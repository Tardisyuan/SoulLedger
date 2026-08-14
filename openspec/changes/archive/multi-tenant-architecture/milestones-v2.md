# SoulLedger — Milestone Plan v2

> Rewrite of SPEC.md Section 9 milestones, reducing from 9 to 6 milestones.
> Reflects actual codebase state at commit 1293990.

---

## Summary

| Milestone | Name | Status | Sessions | Complexity |
|-----------|------|--------|----------|------------|
| M1 | Core Infrastructure | ✅ Done | — | — |
| M2 | JWT Authentication | ✅ Done | — | — |
| M3 | Multi-Tenant Backend | 🔲 In Progress | 4–5 | 🔴 |
| M4 | Tenant-Aware Frontend | 🔲 Not Started | 3–4 | 🟡 |
| M5 | Dispatch Module | 🔲 Not Started | 3–4 | 🔴 |
| M6 | Karma + Statistics | 🔲 Not Started | 2–3 | 🟡 |
| M7 | Extended Civilizations | 🔲 Not Started | 1–2 | 🟢 |
| M8 | Production Ready | 🔲 Not Started | 2 | 🟡 |

---

## M3: Multi-Tenant Backend Infrastructure

**Objective:** Add `tenant_id` FK to all business tables, establish tenant isolation at ORM and API layers, add database indexes/constraints, create Notification model.

**Key Deliverables:**
- `Tenant` model with 3 seed records (CN_DIYU, EU_HEAVEN_HELL, EG_DUAT)
- All 8 business models have `tenant FK → Tenant` (NOT NULL after backfill)
- `TenantMiddleware` injects tenant context per request via JWT
- `TenantManager` auto-filters all 8 model ORM queries by tenant
- All 7 ViewSets filter by `request.tenant` (SYS_ADMIN bypasses)
- Non-SYS_ADMIN users see only their tenant's data; cross-tenant access returns 403
- Tenant management API (SYS_ADMIN only): list, detail, update
- Login response includes tenant info + JWT contains `tenant_code` claim
- Data migration script with `--dry-run` + `--rollback` support
- All `civilization` field references removed (per-file cleanup plan)
- Tenant isolation integration tests (10+ cases)
- DRF Permission Classes: TenantPermission + RolePermission
- Field-level serializer permissions matching SPEC §6.X.2 role matrix
- **Database composite indexes** on all tenant_id columns (SPEC §8.1)
- **Database CHECK constraints** (SPEC §8.2): soul state not empty, dispatch different tenants, dispatch requires endpoint
- **Notification model** (SPEC §7.7): 7 notification types, per-user tracking
- Permission integration tests: full role×operation matrix (20+ cases)

**Estimated Complexity:** 🔴 Complex

**Dependencies:** M2 (JWT) — satisfied

**Sessions:** 4–5

---

## M4: Tenant-Aware Frontend + Landing Page

**Objective:** Make the frontend tenant-aware: URL routing includes tenant, login redirects to tenant dashboard, NavBar shows tenant context. Includes useAuth hook and route guards (relocated from M3.7).

**Key Deliverables:**
- API client interceptor: decodes JWT, auto-injects `X-Tenant-Code` header on all requests
- `TenantContext` React context at `frontend/src/contexts/TenantContext.tsx` (from JWT decode)
- URL routing: `frontend/app/[tenant]/layout.tsx` → move souls/realms/actors under `/[tenant]/`
- Login page → uses `jwt-decode` library, redirects to `/{tenant_code}/souls/`, handles missing tenant_code
- NavBar shows tenant `display_name` + user role badge + logout + SYS_ADMIN dashboard link
- Landing page (`/`): rewritten with 3 tenant selection cards, preserves i18n
- Language switcher: embedded in `[tenant]/layout.tsx`, respects locale on all pages
- `useAuth()` hook at `frontend/src/hooks/useAuth.ts`: permission checks per role (relocated from M3.7)
- `RouteGuard` component at `frontend/src/components/RouteGuard.tsx`: hides pages per role (relocated from M3.7)
- UI Framework tasks (ThemeProvider, color picker, settings drawer, personal center, nav modes) — all marked **(Optional)**

**Estimated Complexity:** 🟡 Moderate

**Dependencies:** M3 (multi-tenant backend)

**Sessions:** 2–3

---

## M5: Dispatch Module

**Objective:** Implement cross-tenant soul dispatch workflow and cross-tenant judgment sessions.

