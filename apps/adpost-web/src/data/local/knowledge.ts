import type { ID, KnowledgeDocument, KnowledgeKind } from '@/domain/types';
import type { KnowledgeApi } from '../contracts';
import { chunkText, retrieve } from '@/domain/knowledge';
import { assertValid, NotFoundError, ValidationError } from '../errors';
import { newId } from '@/lib/utils';
import type { DbSnapshot, LocalDatabase } from './db';
import type { Scope } from './scope';
import { assertKnowledgeRoom } from './entitlements';

export const KNOWLEDGE_KINDS: KnowledgeKind[] = ['brand_guide', 'product', 'seo_policy', 'faq', 'note', 'upload'];
export const MAX_DOC_CHARS = 200_000;

/** (Re)build a document's chunks. Shared by the API and fixtures. */
export function indexDocument(db: LocalDatabase, doc: KnowledgeDocument): void {
    db.delete('knowledgeChunks', (c) => c.documentId === doc.id);
    db.insertMany(
        'knowledgeChunks',
        chunkText(doc.content).map((text, index) => ({ id: `${doc.id}_c${index}`, brandId: doc.brandId, documentId: doc.id, index, text })),
    );
}

const cleanTags = (tags: string[] = []) => [...new Set(tags.map((t) => t.trim().toLowerCase()).filter(Boolean))].slice(0, 20);

export function localKnowledge(scope: Scope): KnowledgeApi {
    const { db } = scope;

    const validate = (input: { title?: string; kind?: KnowledgeKind; content?: string }) =>
        assertValid({
            title: input.title !== undefined && !input.title.trim() && 'Title is required.',
            kind: input.kind !== undefined && !KNOWLEDGE_KINDS.includes(input.kind) && 'Unknown document type.',
            content: input.content !== undefined && ((!input.content.trim() && 'Content is required.') || (input.content.length > MAX_DOC_CHARS && 'Documents are limited to 200,000 characters.')),
        });

    const create = (brandId: ID, input: { title: string; kind: KnowledgeKind; content: string; tags?: string[] }): KnowledgeDocument => {
        validate(input);
        assertKnowledgeRoom(db, brandId, new TextEncoder().encode(input.content).length);
        const doc: KnowledgeDocument = {
            id: newId('kdoc'), brandId, title: input.title.trim(), kind: input.kind, content: input.content.trim(), tags: cleanTags(input.tags),
            sizeBytes: new TextEncoder().encode(input.content).length, createdBy: scope.userId, createdAt: db.nowIso(), updatedAt: db.nowIso(),
        };
        db.insert('knowledgeDocuments', doc);
        indexDocument(db, doc);
        scope.audit(brandId, 'knowledge.created', 'knowledge_document', doc.id);
        return doc;
    };

    return {
        async list(brandId, f = {}) {
            const q = f.query?.trim().toLowerCase();
            return scope
                .rows('knowledgeDocuments', brandId)
                .filter((d) => (!f.kind || d.kind === f.kind) && (!q || d.title.toLowerCase().includes(q) || d.tags.some((t) => t.includes(q))))
                .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
        },

        async get(brandId, id) {
            return scope.row('knowledgeDocuments', brandId, id, { label: 'Document' });
        },

        async create(brandId, input) {
            scope.require(brandId, 'write');
            return structuredClone(create(brandId, input));
        },

        async update(brandId, id, input) {
            scope.require(brandId, 'write');
            scope.owned('knowledgeDocuments', brandId, id, 'Document');
            validate(input);
            const patch: Partial<KnowledgeDocument> = { updatedAt: db.nowIso() };
            if (input.title !== undefined) patch.title = input.title.trim();
            if (input.kind !== undefined) patch.kind = input.kind;
            if (input.tags !== undefined) patch.tags = cleanTags(input.tags);
            if (input.content !== undefined) {
                patch.content = input.content.trim();
                patch.sizeBytes = new TextEncoder().encode(input.content).length;
            }
            const doc = db.patch('knowledgeDocuments', id, patch);
            if (input.content !== undefined) indexDocument(db, doc);
            scope.audit(brandId, 'knowledge.updated', 'knowledge_document', id);
            return structuredClone(doc);
        },

        async remove(brandId, id) {
            scope.require(brandId, 'write');
            scope.owned('knowledgeDocuments', brandId, id, 'Document');
            db.delete('knowledgeChunks', (c) => c.documentId === id);
            db.delete('knowledgeDocuments', (d) => d.id === id);
            scope.audit(brandId, 'knowledge.deleted', 'knowledge_document', id);
        },

        async upload(brandId, file) {
            scope.require(brandId, 'write');
            if (file.text === null) throw new ValidationError({ file: 'Only text files (.txt, .md, .csv, .json, .html) can be indexed locally. Binary uploads use Supabase Storage in Phase 17.' });
            return structuredClone(create(brandId, { title: file.name.replace(/\.[a-z0-9]+$/i, ''), kind: 'upload', content: file.text, tags: ['upload'] }));
        },

        async search(brandId, query) {
            const docs = scope.rows('knowledgeDocuments', brandId);
            return retrieve(docs, scope.rows('knowledgeChunks', brandId), query, 8);
        },

        async saveAttachment(brandId, messageId, attachmentId) {
            scope.require(brandId, 'write');
            const m = scope.owned('messages', brandId, messageId, 'Message');
            const att = m.attachments.find((a) => a.id === attachmentId);
            if (!att) throw new NotFoundError('Attachment');
            if (att.knowledgeDocumentId) throw new ValidationError({ attachment: 'Already saved to knowledge.' });
            if (!att.textExcerpt) throw new ValidationError({ attachment: 'Only text attachments can be saved locally.' });
            const doc = create(brandId, { title: att.name.replace(/\.[a-z0-9]+$/i, ''), kind: 'upload', content: att.textExcerpt, tags: ['from-chat'] });
            db.patch('messages', m.id, { attachments: m.attachments.map((a) => (a.id === attachmentId ? { ...a, knowledgeDocumentId: doc.id } : a)) });
            return structuredClone(doc);
        },
    };
}

