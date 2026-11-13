# Role Architecture (master prompt v6.0)

**Status (2026-11-13):** implemented in migration `20261113000009_roles_access.sql`, the local adapter and the UI. Validated on PGlite (local Postgres) and the mock adapter. **Not applied to staging.**

## Three product roles

| Product role | Storage | Scope |
|---|---|---|
| **Super Admin** | `public.platform_admins` row | Whole platform: all agencies, clients, users, audit log |
| **Admin** (company/agency) | `agency_memberships.role` in `agency_owner`, `agency_admin` | One agency and all of its clients |
| **Client User** | `brand_memberships.role = 'client'` | One client (brand). Optionally one client row (`client_id`), or whole-client when `client_id` is null |

Internal staff roles stay as before: `agency_manager` (agency staff) and brand roles `brand_admin`, `seo_manager`, `content_editor`, `analyst`, `viewer`.

The UI computes an `EffectiveRole` (`src/data/access.ts`). `super_admin` is checked first, then agency roles, then brand roles. `ROLE_LABELS.super_admin = 'Super Admin'`.

## Hierarchy

```
Platform (Super Admin)
└── Agency (Admin)                         status: active | suspended | archived
    └── Client = Brand (Client Users)      status: active | archived
        └── Websites, conversations, projects, tasks, reports, agents
```

Target data (dev seed, reconciled once on 2026-11-13):
- **VCA:** CMS, LIPSKY, HLDC, LOOP19
- **ADPOST:** POD, FMF, DYNAMIC SCREEN PRINTING, CAR MAGNETS
- **GoldStarATM:** ATM NEBRASKA, ATM FLORIDA, ATM OHIO, ATM HAWAII

## Building blocks (SQL, `app` schema)

| Function | Meaning |
|---|---|
| `is_platform_admin()` | Caller is a Super Admin |
| `agency_open(agency)` / `brand_agency_open(brand)` | The agency is not suspended |
| `is_agency_staff_for_agency`, `is_agency_admin_for_agency`, `is_agency_admin`, `is_agency_manager` | All start with `is_platform_admin() or …`, and require an open agency |
| `brand_role(brand)` | The caller's brand role. Null when the agency is suspended or the user is deactivated |
| `client_permission(brand, perm)` | Client User has the explicit permission (`ai_chat`, `comment_tasks`, `download_reports`) |
| `can_read_client_row(brand, client)` | A client-scoped Client User sees only their client row. Whole-client users see all |
| `can_read_conversation` / `can_post_in_conversation` | Visibility scopes (see CLIENT_PORTAL_ACCESS.md) |

Identity always comes from `auth.uid()`. The browser never decides ownership: agency and brand ids sent by the client are checked against memberships inside policies and `security definer` functions.

## Lifecycle controls
- **Agency suspension** (`agencies.status = 'suspended'`) locks out every Admin, staff member and Client User of that agency on their next query. Super Admins keep access so they can restore it.
- **User suspension** (`set_user_suspended`, Super Admin only) sets `profiles.deactivated_at`. The user loses access on the next query, even with an unexpired JWT.
- **Membership revocation** removes rows. Reads stop immediately.

## Related documents
PERMISSION_MATRIX.md · SUPER_ADMIN_DESIGN.md · AGENCY_ADMIN_DESIGN.md · CLIENT_PORTAL_ACCESS.md · USER_INVITATION_FLOW.md · RLS_ROLE_TEST_MATRIX.md · MULTI_AGENCY_ARCHITECTURE.md
