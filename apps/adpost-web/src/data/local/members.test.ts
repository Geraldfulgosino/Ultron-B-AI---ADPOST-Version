import { AccessDeniedError, NotFoundError, ValidationError } from '../errors';
import { as, IDS, testDb } from '@/test/helpers';
import { apiFor } from './backend';
import { LocalDatabase } from './db';

const { pod, dmd } = IDS.brands;

describe('members', () => {
    it('staff can list members; client users cannot', async () => {
        expect((await as('vic').api.members.list(pod)).length).toBeGreaterThan(1);
        await expect(as('casey').api.members.list(pod)).rejects.toBeInstanceOf(AccessDeniedError);
    });

    it('brand A admin cannot list or edit brand B members', async () => {
        const priya = as('priya').api;
        await expect(priya.members.list(dmd)).rejects.toBeInstanceOf(AccessDeniedError);
        await expect(priya.members.updateRole(dmd, 'bm_dana_dmd', 'viewer')).rejects.toBeInstanceOf(AccessDeniedError);
        await expect(priya.members.updateRole(pod, 'bm_dana_dmd', 'viewer')).rejects.toBeInstanceOf(NotFoundError);
    });

    it('managers cannot change roles', async () => {
        await expect(as('morgan').api.members.updateRole(pod, 'bm_vic_pod', 'member')).rejects.toBeInstanceOf(AccessDeniedError);
    });

    it('keeps at least one owner', async () => {
        const priya = as('priya').api;
        await expect(priya.members.updateRole(pod, 'bm_priya_pod', 'admin')).rejects.toBeInstanceOf(ValidationError);
        await expect(priya.members.remove(pod, 'bm_priya_pod')).rejects.toBeInstanceOf(ValidationError);
    });

    it('owner can promote and requires a client for the client role', async () => {
        const db = testDb();
        const priya = as('priya', db).api;
        await expect(priya.members.updateRole(pod, 'bm_vic_pod', 'client', null)).rejects.toBeInstanceOf(ValidationError);
        await expect(priya.members.updateRole(pod, 'bm_vic_pod', 'client', 'cli_dmd_1')).rejects.toBeInstanceOf(ValidationError);
        const updated = await priya.members.updateRole(pod, 'bm_vic_pod', 'admin');
        expect(updated.role).toBe('admin');
        // the new admin still cannot touch the owner
        await expect(as('vic', db).api.members.updateRole(pod, 'bm_priya_pod', 'member')).rejects.toBeInstanceOf(AccessDeniedError);
    });
});

describe('invitations', () => {
    it('full flow: send, preview, accept with matching email', async () => {
        const db = testDb();
        const { invitation, devAcceptPath } = await as('priya', db).api.invitations.send(pod, { email: 'Dana@DMD.example.test', role: 'member' });
        expect(invitation).not.toHaveProperty('token');
        const token = devAcceptPath!.split('/').pop()!;

        // wrong user cannot accept
        await expect(as('frank', db).api.invitations.accept(token)).rejects.toBeInstanceOf(AccessDeniedError);

        const dana = as('dana', db).api;
        expect((await dana.invitations.preview(token)).brandName).toBe('POD');
        expect(await dana.invitations.accept(token)).toEqual({ brandSlug: 'pod' });
        expect((await dana.workspace.listBrands()).map((b) => b.brand.slug)).toEqual(['dmd', 'pod']);
        await expect(dana.invitations.accept(token)).rejects.toBeInstanceOf(ValidationError);
    });

    it('rejects duplicates, existing members, and roles the sender cannot grant', async () => {
        const db = testDb();
        await as('priya', db).api.invitations.send(pod, { email: 'new@example.test', role: 'member' });
        await expect(as('priya', db).api.invitations.send(pod, { email: 'new@example.test', role: 'member' })).rejects.toBeInstanceOf(ValidationError);
        await expect(as('priya', db).api.invitations.send(pod, { email: 'vic@pod.example.test', role: 'member' })).rejects.toBeInstanceOf(ValidationError);
        await expect(as('morgan', db).api.invitations.send(pod, { email: 'x@example.test', role: 'member' })).rejects.toBeInstanceOf(AccessDeniedError);
        // ADPOST admin (morgan) cannot mint owners
        await expect(as('morgan', db).api.invitations.send(IDS.brands.adpost, { email: 'x@example.test', role: 'owner' })).rejects.toBeInstanceOf(ValidationError);
    });

    it('expires after 7 days', async () => {
        const db = testDb();
        const { devAcceptPath } = await as('priya', db).api.invitations.send(pod, { email: 'dana@dmd.example.test', role: 'viewer' });
        const later = new LocalDatabase(db.snapshot(), db.credentials, { now: () => new Date('2026-11-05T00:00:00Z') });
        await expect(apiFor(later, IDS.users.dana).invitations.accept(devAcceptPath!.split('/').pop()!)).rejects.toThrow('expired');
    });

    it('cannot list or cancel another brand\'s invitations', async () => {
        const db = testDb();
        const { invitation } = await as('priya', db).api.invitations.send(pod, { email: 'z@example.test', role: 'viewer' });
        await expect(as('uma', db).api.invitations.cancel(IDS.brands.urban, invitation.id)).rejects.toBeInstanceOf(NotFoundError);
        await expect(as('uma', db).api.invitations.list(pod)).rejects.toBeInstanceOf(AccessDeniedError);
    });
});
