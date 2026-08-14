# SoulLedger API Documentation

> The authoritative API reference is generated from the code: OpenAPI schema at
> `/api/schema/` and Swagger UI at `/api/docs/` (drf-spectacular). This file is a
> hand-maintained quick index and can drift. When the two disagree, the generated
> schema is right.

## Base URL
```
http://localhost:8000/api/v1
```

Health checks sit outside the versioned prefix: `/health/` and `/health/detailed/`.

## Authentication
All API endpoints require JWT authentication unless noted.

```bash
# Login
POST /auth/login/
Body: { "username": "admin", "password": "..." }
Response: { "access": "jwt...", "refresh": "jwt...", "user": {...} }

# Refresh
POST /auth/refresh/
Body: { "refresh": "jwt..." }
```

## Headers
```
Authorization: Bearer <access_token>
Content-Type: application/json
```

## Endpoints

### Souls
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | /souls/ | List all souls |
| POST | /souls/ | Create soul |
| GET | /souls/{id}/ | Get soul detail |
| PUT | /souls/{id}/ | Update soul |
| DELETE | /souls/{id}/ | Delete soul |

### Judgment
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | /judgment/ | List judgments |
| POST | /judgment/ | Create judgment |
| GET | /judgment/{id}/ | Get judgment detail |

### Ledger

Formerly "karma". The app was renamed to `ledger` and the routes moved with it —
`/karma/` no longer exists.

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | /ledger/balance/{soul_id}/ | Ledger summary with time decay, plus the per-civilization `reading` |
| POST | /ledger/calculate/{soul_id}/ | Recalculate |
| GET | /ledger/effective/{soul_id}/ | Effective (decayed) totals |
| GET | /ledger/inheritance/{soul_id}/ | Inherited karma |
| GET | /ledger/stats/overview/ | Aggregate stats |
| GET | /ledger/stats/export/ | CSV export |

`GET /ledger/balance/{soul_id}/` returns both `karmic_balance` (the raw net
total, which the rest of the system routes on) and `reading` — the instrument
this soul's own cosmology uses, which is a *structurally different* object per
civilization. Anything displayed to a user should come from `reading`. See
`backend/apps/ledger/readings.py`.

### Reincarnation
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | /reincarnation/ | List reincarnation records |
| POST | /reincarnation/ | Create reincarnation |

### Users (Admin)
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | /users/ | List users |
| POST | /users/ | Create user |
| PATCH | /users/{id}/ | Update user |
| DELETE | /users/{id}/ | Delete user |

### Permissions / RBAC (Admin)

All under the `/perm/` prefix — there is no top-level `/permissions/` route.

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | /perm/permissions/ | List permissions |
| POST | /perm/permissions/create/ | Create permission |
| GET | /perm/roles/ | List roles |
| POST | /perm/roles/create/ | Create role |
| GET | /perm/roles/{name}/permissions/ | Permissions held by a role |
| GET | /perm/role-permissions/ | Role→permission grants |
| POST | /perm/role-permissions/assign/ | Assign permissions to a role |
| GET/POST | /perm/export/, /perm/import/ | Export / import the permission set |

### Menus (Admin)
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | /menus/ | List menus |
| POST | /menus/ | Create menu |
| GET | /menus/buttons/ | List menu buttons |
| POST | /menus/buttons/ | Create menu button |

### Audit (Admin)
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | /audit-logs/ | List audit logs |

### Organizations
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | /organizations/ | List organizations |

## Permissions

API access is controlled by permission codenames of the form
`<resource>.<action>` — e.g. `soul.create`, `judgment.read`, `menu.delete`,
`audit.read` — enforced by `CodenameViewSetMixin` on the ViewSet.

The codename catalogue and the role→codename grants are moving; do not treat any
list written here as current. The live sources are `backend/apps/perm/` (models,
`checker.py`, and the seeding management commands) and
`backend/docs/PERMISSION_COVERAGE_MATRIX.md`.
