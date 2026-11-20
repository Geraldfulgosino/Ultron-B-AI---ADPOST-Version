export class AccessDeniedError extends Error {
    constructor(message = 'You do not have access to this resource.') {
        super(message);
        this.name = 'AccessDeniedError';
    }
}

export class NotFoundError extends Error {
    constructor(what = 'Record') {
        super(`${what} not found.`);
        this.name = 'NotFoundError';
    }
}

export class ValidationError extends Error {
    constructor(public readonly fields: Record<string, string>) {
        super(Object.values(fields)[0] ?? 'Invalid input.');
        this.name = 'ValidationError';
    }
}

/** A plan/entitlement limit was hit (maps to HTTP 402/403 in Edge Functions). */
export class PlanLimitError extends Error {
    constructor(message: string) {
        super(message);
        this.name = 'PlanLimitError';
    }
}

export class AuthError extends Error {
    constructor(message = 'Invalid credentials.') {
        super(message);
        this.name = 'AuthError';
    }
}

/** Sign-up succeeded but the account needs email confirmation before the first sign-in. */
export class PendingConfirmationError extends Error {
    constructor(message = 'Check your email to confirm your account, then sign in.') {
        super(message);
        this.name = 'PendingConfirmationError';
    }
}

/**
 * The backend could not answer (network, timeout, server error). Shown with a Retry; never
 * replaced by cached or mock data.
 */
export class ServiceError extends Error {
    constructor(message = 'The server could not be reached. Try again.') {
        super(message);
        this.name = 'ServiceError';
    }
}

/**
 * The feature runs server-side (an Edge Function or a sync job) that is not connected in this
 * mode yet. Raised after the access check, so it never reveals another tenant's data and never
 * stands in for real records.
 */
export class NotAvailableError extends Error {
    constructor(feature: string) {
        super(`${feature} is not available in live mode yet.`);
        this.name = 'NotAvailableError';
    }
}

/** Throws ValidationError if any rule produced a message. */
export function assertValid(rules: Record<string, string | false | null | undefined>): void {
    const fields: Record<string, string> = {};
    for (const [k, v] of Object.entries(rules)) if (v) fields[k] = v;
    if (Object.keys(fields).length) throw new ValidationError(fields);
}
