import { chunkText, retrieve, tokenize } from '@/domain/knowledge';
import { as, IDS, testDb } from '@/test/helpers';
import { AccessDeniedError, NotFoundError, ValidationError } from '../errors';
import { Scope } from './scope';
import { brandContext } from './engine';

const { pod, dmd } = IDS.brands;

describe('knowledge (pure)', () => {
    it('chunks on paragraph boundaries near the target size', () => {
        const text = Array.from({ length: 6 }, (_, i) => `Paragraph ${i} `.repeat(20)).join('\n\n');
        const chunks = chunkText(text, 600);
        expect(chunks.length).toBeGreaterThan(1);
        expect(chunks.every((c) => c.length <= 600)).toBe(true);
        expect(chunkText('x'.repeat(1700), 800)).toHaveLength(3);
    });

    it('tokenizes without stopwords and ranks the relevant chunk first', () => {
        expect(tokenize('How should the Title tags be written?')).toEqual(['title', 'tags', 'written']);
        const docs = [
            { id: 'd1', brandId: 'b', title: 'Voice', kind: 'brand_guide' as const, content: '', tags: [], sizeBytes: 0, createdBy: 'u', createdAt: '', updatedAt: '' },
            { id: 'd2', brandId: 'b', title: 'SEO policy', kind: 'seo_policy' as const, content: '', tags: ['titles'], sizeBytes: 0, createdBy: 'u', createdAt: '', updatedAt: '' },
        ];
        const chunks = [
            { id: 'c1', brandId: 'b', documentId: 'd1', index: 0, text: 'Speak plainly and warmly.' },
            { id: 'c2', brandId: 'b', documentId: 'd2', index: 0, text: 'Title tags under 60 characters with the keyword first.' },
        ];
        expect(retrieve(docs, chunks, 'title tags length')[0]!.documentId).toBe('d2');
        expect(retrieve(docs, chunks, 'the and of')).toEqual([]);
    });
});

describe('knowledge API', () => {
    it('seeds a brand guide + SEO policy per brand, isolated', async () => {
        const docs = await as('priya').api.knowledge.list(pod);
        expect(docs.map((d) => d.kind).sort()).toEqual(['brand_guide', 'seo_policy']);
        await expect(as('priya').api.knowledge.list(dmd)).rejects.toBeInstanceOf(AccessDeniedError);
        await expect(as('priya').api.knowledge.get(pod, 'kdoc_dmd_1')).rejects.toBeInstanceOf(NotFoundError);
        await expect(as('casey').api.knowledge.list(pod)).rejects.toBeInstanceOf(AccessDeniedError);
    });

    it('create/update re-indexes; search returns ranked passages', async () => {
        const db = testDb();
        const api = as('priya', db).api;
        const doc = await api.knowledge.create(pod, { title: 'Returns policy', kind: 'faq', content: 'Customers may return unworn items within 30 days.', tags: ['Returns', 'returns'] });
        expect(doc.tags).toEqual(['returns']);
        expect((await api.knowledge.search(pod, 'return items days'))[0]!.documentId).toBe(doc.id);
        await api.knowledge.update(pod, doc.id, { content: 'Exchanges only, within 14 days.' });
        expect(db.all('knowledgeChunks').filter((c) => c.documentId === doc.id).map((c) => c.text)).toEqual(['Exchanges only, within 14 days.']);
        await expect(api.knowledge.create(pod, { title: '', kind: 'note', content: 'x' })).rejects.toBeInstanceOf(ValidationError);
        await expect(as('vic', db).api.knowledge.create(pod, { title: 't', kind: 'note', content: 'x' })).rejects.toBeInstanceOf(AccessDeniedError);
        await api.knowledge.remove(pod, doc.id);
        expect(db.all('knowledgeChunks').some((c) => c.documentId === doc.id)).toBe(false);
    });

    it('uploads text files; rejects binary locally', async () => {
        const api = as('priya').api;
        const d = await api.knowledge.upload(pod, { name: 'faq.md', sizeBytes: 10, mimeType: 'text/markdown', text: '# FAQ\nShipping is free.' });
        expect(d).toMatchObject({ title: 'faq', kind: 'upload' });
        await expect(api.knowledge.upload(pod, { name: 'logo.png', sizeBytes: 10, mimeType: 'image/png', text: null })).rejects.toBeInstanceOf(ValidationError);
    });

    it('saves a chat attachment into knowledge once', async () => {
        const db = testDb();
        const api = as('priya', db).api;
        const c = await api.chat.createDirect(pod, 'agt_pod_content_seo');
        const { message } = await api.chat.send(pod, c.id, { body: 'see file', attachments: [{ name: 'notes.txt', sizeBytes: 5, mimeType: 'text/plain', text: 'Launch in May.' }] });
        const doc = await api.knowledge.saveAttachment(pod, message.id, message.attachments[0]!.id);
        expect(doc.content).toBe('Launch in May.');
        await expect(api.knowledge.saveAttachment(pod, message.id, message.attachments[0]!.id)).rejects.toBeInstanceOf(ValidationError);
    });
});

describe('agent grounding respects tool permissions', () => {
    it('knowledge reaches agents with read_knowledge only; analytics only with analytics tools', () => {
        const db = testDb();
        const scope = new Scope(db, IDS.users.priya);
        const withAll = brandContext(scope, pod, 'title tags', ['read_knowledge', 'read_analytics', 'read_search_console']);
        expect(withAll.knowledge[0]!.title).toBe('POD SEO policy');
        expect(withAll.kpis.window).not.toBeNull();
        const none = brandContext(scope, pod, 'title tags', []);
        expect(none).toMatchObject({ knowledge: [], insights: [], topQueries: [], kpis: { window: null, sessions: 0 } });
    });

    it('an agent reply cites brand knowledge when allowed', async () => {
        const db = testDb();
        const api = as('priya', db).api;
        const c = await api.chat.createDirect(pod, 'agt_pod_content_seo');
        const { replies } = await api.chat.send(pod, c.id, { body: 'Write a title tag following our policy' });
        expect(replies[0]!.body).toContain('Brand knowledge used: "POD SEO policy"');
    });
});
