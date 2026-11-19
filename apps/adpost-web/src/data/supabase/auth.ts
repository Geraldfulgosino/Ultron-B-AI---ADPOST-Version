/**
 * Supabase Auth adapter (Phase 17E). Implements `AuthApi` over an `AuthPort`, so it never holds
 * a token. Identity only: roles, memberships and landing pages come from RLS-protected rows in
 * the 17F data adapter. See docs/development/PHASE17E_AUTH_ADAPTER_PLAN.md.
 */
import type { AuthApi, Session } from '@/data/contracts';
import { assertValid, AuthError, PendingConfirmationError, ValidationError } from '@/data/errors';
import type { AuthPort, PortError, ProfileRow } from './authPort';

const BAD_CREDENTIALS = 'These credentials do not match our records.';
const SUSPENDED = 'This account is suspended. Contact your administrator.';
const UNAVAILABLE = 'This account is not available. Contact your administrator.';
const RATE_LIMITED = 'Too many attempts. Wait a minute and try again.';
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const isRateLimited = (e: PortError) => e.status === 429 || e.code === 'over_request_rate_limit' || e.code === 'over_email_send_rate_limit';
const toSession = (p: ProfileRow): Session => ({ user: { id: p.id, name: p.name, email: p.email } });

export interface SupabaseAuthOptions {
    /** App origin for email links, e.g. `http://127.0.0.1:5173`. */
    origin: string;
}

export class SupabaseAuth implements AuthApi {
    private session: Session | null = null;
    /** True inside a recovery session opened from a password reset link. */
    private recovery = false;
    /** Bumped by every session change so a slow profile load cannot overwrite a newer state. */
    private generation = 0;
    private readonly listeners = new Set<(session: Session | null) => void>();

    private constructor(private readonly port: AuthPort, private readonly options: SupabaseAuthOptions) {}

    /** Restores the stored session (dropping suspended accounts) before the app mounts. */
    static async create(port: AuthPort, options: SupabaseAuthOptions): Promise<SupabaseAuth> {
        const auth = new SupabaseAuth(port, options);
        const userId = await port.sessionUserId();
        if (userId) {
            const profile = await port.loadProfile(userId);
            if (profile && !profile.deactivatedAt) auth.session = toSession(profile);
            else await port.signOut();
        }
        port.onAuthEvent((event, eventUserId) => void auth.onAuthEvent(event, eventUserId));
        return auth;
    }

    async signIn(email: string, password: string): Promise<Session> {
        const { userId, error } = await this.port.signInWithPassword(email.trim().toLowerCase(), password);
        if (error || !userId) {
            if (error && isRateLimited(error)) throw new AuthError(RATE_LIMITED);
            if (error?.code === 'email_not_confirmed') throw new AuthError('Confirm your email address first, then sign in.');
            throw new AuthError(BAD_CREDENTIALS);
        }
        const profile = await this.activeProfile(userId);
        // An explicit sign-in wins over any event handler still loading an older profile.
        ++this.generation;
        this.recovery = false;
        this.session = toSession(profile);
        return structuredClone(this.session);
    }

    async register({ name, email, password }: { name: string; email: string; password: string }): Promise<Session> {
        const normalized = email.trim().toLowerCase();
        assertValid({
            name: !name.trim() && 'Name is required.',
            email: !EMAIL_RE.test(normalized) && 'Enter a valid email address.',
            password: password.length < 8 && 'Password must be at least 8 characters.',
        });
        const { hasSession, userId, error } = await this.port.signUp({ email: normalized, password, name: name.trim(), redirectTo: `${this.options.origin}/login` });
        if (error) {
            if (isRateLimited(error)) throw new AuthError(RATE_LIMITED);
            if (error.code === 'weak_password') throw new ValidationError({ password: 'Choose a stronger password.' });
            // An existing email gets the same answer as a new one (no account enumeration).
            if (error.code === 'user_already_exists' || error.code === 'email_exists') throw new PendingConfirmationError();
            throw new AuthError('Registration failed. Try again later.');
        }
        if (!hasSession || !userId) throw new PendingConfirmationError();
        const profile = await this.activeProfile(userId);
        ++this.generation;
        this.session = toSession(profile);
        return structuredClone(this.session);
    }

    async signOut(): Promise<void> {
        ++this.generation;
        await this.port.signOut();
        this.session = null;
        this.recovery = false;
    }

    currentSession(): Session | null {
        return this.session ? structuredClone(this.session) : null;
    }

