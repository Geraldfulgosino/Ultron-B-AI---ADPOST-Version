/**
 * Role-aware user administration. Super Admins: every user (or one agency's), suspension,
 * Super Admin grants, agency roles and agency-admin invitations. Admins: their agency's users,
 * Client User invitations and permissions, membership revocation. The data layer enforces every
 * rule; this UI only hides actions the caller cannot perform.
 */
import { useState } from 'react';
import { Search, UserPlus } from 'lucide-react';
import { fieldErrors, useAction, useQuery } from '@/app/backend';
import { Alert, Badge, Button, Card, Dialog, EmptyState, ErrorState, Field, Input, LoadingState, Select, Table, TBody, Td, Th, THead } from '@/components/ui';
import type { BrandApi, PlatformRoleKey, UserView } from '@/data/contracts';
import { CLIENT_PERMISSIONS, type ClientPermission } from '@/domain/types';

export const PERMISSION_LABEL: Record<ClientPermission, string> = {
    ai_chat: 'Use client-facing AI chat',
    comment_tasks: 'Comment on shared tasks',
    download_reports: 'Download reports',
};

const PAGE_SIZE = 20;

export function UsersManager({ agencyId }: { agencyId: string | null }) {
    const isSuper = useQuery((api) => api.agencies.isPlatformAdmin(), []);
    const [query, setQuery] = useState('');
    const [role, setRole] = useState<PlatformRoleKey | ''>('');
    const [status, setStatus] = useState<'' | 'active' | 'suspended'>('');
    const [page, setPage] = useState(1);
    const users = useQuery((api) => api.users.list({ agencyId: agencyId ?? undefined, query, role: role || undefined, status: status || undefined, page, pageSize: PAGE_SIZE }), [agencyId, query, role, status, page]);
    const clients = useQuery((api) => (agencyId ? api.agencies.clients(agencyId, { status: 'active' }) : Promise.resolve([])), [agencyId]);
    const invitations = useQuery((api) => (agencyId ? api.users.agencyInvitations(agencyId) : Promise.resolve([])), [agencyId]);
    const [dialog, setDialog] = useState<'client' | 'agency' | null>(null);
    const [permsFor, setPermsFor] = useState<{ user: UserView; membershipId: string; brandId: string; current: ClientPermission[] } | null>(null);
    const [notice, setNotice] = useState<string | null>(null);
    const act = useAction(async (api, fn: (a: BrandApi) => Promise<unknown>, message: string) => { await fn(api); setNotice(message); users.reload(); invitations.reload(); return true; });
    const sa = !!isSuper.data;
    const total = users.data?.total ?? 0;

    return (
        <div className="space-y-4">
            <div className="flex flex-wrap items-end justify-between gap-3">
                <div className="flex flex-wrap items-end gap-3">
                    <Field id="u-search" label="Search users">
                        <div className="relative">
                            <Search className="pointer-events-none absolute left-2 top-2.5 h-4 w-4 text-fg-subtle" aria-hidden="true" />
                            <Input id="u-search" className="pl-8" value={query} onChange={(e) => { setQuery(e.target.value); setPage(1); }} placeholder="Name or email" />
                        </div>
                    </Field>
                    <Field id="u-role" label="Role">
                        <Select id="u-role" value={role} onChange={(e) => { setRole(e.target.value as PlatformRoleKey | ''); setPage(1); }}>
                            <option value="">All roles</option>
                            {sa && <option value="super_admin">Super Admin</option>}
                            <option value="admin">Admin</option>
                            <option value="staff">Staff</option>
                            <option value="client_user">Client User</option>
                        </Select>
                    </Field>
                    <Field id="u-status" label="Status">
                        <Select id="u-status" value={status} onChange={(e) => { setStatus(e.target.value as '' | 'active' | 'suspended'); setPage(1); }}>
                            <option value="">Any</option><option value="active">Active</option><option value="suspended">Suspended</option>
                        </Select>
                    </Field>
                </div>
                {agencyId && (
                    <div className="flex gap-2">
                        <Button onClick={() => setDialog('client')} disabled={!clients.data?.length}><UserPlus className="h-4 w-4" aria-hidden="true" /> Invite client user</Button>
                        {sa && <Button variant="secondary" onClick={() => setDialog('agency')}>Invite agency admin</Button>}
                    </div>
                )}
            </div>
            {notice && <Alert tone="success">{notice}</Alert>}
            {act.error ? <ErrorState error={act.error} /> : null}
            {users.loading ? <LoadingState /> : users.error ? <ErrorState error={users.error} onRetry={users.reload} /> : !users.data!.users.length ? (
                <EmptyState title="No users match these filters" />
            ) : (
                <Card>
                    <Table aria-label="Users">
                        <THead><tr><Th>User</Th><Th>Roles and memberships</Th><Th>Status</Th><Th><span className="sr-only">Actions</span></Th></tr></THead>
                        <TBody>
                            {users.data!.users.map((u) => (
                                <tr key={u.id}>
                                    <Td><span className="font-medium text-fg">{u.name}</span><span className="block text-xs text-fg-muted">{u.email}</span></Td>
                                    <Td>
                                        <ul className="space-y-1 text-xs">
                                            {u.isSuperAdmin && <li><Badge variant="indigo">Super Admin</Badge></li>}
                                            {u.memberships.map((m) => (
                                                <li key={m.membershipId} className="flex flex-wrap items-center gap-1">
                                                    <span className="text-fg-secondary">{m.kind === 'agency' ? m.agencyName : `${m.agencyName} › ${m.brandName}`}:</span>
                                                    <span>{m.roleLabel}</span>
                                                    {m.role === 'client' && <span className="text-fg-muted">({m.permissions.length ? m.permissions.map((p) => PERMISSION_LABEL[p]).join(', ') : 'read-only'})</span>}
                                                    {m.role === 'client' && (
                                                        <button type="button" className="underline text-accent" onClick={() => setPermsFor({ user: u, membershipId: m.membershipId, brandId: m.brandId!, current: m.permissions })}>Permissions</button>
                                                    )}
                                                    {m.kind === 'client' && (
                                                        <button type="button" className="underline text-danger-ink" onClick={() => confirm(`Remove ${u.name} from ${m.brandName}?`) && void act.run((a) => a.members.remove(m.brandId!, m.membershipId), `${u.name} was removed from ${m.brandName}.`)}>Remove</button>
                                                    )}
                                                    {m.kind === 'agency' && sa && (
                                                        <button type="button" className="underline text-danger-ink" onClick={() => confirm(`Remove ${u.name}'s role in ${m.agencyName}?`) && void act.run((a) => a.users.revokeAgencyRole(m.agencyId, u.id), `${u.name}'s agency role was revoked.`)}>Revoke</button>
                                                    )}
                                                </li>
                                            ))}
                                            {!u.isSuperAdmin && !u.memberships.length && <li className="text-fg-muted">No memberships</li>}
                                        </ul>
                                    </Td>
                                    <Td><Badge variant={u.status === 'active' ? 'green' : 'red'}>{u.status === 'active' ? 'Active' : 'Suspended'}</Badge></Td>
                                    <Td className="whitespace-nowrap text-right">
                                        {sa && (
                                            <>
                                                <Button size="sm" variant="ghost" onClick={() => void act.run((a) => a.users.setSuspended(u.id, u.status === 'active'), `${u.name} was ${u.status === 'active' ? 'suspended' : 'reactivated'}.`)} aria-label={`${u.status === 'active' ? 'Suspend' : 'Reactivate'} ${u.name}`}>
                                                    {u.status === 'active' ? 'Suspend' : 'Reactivate'}
                                                </Button>
                                                <Button size="sm" variant="ghost" onClick={() => confirm(`${u.isSuperAdmin ? 'Revoke' : 'Grant'} Super Admin for ${u.name}?`) && void act.run((a) => (u.isSuperAdmin ? a.users.revokeSuperAdmin(u.id) : a.users.grantSuperAdmin(u.id)), `Super Admin ${u.isSuperAdmin ? 'revoked from' : 'granted to'} ${u.name}.`)}>
                                                    {u.isSuperAdmin ? 'Revoke Super Admin' : 'Make Super Admin'}
                                                </Button>
                                                {agencyId && !u.memberships.some((m) => m.kind === 'agency') && (
                                                    <Button size="sm" variant="ghost" onClick={() => void act.run((a) => a.users.assignAgencyRole(agencyId, u.id, 'agency_admin'), `${u.name} is now an Admin of this agency.`)}>Make Admin</Button>
                                                )}
                                            </>
                                        )}
                                    </Td>
                                </tr>
                            ))}
                        </TBody>
                    </Table>
                </Card>
            )}
            {total > PAGE_SIZE && (
                <nav aria-label="Pagination" className="flex items-center gap-2 text-sm">
                    <Button size="sm" variant="secondary" disabled={page <= 1} onClick={() => setPage(page - 1)}>Previous</Button>
                    <span>Page {page} of {Math.ceil(total / PAGE_SIZE)}</span>
                    <Button size="sm" variant="secondary" disabled={page * PAGE_SIZE >= total} onClick={() => setPage(page + 1)}>Next</Button>
                </nav>
            )}
            {agencyId && !!invitations.data?.length && (
                <Card>
                    <Table aria-label="Agency invitations">
                        <THead><tr><Th>Invited</Th><Th>Role</Th><Th>Status</Th><Th>Expires</Th>{sa && <Th><span className="sr-only">Actions</span></Th>}</tr></THead>
                        <TBody>
                            {invitations.data.map((i) => (
                                <tr key={i.id}>
                                    <Td>{i.email}</Td><Td>{i.role === 'agency_admin' ? 'Admin' : 'Agency staff'}</Td><Td>{i.status}</Td><Td className="text-xs">{i.expiresAt.slice(0, 10)}</Td>
                                    {sa && <Td>{(i.status === 'pending' || i.status === 'sent') && <Button size="sm" variant="ghost" onClick={() => void act.run((a) => a.users.revokeAgencyInvitation(i.id), 'Invitation revoked.')}>Revoke</Button>}</Td>}
                                </tr>
                            ))}
                        </TBody>
                    </Table>
                </Card>
            )}
            {dialog === 'client' && agencyId && <InviteClientUserDialog clients={(clients.data ?? []).filter((c) => c.canAdmin).map((c) => c.client)} onClose={() => setDialog(null)} onDone={(m) => { setDialog(null); setNotice(m); users.reload(); }} />}
            {dialog === 'agency' && agencyId && <InviteAgencyDialog agencyId={agencyId} onClose={() => setDialog(null)} onDone={(m) => { setDialog(null); setNotice(m); invitations.reload(); }} />}
            {permsFor && <PermissionsDialog target={permsFor} onClose={() => setPermsFor(null)} onDone={(m) => { setPermsFor(null); setNotice(m); users.reload(); }} />}
        </div>
    );

}

