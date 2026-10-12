# SoulLedger API Documentation

> The authoritative API reference is generated from the code: OpenAPI schema at
> `/api/schema/` and Swagger UI at `/api/docs/` (drf-spectacular; both ADMIN-only,
> same-origin session), and the committed copy `packages/core/openapi/schema.yml`.
> The routes themselves are `backend/config/urls.py` plus each app's `urls.py`.
> This file is a hand-maintained quick index and can drift. When they disagree, the
> generated schema is right.

## Base URL
```
http://localhost:8000/api/v1
```

Health checks sit outside the versioned prefix: `/health/` and `/health/detailed/`.

## Authentication
All API endpoints require JWT authentication unless noted. There are two token
families: **officers** (`/auth/`) and **souls** (`/soul-auth/`, used by the
soul-side app); the prefix a route sits under says which one it takes.

```bash
# Officer login (also /auth/officer-login/)
POST /auth/login/
Body: { "username": "admin", "password": "..." }
Response: { "access": "jwt...", "refresh": "jwt...", "user": {...} }
# With two-step verification (MFA) on, the 200 is instead
#   { "mfa_required": true, "pending_token": "..." }
# and the second step is:
POST /auth/mfa/verify/
Body: { "pending_token": "...", "code": "123456" }   # or "recovery_code"; optional "remember_device"

# Refresh
POST /auth/refresh/
Body: { "refresh": "jwt..." }
```

Souls log in at `POST /soul-auth/login/` (same two-step shape: `POST
/soul-auth/mfa/verify/`), refresh at `/soul-auth/refresh/`, and may sign in from a
trusted device via `POST /soul-auth/device-login/` (revoke: `/soul-auth/device-login/revoke/`).

## Headers
```
Authorization: Bearer <access_token>
Content-Type: application/json
```

## Prefix index

Every router below is mounted under `/api/v1/`; the "Endpoints" sections after this
table list the common ones, the schema has the rest. Counts of paths per prefix are
deliberately not kept here.

| Prefix | Token | What it is |
|--------|-------|------------|
| `auth/` | officer | login / officer-login / refresh / logout / profile, password reset, email verification, two-step `auth/mfa/*` (verify, status, setup, confirm, complete, recovery-codes, disable), `login-logs/` |
| `users/` | officer (ADMIN) | user management, `reset-mfa`, batch activate, CSV import/export |
| `tenants/` | officer | halls (tenants): `{code}/`, `{code}/settings/`, `{code}/mfa-roles/`, `{code}/seal-glyphs/` |
| `souls/` | officer | souls, records, `die`, `transition`, import/export, `batch-recycle` |
| `judgment/` | officer | judgments, `statutes/`, queue, draft, precedents, citations |
| `disposition/` | officer | dispositions (`execute`, `archive`, export) |
| `ledger/` | officer | ledger balance / journal / stats (formerly `karma`) |
| `reincarnation/` | officer | reincarnation records |
| `realms/`, `actors/`, `events/` | officer | realms (+ `occupancy/`), mythology actors, soul event log |
| `sentence-plans/` | officer | sentence plans, `cancel`, `requests/{id}/decide|withdraw`, node `retry-dispatch` |
| `workflows/`, `nodes/`, `workflow/templates/` | officer | approval workflows, nodes, templates (these three sit directly under `/api/v1/`, no common prefix) |
| `dispatch/` | officer | dispatch records and `cross-tenant-judgments/` |
| `death-sync/` | API key (`register/`) / officer ADMIN | external death registration, API keys, webhooks, `health/` |
| `perm/`, `menus/`, `audit-logs/`, `organizations/`, `notifications/`, `recycle-bin/` | officer | RBAC, menus, audit, organization tree, notifications, global recycle bin |
| `scheduler/` | officer | `jobs/` (+ `{id}/run/`, `rebuild/`) and `runs/` |
| `officer-app/` | officer | officer mobile app: `todo/`, `items/{kind}/{id}/` (+ `cosigners/`), `signer-candidates/`, `push-tokens/` |
| `chat/` | officer | the 殿司 inbox: `inbox/`, `inbox-templates/`, `hooks/new-message/` (Matrix push hook: signature-checked, no token, not in the schema) |
| `assist/` | officer | officer-side assistant: `/`, `conversations/` |
| `assist-admin/` | officer (ADMIN) | assistant admin page: `config/*`, `halls/`, `eval/*`, `try/`, `usage/`, `corpus/`, `embedding/*` |
| `social/` | officer | admin-side social CRUD (posts, comments, reactions, follows, profiles, `media/`) |
| `social-moderation/` | officer (`social.moderate`) | `reports/`, `posts/`, `comments/`, `sensitive-words/`, `mutes/`, `handled/` |
| `soul-accounts/` | officer | soul accounts, `credentials/` (+ `{id}/print-slip/`), `rebirth-applications/`, `cooldown-shortenings/`, `accounts/{id}/reset-mfa/` |
| `soul-auth/` | none / soul | `login/`, `refresh/`, `logout/`, `mfa/verify/`, `device-login/` (+ `revoke/`) |
| `me/` | soul | the soul's own data: `me/`, `password/`, `life/`, `past-lives/`, `sentence-plan/`, `rebirth-applications/`, `mfa/*`, `device-login/`, `push-tokens/`, `notification-settings/`, `notifications/`, `assist/`, `chat/*`, `social/*` |
| `social-media/{id}/`, `chat-images/{id}/` | signed URL | file outlets for post images and letter images; visibility is re-checked on every request |
| `app-version/` | none | client version check |

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
| GET | /judgment/queue-counts/ | Case count per queue group, one query |
| GET | /judgment/assignable-officers/ | Officers a case can be reassigned to (unpaginated) |
| POST | /judgment/{id}/request-reassign/ | Ask the case's tenant ADMIN to reassign it (when no one else can take it) |
| PATCH | /judgment/{id}/draft/ | Autosave verdict text, chosen verdict and draft destination; 409 on a conflicting save |
| GET | /judgment/{id}/precedents/ | Ranked precedent list (unpaginated, list filters do not apply) |
| GET/POST | /judgment/{id}/citations/ | The statutes a judgment is founded on / cite one (`{"statute": "<uuid>", "note": ""}`) |
| DELETE | /judgment/{id}/citations/{statute_id}/ | Withdraw a citation from an unconcluded judgment |

Paths verified 2026-09-26 against `backend/apps/judgment/views.py` (`@action` `url_path`s) and
`backend/apps/judgment/urls.py` (the viewset is registered at the `judgment/` root). Not exhaustive —
claim / release / defer / conclude and friends are in the generated schema.

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
| GET | /ledger/journal/?month=YYYY-MM | 功过总账: the four columns (旧管 / 新收 / 开除 / 实在), per-category totals, one page of entries |
| GET | /ledger/journal/export/?month=YYYY-MM | The same month and filters, every entry, one row each (CSV) |

(`backend/apps/ledger/urls.py:15-16`; filters `civilization`, `category`, `search`.)

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