    async updateProfile({ name }: { name: string }): Promise<Session> {
        const session = this.requireSession();
        const clean = name.trim();
        assertValid({ name: (!clean && 'Name is required.') || (clean.length > 120 && 'At most 120 characters.') });
        // RLS grants UPDATE on profiles.name only, and only for the caller's own row.
        const { error } = await this.port.updateProfileName(session.user.id, clean);
        if (error) throw new AuthError('Your profile could not be saved. Try again.');
        const profile = await this.activeProfile(session.user.id);
        ++this.generation;
        this.session = toSession(profile);
        return structuredClone(this.session);
    }

    async changePassword(currentPassword: string, newPassword: string): Promise<void> {
        const session = this.requireSession();
        // Supabase updateUser does not check the old password, so re-authenticate first.
        const check = await this.port.signInWithPassword(session.user.email, currentPassword);
        if (check.error && isRateLimited(check.error)) throw new AuthError(RATE_LIMITED);
        if (check.error || check.userId !== session.user.id) throw new ValidationError({ currentPassword: 'Your current password is incorrect.' });
        assertValid({ newPassword: (newPassword.length < 8 && 'Use at least 8 characters.') || (newPassword === currentPassword && 'Choose a different password.') });
        await this.setPassword(newPassword, 'newPassword');
    }

    async requestPasswordReset(email: string): Promise<void> {
        const normalized = email.trim().toLowerCase();
        assertValid({ email: !EMAIL_RE.test(normalized) && 'Enter a valid email address.' });
        const { error } = await this.port.sendPasswordReset(normalized, `${this.options.origin}/reset-password`);
        // Only rate limiting is reported; anything else would tell the caller whether the account exists.
        if (error && isRateLimited(error)) throw new AuthError(RATE_LIMITED);
    }

    async completePasswordReset(newPassword: string): Promise<Session> {
        if (!this.recovery || !this.session) throw new AuthError('This reset link is invalid or has expired. Request a new one.');
        assertValid({ password: newPassword.length < 8 && 'Use at least 8 characters.' });
        await this.setPassword(newPassword, 'password');
        this.recovery = false;
        return structuredClone(this.session);
    }

    onSessionChange(listener: (session: Session | null) => void): () => void {
        this.listeners.add(listener);
        return () => this.listeners.delete(listener);
    }

    /** True while a password-recovery session is open (the reset page shows the form). */
    inRecovery(): boolean {
        return this.recovery;
    }

    private async onAuthEvent(event: string, userId: string | null): Promise<void> {
        const gen = ++this.generation;
        if (event === 'SIGNED_OUT' || !userId) {
            this.recovery = false;
            return this.publish(null);
        }
        if (event === 'INITIAL_SESSION' || event === 'OTHER') return;
        const profile = await this.port.loadProfile(userId);
        if (gen !== this.generation) return;
        if (!profile || profile.deactivatedAt) {
            ++this.generation;
            await this.port.signOut();
            this.recovery = false;
            return this.publish(null);
        }
        if (event === 'PASSWORD_RECOVERY') this.recovery = true;
        this.publish(toSession(profile));
    }

    private publish(next: Session | null): void {
        const changed = JSON.stringify(next) !== JSON.stringify(this.session);
        this.session = next;
        if (changed || next === null) for (const l of this.listeners) l(next ? structuredClone(next) : null);
    }

    private async activeProfile(userId: string): Promise<ProfileRow> {
        const profile = await this.port.loadProfile(userId);
        if (!profile || profile.deactivatedAt) {
            await this.port.signOut();
            throw new AuthError(profile ? SUSPENDED : UNAVAILABLE);
        }
        return profile;
    }

    private async setPassword(newPassword: string, field: string): Promise<void> {
        const { error } = await this.port.updatePassword(newPassword);
        if (!error) return;
        if (isRateLimited(error)) throw new AuthError(RATE_LIMITED);
        if (error.code === 'same_password') throw new ValidationError({ [field]: 'Choose a different password.' });
        if (error.code === 'weak_password') throw new ValidationError({ [field]: 'Choose a stronger password.' });
        if (error.code === 'reauthentication_needed') throw new AuthError('Sign in again, then change your password.');
        throw new AuthError('Your password could not be changed. Try again.');
    }

    private requireSession(): Session {
        if (!this.session) throw new AuthError('Not signed in.');
        return this.session;
    }
}

export const createSupabaseAuth = (port: AuthPort, options: SupabaseAuthOptions) => SupabaseAuth.create(port, options);
