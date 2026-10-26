import { useState } from 'react';
import { UserPlus } from 'lucide-react';
import { Page } from '@/layouts/AppShell';
import { Alert, Badge, Button, Card, CardContent, CardHeader, CardTitle, Dialog, EmptyState, ErrorState, Field, Input, LoadingState, Select, Table, TBody, Td, Th, THead } from '@/components/ui';
import { fieldErrors, useAction, useBrand, useQuery } from '@/app/backend';
import { ROLE_LABELS } from '@/data/access';
import type { BrandRole } from '@/domain/types';
import type { MemberView } from '@/data/contracts';
import { formatDate } from '@/lib/utils';

export function MembersPage() {
    const access = useBrand();
    const brandId = access.brand.id;
    const canManage = access.assignableRoles.length > 0;
    const members = useQuery((api) => api.members.list(brandId), [brandId]);
    const invitations = useQuery((api) => (canManage ? api.invitations.list(brandId) : Promise.resolve([])), [brandId, canManage]);
    const clients = useQuery((api) => api.clients.list(brandId), [brandId]);
    const updateRole = useAction((api, m: MemberView, role: BrandRole, clientId: string | null) => api.members.updateRole(brandId, m.id, role, clientId));
    const remove = useAction((api, id: string) => api.members.remove(brandId, id));
    const cancel = useAction((api, id: string) => api.invitations.cancel(brandId, id));
    const [inviteOpen, setInviteOpen] = useState(false);

    const actionError = updateRole.error ?? remove.error ?? cancel.error;

    return (
        <Page
            title="Members"
            description={`People with access to ${access.brand.name}`}
            actions={canManage && (
                <Button onClick={() => setInviteOpen(true)}>
                    <UserPlus className="h-4 w-4" aria-hidden="true" /> Invite member
                </Button>
            )}
        >
            {actionError ? <ErrorState error={actionError} /> : null}
            {members.loading ? (
                <LoadingState />
            ) : members.error ? (
                <ErrorState error={members.error} onRetry={members.reload} />
            ) : (
                <Table>
                    <THead>
                        <tr>
                            <Th>Name</Th>
                            <Th>Role</Th>
                            <Th className="hidden md:table-cell">Department</Th>
                            <Th className="hidden md:table-cell">Joined</Th>
                            {canManage && <Th><span className="sr-only">Actions</span></Th>}
                        </tr>
                    </THead>
                    <TBody>
                        {members.data!.map((m) => {
                            const editable = canManage && (m.role !== 'owner' || access.assignableRoles.includes('owner'));
                            return (
                                <tr key={m.id}>
                                    <Td>
                                        <p className="font-medium text-fg">{m.name}</p>
                                        <p className="text-xs text-fg-muted">{m.email}</p>
                                        {m.clientName && <p className="text-xs text-fg-muted">Client: {m.clientName}</p>}
                                    </Td>
                                    <Td>
                                        {editable ? (
                                            <Select
                                                aria-label={`Role for ${m.name}`}
                                                value={m.role}
                                                className="w-36"
                                                onChange={(e) => {
                                                    const role = e.target.value as BrandRole;
                                                    void updateRole.run(m, role, role === 'client' ? (m.clientId ?? clients.data?.[0]?.id ?? null) : null);
                                                }}
                                            >
                                                {(access.assignableRoles.includes(m.role) ? access.assignableRoles : [m.role, ...access.assignableRoles]).map((r) => (
                                                    <option key={r} value={r}>
                                                        {ROLE_LABELS[r]}
                                                    </option>
                                                ))}
                                            </Select>
                                        ) : (
                                            <Badge variant={m.role === 'owner' ? 'indigo' : m.role === 'client' ? 'yellow' : 'gray'}>{ROLE_LABELS[m.role]}</Badge>
                                        )}
                                    </Td>
                                    <Td className="hidden md:table-cell">{m.department ?? '—'}</Td>
                                    <Td className="hidden md:table-cell">{formatDate(m.joinedAt)}</Td>
                                    {canManage && (
                                        <Td className="text-right">
                                            {editable && (
                                                <Button
                                                    variant="ghost"
                                                    size="sm"
                                                    onClick={() => {
                                                        if (confirm(`Remove ${m.name} from ${access.brand.name}?`)) void remove.run(m.id);
                                                    }}
                                                >
                                                    Remove
                                                </Button>
                                            )}
                                        </Td>
                                    )}
                                </tr>
                            );
                        })}
                    </TBody>
                </Table>
            )}

            {canManage && (
                <Card>
                    <CardHeader>
                        <CardTitle>Pending invitations</CardTitle>
                    </CardHeader>
                    <CardContent>
                        {invitations.data?.length ? (
                            <ul className="divide-y divide-line-subtle">
                                {invitations.data.map((inv) => (
                                    <li key={inv.id} className="flex flex-wrap items-center justify-between gap-2 py-3">
                                        <div>
                                            <p className="text-sm font-medium text-fg">{inv.email}</p>
                                            <p className="text-xs text-fg-muted">
                                                {ROLE_LABELS[inv.role]} · expires {formatDate(inv.expiresAt)}
                                            </p>
                                        </div>
                                        <Button variant="secondary" size="sm" onClick={() => void cancel.run(inv.id)}>
                                            Cancel
                                        </Button>
                                    </li>
                                ))}
                            </ul>
                        ) : (
                            <EmptyState title="No pending invitations" />
                        )}
                    </CardContent>
                </Card>
            )}

            {inviteOpen && <InviteDialog onClose={() => setInviteOpen(false)} />}
        </Page>
    );
}

