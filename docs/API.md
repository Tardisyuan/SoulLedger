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
Prometheus metrics are at `/metrics/`, also outside the prefix: 404 unless `METRICS_TOKEN`
(`Authorization: Bearer …`) or `METRICS_ALLOWED_IPS` admits the caller (`backend/apps/core/metrics.py`;
metric list in `docs/DEPLOYMENT.md`).

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

The web client opts out of handling the refresh token (2026-10-29, `apps/authentication/refresh_cookie.py`):
with the request header `X-Auth-Cookie: 1`, every response that issues tokens (login, `mfa/verify/`, refresh,
change-password) leaves `refresh` out of the body and sets it as the httpOnly, `SameSite=Strict` cookie
`soulledger_refresh_http` (path `/api/v1/auth/`); refresh, logout and change-password then read it from the
cookie, with an Origin check. The two apps do not send the header and keep the body form above.

A role that requires two-step verification and has not set it up still signs in, but every officer route except
setting it up (`auth/mfa/status|setup|confirm|complete/`), `logout/`, reading oneself (`profile/`,
`profile/preferences/`) and `change-password/` answers 403 `mfa_setup_required` (`apps/authentication/mfa.py`,
`MFA_SETUP_ALLOWED`). Turning two-step verification off (`auth/mfa/disable/`, `me/mfa/disable/`) takes the
six-digit code or a recovery code; the password alone is no longer accepted.

Souls log in at `POST /soul-auth/login/` (same two-step shape: `POST
/soul-auth/mfa/verify/`), refresh at `/soul-auth/refresh/`, and may sign in from a
trusted device via `POST /soul-auth/device-login/` (revoke: `/soul-auth/device-login/revoke/`).

## Headers
```
Authorization: Bearer <access_token>
Content-Type: application/json
X-Request-ID: <id>        # optional; echoed back, made up when absent or invalid
Idempotency-Key: <key>    # optional, on the writes listed below
```

`X-Request-ID` (`apps/core/trace.py`): the value is kept for the request, written on every log line and
on the request's `AuditLog` rows, passed to Celery tasks, and returned in the response header; the clients send
one per request and the web error page shows its first characters.

`Idempotency-Key` (`apps/core/idempotency.py`, `@idempotent`): judgment conclude / claim / comment, dispatch
create / approve / execute, officer and soul letter replies, disposition execute / release, `reborn/` and the
soul's rebirth application. Keyed by (user, method, path, key) for 24 hours: a repeat with the same body
replays the first 2xx with `Idempotent-Replayed: true`; another body is 422 `idempotency_key_reused`; a repeat
while the first is still running is 409 `idempotency_in_progress`. Without the header nothing changes.
(`death-sync` keeps its own `X-Idempotency-Key`.)

## Prefix index

Every router below is mounted under `/api/v1/`; the "Endpoints" sections after this
table list the common ones, the schema has the rest. Counts of paths per prefix are
deliberately not kept here.