function InviteClientUserDialog({ clients, onClose, onDone }: { clients: Array<{ id: string; name: string }>; onClose: () => void; onDone: (msg: string) => void }) {
    const [form, setForm] = useState({ email: '', brandId: clients[0]?.id ?? '', permissions: [] as ClientPermission[] });
    const [devPath, setDevPath] = useState<string | null>(null);
    const send = useAction((api) => api.invitations.send(form.brandId, { email: form.email, role: 'client', permissions: form.permissions }));
    const errors = fieldErrors(send.error);
    return (
        <Dialog open title="Invite client user" onClose={onClose}
            footer={devPath ? <Button onClick={() => onDone(`Invitation created for ${form.email}.`)}>Done</Button> : <><Button variant="secondary" onClick={onClose}>Cancel</Button><Button loading={send.pending} onClick={async () => { const r = await send.run(); if (r) setDevPath(r.devAcceptPath ?? ''); }}>Create invitation</Button></>}>
            {devPath !== null ? (
                <div className="space-y-2 text-sm">
                    <Alert tone="info">Invitation created (status: pending). Local mode sends no email.</Alert>
                    {devPath && <p>Local accept link: <code className="break-all">{devPath}</code></p>}
                </div>
            ) : (
                <div className="space-y-3">
                    {send.error && !Object.keys(errors).length ? <ErrorState error={send.error} /> : null}
                    <Field id="ic-email" label="Email" required><Input id="ic-email" type="email" value={form.email} error={errors.email} onChange={(e) => setForm({ ...form, email: e.target.value })} /></Field>
                    <Field id="ic-client" label="Client" required>
                        <Select id="ic-client" value={form.brandId} onChange={(e) => setForm({ ...form, brandId: e.target.value })}>
                            {clients.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                        </Select>
                    </Field>
                    <fieldset>
                        <legend className="mb-1 text-sm font-medium text-fg-secondary">Permissions (read-only without any)</legend>
                        {CLIENT_PERMISSIONS.map((p) => (
                            <label key={p} className="flex items-center gap-2 text-sm">
                                <input type="checkbox" className="h-4 w-4 rounded border-line-strong" checked={form.permissions.includes(p)}
                                    onChange={() => setForm({ ...form, permissions: form.permissions.includes(p) ? form.permissions.filter((x) => x !== p) : [...form.permissions, p] })} />
                                {PERMISSION_LABEL[p]}
                            </label>
                        ))}
                    </fieldset>
                    {errors.role && <p className="text-xs text-danger">{errors.role}</p>}
                </div>
            )}
        </Dialog>
    );
}

function InviteAgencyDialog({ agencyId, onClose, onDone }: { agencyId: string; onClose: () => void; onDone: (msg: string) => void }) {
    const [form, setForm] = useState({ email: '', role: 'agency_admin' as 'agency_admin' | 'agency_manager' });
    const [devPath, setDevPath] = useState<string | null>(null);
    const send = useAction((api) => api.users.inviteAgencyUser(agencyId, form));
    const errors = fieldErrors(send.error);
    return (
        <Dialog open title="Invite agency admin" onClose={onClose}
            footer={devPath ? <Button onClick={() => onDone(`Agency invitation created for ${form.email}.`)}>Done</Button> : <><Button variant="secondary" onClick={onClose}>Cancel</Button><Button loading={send.pending} onClick={async () => { const r = await send.run(); if (r) setDevPath(r.devAcceptPath ?? ''); }}>Create invitation</Button></>}>
            {devPath !== null ? (
                <div className="space-y-2 text-sm">
                    <Alert tone="info">Invitation created (status: pending). Local mode sends no email.</Alert>
                    {devPath && <p>Local accept link: <code className="break-all">{devPath}</code></p>}
                </div>
            ) : (
                <div className="space-y-3">
                    {send.error && !Object.keys(errors).length ? <ErrorState error={send.error} /> : null}
                    <Field id="ia-email" label="Email" required><Input id="ia-email" type="email" value={form.email} error={errors.email} onChange={(e) => setForm({ ...form, email: e.target.value })} /></Field>
                    <Field id="ia-role" label="Agency role">
                        <Select id="ia-role" value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value as 'agency_admin' | 'agency_manager' })}>
                            <option value="agency_admin">Admin</option><option value="agency_manager">Agency staff (edit, not administer)</option>
                        </Select>
                    </Field>
                    <p className="text-xs text-fg-muted">Only Super Admins can invite agency administrators. The invitation can only be accepted by a signed-in user with this verified email.</p>
                </div>
            )}
        </Dialog>
    );
}

