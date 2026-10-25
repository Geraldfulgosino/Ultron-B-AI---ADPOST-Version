/**
 * Brand knowledge: chunking + keyword retrieval (BM25-style scoring).
 * Phase 17 can swap retrieval for pgvector embeddings behind the same function.
 */
import type { KnowledgeChunk, KnowledgeDocument } from './types';

export const CHUNK_TARGET = 800;

/** Split on blank lines, then pack paragraphs into ~CHUNK_TARGET-character chunks. */
export function chunkText(text: string, target = CHUNK_TARGET): string[] {
    const paras = text.replace(/\r\n/g, '\n').split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean);
    const chunks: string[] = [];
    let cur = '';
    for (const p of paras) {
        if (p.length > target) {
            if (cur) chunks.push(cur);
            cur = '';
            for (let i = 0; i < p.length; i += target) chunks.push(p.slice(i, i + target));
            continue;
        }
        if (cur && cur.length + p.length + 2 > target) {
            chunks.push(cur);
            cur = p;
        } else cur = cur ? `${cur}\n\n${p}` : p;
    }
    if (cur) chunks.push(cur);
    return chunks;
}

const STOP = new Set(['the', 'and', 'for', 'with', 'that', 'this', 'from', 'are', 'our', 'you', 'your', 'what', 'how', 'can', 'should', 'about', 'into', 'have', 'has', 'was', 'will', 'please']);

export function tokenize(s: string): string[] {
    return s.toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length > 2 && !STOP.has(w));
}

export interface RetrievalHit {
    documentId: string;
    title: string;
    kind: KnowledgeDocument['kind'];
    chunkIndex: number;
    text: string;
    score: number;
}

/** BM25 (k1=1.2, b=0.75) over chunks; title terms count double. */
export function retrieve(docs: readonly KnowledgeDocument[], chunks: readonly KnowledgeChunk[], query: string, limit = 3): RetrievalHit[] {
    const terms = [...new Set(tokenize(query))];
    if (!terms.length || !chunks.length) return [];
    const byId = new Map(docs.map((d) => [d.id, d]));
    const tokenized = chunks.map((c) => {
        const d = byId.get(c.documentId);
        return tokenize(`${c.text} ${d ? `${d.title} ${d.title} ${d.tags.join(' ')}` : ''}`);
    });
    const avg = tokenized.reduce((s, t) => s + t.length, 0) / tokenized.length;
    const df = new Map(terms.map((t) => [t, tokenized.filter((tk) => tk.includes(t)).length]));
    const N = chunks.length;
    return chunks
        .map((c, i) => {
            const tk = tokenized[i]!;
            let score = 0;
            for (const t of terms) {
                const f = tk.filter((x) => x === t).length;
                if (!f) continue;
                const idf = Math.log(1 + (N - df.get(t)! + 0.5) / (df.get(t)! + 0.5));
                score += idf * ((f * 2.2) / (f + 1.2 * (1 - 0.75 + (0.75 * tk.length) / avg)));
            }
            const d = byId.get(c.documentId)!;
            return { documentId: c.documentId, title: d?.title ?? '', kind: d?.kind ?? 'note', chunkIndex: c.index, text: c.text, score: Math.round(score * 1000) / 1000 };
        })
        .filter((h) => h.score > 0 && byId.has(h.documentId))
        .sort((a, b) => b.score - a.score)
        .slice(0, limit);
}