**Key Deliverables:**
- `DispatchRecord` model (source_tenant, target_tenant, soul, reason, status)
- `CrossTenantJudgment` model (multi-tenant review session)
- `CrossTenantJudgmentParticipant` model (ADVISOR/CO_JUDGE/CHAIRMAN roles)
- Dispatch workflow: propose → approve/reject → execute
- Cross-tenant judgment: propose → participate → conclude
- API endpoints: `POST /dispatch/propose/`, `/dispatch/{id}/approve/`, `/dispatch/{id}/reject/`, `/dispatch/{id}/execute/`
- API endpoints: `GET/POST /cross-tenant-judgments/`, `POST .../participate/`
- Frontend: `/{tenant}/dispatch/propose/`, `/{tenant}/dispatch/pending/`, `/{tenant}/dispatch/history/`
- Frontend: `/{tenant}/cross-judgments/`
- Dispatch integration tests (cross-tenant isolation)

**Estimated Complexity:** 🔴 Complex (independent state machines, cross-tenant permissions)

**Dependencies:** M3 (tenant infrastructure), M4 (frontend routing)

**Sessions:** 2–3

---

## M6: Karma System + Statistics Dashboard

**Objective:** Implement karma time-decay calculation, Redis caching, Celery background tasks, and the SYS_ADMIN statistics dashboard.

**Key Deliverables:**
- Karma time-decay: `effective_score = original × e^(-0.01 × years_since_event)`
- `KarmaService` with Redis cache (TTL=5 min)
- Celery tasks: daily karma recalculation, overdue judgment alerts (>30 days in JUDGING)
- Karma API: `GET /api/v1/souls/{id}/karma/`
- Frontend karma visualization (Recharts timeline)
- Global stats API (SYS_ADMIN only): `GET /stats/global/`, `GET /stats/by-tenant/`, `GET /stats/realm-occupancy/`
- Frontend admin dashboard: state distribution pie chart, tenant comparison bar chart, karma distribution histogram
- SYS_ADMIN dispatch audit page (read-only)

**Estimated Complexity:** 🟡 Moderate

**Dependencies:** M3 (multi-tenant backend), M4 (frontend)

**Sessions:** 2–3

---

## M7: Extended Civilizations Data

**Objective:** Seed European and Egyptian realms and actors data.

**Key Deliverables:**
- European: 17 realms (Heaven 3 + Purgatory 7 + Hell 9)
- European actors: St. Peter, Hades, Satan, Michael, Lucifer (5)
- Egyptian: 5 realms (Aaru + Duat regions)
- Egyptian actors: Osiris, Anubis, Thoth, Ma'at (4)
- Dispatch routing verified per civilization
- i18n verified for all three locales

**Estimated Complexity:** 🟢 Simple (seed data scripts only)

**Dependencies:** M3 (tenant infrastructure)

**Sessions:** 1–2

---

## M8: Production Ready

**Objective:** Production-grade Docker, HTTPS, monitoring, and operational tooling.

**Key Deliverables:**
- `docker-compose.prod.yml` (networks, volumes, restart policies)
- Multi-stage Dockerfile (< 500MB)
- Nginx HTTPS config (SSL termination, HTTP → HTTPS)
- `/health/` endpoint for Django + Next.js
- Structured logging (structlog + JSON)
- Sentry integration (error tracking + source maps)
- `.env.example` with minimal secrets

**Estimated Complexity:** 🟡 Moderate

**Dependencies:** All previous milestones

**Sessions:** 2

---

## Milestone Dependency Graph

```
M1 ──→ M2 ──→ M3 ──→ M4 ──┬──→ M5 ──→ M6
                           │           │
                           └───────────┴──→ M7
                                           │
                                           ↓
                                           M8
```

**Note:** M5 (Dispatch) can start after M4. M6 (Karma+Stats) needs M4. M7 (Data) is independent after M3. M8 needs all prior work.

---

## Acceptance Criteria Summary

| Milestone | Criteria |
|-----------|----------|
| M3 | Tenant model + 3 records; all tables have tenant_id; TenantManager filters; isolation tests pass |
| M4 | URLs contain tenant; login redirects to /{tenant}/; NavBar shows tenant; landing page works |
| M5 | Dispatch propose→approve→execute works; cross-tenant judgment sessions work; full frontend |
| M6 | Karma decay formula correct; Redis cache hits; Celery tasks run; dashboard charts render |
| M7 | All European + Egyptian realms/actors seeded; dispatch routing works per tenant |
| M8 | Docker-compose.prod works; Dockerfile < 500MB; /health/ returns 200; Sentry connected |

---

## Session Estimates by Phase

| Phase | Tasks | Sessions |
|-------|-------|----------|
| M3 Backend multi-tenancy | 38 | 4–5 |
| M4 Frontend tenant-awareness | 12 | 2–3 |
| M5 Dispatch module | 9 | 2–3 |
| M6 Karma + Statistics | 9 | 2–3 |
| M7 Extended civilizations | 4 | 1–2 |
| M8 Production | 7 | 2 |
| **Total remaining** | **81** | **12–17** |
