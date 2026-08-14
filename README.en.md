# SoulLedger

**English** | [中文](README.md)

SoulLedger is a working full-stack web application — Django + Next.js — that tracks
souls through an afterlife pipeline in three different mythologies at once: the
Chinese Diyu, the Christian/Greek/Norse afterlives grouped here as "European," and
the Egyptian Duat. It is an application, not a documentation repository: the
`docs/` folder holds the domain research that the code was built from, and the
research is genuinely load-bearing.

The interesting part is that the three cosmologies are not one data model in three
colour schemes. They compute structurally different quantities, and the code
refuses to average them.

---

## Why the three civilizations are not the same system

Most "multi-culture" demos pick one mechanic and restyle it. This one does not.
See [`backend/apps/ledger/readings.py`](backend/apps/ledger/readings.py):

| Civilization | What its ledger actually says | Shape of the answer |
|---|---|---|
| **Chinese** | A cumulative account (功過格). Merit and demerit offset each other; the running total *is* the verdict. | One signed number |
| **Egyptian** | A threshold test. The heart is weighed once against Ma'at's feather and must be "not heavier than" it. Merit does not appear — there is no offsetting step. | Pass/fail against a fixed counterweight |
| **European** | Two unrelated facts. *Culpa* (guilt) and *poena* (penalty remaining after absolution) do not reduce each other, and this system holds no data from which poena could honestly be derived. | Two independent quantities, one of them explicitly unavailable |

A soul whose tenant is not mapped to a cosmology gets no reading at all — an
explicit refusal rather than a fallback to somebody else's arithmetic.

The same principle runs through the ledger's decay rule
(`backend/apps/ledger/services.py`): karma decays at 1%/year for Chinese and
Egyptian souls and **not at all** for European ones, because the published
European label denies decay outright. Decay is anchored to the soul's death date,
not to today, so a 612 BCE deed is not eroded to nothing by the mere passage of
civilizational time.

This distinction is not backend-only. The soul detail page's `SoulReadingPanel`
([`frontend/src/components/souls/SoulReadingPanel.tsx`](frontend/src/components/souls/SoulReadingPanel.tsx))
switches on `reading.kind` and renders each shape differently: Chinese gets a net
figure with a trend, Egyptian renders "not heavier than" as a ratio rather than a
badge that would read "fail" for nearly every soul forever, European keeps culpa
and poena visually separate and, when poena is unavailable, shows why rather than
a 0. The souls list's Balance column follows the same rule — only Chinese souls
get a net number; every other civilization gets an em dash rather than a
borrowed reading.

Dates carry two severities. `death_before_birth`, `implausible_lifespan` and
`event_before_birth` are ERRORs — the write is refused outright.
`event_after_death` (a record entered after the soul's death — legitimately
common: posthumous judgments, deeds recorded after the fact) is a WARNING: it's
let through and stays visible in the detail page's `DateProblemsPanel`, where an
operator can mark it reviewed. That mark is bound to a fingerprint of the exact
pair of dates it was reviewed against — if either date is edited afterward, the
mark stops applying and the warning reappears, rather than a plain boolean
silently hiding a warning that is now about different dates. The souls list marks
affected rows with ⊘/△ and offers a one-click filter for them.

---

## Quick start

**Prerequisites:** Python 3.11+, Node.js 20+, and Docker if you want PostgreSQL
and Redis locally.

### Backend

```bash
cd backend
cp .env.example .env
pip install -r requirements.txt
python manage.py migrate
python manage.py runserver 0.0.0.0:8000
```

With no `DATABASE_URL` set, Django falls back to SQLite at `backend/db.sqlite3`,
so this works with nothing else running. (SQLite is rejected outright when
`DEBUG=False`.) Redis is only needed for WebSockets and Celery — the REST API
runs without it.

### Frontend

```bash
cd frontend
npm install
npm run dev          # already pins PORT=3333
```

### PostgreSQL + Redis (optional, matches CI)

```bash
cd infrastructure
docker compose up -d   # postgres:16-alpine on :5432, redis:7-alpine on :6379
```

