import React, { useEffect, useRef, useState } from 'react';
import { Paperclip, RotateCcw, Send, X } from 'lucide-react';
import { Badge, Button, ErrorState, LoadingState } from '@/components/ui';
import { fieldErrors, useAction, useBrand, useQuery } from '@/app/backend';
import type { AttachmentInput } from '@/data/contracts';
import type { AgentInstance, Conversation, Message, Proposal } from '@/domain/types';
import { cn, formatDateTime } from '@/lib/utils';

const TEXT_TYPES = /^(text\/|application\/(json|xml|csv))/;
const TEXT_EXT = /\.(md|txt|csv|json|html?|xml|ya?ml)$/i;
export const MAX_FILE_BYTES = 1_000_000;

export async function readAttachment(file: File): Promise<AttachmentInput> {
    const isText = TEXT_TYPES.test(file.type) || TEXT_EXT.test(file.name);
    const text = isText && file.size <= MAX_FILE_BYTES ? await file.text() : null;
    return { name: file.name, sizeBytes: file.size, mimeType: file.type || 'application/octet-stream', text };
}

const PROPOSAL_LABEL: Record<Proposal['action']['type'], string> = {
    create_task: 'Create task',
    request_approval: 'Request approval',
    delegate: 'Hand off',
};

export interface ProposalHandlers {
    apply?: (message: Message, proposal: Proposal) => Promise<unknown>;
    dismiss: (message: Message, proposal: Proposal) => Promise<unknown>;
}

function ProposalCard({ message, proposal, handlers, canWrite }: { message: Message; proposal: Proposal; handlers: ProposalHandlers; canWrite: boolean }) {
    const a = proposal.action;
    const [busy, setBusy] = useState(false);
    const title = a.type === 'delegate' ? `@${a.handle}` : a.title;
    const detail = a.type === 'delegate' ? a.brief : a.type === 'create_task' ? `Priority: ${a.priority}` : a.summary;
    const run = async (fn: () => Promise<unknown>) => {
        setBusy(true);
        try {
            await fn();
        } finally {
            setBusy(false);
        }
    };
    return (
        <div className="rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm" data-testid="proposal">
            <div className="flex flex-wrap items-center gap-2">
                <Badge variant={a.type === 'request_approval' ? 'yellow' : a.type === 'delegate' ? 'indigo' : 'blue'}>{PROPOSAL_LABEL[a.type]}</Badge>
                <span className="font-medium text-gray-900">{title}</span>
                {proposal.status !== 'proposed' && <Badge variant={proposal.status === 'applied' ? 'green' : 'gray'}>{proposal.status === 'applied' ? (a.type === 'delegate' ? 'Handed off' : 'Applied') : 'Dismissed'}</Badge>}
            </div>
            <p className="mt-1 text-xs text-gray-600">{detail}</p>
            {proposal.status === 'proposed' && canWrite && (
                <div className="mt-2 flex gap-2">
                    {handlers.apply && a.type !== 'delegate' && (
                        <Button size="sm" loading={busy} onClick={() => void run(() => handlers.apply!(message, proposal))}>
                            {a.type === 'create_task' ? 'Create task' : 'Send for approval'}
                        </Button>
                    )}
                    <Button size="sm" variant="ghost" disabled={busy} onClick={() => void run(() => handlers.dismiss(message, proposal))}>
                        Dismiss
                    </Button>
                </div>
            )}
        </div>
    );
}

