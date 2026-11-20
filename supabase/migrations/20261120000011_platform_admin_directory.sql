-- Migration 0011: Super Admins can see who the other Super Admins are (Phase 17F).
--
-- Found while wiring the Users page to Supabase: platform_admins_select_self (0008) lets each
-- user read only their own row, so a Super Admin could not tell which users hold Super Admin
-- (needed to grant/revoke it, and to protect the last one in the UI). Everyone else still sees
-- only their own row. Writes are unchanged: grant_super_admin / revoke_super_admin only.
-- One permissive policy (not two) and initplan-wrapped calls, per the Supabase advisors.
--
-- STATUS: local only. Not applied to staging (needs owner approval with 0006–0010).

drop policy platform_admins_select_self on public.platform_admins;
create policy platform_admins_select on public.platform_admins for select to authenticated
    using (user_id = (select auth.uid()) or (select app.is_platform_admin()));
