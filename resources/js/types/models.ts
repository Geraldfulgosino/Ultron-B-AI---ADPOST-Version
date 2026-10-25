export interface User {
    id: number;
    name: string;
    email: string;
    email_verified_at: string | null;
    mfa_enabled: boolean;
}

export interface Organization {
    id: number;
    name: string;
    slug: string;
    status: 'active' | 'suspended' | 'archived';
    timezone: string;
    currency: string;
}

export interface OrganizationMember {
    id: number;
    user_id: number;
    name: string;
    email: string;
    role: MemberRole;
    role_label: string;
    department: string | null;
    joined_at: string;
}

export type MemberRole = 'owner' | 'admin' | 'member' | 'viewer';

export interface OrganizationInvitation {
    id: number;
    email: string;
    role: MemberRole;
    role_label: string;
    invited_by: string;
    expires_at: string;
}

export interface Client {
    id: number;
    organization_id: number;
    name: string;
    slug: string;
    status: 'active' | 'archived';
    timezone: string;
    currency: string;
    business_goals: string | null;
}

export interface Website {
    id: number;
    organization_id: number;
    client_id: number;
    name: string;
    domain: string;
    status: 'active' | 'archived';
    timezone: string;
    currency: string;
    primary_conversion: string | null;
}

export interface Integration {
    id: number;
    organization_id: number;
    website_id: number | null;
    provider: string;
    provider_label: string;
    status: string;
    status_label: string;
    external_account_name: string | null;
    external_property_name: string | null;
    last_synced_at: string | null;
    last_error_message: string | null;
}