/** Synthetic brand guides so agents have brand memory to ground in. */
export function seedKnowledge(s: DbSnapshot, brands: Array<{ id: string; name: string }>, createdBy: ID, now: string): void {
    for (const b of brands) {
        const docs: Array<Pick<KnowledgeDocument, 'title' | 'kind' | 'content' | 'tags'>> = [
            {
                title: `${b.name} brand voice guide`,
                kind: 'brand_guide',
                tags: ['voice', 'tone', 'brand'],
                content: `${b.name} speaks in a clear, confident and friendly voice. Use plain language and short sentences.\n\nAudience: busy decision makers comparing options online. Lead with the benefit, then the proof.\n\nDo: use active voice, concrete numbers, and one call to action per section. Don't: use jargon, exclamation marks, or unverifiable superlatives.\n\n(Synthetic development content: replace with the real ${b.name} guide.)`,
            },
            {
                title: `${b.name} SEO policy`,
                kind: 'seo_policy',
                tags: ['seo', 'policy', 'titles'],
                content: `Title tags: under 60 characters, primary keyword first, brand last ("Keyword | ${b.name}").\n\nMeta descriptions: 140 to 155 characters with a clear call to action.\n\nNever publish content or change templates without an approval request. Structured data: Organization site-wide, FAQ on support pages, Product on product pages.\n\n(Synthetic development content.)`,
            },
        ];
        for (const [i, d] of docs.entries()) {
            const doc: KnowledgeDocument = { id: `kdoc_${b.id.slice(4)}_${i + 1}`, brandId: b.id, ...d, sizeBytes: d.content.length, createdBy, createdAt: now, updatedAt: now };
            s.knowledgeDocuments.push(doc);
            chunkText(doc.content).forEach((text, index) => s.knowledgeChunks.push({ id: `${doc.id}_c${index}`, brandId: b.id, documentId: doc.id, index, text }));
        }
    }
}
