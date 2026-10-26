import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { render, screen } from '@testing-library/react';
import { Badge, Button, Card, Input, Table, TBody, Td, THead, Th } from '@/components/ui';
import { Alert } from '@/components/ui/Feedback';
import { Dialog } from '@/components/ui/Dialog';

const SRC = join(process.cwd(), 'src');
const css = readFileSync(join(SRC, 'index.css'), 'utf8');

function block(selector: string): string {
    const start = css.indexOf(`${selector} {`);
    expect(start, `${selector} block`).toBeGreaterThanOrEqual(0);
    return css.slice(start, css.indexOf('}', start));
}
const varsIn = (text: string) => new Set([...text.matchAll(/^\s*(--[\w-]+):/gm)].map((m) => m[1]!));

describe('theme tokens (src/index.css)', () => {
    it('every light token has a dark value', () => {
        const light = varsIn(block(':root'));
        const dark = varsIn(block(":root[data-theme='dark']"));
        expect(light.size).toBeGreaterThan(20);
        expect([...light].filter((v) => !dark.has(v))).toEqual([]);
    });

    it('every Tailwind color utility points at a defined token', () => {
        const light = varsIn(block(':root'));
        const refs = [...block('@theme inline').matchAll(/var\((--[\w-]+)\)/g)].map((m) => m[1]!);
        expect(refs.filter((r) => !light.has(r))).toEqual([]);
    });
});

/** Regression guard: new UI must use semantic tokens, or it won't follow the theme. */
describe('no hard-coded light-only colors in components', () => {
    const files: string[] = [];
    (function walk(dir: string) {
        for (const name of readdirSync(dir)) {
            const p = join(dir, name);
            if (statSync(p).isDirectory()) walk(p);
            else if (/\.tsx$/.test(name) && !/\.test\.tsx$/.test(name)) files.push(p);
        }
    })(SRC);

    it('uses tokens instead of gray/white utility classes', () => {
        const banned = /(?<![\w-])(?:bg|text|border|divide|fill|stroke|ring|placeholder:text)-(?:gray-\d+|white(?![\w/-]))/g;
        const offenders = files.flatMap((f) => {
            // The sidebar is intentionally dark in both themes and keeps its slate/white palette.
            const allowWhite = /AppShell\.tsx$|ThemeToggle\.tsx$|AuthLayout\.tsx$/.test(f);
            return [...readFileSync(f, 'utf8').matchAll(banned)]
                .map((m) => m[0])
                .filter((c) => !(allowWhite && /white/.test(c)) && c !== 'text-white')
                .map((c) => `${relative(SRC, f)}: ${c}`);
        });
        expect(offenders).toEqual([]);
    });
});

describe('shared components use theme tokens', () => {
    it('card, button, input, table, badge, alert and dialog render with semantic classes', () => {
        render(
            <>
                <Card data-testid="card">x</Card>
                <Button variant="secondary">Secondary</Button>
                <Input aria-label="Field" />
                <Table>
                    <THead><tr><Th>H</Th></tr></THead>
                    <TBody><tr><Td>cell</Td></tr></TBody>
                </Table>
                <Badge variant="green">ok</Badge>
                <Alert tone="error">bad</Alert>
                <Dialog open title="Dlg" onClose={() => {}}>body</Dialog>
            </>,
        );
        expect(screen.getByTestId('card')).toHaveClass('bg-surface', 'border-line');
        expect(screen.getByRole('button', { name: 'Secondary' })).toHaveClass('bg-surface', 'text-fg', 'border-line-strong');
        expect(screen.getByLabelText('Field')).toHaveClass('bg-surface', 'text-fg', 'placeholder:text-fg-subtle');
        expect(screen.getByText('cell')).toHaveClass('text-fg-secondary');
        expect(screen.getByText('ok')).toHaveClass('bg-success-muted', 'text-success-ink');
        expect(screen.getByRole('alert')).toHaveClass('bg-danger-soft', 'text-danger-ink');
        expect(screen.getByRole('dialog', { name: 'Dlg' })).toHaveClass('bg-surface');
    });
});
