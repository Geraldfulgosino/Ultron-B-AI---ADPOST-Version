# ULTRON-B AI — Agent Instructions

Shared rules for Codex, Claude Code, and all AI coding agents working on this project.

## Mandatory Rules

- Follow Laravel 13 conventions and PHP 8.4 strict typing
- Use MySQL 8.4-compatible migrations
- Every tenant-owned record requires `organization_id`
- Never trust `organization_id` supplied by the browser without membership verification (use `SetActiveOrganization` middleware)
- Use Policies and Form Requests for all protected operations
- Keep controllers thin; place business behaviour in `app/Domains/*/Actions/`
- Queue external APIs, AI calls, exports, and long processing (`QUEUE_CONNECTION=redis`)
- Never expose credentials, tokens, or raw provider data to React or logs
- Add tenant-isolation tests to every organization-owned feature
- Do not add a package without documenting the reason and license
- Do not edit production data or production credentials
- Run formatting (`./vendor/bin/pint`), static analysis, and tests before declaring completion
- Update documentation with every feature change

## Module Boundaries

Modules communicate through defined Actions, Events, or DTOs — never through arbitrary model cross-access.

| Domain | Purpose |
|--------|---------|
| `Identity` | User authentication and profile |
| `Organizations` | Multi-tenancy, membership, roles |
| `Invitations` | Invite flow and acceptance |
| `Clients` | Client and website management |
| `Integrations` | Integration credentials and OAuth providers |

## Testing Requirements

Every feature must include:
1. Happy-path feature test
2. Tenant isolation test (two organizations; verify denied cross-access via URL and direct API call)
3. Authorization test (wrong role is denied)

## File Conventions

- PHP: `app/Domains/<Domain>/<Layer>/<ClassName>.php`
- React pages: `resources/js/pages/<domain>/<PageName>.tsx`
- Tests: `tests/Feature/<Domain>/<FeatureTest>.php`
