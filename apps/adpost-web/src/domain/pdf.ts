/**
 * Minimal dependency-free PDF writer (PDF 1.4, Helvetica, A4, text + rules).
 * Enough for the report export; avoids pulling a PDF library into the bundle.
 * The server-side report-export Edge Function can replace it in Phase 17.
 */
import { type ReportData, sourceLabel, websiteLabel } from './analytics';

type Line = { text: string; size: number; bold?: boolean; gap?: number; rule?: boolean; indent?: number };

const PAGE_W = 595;
const PAGE_H = 842;
const MARGIN = 50;

/** PDF string literal escaping; non-Latin-1 characters are replaced with '?'. */
function pdfText(s: string): string {
    return s.replace(/[^\x20-\x7e\xa0-\xff]/g, '?').replace(/([\\()])/g, '\\$1');
}

/** Rough Helvetica width (avg 0.5em) to wrap long lines. */
function wrap(text: string, size: number, indent = 0): string[] {
    const max = Math.floor((PAGE_W - 2 * MARGIN - indent) / (size * 0.5));
    if (text.length <= max) return [text];
    const out: string[] = [];
    let line = '';
    for (const word of text.split(' ')) {
        if ((line + ' ' + word).trim().length > max) {
            if (line) out.push(line);
            line = word;
        } else line = (line + ' ' + word).trim();
    }
    if (line) out.push(line);
    return out;
}

