// @vitest-environment node
/** user-invite Edge Function logic with fakes (no Supabase, no email provider). */
import { handleSendInvitation, sha256Hex, type InviteDeps, type InvitationRecord } from '../../../../../supabase/functions/_shared/invites.ts';

const TOKEN = 'a'.repeat(64);
const NOW = new Date('2026-11-13T12:00:00Z');

async function setup(over: Partial<InviteDeps> = {}, inv: Partial<InvitationRecord> = {}) {
    const record: InvitationRecord = { id: 'inv-1', email: 'new.user@lipsky.example.test', status: 'pending', tokenHash: await sha256Hex(TOKEN), expiresAt: '2026-11-20T00:00:00Z', ...inv };
    const marks: Array<[string, string | null]> = [];
    const sent: Array<[string, string]> = [];
    const deps: InviteDeps = {
        userId: 'admin-1', allowedOrigins: ['http://localhost:5173'], now: () => NOW,
        invitation: async (_k, id) => (id === record.id ? record : null),
        accountExists: async () => false,
        sendAuthInvite: async (email, redirectTo) => { sent.push([email, redirectTo]); return { ok: true }; },
        markDelivery: async (_k, _id, status, error) => { marks.push([status, error]); },
        ...over,
    };
    return { deps, marks, sent };
}
const input = { kind: 'client' as const, invitationId: 'inv-1', token: TOKEN, appOrigin: 'http://localhost:5173' };

describe('user-invite', () => {
    it('sends through Supabase Auth to the accept link and records "sent" only on acceptance by Auth', async () => {
        const { deps, marks, sent } = await setup();
        const r = await handleSendInvitation(input, deps);
        expect(r).toMatchObject({ status: 'sent', delivered: true, acceptPath: `/invitations/${TOKEN}` });
        expect(sent).toEqual([['new.user@lipsky.example.test', `http://localhost:5173/invitations/${TOKEN}`]]);
        expect(marks).toEqual([['sent', null]]);
    });

    it('records a sanitized failure when Auth rejects the request', async () => {
        const { deps, marks } = await setup({ sendAuthInvite: async () => ({ ok: false, error: 'rate limit for Bearer abc.def exceeded' }) });
        const r = await handleSendInvitation(input, deps);
        expect(r).toMatchObject({ status: 'failed', delivered: false });
        expect(r.error).not.toContain('abc.def');
        expect(marks[0]![0]).toBe('failed');
    });

    it('existing accounts: no email is claimed; the accept link is returned to share', async () => {
        const { deps, marks, sent } = await setup({ accountExists: async () => true });
        expect(await handleSendInvitation({ ...input, kind: 'agency' }, deps)).toMatchObject({ status: 'pending', delivered: false, reason: 'existing_account', acceptPath: `/agency-invitations/${TOKEN}` });
        expect(sent).toEqual([]);
        expect(marks).toEqual([]);
    });

    it.each([
        ['unauthenticated', { userId: null }, {}, input, 401],
        ['invitation hidden by RLS', {}, {}, { ...input, invitationId: 'other' }, 404],
        ['wrong token', {}, {}, { ...input, token: 'b'.repeat(64) }, 403],
        ['already accepted', {}, { status: 'accepted' }, input, 409],
        ['expired', {}, { expiresAt: '2026-11-01T00:00:00Z' }, input, 409],
        ['origin not allowed', {}, {}, { ...input, appOrigin: 'https://evil.example.com' }, 400],
        ['malformed token', {}, {}, { ...input, token: 'short' }, 400],
    ])('refuses: %s', async (_label, over, inv, args, status) => {
        const { deps, sent } = await setup(over as Partial<InviteDeps>, inv as Partial<InvitationRecord>);
        await expect(handleSendInvitation(args, deps)).rejects.toMatchObject({ status });
        expect(sent).toEqual([]);
    });
});
