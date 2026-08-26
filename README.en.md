# SoulLedger

**English** | [中文](README.md)

SoulLedger is a working full-stack web application — Django + Next.js — that tracks
souls through an afterlife pipeline in four different mythologies at once: the
Chinese Diyu, the Christian and Dantean afterlives grouped here as "European," the
Egyptian Duat, and Plato's Greek underworld. It is an application, not a documentation repository: the
`docs/` folder holds the domain research that the code was built from, and the
research is genuinely load-bearing.

The interesting part is that the four cosmologies are not one data model in four
colour schemes. They compute structurally different quantities, and the code
refuses to average them.

---

## Why the four civilizations are not the same system

Most "multi-culture" demos pick one mechanic and restyle it. This one does not.
See [`backend/apps/ledger/readings.py`](backend/apps/ledger/readings.py):

| Civilization | What its ledger actually says | Shape of the answer |
|---|---|---|
| **Chinese** | A cumulative account (功過格). Merit and demerit offset each other; the running total *is* the verdict. | One signed number |
| **Egyptian** | A threshold test. The heart is weighed once against Ma'at's feather and must be "not heavier than" it. Merit does not appear — there is no offsetting step. | Pass/fail against a fixed counterweight |
| **European** | Two unrelated facts. *Culpa* (guilt) and *poena* (penalty remaining after absolution) do not reduce each other, and this system holds no data from which poena could honestly be derived. | Two independent quantities, one of them explicitly unavailable |
| **Greek** | Plato's two myths disagree with each other: the *Gorgias* stamps a soul and stops, the *Republic*'s Er returns it after a thousand years. So 20 of the 22 transcribed articles have polarity `PROCEDURE` — **they are rules of the court, not names of offences**. | A procedure, not a quantity |

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

> **Node ≥ 20.9** (`frontend/package.json` `engines`). Next 16 requires it at build
> time, and `eslint.config.mjs` derives its root from `import.meta.url`. On Node 18
> this lint config once **crashed during rule loading and exited 2** — and exit 2 is
> indistinguishable from 0 once it passes through a pipe. If `npm run lint` behaves
> strangely, check `node --version` first.

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

`.github/workflows/ci.yml` defines three jobs. **It is now `workflow_dispatch` only**
— no push or PR triggers it (GitHub Actions quota exhausted; `security.yml`'s weekly
cron is off for the same reason). So "CI is green" is not a statement this repository
makes automatically any more. The local gate is.

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
cd backend && python -m pytest --tb=short -q     # repo-root pytest.ini: --cov=apps, --cov-fail-under=80
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
  `readings.py` looks the way it does. These used to be mirrored byte-for-byte
  at the repo root under `地府结构研究/`, `欧洲天堂地狱/` and `埃及冥界/`;
  **de-duplicated on 2026-08-15** (`b2645e3`), which deleted the 19 copies and
  left each directory holding one README that maps the old filenames into
  `docs/`.
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

## Frontend design system

The interface used to render in whatever UI font the reader's OS supplied — no
family was loaded at all, so mixed Latin/CJK runs sat on two unrelated baselines.
There is now a written-down type system.

| Layer | What it is |
|---|---|
| Type | Archivo (UI) · Source Serif 4 (quotation) · IBM Plex Mono (figures, identifiers), each paired with Noto Sans SC / Noto Serif SC. All SIL OFL. |
| Scale | Eight steps, `text-01`…`text-08` (11/12/13/15/18/22/32/56px). Largest-to-body goes from 1.71 to 3.7; table body *tightens* to 13px, so density is not the price. |
| Radius | **Square everywhere.** `rounded-full` is reserved for identity objects (avatars, the 7px civilization dot), `rounded-focus` for the focus ring. |
| Rules | Four weights: 1px row rule / 1px block edge / 2px section underline / 3px civilization line and sealed-verdict band. |
| Shell | One `PageShell` replaces 36 hand-written page shells; eight content widths collapse to three. |
| Primitives | `Button` `Field` `Badge` `Spinner` `EmptyState` `PageShell` |

**Serif marks what someone said** — the 170 transcribed articles, confession text,
the reasoning of a judgment, the opinion of a cross-civilization panel. Every label,
table, button and figure is sans. That makes "serif = quotation" a readable rule
rather than a decorative choice, and it is why confession no longer needs `italic`
plus quote marks to announce itself.

**The four cosmologies are told apart by how each numbers its own articles, not by
colour**: 功過格 is `救濟門 · 十七` (gate and article in Han numerals — *not* 卷, which
《太微仙君功過格》 does not have); the *Inferno* is `IX · XXVI`; the Negative Confession
is `§ 27 / 42` (**the denominator is printed** — the system means nothing unless all
forty-two are answered); Plato is a Stephanus page, `523a`. See
[`frontend/src/config/civilizationSigil.ts`](frontend/src/config/civilizationSigil.ts).

`/corpus` browses those 170 articles (Chinese 功過格 73, Egyptian Negative
Confession 42, European Deadly Sins 7 + Inferno 26, Greek Gorgias 11 + Republic/Er
11 — counted by running `seed_mythology`, not estimated). Before it they surfaced only inside the
judgment page's citation picker — 170 researched articles with nowhere to read them.

### The rules are enforced by lint, not by discipline

Tailwind's `theme.extend` can add and override but not remove: `text-sm` still
resolves, `rounded-lg` still resolves (to 0). So the eight steps, the six spacing
steps and the two radii are all **restrictions**, and a restriction has no
expression in Tailwind — only lint can impose it. `frontend/eslint.config.mjs`
carries five custom rules plus jsx-a11y, all at `error`.

`npm run lint` is a bare `eslint .`, and ESLint exits 0 when only warnings exist, so
a warn-level rule here is worth nothing. Migration relief is a **baseline** instead:
`frontend/eslint.design-guard-baseline.json` records each file's current violation
count, and it fires in **both** directions — a count that drops below its budget is
as red as one that exceeds it, because a stale baseline is an unwatched gap.

### Two conventions that bite

**The indentation of `frontend/src/config/workflow-templates.ts` is a backend
contract.** Three backend tests (`test_workflow_template_cast.py`,
`test_workflow_preset_node_types.py`, `test_workflow_template_priority.py`) open
this frontend file by hardcoded path and regex its *layout* — two-space keys,
four-space fields, one-line node literals. 491 of its lines are load-bearing text.
**Running `prettier` over it silently breaks those three backend tests.**

**`min-h-screen` belongs only to routes outside `AppLayout`.** `AppLayout` hands a
page a `min-h-[calc(100vh-4rem)]` slot; writing `min-h-screen` inside it nests 100vh
in 100vh−4rem, which is 64px of dead scroll on every route — no error, no type
error, no failing assertion. `src/__tests__/viewportHeightContract.test.ts` guards it.

---

## Tech stack

| Layer | Technology |
|---|---|
| Frontend | Next.js 16, React 18, TypeScript 5, Tailwind CSS 3, TanStack Query v5, @xyflow/react (workflow canvas), Recharts, class-variance-authority |
| Type | next/font + Archivo / Source Serif 4 / IBM Plex Mono; `@fontsource-variable/noto-sans-sc` and `-serif-sc` self-hosted (101 `unicode-range` slices each, so a browser fetches only what a page uses) |
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
