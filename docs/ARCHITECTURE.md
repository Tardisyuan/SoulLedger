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
- permissions — cross-tenant judgment authorization (distinct from `perm`)
- authentication — User model, JWT, roles
- tenants
- org — organization chart
- social
- events
- core — middleware, shared viewsets/mixins, WebSocket auth, health checks

Note the two similarly named apps: `perm` is the RBAC system; `permissions`
holds cross-tenant judgment authorization. They are not the same thing.

---

# Core Architectural Patterns

Tenant Isolation

- row-level tenant filtering
- TenantManager

Audit Trail

- AuditUserFields
- soft delete

RBAC

- CodenameViewSetMixin
- Permission codenames
- DataScope
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
→ SocialEventBusProvider
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
- dashboard, admin, welcome

API Clients:

frontend/lib/api — one typed module per backend app

React Query:

frontend/src/hooks

Query Keys:

Query-key factories live beside the hooks and API modules that use them. Never
hardcode key strings — see CONVENTIONS.md.

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
