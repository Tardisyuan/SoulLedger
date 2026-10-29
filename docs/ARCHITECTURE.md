# ARCHITECTURE.md

# Overview

SoulLedger is a multi-tenant cross-civilization soul management platform.

Technology Stack:

Backend:

- Django 5
- Django REST Framework (+ drf-spectacular for the OpenAPI schema)
- Django Channels + daphne
- PostgreSQL 16 in Docker; SQLite is the local fallback when `DATABASE_URL` is unset
- Redis — channel layer and Celery broker

Frontend:

- Next.js 16 App Router
- TypeScript
- React Query
- TailwindCSS

Shared and mobile:

- `packages/core` — platform-independent API clients, hooks, WebSocket clients, message bundles
  and the OpenAPI schema; consumed by the web app and both Expo apps
- `mobile/` (soul-side app) and `mobile-officer/` (officer app)

---

# Backend Structure

backend/apps/

Core domains (directory names under `backend/apps/`):

- souls
- ledger — merit/demerit records, time decay, per-civilization readings
- judgment
- disposition
- reincarnation
- workflow
- dispatch
- death_sync
- notifications
- audit
- actors
- realms
- menus
- perm — RBAC
- authentication — User model, JWT, roles
- tenants
- org — organization chart
- social — posts, comments, reactions, follows; officer-side moderation
- events
- soul_accounts, soul_push, chat, soul_assist — the soul-side app: accounts and login,
  push, letters (Matrix-backed), the assistant (the officer-side assistant and its admin page
  live in `soul_assist` too)
- officer_app — todo list and push tokens for the officer app
- sentence_plan — sentence plans (see `docs/ARCHITECTURE-sentence-plan.md`)
- scheduler — scheduled jobs and run records
- core — shared viewsets/mixins, permissions, tenant scoping, WebSocket auth,
  health checks. NOT in `INSTALLED_APPS`.

`apps/permissions` no longer exists. It held cross-tenant judgment
authorization and was deleted on 2026-09-03 (`1b59ec4`) as the only model in
the repo with prod=0 / test=0 / admin=0 readers; its table was dropped with
it. This file listed it, and warned readers not to confuse it with `perm`,
until 2026-09-06. The authoritative list is `INSTALLED_APPS` in `config/settings.py`.

`apps.core.middleware` also no longer exists — that module was deleted
2026-08-28; the surviving middleware is
`apps/core/request_local.py::RequestContextMiddleware`.

---

# Core Architectural Patterns

Tenant Isolation

- **View-layer** filtering via `apps/core/tenant.py::scope_to_tenant`, called
  from each ViewSet's `get_queryset`. Fail closed: no tenant → `qs.none()`.
- `TenantManager` filters **soft deletes only** — it does not filter by tenant.
  This section said "row-level tenant filtering / TenantManager" until
  2026-09-06, which described a mechanism that had been removed.
- Enforced by `backend/tests/test_tenant_scoping_contract.py`, which walks the
  real URLconf. It does not cover `@action` methods or write paths.

Audit Trail

- AuditUserFields
- soft delete

RBAC

- CodenameViewSetMixin
- Permission codenames
- RoleDataScope
- FieldPermission

Events

- EventBus
- AuditHandler
- NotificationHandler
- WebSocketHandler
- WebhookHandler

---

# Realtime Architecture

Channels

JWT
→ Tenant
→ Permission
→ Router

Frontend

WebSocketProvider
→ React Query Cache

---

# Frontend Structure

frontend/app/

Main areas:

- souls, ledger, judgment, disposition, reincarnation
- realms, actors
- workflow, dispatch, cross-judgments
- death-sync, notifications, audit
- users, permissions, menus, organizations, tenants
- social, profile
- soul-credentials, soul-inbox, sentence-requests, rebirth-applications, moderation, scheduler, recycle-bin
- dashboard, admin, welcome

API Clients:

packages/core/src/api — one typed module per backend area (types come from
`packages/core/openapi/schema.yml`)

React Query:

packages/core/src/hooks — the data hooks; `frontend/src/hooks` holds only view-layer hooks

Query Keys:

Query-key factories live beside the hooks and API modules that use them. Never
hardcode key strings — see CONVENTIONS.md.

Workflow presets:

`packages/core/src/config/workflow-templates.ts` holds the **editor presets** the `/workflow` page offers
(`frontend/app/workflow/page.tsx`). They are not the backend's flow table
(`backend/apps/workflow/templates.py`, keyed by `(civilization, CaseType)`; its header explains the split):
a preset only reaches the backend when someone saves it as a `WorkflowTemplate` row. Several presets have no
case type of their own in `CaseType` — `CHINESE_WANG_SI` (枉死城流程), `CHINESE_ABYSS`, `CHINESE_EMERGENCY` file
under `SPECIAL`, `CHINESE_REINCARNATION` under `ROUTINE` — and none of them drives a business rule. In particular
`CHINESE_WANG_SI` is **not connected** to the 枉死城 mechanism: holding a soul until its fated date, the grievance
and early release live on the judgment itself (`Judgment.untimely` / `held_until` / `grievance_*`,
`backend/apps/judgment/wangsi.py`, `claims.py`), and nothing there reads the preset.

---

# Data Flow

User Action

↓

API Client

↓

React Query

↓

Backend API

↓

Service Layer

↓

Models

↓

EventBus

↓

WebSocket

↓

Frontend Cache Invalidation
