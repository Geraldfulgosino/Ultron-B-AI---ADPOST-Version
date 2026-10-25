/** Trigger a browser download for in-memory content. */
export function downloadBlob(content: BlobPart, filename: string, type: string): void {
    const url = URL.createObjectURL(new Blob([content], { type }));
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 0);
}

/** Legacy export file naming: <slug>-report-<from>-to-<to>.<ext> */
export function reportFilename(slug: string, from: string, to: string, ext: 'csv' | 'pdf'): string {
    return `${slug}-report-${from}-to-${to}.${ext}`;
}