export function buildPdf(lines: Line[]): Uint8Array {
    const pages: string[][] = [[]];
    let y = PAGE_H - MARGIN;
    for (const l of lines) {
        const parts = l.rule ? [''] : wrap(l.text, l.size, l.indent);
        for (const part of parts) {
            const lead = l.size * 1.4 + (l.gap ?? 0);
            if (y - lead < MARGIN) {
                pages.push([]);
                y = PAGE_H - MARGIN;
            }
            y -= lead;
            const ops = pages[pages.length - 1]!;
            if (l.rule) ops.push(`0.85 G 0.5 w ${MARGIN} ${y + l.size} m ${PAGE_W - MARGIN} ${y + l.size} l S`);
            else ops.push(`BT /${l.bold ? 'F2' : 'F1'} ${l.size} Tf ${MARGIN + (l.indent ?? 0)} ${y.toFixed(1)} Td (${pdfText(part)}) Tj ET`);
        }
    }

    const objects: string[] = [];
    const add = (body: string) => objects.push(body); // object number = index + 1
    add('<< /Type /Catalog /Pages 2 0 R >>');
    add(''); // pages placeholder
    add('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>');
    add('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>');
    const kids: number[] = [];
    pages.forEach((ops, i) => {
        const footer = `BT /F1 8 Tf ${MARGIN} 30 Td (${pdfText(`Page ${i + 1} of ${pages.length}`)}) Tj ET`;
        const stream = [...ops, footer].join('\n');
        add(`<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`);
        const contentNo = objects.length;
        add(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${PAGE_W} ${PAGE_H}] /Resources << /Font << /F1 3 0 R /F2 4 0 R >> >> /Contents ${contentNo} 0 R >>`);
        kids.push(objects.length);
    });
    objects[1] = `<< /Type /Pages /Kids [${kids.map((k) => `${k} 0 R`).join(' ')}] /Count ${kids.length} >>`;

    let out = '%PDF-1.4\n';
    const offsets: number[] = [];
    objects.forEach((body, i) => {
        offsets.push(out.length);
        out += `${i + 1} 0 obj\n${body}\nendobj\n`;
    });
    const xref = out.length;
    out += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
    for (const off of offsets) out += `${String(off).padStart(10, '0')} 00000 n \n`;
    out += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;

    // All content is Latin-1 after pdfText, so a byte-per-char encoding keeps offsets exact.
    const bytes = new Uint8Array(out.length);
    for (let i = 0; i < out.length; i++) bytes[i] = out.charCodeAt(i) & 0xff;
    return bytes;
}

const n = (v: number) => new Intl.NumberFormat('en-US').format(v);

export function reportToPdf(report: ReportData, brandName: string, generatedAt: string): Uint8Array {
    const { filters, summary } = report;
    const showGsc = filters.source !== 'ga4';
    const showGa4 = filters.source !== 'gsc';
    const L: Line[] = [
        { text: 'ULTRON-B AI - SEO Performance Report', size: 18, bold: true },
        { text: brandName, size: 12, gap: 2 },
        { text: `${filters.from} to ${filters.to}  |  Source: ${sourceLabel(filters.source)}  |  Website: ${websiteLabel(report)}`, size: 9, gap: 4 },
        { text: `Generated ${generatedAt}`, size: 8 },
        { text: '', size: 8, rule: true, gap: 6 },
    ];
    if (!report.hasData) {
        L.push({ text: 'No report data for the selected range.', size: 11, gap: 8 });
    } else {
        L.push({ text: 'Executive summary', size: 13, bold: true, gap: 8 });
        L.push({ text: executiveSummary(report), size: 10, gap: 2 });
        L.push({ text: 'Summary metrics', size: 13, bold: true, gap: 10 });
        if (showGsc) {
            L.push({ text: `GSC clicks: ${n(summary.gscClicks)}`, size: 10, indent: 10 });
            L.push({ text: `GSC impressions: ${n(summary.gscImpressions)}`, size: 10, indent: 10 });
        }
        if (showGa4) {
            L.push({ text: `GA4 sessions: ${n(summary.ga4Sessions)}`, size: 10, indent: 10 });
            L.push({ text: `GA4 conversions: ${n(summary.ga4Conversions)}`, size: 10, indent: 10 });
        }
        if (showGsc) {
            L.push({ text: 'Top queries (clicks)', size: 13, bold: true, gap: 10 });
            if (!report.topQueries.length) L.push({ text: 'No data', size: 10, indent: 10 });
            report.topQueries.forEach((q, i) => L.push({ text: `${i + 1}. ${q.query} - ${n(q.clicks)}`, size: 10, indent: 10 }));
        }
        if (showGa4) {
            L.push({ text: 'Top pages (sessions)', size: 13, bold: true, gap: 10 });
            if (!report.topPages.length) L.push({ text: 'No data', size: 10, indent: 10 });
            report.topPages.forEach((p, i) => L.push({ text: `${i + 1}. ${p.path} - ${n(p.sessions)}`, size: 10, indent: 10 }));
        }
    }
    L.push({ text: 'SEO insights', size: 13, bold: true, gap: 10 });
    if (!report.insights.length) L.push({ text: 'No open insights.', size: 10, indent: 10 });
    report.insights.forEach((i) => L.push({ text: `[${i.severity.toUpperCase()}] ${i.title} (${i.status})`, size: 10, indent: 10 }));
    return buildPdf(L);
}

/** Deterministic plain-language summary (no AI involved). */
export function executiveSummary(report: ReportData): string {
    const { summary, filters, topQueries, topPages, insights } = report;
    const parts: string[] = [];
    if (filters.source !== 'ga4') {
        const ctr = summary.gscImpressions ? ((summary.gscClicks / summary.gscImpressions) * 100).toFixed(2) : '0.00';
        parts.push(`Organic search delivered ${n(summary.gscClicks)} clicks from ${n(summary.gscImpressions)} impressions (${ctr}% CTR).`);
        if (topQueries[0]) parts.push(`The leading query was "${topQueries[0].query}" with ${n(topQueries[0].clicks)} clicks.`);
    }
    if (filters.source !== 'gsc') {
        const rate = summary.ga4Sessions ? ((summary.ga4Conversions / summary.ga4Sessions) * 100).toFixed(2) : '0.00';
        parts.push(`GA4 recorded ${n(summary.ga4Sessions)} sessions and ${n(summary.ga4Conversions)} conversions (${rate}% conversion rate).`);
        if (topPages[0]) parts.push(`The top landing page was ${topPages[0].path}.`);
    }
    const high = insights.filter((i) => i.severity === 'high').length;
    parts.push(insights.length ? `${insights.length} open SEO insight${insights.length === 1 ? '' : 's'} need attention${high ? `, ${high} high severity` : ''}.` : 'No open SEO insights.');
    return parts.join(' ');
}
