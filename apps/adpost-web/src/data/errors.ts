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

export class AuthError extends Error {
    constructor(message = 'Invalid credentials.') {
        super(message);
        this.name = 'AuthError';
    }
}

/** Throws ValidationError if any rule produced a message. */
export function assertValid(rules: Record<string, string | false | null | undefined>): void {
    const fields: Record<string, string> = {};
    for (const [k, v] of Object.entries(rules)) if (v) fields[k] = v;
    if (Object.keys(fields).length) throw new ValidationError(fields);
}