function MessageItem({ m, agents, userNames, onRetry, retrying, handlers, canWrite, onSaveAttachment }: {
    m: Message;
    agents: AgentInstance[];
    userNames: Map<string, string>;
    onRetry: (m: Message) => void;
    retrying: boolean;
    handlers: ProposalHandlers;
    canWrite: boolean;
    onSaveAttachment: (m: Message, attachmentId: string) => void;
}) {
    if (m.author.type === 'system') {
        return (
            <li className={cn('mx-auto max-w-xl rounded-lg px-3 py-2 text-xs', m.status === 'failed' ? 'bg-red-50 text-red-800' : 'bg-gray-100 text-gray-600')} role={m.status === 'failed' ? 'alert' : undefined}>
                <p className="whitespace-pre-wrap">{m.body}</p>
                {m.status === 'failed' && canWrite && (
                    <button type="button" className="mt-1 inline-flex items-center gap-1 font-medium underline disabled:opacity-50" disabled={retrying} onClick={() => onRetry(m)}>
                        <RotateCcw className="h-3 w-3" aria-hidden="true" /> {retrying ? 'Retrying…' : 'Retry'}
                    </button>
                )}
            </li>
        );
    }
    const isUser = m.author.type === 'user';
    const authorId = m.author.type === 'agent' ? m.author.agentInstanceId : '';
    const name = m.author.type === 'user' ? userNames.get(m.author.userId) ?? 'You' : agents.find((a) => a.id === authorId)?.displayName ?? 'Agent';
    return (
        <li className={cn('flex', isUser ? 'justify-end' : 'justify-start')}>
            <article className={cn('max-w-[85%] space-y-2 rounded-2xl px-4 py-3', isUser ? 'bg-indigo-600 text-white' : 'bg-white border border-gray-200 text-gray-900')} aria-label={`${name} message`}>
                <header className={cn('flex flex-wrap items-center gap-2 text-xs', isUser ? 'text-indigo-100' : 'text-gray-500')}>
                    <span className="font-semibold">{name}</span>
                    <span>{formatDateTime(m.createdAt)}</span>
                    {m.mode === 'simulated' && <Badge variant="blue">Simulated</Badge>}
                    {m.mode === 'live' && <Badge variant="green">Live</Badge>}
                </header>
                {m.body && <p className="whitespace-pre-wrap text-sm leading-relaxed">{m.body}</p>}
                {m.attachments.length > 0 && (
                    <ul className="flex flex-wrap gap-1">
                        {m.attachments.map((a) => (
                            <li key={a.id} className={cn('rounded px-2 py-0.5 text-xs', isUser ? 'bg-indigo-500' : 'bg-gray-100')}>
                                <Paperclip className="mr-1 inline h-3 w-3" aria-hidden="true" />
                                {a.name} {a.textExcerpt === null && '(not read)'}
                                {canWrite && a.textExcerpt !== null && (a.knowledgeDocumentId ? <span className="ml-1 opacity-75">· in knowledge</span> : (
                                    <button type="button" className="ml-1 underline" onClick={() => onSaveAttachment(m, a.id)}>Save to knowledge</button>
                                ))}
                            </li>
                        ))}
                    </ul>
                )}
                {m.proposals.length > 0 && (
                    <div className="space-y-2">
                        {m.proposals.map((p) => <ProposalCard key={p.id} message={m} proposal={p} handlers={handlers} canWrite={canWrite} />)}
                    </div>
                )}
            </article>
        </li>
    );
}