Then point the backend at it, e.g.
`DATABASE_URL=postgres://soulledger:devpassword@localhost:5432/soulledger`.

### Whole stack in Docker

```bash
docker compose up    # root docker-compose.yml: db, redis, backend, celery, celery-beat, frontend
```

Requires `DB_PASSWORD` and `SECRET_KEY` in the environment. This path runs
migrations and seeds all three civilizations on boot.

### Seed data

The root compose file's boot sequence is `python manage.py migrate` then
`python manage.py seed_mythology`, which loads realms and actors for all three
civilizations. It used to run `python scripts/seed_chinese_data.py` — a second
hand-maintained copy of the same tables, where every edit had to be remembered
twice and the copy docker ran was the one no test covered. That script is gone;
the command is the only seeding entry point. Further seeding also lives in
Django management commands:

```bash
python manage.py seed_tenants               # CN_DIYU, EU_HEAVEN_HELL, EG_DUAT
python manage.py seed_mythology             # realms + actors, all three (idempotent)
python manage.py consolidate_eu_pantheon
python manage.py seed_workflow_templates
python manage.py seed_field_permissions
python manage.py init_organizations
python manage.py create_api_key             # for the Death Sync external API
```

### Convenience scripts

```bash
bash scripts/start-all.sh      # backend + frontend, backgrounded, logs in scripts/logs/
bash scripts/status.sh
bash scripts/stop-all.sh
bash scripts/install-hooks.sh  # pre-commit hook: ESLint on staged frontend files
```

Note: `start-all.sh` prints the frontend URL as `:3000`; the dev server actually
listens on `:3333`.

---

## Architecture

```
Frontend (Next.js 16, App Router)  →  http://localhost:3333
Backend  (Django 5 + DRF)          →  http://localhost:8000/api/v1/
API docs (drf-spectacular)         →  http://localhost:8000/api/docs/
Health                             →  http://localhost:8000/health/  and /health/detailed/
WebSocket (channels + daphne)      →  ws://localhost:8000/ws/notifications/
PostgreSQL 16                      →  :5432   (SQLite fallback for local dev)
Redis 7                            →  :6379   (channel layer + Celery broker)
```

**Multi-tenancy.** A `Tenant` is an administrative record; a civilization is a
claim about what happens to the dead. The mapping between them lives in exactly
one place, `TENANT_CIVILIZATION` in `backend/apps/souls/models.py`. Row-level
isolation is enforced by a `TenantManager` backed by `contextvars` (not
`threading.local`, so it survives Celery workers and async code).

**Permissions.** Four roles (ADMIN / JUDGE / GUARDIAN / VIEWER) over
codename-based permissions, plus `DataScope` for row visibility and
`FieldPermission` for per-field visibility. API enforcement is via
`CodenameViewSetMixin`; the frontend mirrors it with `RequirePermission` /
`RequireButton` for UI gating. The frontend gate is cosmetic — the backend check
is the real one. `/permissions` is a role×codename matrix rather than a
per-role picker, with a three-tier save guard (privilege escalation, and a
paradoxical count/grant mismatch, among the checks) before a save is allowed
through. Each role carries a `user_count` and an optimistic-lock `version`; of
two concurrent saves, the one that lands second is rejected on a version
conflict instead of silently clobbering the first.

**Bilingual chrome.** Menu names, breadcrumbs and role names are free-text
database content with no translation field, so they stay in Chinese regardless
of the active locale (`en`/`egy`) — deliberately, not a missed translation.
Instead, the breadcrumb trail and each page's H1 pair the translated label with
the Chinese original when the locale differs
(see [`frontend/src/lib/menuI18n.ts`](frontend/src/lib/menuI18n.ts)), and sidebar
icons are required to be unique within their parent, since the icon is the only
identification channel available in a locale that can't read the Chinese label.

**Events and realtime.**

```
Service → EventBus → HandlerRegistry → ChannelLayer (Redis) → Consumer → Frontend cache invalidation
```

Handlers can subscribe by event type, by domain, or globally; dispatch is O(1)
through the registry. Domains currently emitting: soul, workflow, notification,
dispatch, deathsync, social.

