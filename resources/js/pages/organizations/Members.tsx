import React, { useState } from 'react';
import { useForm, Head, router, usePage } from '@inertiajs/react';
import AppLayout from '@/layouts/AppLayout';
import { Card, CardContent, CardHeader } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Label } from '@/components/ui/Label';
import { Badge } from '@/components/ui/Badge';
import type { OrganizationMember, OrganizationInvitation, MemberRole, Organization } from '@/types/models';

interface MembersProps {
    members: OrganizationMember[];
    invitations: OrganizationInvitation[];
    roles: Array<{ value: string; label: string }>;
    canManage: boolean;
}

const roleBadgeVariant = (role: MemberRole) => {
    const map: Record<MemberRole, 'indigo' | 'blue' | 'gray' | 'green'> = {
        owner: 'indigo',
        admin: 'blue',
        member: 'gray',
        viewer: 'green',
    };
    return map[role] ?? 'gray';
};

export default function Members({ members, invitations, roles, canManage }: MembersProps) {
    const { currentOrganization } = usePage().props as unknown as {
        currentOrganization: (Organization & { role: string }) | null;
    };
    const slug = currentOrganization?.slug ?? '';
    const [showInvite, setShowInvite] = useState(false);
    const { data, setData, post, processing, errors, reset } = useForm({
        email: '',
        role: 'member' as string,
    });

    const submit = (e: React.FormEvent) => {
        e.preventDefault();
        post(route('invitations.store', { organization: slug }), {
            onSuccess: () => {
                reset();
                setShowInvite(false);
            },
        });
    };

    return (
        <AppLayout title="Team Members">
            <Head title="Team Members" />

            {/* Invite form */}
            {canManage && (
                <div className="mb-6">
                    {!showInvite ? (
                        <Button onClick={() => setShowInvite(true)}>Invite member</Button>
                    ) : (
                        <Card>
                            <CardHeader>
                                <h3 className="text-base font-semibold text-gray-900">Invite a team member</h3>
                            </CardHeader>
                            <CardContent>
                                <form onSubmit={submit} className="flex gap-3 items-end">
                                    <div className="flex-1">
                                        <Label htmlFor="email" required>Email</Label>
                                        <Input
                                            id="email"
                                            type="email"
                                            value={data.email}
                                            onChange={(e) => setData('email', e.target.value)}
                                            placeholder="colleague@example.com"
                                            error={errors.email}
                                        />
                                    </div>
                                    <div className="w-36">
                                        <Label htmlFor="role">Role</Label>
                                        <select
                                            id="role"
                                            value={data.role}
                                            onChange={(e) => setData('role', e.target.value)}
                                            className="block w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                                        >
                                            {roles.map((r) => (
                                                <option key={r.value} value={r.value}>{r.label}</option>
                                            ))}
                                        </select>
                                    </div>
                                    <Button type="submit" loading={processing}>Send invite</Button>
                                    <Button variant="ghost" type="button" onClick={() => setShowInvite(false)}>
                                        Cancel
                                    </Button>
                                </form>
                            </CardContent>
                        </Card>
                    )}
                </div>
            )}

            {/* Members list */}
            <Card className="mb-6">
                <CardHeader>
                    <h3 className="text-base font-semibold text-gray-900">Members ({members.length})</h3>
                </CardHeader>
                <div className="divide-y divide-gray-100">
                    {members.map((member) => (
                        <div key={member.id} className="px-6 py-4 flex items-center justify-between">
                            <div>
                                <p className="text-sm font-medium text-gray-900">{member.name}</p>
                                <p className="text-xs text-gray-500">{member.email}</p>
                            </div>
                            <div className="flex items-center gap-3">
                                {member.department && (
                                    <span className="text-xs text-gray-400">{member.department}</span>
                                )}
                                <Badge variant={roleBadgeVariant(member.role)}>{member.role_label}</Badge>
                            </div>
                        </div>
                    ))}
                </div>
            </Card>

            {/* Pending invitations */}
            {invitations.length > 0 && (
                <Card>
                    <CardHeader>
                        <h3 className="text-base font-semibold text-gray-900">
                            Pending invitations ({invitations.length})
                        </h3>
                    </CardHeader>
                    <div className="divide-y divide-gray-100">
                        {invitations.map((inv) => (
                            <div key={inv.id} className="px-6 py-4 flex items-center justify-between">
                                <div>
                                    <p className="text-sm font-medium text-gray-900">{inv.email}</p>
                                    <p className="text-xs text-gray-500">
                                        Invited by {inv.invited_by} · Expires {inv.expires_at}
                                    </p>
                                </div>
                                <div className="flex items-center gap-3">
                                    <Badge variant="yellow">{inv.role_label}</Badge>
                                    {canManage && (
                                        <button
                                            onClick={() => router.delete(
                                                route('invitations.destroy', {
                                                    organization: slug,
                                                    invitation: inv.id,
                                                })
                                            )}
                                            className="text-xs text-red-500 hover:text-red-700"
                                        >
                                            Cancel
                                        </button>
                                    )}
                                </div>
                            </div>
                        ))}
                    </div>
                </Card>
            )}
        </AppLayout>
    );
}
