/**
 * user-invite Edge Function logic (pure; the Deno entry wires Supabase clients).
 *
 * The browser first creates the invitation through the RLS-checked RPC (create_invitation or
 * create_agency_invitation), which returns the plain token once. It then asks this function to
 * deliver it. The function:
 *  1. requires a signed-in caller who can SEE the invitation under RLS (its administrators);
 *  2. checks the invitation is still open and that sha256(token) equals the stored hash;
 *  3. builds the accept link only for an allow-listed app origin;
 *  4. new email → Supabase Auth inviteUserByEmail (server-side, service role); status 'sent'
 *     only when Auth accepts the request, otherwise 'failed' with a sanitized reason;
 *     existing account → no email is claimed; the link is returned for the admin to share.
 */
import { sanitize } from './ai/errors.ts';

export type InviteKind = 'client' | 'agency';

export interface InvitationRecord {
    id: string;
    email: string;
    status: string;
    tokenHash: string;
    expiresAt: string;
}

export interface InviteDeps {
    userId: string | null;
    allowedOrigins: string[];
    now?: () => Date;
    /** RLS-scoped visibility check, then the hash read with the service role. */
    invitation(kind: InviteKind, id: string): Promise<InvitationRecord | null>;
    accountExists(email: string): Promise<boolean>;
    sendAuthInvite(email: string, redirectTo: string): Promise<{ ok: true } | { ok: false; error: string }>;
    markDelivery(kind: InviteKind, id: string, status: 'sent' | 'failed', error: string | null): Promise<void>;
}

export class InviteError extends Error {
    constructor(readonly status: number, message: string) {
        super(message);
    }
}

export interface InviteResult {
    status: 'sent' | 'failed' | 'pending';
    delivered: boolean;
    reason: 'email_sent' | 'existing_account' | 'delivery_failed';
    acceptPath: string;
    error: string | null;
}

export async function sha256Hex(text: string): Promise<string> {
    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
    return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export async function handleSendInvitation(input: { kind: InviteKind; invitationId: string; token: string; appOrigin: string }, deps: InviteDeps): Promise<InviteResult> {
    if (!deps.userId) throw new InviteError(401, 'Sign in required.');
    if (input.kind !== 'client' && input.kind !== 'agency') throw new InviteError(400, 'Unknown invitation kind.');
    if (!/^[0-9a-f]{64}$/.test(input.token ?? '')) throw new InviteError(400, 'A valid invitation token is required.');
    let origin: string;
    try {
        origin = new URL(input.appOrigin).origin;
    } catch {
        throw new InviteError(400, 'Invalid app origin.');
    }
    if (!deps.allowedOrigins.includes(origin)) throw new InviteError(400, 'This app origin is not allowed for invitation links.');

    const inv = await deps.invitation(input.kind, input.invitationId);
    if (!inv) throw new InviteError(404, 'Invitation not found.');
    if (inv.status !== 'pending' && inv.status !== 'failed') throw new InviteError(409, `This invitation is ${inv.status}.`);
    if (new Date(inv.expiresAt).getTime() < (deps.now ?? (() => new Date()))().getTime()) throw new InviteError(409, 'This invitation has expired.');
    if ((await sha256Hex(input.token)) !== inv.tokenHash) throw new InviteError(403, 'The token does not match this invitation.');

    const acceptPath = `/${input.kind === 'agency' ? 'agency-invitations' : 'invitations'}/${input.token}`;
    if (await deps.accountExists(inv.email)) {
        // No email is claimed: Supabase Auth cannot send an invite to an existing account.
        return { status: 'pending', delivered: false, reason: 'existing_account', acceptPath, error: null };
    }
    const sent = await deps.sendAuthInvite(inv.email, `${origin}${acceptPath}`);
    if (sent.ok) {
        await deps.markDelivery(input.kind, inv.id, 'sent', null);
        return { status: 'sent', delivered: true, reason: 'email_sent', acceptPath, error: null };
    }
    const error = sanitize(sent.error, 200);
    await deps.markDelivery(input.kind, inv.id, 'failed', error);
    return { status: 'failed', delivered: false, reason: 'delivery_failed', acceptPath, error };
}
