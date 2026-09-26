# SoulLedger Technical Documentation

## Architecture

### Stack
- **Backend**: Django 5 + DRF + channels; PostgreSQL 16 (SQLite locally)
- **Frontend**: Next.js 16 + React 19 + TanStack Query v5 + TailwindCSS
  (web builds and jest use Next's vendored React canary; `packages/core` vitest and
  `mobile/` use the installed react 19.2.3 — see `CLAUDE.md`, Build & Test)
- **Auth**: JWT (djangorestframework-simplejwt), plus API keys for Death Sync
- **Task Queue**: Celery + Redis

Exact ranges are in `backend/requirements.txt` (pinned set: `requirements.lock`, which
CI and the image install) and `frontend/package.json`; those files are the authority, not this one.

### Project Structure

> **2026-09-26 note:** the app list below is a partial, older snapshot (it omits
> `dispatch`, `notifications`, `org`, `death_sync`, `social`, `scheduler`,
> `soul_accounts`, `soul_push`, `chat` and `sentence_plan`). The list is maintained in
> `backend/config/settings.py:69-92` (24 local apps); `AGENTS.md` §6 has a current tree.
> `permissions/` has been removed from the tree here: `apps.permissions` was deleted on
> 2026-09-03 (see `backend/AGENTS.md`); the live RBAC app is `perm/`.

```
├── backend/           Django project
│   ├── apps/
│   │   ├── actors/          # Judges, guardians, psychopomps
│   │   ├── audit/           # Audit logging
│   │   ├── authentication/  # JWT auth, User model, roles
│   │   ├── core/            # Middleware, shared viewsets/mixins, health
│   │   ├── disposition/     # Disposition system
│   │   ├── events/          # Event system
│   │   ├── judgment/        # Judgment records
│   │   ├── ledger/          # Merit/demerit, time decay, per-civ readings
│   │   ├── menus/           # Menu & button management
│   │   ├── perm/            # RBAC permissions
│   │   ├── realms/          # Realm management
│   │   ├── reincarnation/   # Reincarnation records
│   │   ├── souls/           # Soul model, state machine, tenant→civ map
│   │   ├── tenants/         # Multi-tenant
│   │   └── workflow/        # Workflow engine
│   └── config/              # Django settings
├── frontend/          Next.js project
│   ├── app/           # App Router pages
│   ├── src/
│   │   ├── components/      # React components
│   │   │   └── rbac/        # Permission components
│   │   ├── contexts/        # React contexts
│   │   └── hooks/           # Custom hooks
│   ├── e2e/                 # Playwright tests
│   └── lib/                 # Utilities, API client
└── docs/              Documentation
```

## Permission System

### RBAC Model
- **Roles**: ADMIN, MODERATOR, JUDGE, GUARDIAN, VIEWER, SOUL
  (`backend/apps/authentication/models.py:56-67`; SOUL is the soul-app account, never assignable)
- **Permissions**: Codename-based (e.g., `soul.create`, `menu.delete`)
- **Data Scope**: Tenant-level data isolation
- **Field Permissions**: Per-field visibility control

### Permission Flow
1. User authenticates → receives JWT with role
2. `get_permissions()` returns codenames from DB or ROLE_PERMISSIONS fallback
3. Frontend checks permissions via `usePermissions()` hook
4. `RequirePermission` component gates UI elements
5. Backend `CodenameViewSetMixin` enforces API-level access

### Key Components
- `RequirePermission` — gates children by permission codename
- `RequireButton` — gates by menu button code
- ~~`RouteGuard`~~ — no such component (2026-09-26). Page-level gates wrap the page in
  `RequirePermission` with a `PermissionDenied` fallback; `frontend/middleware.ts` only
  separates public paths from authenticated ones
- `usePermissions()` — hook with ADMIN bypass

## API Documentation
See [API.md](./API.md)

## Milestones
See [MILESTONES.md](./MILESTONES.md)

## Production Readiness
See [PRODUCTION_READINESS_REPORT.md](./PRODUCTION_READINESS_REPORT.md)
