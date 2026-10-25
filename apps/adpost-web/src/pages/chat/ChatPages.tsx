import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { Archive, ArchiveRestore, FileText, MessageSquarePlus, Search } from 'lucide-react';
import { Page } from '@/layouts/AppShell';
import { Alert, Badge, Button, EmptyState, ErrorState, Input, Label, LoadingState, Select } from '@/components/ui';
import { ChatView, type ProposalHandlers } from '@/components/chat/ChatView';
import { useAction, useBrand, useQuery } from '@/app/backend';
import type { ConversationKind, TeamKey } from '@/domain/types';
import { cn, formatDateTime } from '@/lib/utils';

const TEAMS: Array<{ key: TeamKey; label: string; description: string }> = [
    { key: 'seo', label: 'SEO Team', description: 'SEO Manager with the Technical, Content and Statistics specialists' },
    { key: 'web', label: 'Web Team', description: 'Web Design and Web Development agents' },
    { key: 'all', label: 'All Agents', description: 'Every specialist, led by the SEO Manager' },
];

function ConversationList({ kind, base, activeId }: { kind: ConversationKind; base: string; activeId?: string }) {
    const { brand } = useBrand();
    const [showArchived, setShowArchived] = useState(false);
    const [query, setQuery] = useState('');
    const list = useQuery((api) => api.chat.list(brand.id, { kind, includeArchived: showArchived }), [brand.id, kind, showArchived]);
    const hits = useQuery((api) => api.chat.search(brand.id, query), [brand.id, query]);
    const kindIds = new Set(list.data?.map((c) => c.id));
    const searchHits = (hits.data ?? []).filter((h) => kindIds.has(h.conversationId));

    return (
        <nav aria-label="Conversations" className="space-y-3">
            <div className="relative">
                <Search className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-gray-400" aria-hidden="true" />
                <Input aria-label="Search messages" placeholder="Search messages…" className="pl-9" value={query} onChange={(e) => setQuery(e.target.value)} />
            </div>
            {query.trim().length >= 2 ? (
                <ul className="space-y-1" aria-label="Search results">
                    {!searchHits.length && <li className="text-xs text-gray-500">No matches.</li>}
                    {searchHits.map((h) => (
                        <li key={h.message.id}>
                            <Link to={`${base}/${h.conversationId}`} className="block rounded-lg px-3 py-2 hover:bg-gray-100">
                                <p className="text-xs font-medium text-gray-900">{h.conversationTitle}</p>
                                <p className="text-xs text-gray-600 line-clamp-2">{h.message.body}</p>
                            </Link>
                        </li>
                    ))}
                </ul>
            ) : list.loading ? (
                <LoadingState />
            ) : list.error ? (
                <ErrorState error={list.error} />
            ) : (
                <ul className="space-y-1">
                    {!list.data!.length && <li className="text-xs text-gray-500">No conversations yet.</li>}
                    {list.data!.map((c) => (
                        <li key={c.id}>
                            <Link
                                to={`${base}/${c.id}`}
                                aria-current={c.id === activeId ? 'page' : undefined}
                                className={cn('block rounded-lg px-3 py-2', c.id === activeId ? 'bg-indigo-50 ring-1 ring-indigo-200' : 'hover:bg-gray-100')}
                            >
                                <p className="flex items-center gap-1 text-sm font-medium text-gray-900 truncate">
                                    {c.title} {c.archived && <Badge>Archived</Badge>}
                                </p>
                                <p className="text-xs text-gray-500 truncate">{c.lastMessage ? c.lastMessage.body.slice(0, 80) : 'No messages'}</p>
                            </Link>
                        </li>
                    ))}
                </ul>
            )}
            <label className="flex items-center gap-2 text-xs text-gray-600">
                <input type="checkbox" className="h-3.5 w-3.5 rounded border-gray-300" checked={showArchived} onChange={(e) => setShowArchived(e.target.checked)} />
                Show archived
            </label>
        </nav>
    );
}