**Soul state machine** (`SoulState` in `backend/apps/souls/models.py`):

```
ALIVE → JUDGING → DISPOSED → REINCARNATING → ALIVE (next cycle)
                     ├──→ SETTLED   (absorbing — eternal disposition)
                     └──→ LOST      (suspended)
```

`SETTLED` is deliberately absorbing: unlike `DISPOSED`, it does not keep `LOST`
reachable.

---

## API surface

Everything is under `/api/v1/`. Tenant-scoped endpoints expect an `X-Tenant-ID`
header; authenticated ones expect `Authorization: Bearer <access>`.

| Prefix | App |
|---|---|
| `auth/`, `users/` | JWT login/refresh, user management |
| `souls/` | Soul CRUD plus state transitions |
| `ledger/` | Merit/demerit records, balance, decay, per-civilization reading |
| `judgment/`, `disposition/`, `reincarnation/` | The judgment pipeline |
| `realms/`, `actors/` | Afterlife geography and its personnel |
| `dispatch/` | Cross-realm soul transfer, with approval |
| `workflows/`, `nodes/`, `workflow/templates/` | Approval workflow engine |
| `perm/`, `menus/`, `organizations/`, `tenants/` | RBAC, navigation, org chart, tenants |
| `audit-logs/`, `events/`, `notifications/` | Audit trail, event log, notifications |
| `death-sync/` | External death-registration API (API key + HMAC-signed webhooks) |
| `social/` | Posts, comments, reactions, follows, profiles |

