/**
 * user-invite: delivers an invitation created by the RLS-checked RPCs.
 * POST { kind: 'client' | 'agency', invitationId, token, appOrigin } with the user's JWT.
 * Uses Supabase Auth admin inviteUserByEmail on the server only (never from the browser).
 *
 * STATUS: implemented; NOT deployed (needs migration 0009 on staging, owner approval, and an
 * email setup: Supabase's built-in mailer is rate-limited; custom SMTP is recommended).
 */
// @ts-nocheck: Deno runtime file; type-checked by `supabase functions deploy`.
import { clientsFor, cors, json } from '../_shared/edge.ts';
import { handleSendInvitation, InviteError } from '../_shared/invites.ts';

const ALLOWED = (Deno.env.get('ALLOWED_ORIGINS') ?? 'http://localhost:5173').split(',').map((s) => s.trim()).filter(Boolean);

Deno.serve(async (req) => {
    if (req.method === 'OPTIONS') return new Response(null, { headers: cors(req) });
    if (req.method !== 'POST') return json(req, 405, { error: 'Method not allowed.' });
    try {
        const body = await req.json().catch(() => ({}));
        const { user, admin, userId } = await clientsFor(req);
        const table = (kind) => (kind === 'agency' ? 'agency_invitations' : 'invitations');
        const result = await handleSendInvitation(
            { kind: body?.kind, invitationId: String(body?.invitationId ?? ''), token: String(body?.token ?? ''), appOrigin: String(body?.appOrigin ?? '') },
            {
                userId,
                allowedOrigins: ALLOWED,
                async invitation(kind, id) {
                    // Visibility under RLS first (only the invitation's administrators see it) ...
                    const visible = await user.from(table(kind)).select('id').eq('id', id).maybeSingle();
                    if (visible.error || !visible.data) return null;
                    // ... then the hash with the service role (not exposed to app users).
                    const r = await admin.from(table(kind)).select('id, email, status, token_hash, expires_at').eq('id', id).single();
                    if (r.error) return null;
                    return { id: r.data.id, email: r.data.email, status: r.data.status, tokenHash: r.data.token_hash, expiresAt: r.data.expires_at };
                },
                async accountExists(email) {
                    const r = await admin.from('profiles').select('id').eq('email', email.toLowerCase()).maybeSingle();
                    return !!r.data;
                },
                async sendAuthInvite(email, redirectTo) {
                    const r = await admin.auth.admin.inviteUserByEmail(email, { redirectTo });
                    return r.error ? { ok: false, error: r.error.message } : { ok: true };
                },
                async markDelivery(kind, id, status, error) {
                    await admin.from(table(kind)).update({ status, delivery_error: error }).eq('id', id);
                },
            },
        );
        return json(req, 200, result);
    } catch (e) {
        if (e instanceof InviteError) return json(req, e.status, { error: e.message });
        console.error('user-invite failed', e instanceof Error ? e.name : 'unknown');
        return json(req, 500, { error: 'Invitation delivery failed.' });
    }
});