function ThreadHeader({ conversationId }: { conversationId: string }) {
    const { brand, can } = useBrand();
    const c = useQuery((api) => api.chat.get(brand.id, conversationId), [brand.id, conversationId]);
    const [editing, setEditing] = useState(false);
    const [title, setTitle] = useState('');
    const rename = useAction((api) => api.chat.rename(brand.id, conversationId, title));
    const archive = useAction((api, archived: boolean) => api.chat.archive(brand.id, conversationId, archived));
    const summarize = useAction((api) => api.chat.summarize(brand.id, conversationId));
    if (!c.data) return null;
    return (
        <div className="space-y-2">
            <div className="flex flex-wrap items-center justify-between gap-2">
                {editing ? (
                    <form
                        className="flex gap-2"
                        onSubmit={async (e) => {
                            e.preventDefault();
                            if (await rename.run()) setEditing(false);
                        }}
                    >
                        <Input aria-label="Conversation title" value={title} onChange={(e) => setTitle(e.target.value)} />
                        <Button type="submit" size="sm">Save</Button>
                    </form>
                ) : (
                    <button type="button" className="text-left font-semibold text-gray-900 disabled:cursor-default" disabled={!can.write} onClick={() => { setTitle(c.data!.title); setEditing(true); }}>
                        {c.data.title}
                    </button>
                )}
                {can.write && (
                    <div className="flex gap-1">
                        {c.data.kind === 'group' && (
                            <Button size="sm" variant="ghost" loading={summarize.pending} onClick={() => void summarize.run()}>
                                <FileText className="h-4 w-4" aria-hidden="true" /> Summarize
                            </Button>
                        )}
                        <Button size="sm" variant="ghost" onClick={() => void archive.run(!c.data!.archived)}>
                            {c.data.archived ? <ArchiveRestore className="h-4 w-4" aria-hidden="true" /> : <Archive className="h-4 w-4" aria-hidden="true" />}
                            {c.data.archived ? 'Unarchive' : 'Archive'}
                        </Button>
                    </div>
                )}
            </div>
            {c.data.summary && (
                <div className="rounded-lg bg-gray-50 p-3 text-xs text-gray-700" aria-label="Thread summary">
                    <p className="font-semibold text-gray-900 mb-1">Summary</p>
                    <p className="whitespace-pre-wrap">{c.data.summary}</p>
                </div>
            )}
        </div>
    );
}

function useProposalApply(): ProposalHandlers['apply'] {
    const { brand } = useBrand();
    const apply = useAction((api, messageId: string, proposalId: string) => api.work.applyProposal(brand.id, messageId, proposalId));
    return async (m, p) => {
        const r = await apply.run(m.id, p.id);
        if (!r && apply.error) throw apply.error;
        return r;
    };
}