function InviteDialog({ onClose }: { onClose: () => void }) {
    const access = useBrand();
    const brandId = access.brand.id;
    const clients = useQuery((api) => api.clients.list(brandId), [brandId]);
    const [email, setEmail] = useState('');
    const [role, setRole] = useState<BrandRole>('member');
    const [clientId, setClientId] = useState('');
    const send = useAction((api) => api.invitations.send(brandId, { email, role, clientId: role === 'client' ? clientId : null }));
    const [sentPath, setSentPath] = useState<string | null>(null);
    const errors = fieldErrors(send.error);

    return (
        <Dialog
            open
            title="Invite member"
            onClose={onClose}
            footer={
                sentPath ? (
                    <Button onClick={onClose}>Done</Button>
                ) : (
                    <>
                        <Button variant="secondary" onClick={onClose}>
                            Cancel
                        </Button>
                        <Button
                            loading={send.pending}
                            onClick={async () => {
                                const res = await send.run();
                                if (res) setSentPath(res.devAcceptPath ?? '');
                            }}
                        >
                            Send invitation
                        </Button>
                    </>
                )
            }
        >
            {sentPath !== null ? (
                <Alert tone="success">
                    Invitation created for {email}.
                    {sentPath && (
                        <>
                            {' '}Local mode doesn't send email. The accept link is <code className="font-mono break-all">{sentPath}</code>.
                        </>
                    )}
                </Alert>
            ) : (
                <div className="space-y-4">
                    {send.error && !Object.keys(errors).length ? <ErrorState error={send.error} /> : null}
                    <Field id="invite-email" label="Email" required>
                        <Input id="invite-email" type="email" value={email} error={errors.email} onChange={(e) => setEmail(e.target.value)} />
                    </Field>
                    <Field id="invite-role" label="Role" required>
                        <Select id="invite-role" value={role} onChange={(e) => setRole(e.target.value as BrandRole)}>
                            {access.assignableRoles.map((r) => (
                                <option key={r} value={r}>
                                    {ROLE_LABELS[r]}
                                </option>
                            ))}
                        </Select>
                    </Field>
                    {role === 'client' && (
                        <Field id="invite-client" label="Client" required hint="Client users only see this client's data.">
                            <Select id="invite-client" value={clientId} onChange={(e) => setClientId(e.target.value)}>
                                <option value="">Choose a client…</option>
                                {clients.data?.map((c) => (
                                    <option key={c.id} value={c.id}>
                                        {c.name}
                                    </option>
                                ))}
                            </Select>
                            {errors.clientId && <p className="mt-1 text-xs text-danger">{errors.clientId}</p>}
                        </Field>
                    )}
                </div>
            )}
        </Dialog>
    );
}