| Prefix | Token | What it is |
|--------|-------|------------|
| `auth/` | officer | login / officer-login / refresh / logout / profile, password reset, email verification, two-step `auth/mfa/*` (verify, status, setup, confirm, complete, recovery-codes, disable), own `sessions/`, `admin/sessions/` (`session.manage`), `impersonate/`, `login-logs/` |
| `users/` | officer (`user.manage`) | user management, `reset_password`, `reset-mfa`, deactivate (+ batch), roles, invite, CSV import/export |
| `tenants/` | officer | halls (tenants): `{code}/`, `{code}/settings/`, `{code}/mfa-roles/`, `{code}/seal-glyphs/` |
| `souls/` | officer | souls, records, `die`, `transition`, `station`, import/export, `batch-recycle` |
| `judgment/` | officer | judgments, `statutes/`, queue, draft, precedents, citations, `negative-confessions/`, `city-gods/`, `city-god-cases/`, `wangsi/`, `appeals/`, `handover/` |
| `disposition/` | officer | dispositions (`execute`, `archive`, export) |
| `ledger/` | officer | ledger balance / journal / stats (formerly `karma`) |
| `reincarnation/` | officer | reincarnation records (read-only), `reborn/`, `drink-soup/`, `quota/` |
| `realms/`, `actors/`, `events/` | officer | realms (+ `occupancy/`), mythology actors, soul event log |
| `sentence-plans/` | officer | sentence plans, `cancel`, `requests/{id}/decide|withdraw`, node `retry-dispatch` |
| `workflows/`, `nodes/`, `workflow/templates/` | officer | approval workflows, nodes, templates (these three sit directly under `/api/v1/`, no common prefix) |
| `dispatch/` | officer | dispatch `records/`, `cross-tenant-judgments/`, `capture-warrants/` (勾魂牒) |
| `death-sync/` | API key (`register/`) / officer ADMIN | external death registration, API keys, webhooks, `health/`, `tudi-gods/` (officer) |
| `perm/`, `menus/`, `audit-logs/`, `organizations/`, `notifications/`, `recycle-bin/` | officer | RBAC, menus, audit, organization tree, notifications, global recycle bin |
| `scheduler/` | officer | `jobs/` (+ `{id}/run/`, `rebuild/`) and `runs/` |
| `officer-app/` | officer | officer mobile app: `todo/`, `items/{kind}/{id}/` (+ `cosigners/`), `signer-candidates/`, `push-tokens/` |
| `chat/` | officer | the 殿司 inbox: `inbox/`, `inbox-templates/`, `hooks/new-message/` (Matrix push hook: signature-checked, no token, not in the schema) |
| `assist/` | officer | officer-side assistant: `/`, `conversations/` |
| `assist-admin/` | officer (ADMIN) | assistant admin page: `config/*`, `halls/`, `eval/*`, `try/`, `usage/`, `corpus/`, `embedding/*` |
| `social/` | officer | admin-side social CRUD (posts, comments, reactions, follows, profiles, `media/`). Post and comment rows carry `my_reaction` (the caller's own reaction kind, or `null`) and comment rows `reaction_count` (since 2026-10-30, annotated once per page) |
| `social-moderation/` | officer (`social.moderate`) | `reports/`, `posts/`, `comments/`, `sensitive-words/`, `mutes/`, `handled/` |
| `soul-accounts/` | officer | soul accounts, `credentials/` (+ `{id}/print-slip/`), `rebirth-applications/`, `cooldown-shortenings/`, `accounts/{id}/reset-mfa/` |
| `soul-auth/` | none / soul | `login/`, `refresh/`, `logout/`, `mfa/verify/`, `device-login/` (+ `revoke/`) |
| `me/` | soul | the soul's own data: `me/`, `password/`, `life/`, `past-lives/`, `sentence-plan/`, `rebirth-applications/`, `wangsi/`, `mfa/*`, `device-login/`, `push-tokens/`, `notification-settings/`, `notifications/`, `assist/`, `chat/*`, `social/*` |
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
| POST | /souls/{id}/station/ | 地府十三站: move the soul to `{"station": "<DiyuStation>"}` (`soul.transition`; may move backwards). 409 `not_diyu` / `alive`. Answers the soul |

Soul fields added 2026-10-28 (`backend/apps/souls/models.py`, `serializers.py`):
`diyu_station` (read-only; written only by `apps/souls/stations.py` and the station action),
`birth_continent` (四大部洲, 地府 only, officer-recorded; rewritten by a human rebirth),
`neutral_in_life` (European only, Inferno III; null = unrecorded; 400 on any other civilization),
`ferry_passage` (Greek: `UNBURIED` / `NO_FARE`, blank = may cross) with read-only `ferry_century_passed`
(an unburied soul dead a hundred years may cross, `apps/souls/acheron.py`).
A ledger record (`SoulRecord`) carries `sin_gravity` (`MORTAL` / `MORTAL_ABSOLVED` / `VENIAL`; European DEMERIT
only, else 400), checked against the verdict at conclusion (`DispositionService.refuse_against_gravity`:
400 `mortal_sin_unrepented` / `no_mortal_sin`).

### Judgment
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | /judgment/ | List judgments (`JudgmentListSerializer`: every detail field but `citations`, since 2026-10-30; the CSV export likewise) |
| POST | /judgment/ | Create judgment (rules in `JudgmentService.open_case`, shared with a sentence plan's REOPEN) |
| GET | /judgment/{id}/ | Get judgment detail (includes `citations`) |
| GET | /judgment/queue-counts/ | Case count per queue group, one query |
| GET | /judgment/assignable-officers/ | Officers a case can be reassigned to (unpaginated) |
| POST | /judgment/{id}/request-reassign/ | Ask the case's tenant ADMIN to reassign it (when no one else can take it) |
| PATCH | /judgment/{id}/draft/ | Autosave verdict text, chosen verdict and draft destination; 409 on a conflicting save |
| GET | /judgment/{id}/precedents/ | Ranked precedent list (unpaginated, list filters do not apply) |
| GET/POST | /judgment/{id}/citations/ | The statutes a judgment is founded on / cite one (`{"statute": "<uuid>", "note": ""}`) |
| DELETE | /judgment/{id}/citations/{statute_id}/ | Withdraw a citation from an unconcluded judgment |
| GET | /judgment/{id}/negative-confessions/ | Egyptian: the 42 denials of a weighed case with what was heard, plus a tally (`judgment.read`, unpaginated) |
| PUT | /judgment/{id}/negative-confessions/{ordinal}/ | Record one denial (`{"truthful": true\|false\|null, "note": ""}`, `judgment.execute`). 400 `not_weighed`, 404 `unknown_clause`, 409 `concluded`. Answers the whole listing |
| POST | /judgment/{id}/reopen-cancelled/ | Reopen a case held by a cancelled approval flow (`judgment.assign`) |
| POST | /judgment/wangsi/{id}/grievance/ | 枉死城: file a grievance (`{"plea": ""}`, `wangsi.execute`). 409 `not_pending` / `not_in_wangsi` / `grievance_open` |
| POST | /judgment/wangsi/{id}/decide/ | Review it (`{"upheld": bool, "note": ""}`, `wangsi.execute`, and a 城隍 officer of the case or `wangsi.manage`, else 403 `not_city_god_officer`). 409 `no_grievance_filed` / `grievance_not_major`; upheld on a major/severe grievance clears `held_until` |
| GET/POST/PATCH/DELETE | /judgment/city-gods/ | The hall's 城隍 (`city_god.read`; writes and `officer-choices/` `city_god.manage`). Fields include `rank` (`PROVINCE` / `PREFECTURE` / `DEPARTMENT` / `COUNTY`) and `bureaus` (subset of the 二十四司 `CityGodBureau`); a 城隍 with 土地公 under it cannot leave `COUNTY` (400 `city_god_has_tudi_gods`) |

`/judgment/wangsi/` (read: `wangsi.read`) only sees this hall's untimely (`untimely=True`) cases; others are 404
(`backend/apps/judgment/wangsi_views.py`, rules in `wangsi.py`). Both answer the whole judgment.

Judgment fields added 2026-10-28: `offence` (地府 罪目 `ChineseOffence`; routes the case to its court,
`DispositionService._route_chinese`; 地府 only, frozen once concluded), `wrongful_death_cause` /
`grievance_level` (枉死 cases only) and the read-only `grievance_*` columns, and read-only `ferry_barred`
(Greek original trial: `UNBURIED` / `NO_FARE` while the soul cannot cross Acheron, blank otherwise —
`apps/judgment/claims.py::ferry_barred`; claiming such a case is 409 `unferried`).

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

`ReincarnationViewSet` is read-only (`backend/apps/reincarnation/views.py:61`): there is no
`POST /reincarnation/`. Rows are written only by the two actions below.

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | /reincarnation/ | List reincarnation records |
| GET | /reincarnation/{id}/ | One record |
| GET | /reincarnation/quota/ | This month's rebirth quota per path (`reincarnation.read`) |
| POST | /reincarnation/reborn/ | Rebirth a soul and complete it at once (`reincarnation.reborn`) |
| POST | /reincarnation/drink-soup/ | 孟婆汤 (`{"soul_id": "..."}`, `reincarnation.manage`) |

A record carries `rebirth_continent` (四大部洲); `reborn` accepts it only for a 地府 rebirth into the human
path, else 400 `rebirth_continent_not_applicable`.

### Workflow rules added 2026-10-29

Not endpoints but refusals the approval routes now give (`backend/apps/workflow/`, `apps/judgment/`):
escalation stops at the final review — escalating past it, or an escalation that would complete the flow, is
400 `escalate_past_final`; a cross-realm cancel that cuts a flow short ends it `CANCELLED` (not `COMPLETED`, no
completion hooks; the judgment can be reopened with `reopen-cancelled/`); while a case's original flow is still
running (PENDING / IN_PROGRESS) an appeal, an escalated appeal and `reincarnation/reborn/` are refused with
`origin_flow_open`; a PASSED verdict on a 五逆 offence is 400 `five_heinous_must_fail` (conclusion, appeal
amend and approval alike); advisor seats of a cross-realm judgment get no approval segment.

### Dispatch: capture warrants (勾魂牒, 地府 only)

`backend/apps/dispatch/capture_views.py`, rules in `capture.py`.

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | /dispatch/capture-warrants/ | List (`?soul=`, `?status=`; `capture.read`) |
| GET | /dispatch/capture-warrants/{id}/ | One warrant (`capture.read`) |
| GET | /dispatch/capture-warrants/due/ | Living 地府 souls whose fated date has come and who have no open warrant (`{count, results}`, results capped; `capture.read`) |
| POST | /dispatch/capture-warrants/ | Issue (`{"soul": "<uuid>", "escort"?}`, `capture.issue`). 404 `not_found`; 400 `invalid_escort`; 409 `not_diyu` / `not_alive` / `lifespan_not_ended` / `warrant_open` |
| POST | /dispatch/capture-warrants/{id}/capture/ | Captured (`capture.execute`); 409 `wrong_status` |
| POST | /dispatch/capture-warrants/{id}/hand-over/ | Hand over = register the death (`{"location"?}`, `capture.execute`); 409 `wrong_status` / `not_alive` |
| POST | /dispatch/capture-warrants/{id}/cancel/ | Revoke (`{"reason": ""}`, `capture.issue`); 400 `reason_required`, 409 `wrong_status` |

A 地府 death registered any other way (death sync, 土地公, officer state change) hands every open warrant
over in the same transaction, or issues one already handed over when the soul had none (city god matched by
origin, may be null); `capture.py::close_on_death`, user decision 2026-10-30. Other civilizations get no warrant.
The soul's own `GET /me/` carries `capture_warrant` `{status, issued_at}` (地府, else null): while alive only an
`ISSUED` / `CAPTURED` one; after death the latest warrant that was not cancelled, so `HANDED_OVER` too.

### Death sync: 土地公 (地府 only)

`backend/apps/death_sync/tudi_views.py`.

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET/POST/PATCH/DELETE | /death-sync/tudi-gods/ | The hall's 土地公 (`tudi.read`; writes `tudi.manage`; delete is soft). 400 `tudi_gods_diyu_only`; `city_god` must be this hall's and, if ranked, `COUNTY` (`tudi_city_god_not_county`) |
| POST | /death-sync/tudi-gods/{id}/register-death/ | Register a death in this 土地公's name (`tudi.register`, and his officer or `tudi.manage`, else 403 `not_tudi_officer`). Same body as an external registration, `soul_lookup.soul_id` required, optional `idempotency_key` (a repeat is 409 with the existing row). Answers a registration |

### Me: 枉死城 (soul token)

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | /me/wangsi/ | This soul's untimely cases in the current life: held or not, grievance state, `can_file` / `refusal_code` |
| POST | /me/wangsi/ | File a grievance (`{"judgment": "<uuid>", "plea": ""}`); 404 `not_found` for another soul's or another life's case, other refusals as the officer side. 201 with the case |

### Users (`user.manage`)
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | /users/ | List users (`?search=`, `?role=`, `?is_active=`, `?mfa=`, `?organization=` includes sub-units) |
| POST | /users/ | Create user (a hall member who is not ADMIN needs an `organization` of that hall) |
| PATCH | /users/{id}/ | Update user (no `password`; `is_active=false` is a deactivation, see below) |
| DELETE | /users/{id}/ | Soft-delete user (same rules as deactivate) |
| POST | /users/{id}/reset_password/ | Void the password, sign out everywhere, answer `{link, expires_in}`: a single-use setup link (no password is returned) |
| POST | /users/{id}/deactivate/ | Deactivate; 409 `officer_has_open_work` unless `handover_to` names an active officer of the hall |
| POST | /users/batch_activate/, /users/batch_deactivate/ | Batch toggle; ADMIN accounts and the caller are left out, officers with open work come back in `held` |
| POST | /users/{id}/assign_roles/ | Primary `role` and `extra_roles` |
| POST | /users/{id}/reset-mfa/ | Reset two-step verification (reason required) |

Scope (2026-10-29, `apps/authentication/views.py`): the hall-less ADMIN sees every hall; anyone else, a
hall-bound ADMIN included, only their own hall, narrowed further by the role data scope. A holder of
`user.manage` who is not ADMIN never sees an ADMIN account; MODERATOR may never hold the code. Any write to
another ADMIN (edit, roles, reset password, reset-mfa, deactivate, delete) is only for the hall-less ADMIN and
needs the caller's own TOTP or recovery code (403 `second_factor_required` without it). Nobody deactivates or
deletes themselves; deactivating or deleting ends every session (refresh tokens, devices, push registrations,
sockets). A role change pushes a permission refresh to that user's open sockets.

Online sessions: `GET /auth/admin/sessions/` lists who is signed in (officers and souls),
`POST /auth/admin/sessions/{id}/revoke/` signs one session out and `POST /auth/admin/sessions/revoke-user/` all
of a user's (`session.manage`, seeded for ADMIN only; a hall-bound ADMIN sees its own hall's people).

### Permissions / RBAC (Admin)

All under the `/perm/` prefix — there is no top-level `/permissions/` route.

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | /perm/permissions/ | List permissions |
| POST | /perm/permissions/create/ | Create permission |
| GET | /perm/roles/ | List roles |
| POST | /perm/roles/create/ | Create role |
| GET | /perm/roles/{name}/permissions/ | Permissions held by a role |
| PUT/DELETE | /perm/roles/{id}/ | Edit / delete a role (refused while anyone holds it as an additional role) |
| POST | /perm/roles/{id}/copy/ | Copy a role, its data scope included |
| GET/POST | /perm/roles/{id}/members/ | Holders (main role first, then additional; paged, searchable); add as main or additional role, remove an additional one. One refusal leaves the whole batch unchanged |
| GET/PUT | /perm/roles/{id}/data-scope/ | `{default: {scope, orgs}, overrides: [{resource, scope, orgs}]}`, scope one of `ALL` / `ORG_CHILD` / `ORG` / `SELF` / `DEFINE` (DEFINE needs units and includes their sub-units); ADMIN's is fixed (400 `admin_role`) |
| GET | /perm/data-scope/resources/ | The business areas a scope can be overridden for |
| GET | /perm/role-permissions/ | Role→permission grants |
| POST | /perm/role-permissions/assign/ | Assign permissions to a role |
| POST | /perm/role-permissions/changes/, /perm/role-permissions/impact/ | Save matrix changes / preview their effect on approval steps |
| GET/POST | /perm/export/, /perm/import/ | Export / import the permission set (with `role_data_scopes`) |

Reads need `system.settings` (the catalogue also opens for `menu.manage`); every write needs `system.settings`
and no hall, i.e. the hall-less ADMIN (`CanWriteGlobalSettings`, `apps/perm/views.py`). The checker's server rules
(`apps/perm/checker.py`), refused by the matrix, assign, copy and import alike: ADMIN-only codenames
(`recycle_bin.restore`, `recycle_bin.hard_delete`, `soul.correct_settlement`, `menu.manage`,
`scheduler.manage`); MODERATOR never holds `user.manage`; a role holding `workflow.create` / `workflow.update`
may not hold `workflow.approve` / `workflow.advance`. A catalogue codename's row can be recreated with its
default grants but never deleted or renamed. Every grant write pushes a permission refresh to the affected
users' sockets. Row visibility follows the role data scope (`apps/perm/data_scope.py`): with no rows a role sees
its whole hall; data the user created or is assigned to is always visible.

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
| GET | /audit-logs/ | List audit logs (`?action=`, `?resource=`, `?resource_id=`, `?user=`, `?trace_id=`, `?tenant=<hall code>`, `?start_date=` / `?end_date=`, `?search=`) |
| GET | /audit-logs/export/ | CSV of the same query as the list (same filters, `?search=` included, same hall scope), unpaginated |

`?search=` (since 2026-10-30) matches `resource`, `resource_id`, `description` and the acting user's
username across every row the caller may read — not only the page on screen.

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
`checker.py`, and the seeding management commands such as `sync_permissions`).