export function AgentChatPage() {
    const { conversationId } = useParams();
    const { brand } = useBrand();
    const navigate = useNavigate();
    const agents = useQuery((api) => api.agents.list(brand.id), [brand.id]);
    const conv = useQuery((api) => (conversationId ? api.chat.get(brand.id, conversationId) : Promise.resolve(null)), [brand.id, conversationId]);
    const [agentId, setAgentId] = useState('');
    const create = useAction((api) => api.chat.createDirect(brand.id, agentId || agents.data![0]!.id));
    const apply = useProposalApply();
    const base = `/b/${brand.slug}/chat`;

    return (
        <Page title="Agent Chat" description="One-to-one conversations with a specialist">
            <div className="grid gap-4 lg:grid-cols-[18rem_1fr]">
                <aside className="space-y-4">
                    <div className="space-y-2 rounded-xl border border-gray-200 bg-white p-3">
                        <Label htmlFor="new-chat-agent">New conversation with</Label>
                        <Select id="new-chat-agent" value={agentId} onChange={(e) => setAgentId(e.target.value)}>
                            {agents.data?.map((a) => (
                                <option key={a.id} value={a.id} disabled={!a.active}>
                                    {a.displayName}{a.active ? '' : ' (inactive)'}
                                </option>
                            ))}
                        </Select>
                        <Button
                            className="w-full"
                            size="sm"
                            loading={create.pending}
                            disabled={!agents.data?.length}
                            onClick={async () => {
                                const c = await create.run();
                                if (c) navigate(`${base}/${c.id}`);
                            }}
                        >
                            <MessageSquarePlus className="h-4 w-4" aria-hidden="true" /> Start chat
                        </Button>
                        {create.error ? <ErrorState error={create.error} /> : null}
                    </div>
                    <ConversationList kind="direct" base={base} activeId={conversationId} />
                </aside>
                <div>
                    {!conversationId ? (
                        <EmptyState title="Pick a conversation" description="Or start a new chat with one of the six specialists." />
                    ) : conv.loading ? (
                        <LoadingState />
                    ) : conv.error || !conv.data ? (
                        <ErrorState error={conv.error} />
                    ) : (
                        <ChatView key={conv.data.id} conversation={conv.data} agents={agents.data ?? []} header={<ThreadHeader conversationId={conv.data.id} />} applyProposal={apply} />
                    )}
                </div>
            </div>
        </Page>
    );
}

export function TeamChatPage() {
    const { conversationId } = useParams();
    const { brand, can } = useBrand();
    const navigate = useNavigate();
    const agents = useQuery((api) => api.agents.list(brand.id), [brand.id]);
    const conv = useQuery((api) => (conversationId ? api.chat.get(brand.id, conversationId) : Promise.resolve(null)), [brand.id, conversationId]);
    const create = useAction((api, team: TeamKey) => api.chat.createGroup(brand.id, { team }));
    const apply = useProposalApply();
    const base = `/b/${brand.slug}/team`;

    return (
        <Page title="Team Chat" description="Collaborate with a team of agents. The lead agent delegates to specialists automatically, within limits.">
            <div className="grid gap-4 lg:grid-cols-[18rem_1fr]">
                <aside className="space-y-4">
                    {can.write && (
                        <div className="space-y-2 rounded-xl border border-gray-200 bg-white p-3">
                            <p className="text-sm font-medium text-gray-700">Start a team thread</p>
                            {TEAMS.map((t) => (
                                <button
                                    key={t.key}
                                    type="button"
                                    onClick={async () => {
                                        const c = await create.run(t.key);
                                        if (c) navigate(`${base}/${c.id}`);
                                    }}
                                    className="block w-full rounded-lg border border-gray-200 px-3 py-2 text-left hover:border-indigo-300"
                                >
                                    <span className="block text-sm font-medium text-gray-900">{t.label}</span>
                                    <span className="block text-xs text-gray-500">{t.description}</span>
                                </button>
                            ))}
                            {create.error ? <ErrorState error={create.error} /> : null}
                        </div>
                    )}
                    <ConversationList kind="group" base={base} activeId={conversationId} />
                </aside>
                <div className="space-y-3">
                    <Alert tone="info">Each message runs at most 6 agent replies, with handoffs up to 3 levels deep. Tasks and approvals stay proposals until a person applies them.</Alert>
                    {!conversationId ? (
                        <EmptyState title="Pick or start a team thread" />
                    ) : conv.loading ? (
                        <LoadingState />
                    ) : conv.error || !conv.data ? (
                        <ErrorState error={conv.error} />
                    ) : (
                        <ChatView key={conv.data.id} conversation={conv.data} agents={agents.data ?? []} header={<ThreadHeader conversationId={conv.data.id} />} applyProposal={apply} />
                    )}
                    {conv.data && <p className="text-xs text-gray-500">Created {formatDateTime(conv.data.createdAt)} · {conv.data.agentInstanceIds.length} agents</p>}
                </div>
            </div>
        </Page>
    );
}