The ledger reading described above is served from
`GET /api/v1/ledger/balance/{soul_id}/`. The response carries both
`karmic_balance` (the raw net total, which the rest of the system routes on) and
`reading` (the instrument this soul's own cosmology uses). **Anything shown to a
user should use `reading`.**

The generated OpenAPI schema at `/api/schema/` and the Swagger UI at `/api/docs/`
are authoritative; the table above is a map, not a contract.

---

## Testing and CI

`.github/workflows/ci.yml` runs three jobs on push to `main`/`develop` and on PRs
into `main`:

| Job | Steps |
|---|---|
| **backend** | `makemigrations --check --dry-run`, `migrate`, `pytest`, `ruff check`, `pip-audit` |
| **frontend** | `tsc --noEmit`, `eslint`, `next build`, `jest`, `npm audit` |
| **e2e** | Playwright, `--project=chromium`, artifacts uploaded |

Backend CI runs against real PostgreSQL 16 and Redis 7 service containers.

Both `pip-audit` and `npm audit` are currently `continue-on-error: true` — they
report but do not block. The reasons are written into the workflow file next to
each step; if you are hardening this, read those comments first.

Locally:

```bash
cd backend && python -m pytest --tb=short -q     # pytest.ini: --cov=apps, --cov-fail-under=40
cd backend && ruff check .
cd frontend && npx tsc --noEmit && npm run lint && npm test
cd frontend && npx playwright test --project=chromium
```

**Backend tests live in two places** — `backend/tests/` and `test_*.py` / `tests.py`
inside each app under `backend/apps/`. `pytest.ini` sets `testpaths = backend`, so
running from the repo root collects both. Pointing pytest at only one of them
gives you a green run that proves less than it looks like it does.

Coverage is measured as `--cov=apps` (the importable package name, not a path) so
that it reports the same numbers whether you run from the repo root or from
`backend/`.

---

## Repository map

```
backend/
  apps/
    souls/          Soul model, state machine, tenant→civilization map
    ledger/         Merit/demerit records, time decay, per-cosmology readings
    judgment/       Judgment records and verdicts
    disposition/    Verdict → destination realm
    reincarnation/  Rebirth records
    actors/         Judges, guardians, psychopomps
    realms/         Afterlife geography
    dispatch/       Cross-realm transfers
    permissions/    Cross-tenant judgment authorization
    perm/           RBAC: Permission, Role, DataScope, FieldPermission
    tenants/        Tenant model, contextvar-backed TenantManager
    authentication/ JWT auth, User model, roles
    workflow/       Approval workflow engine
    menus/          Tree navigation + MenuButton
    events/         EventBus, EventEnvelope, HandlerRegistry
    notifications/  Notifications + WebSocket consumer
    death_sync/     External death-registration API and webhooks
    social/         Posts, comments, reactions, follows, profiles
    org/            Organization chart
    audit/          Audit log with trace_id
    core/           Middleware, shared viewsets/mixins, WebSocket auth, health
  config/           Settings, URLs, ASGI, Celery
  tests/            Cross-app pytest suite
frontend/
  app/              Next.js App Router pages
  lib/api/          One typed client per backend app
  src/hooks/        TanStack Query hooks
  src/components/   UI, including the RBAC gating components
  messages/         i18n: zh-Hans, en, egy
  e2e/              Playwright specs
infrastructure/     docker-compose for PostgreSQL + Redis
scripts/            start/stop/restart/status, DB backup/restore, git hooks
docs/               Domain research, engineering docs, design handoff — see docs/README.md
```

---

## Documentation

Start at [`docs/README.md`](docs/README.md), which indexes the whole folder. The
short version:

- **Domain research (Chinese-language).** ~20 files on the three afterlife
  systems — the Ten Courts of Diyu, Dante's circles and the Norse and Greek
  underworlds, the twelve gates of the Duat and the weighing of the heart. This
  is the source material the domain model was derived from, and it is why
  `readings.py` looks the way it does. Mirrored at the repo root under
  `地府结构研究/`, `欧洲天堂地狱/` and `埃及冥界/`.
- **Engineering docs.** Architecture, conventions, API notes, milestones, and a
  set of dated review/audit reports.
- **[`docs/design-handoff/`](docs/design-handoff/)** — a design brief package sent
  to an external designer, with 29 full-page screenshots of the live UI, a design
  token inventory, and localized table samples. `ADDENDUM.md` records what changed
  after the package was assembled and should be read alongside `BRIEF.md`. This
  package is referenced externally; treat it as frozen.

Top level: [`SPEC.md`](SPEC.md) is the full project specification,
[`DESIGN.md`](DESIGN.md) the design system, [`CONTRIBUTING.md`](CONTRIBUTING.md)
the workflow, [`SECURITY.md`](SECURITY.md) the disclosure policy.

---

## Tech stack

| Layer | Technology |
|---|---|
| Frontend | Next.js 16, React 18, TypeScript 5, Tailwind CSS 3, TanStack Query v5, @xyflow/react (workflow canvas), Recharts |
| Backend | Django 5, Django REST Framework, drf-spectacular, channels + daphne |
| Database | PostgreSQL 16 (Docker/production), SQLite (local default) |
| Realtime | WebSocket via channels with channels-redis |
| Async | Celery 5 + django-celery-beat, Redis broker |
| Auth | djangorestframework-simplejwt, plus API keys for Death Sync |
| Testing | pytest + pytest-django + pytest-cov + factory-boy; Jest + React Testing Library; Playwright |
| Tooling | ruff, ESLint, TypeScript, Sentry, structlog |

---

## Security posture

Implemented: JWT and API-key authentication, RBAC with data and field scoping,
Fernet encryption for webhook secrets and PII payloads, atomic Redis rate
limiting, SSRF validation on webhook URLs, CSP/HSTS/X-Frame-Options, and an audit
trail on mutations.

That list describes what the code does, not a security guarantee. See
[`SECURITY.md`](SECURITY.md) for how to report a problem.

---

## Scope and status

This is a personal project built for its own sake — a place to work out what it
takes to model three incompatible moral accounting systems in one schema without
quietly flattening them into one. It has never been deployed anywhere real, has
no users, and carries no uptime, support, or backward-compatibility promise. The
production Docker Compose file, health checks, and CI exist because doing them
properly was part of the exercise, not because anything is in production.

Milestone history is in [`docs/MILESTONES.md`](docs/MILESTONES.md), and it lags
the code. `git log` is the accurate record.

---

## Credits

The menu and permission system design draws on
[Snowy](https://github.com/xiaonuobase/Snowy) (Apache-2.0).

Maintainer: Tardisyuan · <https://github.com/Tardisyuan/SoulLedger>