export function ChatView({ conversation, agents, header, applyProposal }: {
    conversation: Conversation;
    agents: AgentInstance[];
    header?: React.ReactNode;
    applyProposal?: ProposalHandlers['apply'];
}) {
    const { brand, can } = useBrand();
    const messages = useQuery((api) => api.chat.messages(brand.id, conversation.id), [brand.id, conversation.id]);
    const members = useQuery((api) => (can.staff ? api.members.list(brand.id) : Promise.resolve([])), [brand.id]);
    const [body, setBody] = useState('');
    const [files, setFiles] = useState<AttachmentInput[]>([]);
    const send = useAction((api, input: { body: string; attachments: AttachmentInput[] }) => api.chat.send(brand.id, conversation.id, input));
    const retry = useAction((api, id: string) => api.chat.retry(brand.id, conversation.id, id));
    const dismiss = useAction((api, m: Message, p: Proposal) => api.chat.dismissProposal(brand.id, m.id, p.id));
    const saveAttachment = useAction((api, m: Message, attachmentId: string) => api.knowledge.saveAttachment(brand.id, m.id, attachmentId));
    const endRef = useRef<HTMLDivElement>(null);
    const fileRef = useRef<HTMLInputElement>(null);
    const errors = fieldErrors(send.error);
    const userNames = new Map((members.data ?? []).map((m) => [m.userId, m.name]));
    const inConversation = agents.filter((a) => conversation.agentInstanceIds.includes(a.id));
    const responders = conversation.kind === 'direct' ? inConversation[0]?.displayName ?? 'Agent' : 'The team';

    useEffect(() => endRef.current?.scrollIntoView?.({ block: 'end' }), [messages.data?.length, send.pending]);

    const submit = async () => {
        if (send.pending || (!body.trim() && !files.length)) return;
        const res = await send.run({ body, attachments: files });
        if (res) {
            setBody('');
            setFiles([]);
        }
    };

    return (
        <section className="flex h-full min-h-[60vh] flex-col rounded-xl border border-gray-200 bg-gray-50" aria-label={conversation.title}>
            <div className="border-b border-gray-200 bg-white px-4 py-3 rounded-t-xl">{header}</div>
            <div className="flex-1 overflow-y-auto px-4 py-4" aria-live="polite">
                {messages.loading ? (
                    <LoadingState />
                ) : messages.error ? (
                    <ErrorState error={messages.error} onRetry={messages.reload} />
                ) : (
                    <ol className="space-y-3">
                        {!messages.data!.length && <li className="py-8 text-center text-sm text-gray-500">No messages yet. Ask {responders} anything about {brand.name}.</li>}
                        {messages.data!.map((m) => (
                            <MessageItem
                                key={m.id}
                                m={m}
                                agents={agents}
                                userNames={userNames}
                                canWrite={can.write}
                                retrying={retry.pending}
                                onRetry={(x) => void retry.run(x.id)}
                                onSaveAttachment={(mm, id) => void saveAttachment.run(mm, id)}
                                handlers={{ apply: applyProposal, dismiss: (mm, p) => dismiss.run(mm, p) }}
                            />
                        ))}
                        {send.pending && <li className="text-sm text-gray-500" role="status">{responders} is responding…</li>}
                    </ol>
                )}
                <div ref={endRef} />
            </div>
            {send.error || retry.error || dismiss.error || saveAttachment.error ? (
                <div className="px-4 pb-2">{Object.keys(errors).length ? <p className="text-xs text-red-600">{Object.values(errors)[0]}</p> : <ErrorState error={send.error ?? retry.error ?? dismiss.error ?? saveAttachment.error} />}</div>
            ) : null}
            {can.write && !conversation.archived ? (
                <form
                    className="border-t border-gray-200 bg-white p-3 rounded-b-xl space-y-2"
                    onSubmit={(e) => {
                        e.preventDefault();
                        void submit();
                    }}
                >
                    {conversation.kind === 'group' && (
                        <div className="flex flex-wrap gap-1" aria-label="Mention an agent">
                            {inConversation.map((a) => (
                                <button
                                    key={a.id}
                                    type="button"
                                    disabled={!a.active}
                                    title={a.active ? `Mention ${a.displayName}` : `${a.displayName} is inactive`}
                                    onClick={() => setBody((b) => `${b}${b && !b.endsWith(' ') ? ' ' : ''}@${a.handle} `)}
                                    className="rounded-full border border-gray-200 px-2 py-0.5 text-xs text-gray-700 hover:bg-gray-100 disabled:opacity-40"
                                >
                                    @{a.handle}
                                </button>
                            ))}
                        </div>
                    )}
                    {files.length > 0 && (
                        <ul className="flex flex-wrap gap-1">
                            {files.map((f, i) => (
                                <li key={f.name + i} className="flex items-center gap-1 rounded bg-gray-100 px-2 py-0.5 text-xs text-gray-700">
                                    {f.name}
                                    <button type="button" aria-label={`Remove ${f.name}`} onClick={() => setFiles(files.filter((_, j) => j !== i))}>
                                        <X className="h-3 w-3" />
                                    </button>
                                </li>
                            ))}
                        </ul>
                    )}
                    <div className="flex items-end gap-2">
                        <label className="sr-only" htmlFor={`composer-${conversation.id}`}>Message</label>
                        <textarea
                            id={`composer-${conversation.id}`}
                            rows={2}
                            value={body}
                            placeholder={conversation.kind === 'group' ? 'Message the team. Use @handle to address a specialist.' : 'Message the agent…'}
                            onChange={(e) => setBody(e.target.value)}
                            onKeyDown={(e) => {
                                if (e.key === 'Enter' && !e.shiftKey) {
                                    e.preventDefault();
                                    void submit();
                                }
                            }}
                            className="block w-full resize-none rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                        />
                        <input
                            ref={fileRef}
                            type="file"
                            multiple
                            className="hidden"
                            aria-label="Attach files"
                            onChange={async (e) => {
                                const picked = await Promise.all([...(e.target.files ?? [])].map(readAttachment));
                                setFiles((f) => [...f, ...picked].slice(0, 5));
                                e.target.value = '';
                            }}
                        />
                        <Button variant="secondary" aria-label="Attach files" onClick={() => fileRef.current?.click()}>
                            <Paperclip className="h-4 w-4" />
                        </Button>
                        <Button type="submit" aria-label="Send" loading={send.pending} disabled={!body.trim() && !files.length}>
                            <Send className="h-4 w-4" />
                        </Button>
                    </div>
                    <p className="text-[11px] text-gray-400">Enter to send · Shift+Enter for a new line · text files (≤1 MB) are read by the agent</p>
                </form>
            ) : (
                <p className="border-t border-gray-200 bg-white p-3 text-center text-xs text-gray-500 rounded-b-xl">
                    {conversation.archived ? 'This conversation is archived.' : 'Your role can read conversations but not send messages.'}
                </p>
            )}
        </section>
    );
}
