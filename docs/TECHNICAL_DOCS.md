# SoulLedger Technical Documentation

## Architecture

### Stack
- **Backend**: Django 5 + DRF + channels; PostgreSQL 16 (SQLite locally)
- **Frontend**: Next.js 16 + React 18 + TanStack Query v5 + TailwindCSS
- **Auth**: JWT (djangorestframework-simplejwt), plus API keys for Death Sync
- **Task Queue**: Celery + Redis

Exact pinned ranges are in `backend/requirements.txt` and
`frontend/package.json`; those files are the authority, not this one.

### Project Structure
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
│   │   ├── permissions/     # Cross-tenant judgment authorization
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
- **Roles**: ADMIN, JUDGE, GUARDIAN, VIEWER (extensible)
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
- `RouteGuard` — gates entire routes
- `usePermissions()` — hook with ADMIN bypass

## API Documentation
See [API.md](./API.md)

## Milestones
See [MILESTONES.md](./MILESTONES.md)

## Production Readiness
See [PRODUCTION_READINESS_REPORT.md](./PRODUCTION_READINESS_REPORT.md)
