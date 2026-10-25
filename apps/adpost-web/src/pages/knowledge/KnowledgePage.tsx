import { useRef, useState } from 'react';
import { Plus, Search, Upload } from 'lucide-react';
import { Page } from '@/layouts/AppShell';
import { Alert, Badge, Button, Card, CardContent, CardHeader, CardTitle, Dialog, EmptyState, ErrorState, Field, Input, Label, LoadingState, Select, Textarea } from '@/components/ui';
import { fieldErrors, useAction, useBrand, useQuery } from '@/app/backend';
import { readAttachment } from '@/components/chat/ChatView';
import type { KnowledgeDocument, KnowledgeKind } from '@/domain/types';
import { formatDateTime, formatNumber } from '@/lib/utils';

export const KIND_LABELS: Record<KnowledgeKind, string> = {
    brand_guide: 'Brand guide',
    product: 'Product',
    seo_policy: 'SEO policy',
    faq: 'FAQ',
    note: 'Note',
    upload: 'Upload',
};

export function KnowledgePage() {
    const { brand, can } = useBrand();
    const [kind, setKind] = useState<KnowledgeKind | ''>('');
    const [query, setQuery] = useState('');
    const [ask, setAsk] = useState('');
    const docs = useQuery((api) => api.knowledge.list(brand.id, { kind: kind || undefined, query }), [brand.id, kind, query]);
    const hits = useQuery((api) => (ask.trim().length > 2 ? api.knowledge.search(brand.id, ask) : Promise.resolve([])), [brand.id, ask]);
    const upload = useAction((api, file: File) => readAttachment(file).then((a) => api.knowledge.upload(brand.id, a)));
    const remove = useAction((api, id: string) => api.knowledge.remove(brand.id, id));
    const [editing, setEditing] = useState<KnowledgeDocument | 'new' | null>(null);
    const fileRef = useRef<HTMLInputElement>(null);

    return (
        <Page
            title="Knowledge"
            description={`${brand.name}'s brand memory. Agents with the "Read brand knowledge" tool ground their answers in it.`}
            actions={can.write && (
                <>
                    <input ref={fileRef} type="file" accept=".txt,.md,.csv,.json,.html,text/*" className="hidden" aria-label="Upload document" onChange={async (e) => { const f = e.target.files?.[0]; if (f) await upload.run(f); e.target.value = ''; }} />
                    <Button variant="secondary" loading={upload.pending} onClick={() => fileRef.current?.click()}><Upload className="h-4 w-4" aria-hidden="true" /> Upload</Button>
                    <Button onClick={() => setEditing('new')}><Plus className="h-4 w-4" aria-hidden="true" /> New document</Button>
                </>
            )}
        >
            {upload.error || remove.error ? <ErrorState error={upload.error ?? remove.error} /> : null}
            <Card>
                <CardHeader><CardTitle>Test retrieval</CardTitle><p className="text-xs text-gray-500">See which passages an agent would receive for a question.</p></CardHeader>
                <CardContent className="space-y-3">
                    <div className="relative">
                        <Search className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-gray-400" aria-hidden="true" />
                        <Input aria-label="Ask the knowledge base" className="pl-9" placeholder="e.g. how should titles be written?" value={ask} onChange={(e) => setAsk(e.target.value)} />
                    </div>
                    {ask.trim().length > 2 && (
                        hits.data?.length ? (
                            <ol className="space-y-2" aria-label="Retrieved passages">
                                {hits.data.map((h) => (
                                    <li key={`${h.documentId}-${h.chunkIndex}`} className="rounded-lg bg-gray-50 p-3 text-sm">
                                        <p className="text-xs font-medium text-gray-900">{h.title} <span className="text-gray-500">· score {h.score}</span></p>
                                        <p className="mt-1 whitespace-pre-wrap text-gray-700 line-clamp-4">{h.text}</p>
                                    </li>
                                ))}
                            </ol>
                        ) : <p className="text-sm text-gray-500">No passages match.</p>
                    )}
                </CardContent>
            </Card>
            <div className="flex flex-wrap items-end gap-3" role="group" aria-label="Filters">
                <div>
                    <Label htmlFor="kb-kind">Type</Label>
                    <Select id="kb-kind" value={kind} onChange={(e) => setKind(e.target.value as KnowledgeKind | '')}>
                        <option value="">All</option>
                        {Object.entries(KIND_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                    </Select>
                </div>
                <div className="min-w-56">
                    <Label htmlFor="kb-filter">Title or tag</Label>
                    <Input id="kb-filter" value={query} onChange={(e) => setQuery(e.target.value)} />
                </div>
            </div>
            {docs.loading ? (
                <LoadingState />
            ) : docs.error ? (
                <ErrorState error={docs.error} onRetry={docs.reload} />
            ) : !docs.data!.length ? (
                <EmptyState title="No documents" description="Add the brand guide, product facts and SEO policies your agents should follow." />
            ) : (
                <ul className="grid gap-3 md:grid-cols-2" aria-label="Documents">
                    {docs.data!.map((d) => (
                        <li key={d.id}>
                            <Card className="h-full">
                                <CardContent className="space-y-2">
                                    <div className="flex items-start justify-between gap-2">
                                        <button type="button" className="text-left font-medium text-gray-900 hover:text-indigo-700" onClick={() => setEditing(d)}>{d.title}</button>
                                        <Badge variant="indigo">{KIND_LABELS[d.kind]}</Badge>
                                    </div>
                                    <p className="text-sm text-gray-600 line-clamp-3">{d.content}</p>
                                    <div className="flex flex-wrap items-center gap-1 text-xs text-gray-500">
                                        {d.tags.map((t) => <Badge key={t}>{t}</Badge>)}
                                        <span>{formatNumber(d.sizeBytes)} bytes · updated {formatDateTime(d.updatedAt)}</span>
                                    </div>
                                    {can.write && <button type="button" className="text-xs text-gray-500 hover:text-red-700" onClick={() => confirm(`Delete "${d.title}"?`) && void remove.run(d.id)}>Delete</button>}
                                </CardContent>
                            </Card>
                        </li>
                    ))}
                </ul>
            )}
            {editing && <DocumentDialog doc={editing === 'new' ? null : editing} readOnly={!can.write} onClose={() => setEditing(null)} />}
        </Page>
    );
}

function DocumentDialog({ doc, readOnly, onClose }: { doc: KnowledgeDocument | null; readOnly: boolean; onClose: () => void }) {
    const { brand } = useBrand();
    const [form, setForm] = useState({ title: doc?.title ?? '', kind: doc?.kind ?? ('note' as KnowledgeKind), content: doc?.content ?? '', tags: doc?.tags.join(', ') ?? '' });
    const save = useAction((api) => {
        const input = { ...form, tags: form.tags.split(',') };
        return doc ? api.knowledge.update(brand.id, doc.id, input) : api.knowledge.create(brand.id, input);
    });
    const errors = fieldErrors(save.error);
    return (
        <Dialog open title={doc ? 'Edit document' : 'New document'} onClose={onClose} footer={readOnly ? <Button onClick={onClose}>Close</Button> : <><Button variant="secondary" onClick={onClose}>Cancel</Button><Button loading={save.pending} onClick={async () => (await save.run()) && onClose()}>Save</Button></>}>
            <fieldset disabled={readOnly} className="space-y-4">
                <Alert tone="info">Changes are re-indexed immediately and used by agents in their next reply.</Alert>
                <div className="grid gap-4 sm:grid-cols-2">
                    <Field id="doc-title" label="Title" required><Input id="doc-title" value={form.title} error={errors.title} onChange={(e) => setForm({ ...form, title: e.target.value })} /></Field>
                    <Field id="doc-kind" label="Type"><Select id="doc-kind" value={form.kind} onChange={(e) => setForm({ ...form, kind: e.target.value as KnowledgeKind })}>{Object.entries(KIND_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</Select></Field>
                </div>
                <Field id="doc-content" label="Content" required>
                    <Textarea id="doc-content" rows={10} value={form.content} onChange={(e) => setForm({ ...form, content: e.target.value })} />
                    {errors.content && <p className="mt-1 text-xs text-red-600">{errors.content}</p>}
                </Field>
                <Field id="doc-tags" label="Tags" hint="Comma separated"><Input id="doc-tags" value={form.tags} onChange={(e) => setForm({ ...form, tags: e.target.value })} /></Field>
            </fieldset>
        </Dialog>
    );
}