function PermissionsDialog({ target, onClose, onDone }: { target: { user: UserView; membershipId: string; brandId: string; current: ClientPermission[] }; onClose: () => void; onDone: (msg: string) => void }) {
    const [perms, setPerms] = useState<ClientPermission[]>(target.current);
    const save = useAction((api) => api.users.setClientPermissions(target.brandId, target.membershipId, perms).then(() => true));
    return (
        <Dialog open title={`Permissions for ${target.user.name}`} onClose={onClose}
            footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button loading={save.pending} onClick={async () => { if (await save.run()) onDone(`Permissions updated for ${target.user.name}.`); }}>Save permissions</Button></>}>
            <div className="space-y-2">
                {save.error ? <ErrorState error={save.error} /> : null}
                {CLIENT_PERMISSIONS.map((p) => (
                    <label key={p} className="flex items-center gap-2 text-sm">
                        <input type="checkbox" className="h-4 w-4 rounded border-line-strong" checked={perms.includes(p)} onChange={() => setPerms(perms.includes(p) ? perms.filter((x) => x !== p) : [...perms, p])} />
                        {PERMISSION_LABEL[p]}
                    </label>
                ))}
                <p className="text-xs text-fg-muted">Without permissions a Client User is read-only.</p>
            </div>
        </Dialog>
    );
}
