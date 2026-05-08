# Multi-Tenant Architecture — Task List v2

> Rewritten to align with 6-milestone structure. Tasks grouped by milestone.
> Each task is: specific (concrete action), verifiable (can check), small (one session).

---

## M3: Multi-Tenant Backend Infrastructure

**Prerequisite:** M2 ✅ (JWT auth done)

### M3.1: Tenant Model + Seed Data

- [ ] **create_tenant_model** 🔴
  - Title: Create Tenant model
  - Action: Create `backend/apps/tenants/models.py` with Tenant model (code, display_name, description, settings JSON, is_active, dispatch_enabled, api_endpoint)
  - Verify: `python manage.py check`

- [ ] **seed_tenant_data** 🟢
  - Title: Insert 3 tenant records
  - Action: Create `backend/scripts/seed_tenants.py` inserting CN_DIYU, EU_HEAVEN_HELL, EG_DUAT with dispatch_enabled=True
  - Verify: `SELECT * FROM tenants_tenant;` returns 3 rows

### M3.2: Add tenant_id to All Business Tables

- [ ] **add_tenant_id_to_realms** 🟡
  - Title: Add tenant_id to Realm model
  - Action: Add `tenant FK → Tenant (nullable)` to Realm model; create migration; backfill for existing data
  - Verify: `python manage.py makemigrations realms --check` passes

- [ ] **add_tenant_id_to_actors** 🟡
  - Title: Add tenant_id to Actor model
  - Action: Same pattern as realms
  - Verify: `python manage.py makemigrations actors --check` passes

- [ ] **add_tenant_id_to_souls** 🔴
  - Title: Add tenant_id to Soul model
  - Action: Add `tenant FK → Tenant (NOT NULL)`; remove `civilization` field (replaced by tenant); migrate existing souls to CN_DIYU
  - Verify: `python manage.py makemigrations souls --check` passes

- [ ] **add_tenant_id_to_judgment** 🟡
  - Title: Add tenant_id to Judgment model
  - Action: Add `tenant FK → Tenant`; backfill from soul.tenant
  - Verify: `python manage.py makemigrations judgment --check` passes

- [ ] **add_tenant_id_to_disposition** 🟡
  - Title: Add tenant_id to Disposition model
  - Action: Add `tenant FK → Tenant`; backfill from soul.tenant
  - Verify: `python manage.py makemigrations disposition --check` passes

- [ ] **add_tenant_id_to_reincarnation** 🟡
  - Title: Add tenant_id to Reincarnation model
  - Action: Add `tenant FK → Tenant`; backfill from soul.tenant
  - Verify: `python manage.py makemigrations reincarnation --check` passes

- [ ] **add_tenant_id_to_events** 🟡
  - Title: Add tenant_id to SoulEvent model
  - Action: Add `tenant FK → Tenant`; backfill from related soul.tenant
  - Verify: `python manage.py makemigrations events --check` passes

- [ ] **add_tenant_id_to_user** 🟡
  - Title: Add tenant_id to User model
  - Action: Add `tenant FK → Tenant (NOT NULL)` to User model; set default=CN_DIYU for existing users
  - Verify: `python manage.py makemigrations authentication --check` passes

### M3.3: Middleware + TenantManager

- [ ] **create_tenant_middleware** 🔴
  - Title: Create TenantMiddleware
  - Action: Create `backend/apps/tenants/middleware.py`; extract `tenant_code` from JWT; store in thread-local; attach `request.tenant`
  - Verify: `python manage.py check`; unit test: request.tenant matches JWT claims

- [ ] **create_tenant_manager** 🔴
  - Title: Create TenantManager for auto-filtering
  - Action: Create `backend/apps/tenants/managers.py` with TenantManager; update all business models to use TenantManager; auto-filter all queries by `self.tenant`
  - Verify: `python manage.py shell` — query from user in CN_DIYU returns only CN_DIYU souls

- [ ] **update_viewsets_tenant_filter** 🟡
  - Title: Update all ViewSets for tenant filtering
  - Action: Update all ViewSet `get_queryset()` to use TenantManager; ADMIN role bypasses tenant filter; non-ADMIN always filtered
  - Verify: Test user in CN_DIYU cannot see EU souls via API

### M3.4: Tenant API + Auth Updates

- [ ] **add_tenant_endpoints** 🟢
  - Title: Add tenant management API (ADMIN only)
  - Action: Create `backend/apps/tenants/views.py`, serializers.py, urls.py; GET /tenants/, GET /tenants/{code}/, PATCH (ADMIN only)
  - Verify: `curl -H "Authorization: Bearer $ADMIN_TOKEN" /api/v1/tenants/` returns 3 records

- [ ] **update_auth_login_response** 🟢
  - Title: Login response includes tenant info
  - Action: Update `backend/apps/authentication/serializers.py`; login response includes `user.tenant.code` and `user.tenant.display_name`
  - Verify: POST /auth/login/ response contains tenant.code and tenant.display_name

### M3.5: Data Migration + Cleanup

- [ ] **migrate_existing_data** 🔴
  - Title: Migrate existing data to multi-tenant
  - Action: Create `backend/scripts/migrate_to_multitenant.py`; map existing souls/realms/actors to tenant_id based on civilization field
  - Verify: All souls have tenant_id; no orphan records

- [ ] **cleanup_civilization_references** 🟡
  - Title: Remove civilization field references
  - Action: Search all code for `civilization`; replace with `tenant`; update serializers, filters, URLs
  - Verify: `grep -r "civilization" backend/` returns no matches

### M3.6: Testing

- [ ] **write_tenant_isolation_tests** 🔴
  - Title: Tenant isolation integration tests
  - Action: Create `backend/tests/test_tenant_isolation.py`; create users in CN and EU; verify cross-tenant data access returns 0 results
  - Verify: `pytest -v backend/tests/test_tenant_isolation.py` — all pass

---

## M4: Tenant-Aware Frontend + Landing Page

**Prerequisite:** M3 ✅

### M4.1: Core Frontend Tenant Support

- [ ] **update_api_client_tenant** 🟡
  - Title: API client injects tenant context
  - Action: Update `frontend/lib/api.ts`; decode JWT to extract tenant_code; add tenant header/query param to all requests
  - Verify: All API calls include `X-Tenant-Code` header or tenant in URL

- [ ] **create_tenant_context** 🟡
  - Title: TenantContext React context
  - Action: Create `frontend/contexts/TenantContext.tsx`; store tenant_code and display_name; provide useTenant() hook
  - Verify: `console.log(useTenant())` returns correct tenant in any page

- [ ] **add_tenant_routing** 🔴
  - Title: Frontend tenant route structure
  - Action: Create `frontend/app/[tenant]/layout.tsx`; update page.tsx; all business pages under `[tenant]` dynamic route
  - Verify: Navigating to /CN_DIYU/souls/ renders souls list; /EU_HEAVEN_HELL/souls/ renders different data

- [ ] **update_navbar_tenant_context** 🟡
  - Title: NavBar shows tenant + user info
  - Action: Update `frontend/components/NavBar.tsx`; show tenant display_name, user role, logout button; show ADMIN dashboard link if role=ADMIN
  - Verify: NavBar displays "Chinese Afterlife (CN_DIYU)" when logged in as CN user

- [ ] **update_login_redirect** 🟢
  - Title: Login redirects to tenant dashboard
  - Action: Update `frontend/app/(auth)/login/page.tsx`; on successful login, decode JWT tenant_code and redirect to `/{tenant_code}/souls/`
  - Verify: Login as CN user → redirects to /CN_DIYU/souls/

### M4.2: Landing Page

- [ ] **create_landing_page_tenant_selection** 🟡
  - Title: Landing page with tenant selection
  - Action: Update `frontend/app/page.tsx`; show 3 clickable tenant cards; clicking navigates to login for that tenant
  - Verify: Landing page shows 3 civilizations with names and descriptions

- [ ] **update_language_switcher** 🟢
  - Title: Language switcher per-tenant
  - Action: Ensure language switcher works on all pages; dispatch/judgment content respects user locale
  - Verify: Switch from zh to en and all labels update

---

## M5: Dispatch Module

**Prerequisite:** M3 ✅ + M4 ✅

### M5.1: Dispatch Models

- [ ] **create_dispatch_models** 🔴
  - Title: Create DispatchRecord + CrossTenantJudgment models
  - Action: Create `backend/apps/dispatch/models.py`; DispatchRecord (source_tenant, target_tenant, soul FK, reason, status, created_at, updated_at, dispatched_at); CrossTenantJudgment (title, description, status, created_at); CrossTenantJudgmentParticipant (judgment FK, tenant FK, actor FK, role: ADVISOR/CO_JUDGE/CHAIRMAN)
  - Verify: `python manage.py check`

- [ ] **create_dispatch_services** 🔴
  - Title: DispatchService + CrossTenantJudgmentService
  - Action: Create `backend/apps/dispatch/services.py`; propose_dispatch(soul, target_tenant, reason, judger), approve_dispatch(dispatch_id, approver), reject_dispatch(dispatch_id, reason), execute_dispatch(dispatch_id); create_judgment_session(title, participants), join_judgment(judgment_id, actor, role), conclude_judgment(judgment_id)
  - Verify: `python manage.py check`; unit tests for each service method

### M5.2: Dispatch API

- [ ] **add_dispatch_api** 🔴
  - Title: Dispatch REST API endpoints
  - Action: Create `backend/apps/dispatch/views.py`, serializers.py, urls.py; POST /dispatch/propose/, GET /dispatch/ (list, filtered by tenant), GET /dispatch/{id}/, POST /dispatch/{id}/approve/, POST /dispatch/{id}/reject/, POST /dispatch/{id}/execute/
  - Verify: `curl` commands exercise full dispatch workflow

- [ ] **add_cross_tenant_judgment_api** 🔴
  - Title: Cross-tenant judgment API endpoints
  - Action: Add to dispatch views/serializers/urls; GET /cross-tenant-judgments/, POST /cross-tenant-judgments/, GET /cross-tenant-judgments/{id}/, POST /cross-tenant-judgments/{id}/participate/, POST /cross-tenant-judgments/{id}/conclude/
  - Verify: Cross-tenant users can join same judgment session

### M5.3: Dispatch Frontend

- [ ] **add_dispatch_propose_page** 🟡
  - Title: Dispatch propose page
  - Action: Create `frontend/app/[tenant]/dispatch/propose/page.tsx`; form: select soul, select target tenant, enter reason; submit calls POST /dispatch/propose/
  - Verify: Can propose dispatch from CN_DIYU to EU_HEAVEN_HELL

- [ ] **add_dispatch_pending_page** 🟡
  - Title: Dispatch pending page
  - Action: Create `frontend/app/[tenant]/dispatch/pending/page.tsx`; list of pending dispatches for target tenant; approve/reject buttons
  - Verify: EU user sees pending dispatch from CN with approve button

- [ ] **add_dispatch_history_page** 🟢
  - Title: Dispatch history page
  - Action: Create `frontend/app/[tenant]/dispatch/history/page.tsx`; paginated list of all past dispatches with status badges
  - Verify: History shows COMPLETED/REJECTED dispatches

- [ ] **add_cross_judgment_page** 🟡
  - Title: Cross-tenant judgment page
  - Action: Create `frontend/app/[tenant]/cross-judgments/page.tsx`; list all cross-tenant judgment sessions; show participant list; join button
  - Verify: Can view and join cross-tenant judgment as ADVISOR

### M5.4: Dispatch Tests

- [ ] **write_dispatch_tests** 🔴
  - Title: Dispatch integration tests
  - Action: Create `backend/tests/test_dispatch.py`; test full propose→approve→execute workflow; test cross-tenant isolation; test role permissions
  - Verify: `pytest -v backend/tests/test_dispatch.py` — all pass

---

## M6: Karma System + Statistics Dashboard

**Prerequisite:** M3 ✅ + M4 ✅

### M6.1: Karma Backend

- [ ] **implement_karma_time_decay** 🔴
  - Title: Karma time-decay calculation
  - Action: Add to `backend/apps/souls/services.py`; `effective_score = original × e^(-0.01 × years_since_event)`; method `calculate_effective_karma(soul_id)`
  - Verify: Unit test: karma 100 merit 10 years ago → ~90.48 effective

- [ ] **implement_karma_redis_cache** 🟡
  - Title: Redis karma cache
  - Action: Update `KarmaService`; cache key `karma:{soul_id}`; TTL=5 min; invalidate on soul record change
  - Verify: Second call to karma for same soul hits cache (check Redis KEYS)

- [ ] **add_karma_api_endpoint** 🟡
  - Title: Karma API endpoint
  - Action: Add to `backend/apps/souls/views.py`; `GET /souls/{id}/karma/`; returns original, effective, breakdown by event
  - Verify: `curl /api/v1/souls/1/karma/` returns JSON with original and effective scores

- [ ] **implement_celery_karma_tasks** 🟡
  - Title: Celery karma tasks
  - Action: Create `backend/apps/souls/tasks.py`; daily karma recalculation task; overdue judgment check (soul in JUDGING > 30 days → log warning)
  - Verify: `celery -A config beat` shows scheduled tasks; overdue check logs warning for old judgments

### M6.2: Statistics Backend

- [ ] **add_global_stats_api** 🟡
  - Title: Global statistics API (ADMIN only)
  - Action: Create `backend/apps/stats/views.py`, serializers.py; `GET /stats/global/` (all-tenant counts), `GET /stats/by-tenant/` (per-tenant breakdown), `GET /stats/realm-occupancy/` (soul count per realm); ADMIN role required
  - Verify: ADMIN token returns full stats; non-ADMIN returns 403

### M6.3: Karma Frontend

- [ ] **add_karma_chart** 🟡
  - Title: Soul detail karma chart
  - Action: Update `frontend/app/[tenant]/souls/[id]/page.tsx`; add Recharts LineChart showing karma over time (timeline of merit/demerit events)
  - Verify: Karma chart renders with real soul data

### M6.4: Statistics Dashboard Frontend

- [ ] **add_admin_dashboard_page** 🔴
  - Title: Admin statistics dashboard
  - Action: Create `frontend/app/admin/dashboard/page.tsx`; Recharts: PieChart (soul state distribution), BarChart (tenant comparison), Histogram (karma distribution)
  - Verify: Dashboard renders with real API data when logged in as ADMIN

- [ ] **add_dispatch_audit_page** 🟢
  - Title: Dispatch audit page (read-only)
  - Action: Create `frontend/app/admin/dispatch/audit/page.tsx`; paginated table of all dispatch records; read-only; ADMIN only
  - Verify: Page shows all dispatches across tenants; no edit controls

---

## M7: Extended Civilizations Data

**Prerequisite:** M3 ✅

- [ ] **seed_european_data** 🟢
  - Title: Seed European realms + actors
  - Action: Create `backend/scripts/seed_european_data.py`; 17 realms (Heaven 3 + Purgatory 7 + Hell 9); 5 actors (St. Peter, Hades, Satan, Michael, Lucifer); each with tenant_id=EU_HEAVEN_HELL
  - Verify: `SELECT COUNT(*) FROM realms_realmmembership WHERE tenant_id=<EU_ID>;` = 17; actors = 5

- [ ] **seed_egyptian_data** 🟢
  - Title: Seed Egyptian realms + actors
  - Action: Create `backend/scripts/seed_egyptian_data.py`; 5 realms (Aaru + Duat regions); 4 actors (Osiris, Anubis, Thoth, Ma'at); each with tenant_id=EG_DUAT
  - Verify: `SELECT COUNT(*) FROM realms_realmmembership WHERE tenant_id=<EG_ID>;` = 5; actors = 4

- [ ] **verify_civilization_dispatch_routing** 🟡
  - Title: Verify dispatch works per civilization
  - Action: Run `backend/scripts/seed_all_tenants.py` to verify all data; test dispatch from CN→EU and CN→EG routes correctly
  - Verify: Each tenant's souls show correct realm count

- [ ] **verify_i18n_all_locales** 🟢
  - Title: Verify i18n for all 3 locales
  - Action: Switch frontend to zh/en/eg locale; verify all labels, realm names, actor names display correctly
  - Verify: No untranslated strings in any locale

---

## M8: Production Ready

**Prerequisite:** All previous milestones

### M8.1: Container & Deployment

- [ ] **create_docker_compose_prod** 🟡
  - Title: Production docker-compose
  - Action: Create `docker-compose.prod.yml`; production networks, named volumes, restart policies, resource limits
  - Verify: `docker-compose -f docker-compose.prod.yml config` passes

- [ ] **create_multi_stage_dockerfile** 🟡
  - Title: Multi-stage Dockerfile < 500MB
  - Action: Rewrite `backend/Dockerfile`; multi-stage build (builder + runtime); final image < 500MB
  - Verify: `docker build` produces image < 500MB (check `docker images`)

- [ ] **configure_nginx_https** 🟡
  - Title: Nginx HTTPS configuration
  - Action: Create `infrastructure/nginx.conf`; SSL termination, HTTP → HTTPS redirect, proxy to Next.js and Django
  - Verify: Nginx starts and serves HTTPS on port 443

### M8.2: Observability

- [ ] **add_health_endpoints** 🟢
  - Title: Health check endpoints
  - Action: Add `GET /health/` to `backend/config/urls.py` (returns 200 + {"status": "ok"}); add Next.js `/api/health` route
  - Verify: `curl localhost:8000/health/` returns 200; `curl localhost:3333/api/health` returns 200

- [ ] **configure_structured_logging** 🟡
  - Title: Structured logging with structlog
  - Action: Update `backend/config/settings.py`; configure structlog with JSON output; add request ID to all logs
  - Verify: Django logs output JSON format (not plain text)

- [ ] **integrate_sentry** 🟡
  - Title: Sentry error tracking
  - Action: Install `sentry-sdk`; configure in `backend/config/settings.py`; add source maps to Docker build
  - Verify: `sentry-cli test` connects; test error triggers Sentry event

### M8.3: Operations

- [ ] **create_env_example** 🟢
  - Title: .env.example with all required vars
  - Action: Create `backend/.env.example`; list all required env vars (DATABASE_URL, REDIS_URL, JWT_SECRET, SENTRY_DSN, etc.); no real secrets
  - Verify: Copy `.env.example` to `.env`, fill in values, Django starts

---

## Dependency Summary

| Task | Milestone | Complexity | Dependencies |
|------|-----------|------------|--------------|
| create_tenant_model | M3.1 | 🔴 | M2 |
| seed_tenant_data | M3.1 | 🟢 | M3.1 |
| add_tenant_id_to_realms | M3.2 | 🟡 | M3.1 |
| add_tenant_id_to_actors | M3.2 | 🟡 | M3.1 |
| add_tenant_id_to_souls | M3.2 | 🔴 | M3.1 |
| add_tenant_id_to_judgment | M3.2 | 🟡 | M3.2 |
| add_tenant_id_to_disposition | M3.2 | 🟡 | M3.2 |
| add_tenant_id_to_reincarnation | M3.2 | 🟡 | M3.2 |
| add_tenant_id_to_events | M3.2 | 🟡 | M3.2 |
| add_tenant_id_to_user | M3.2 | 🟡 | M3.1 |
| create_tenant_middleware | M3.3 | 🔴 | M3.1 |
| create_tenant_manager | M3.3 | 🔴 | M3.3 |
| update_viewsets_tenant_filter | M3.3 | 🟡 | M3.3 |
| add_tenant_endpoints | M3.4 | 🟢 | M3.3 |
| update_auth_login_response | M3.4 | 🟢 | M3.4 |
| migrate_existing_data | M3.5 | 🔴 | M3.2 |
| cleanup_civilization_references | M3.5 | 🟡 | M3.2 |
| write_tenant_isolation_tests | M3.6 | 🔴 | M3.3 |
| update_api_client_tenant | M4.1 | 🟡 | M3 |
| create_tenant_context | M4.1 | 🟡 | M4.1 |
| add_tenant_routing | M4.1 | 🔴 | M4.1 |
| update_navbar_tenant_context | M4.1 | 🟡 | M4.1 |
| update_login_redirect | M4.2 | 🟢 | M4.1 |
| create_landing_page_tenant_selection | M4.2 | 🟡 | M4.2 |
| update_language_switcher | M4.2 | 🟢 | M4.1 |
| create_dispatch_models | M5.1 | 🔴 | M3 |
| create_dispatch_services | M5.1 | 🔴 | M5.1 |
| add_dispatch_api | M5.2 | 🔴 | M5.1 |
| add_cross_tenant_judgment_api | M5.2 | 🔴 | M5.1 |
| add_dispatch_propose_page | M5.3 | 🟡 | M5.2 |
| add_dispatch_pending_page | M5.3 | 🟡 | M5.2 |
| add_dispatch_history_page | M5.3 | 🟢 | M5.3 |
| add_cross_judgment_page | M5.3 | 🟡 | M5.2 |
| write_dispatch_tests | M5.4 | 🔴 | M5.2 |
| implement_karma_time_decay | M6.1 | 🔴 | M3 |
| implement_karma_redis_cache | M6.1 | 🟡 | M6.1 |
| add_karma_api_endpoint | M6.1 | 🟡 | M6.1 |
| implement_celery_karma_tasks | M6.1 | 🟡 | M6.1 |
| add_global_stats_api | M6.2 | 🟡 | M3 |
| add_karma_chart | M6.3 | 🟡 | M6.1 |
| add_admin_dashboard_page | M6.4 | 🔴 | M6.2 |
| add_dispatch_audit_page | M6.4 | 🟢 | M5.3 |
| seed_european_data | M7 | 🟢 | M3 |
| seed_egyptian_data | M7 | 🟢 | M3 |
| verify_civilization_dispatch_routing | M7 | 🟡 | M5, M7 |
| verify_i18n_all_locales | M7 | 🟢 | M4.2 |
| create_docker_compose_prod | M8.1 | 🟡 | All |
| create_multi_stage_dockerfile | M8.1 | 🟡 | M8.1 |
| configure_nginx_https | M8.1 | 🟡 | M8.1 |
| add_health_endpoints | M8.2 | 🟢 | M8.1 |
| configure_structured_logging | M8.2 | 🟡 | M8.2 |
| integrate_sentry | M8.2 | 🟡 | M8.2 |
| create_env_example | M8.3 | 🟢 | M8.2 |

---

## Complexity Totals

| Milestone | 🔴 Complex | 🟡 Moderate | 🟢 Simple | Total |
|-----------|-----------|-------------|-----------|-------|
| M3 | 8 | 7 | 4 | 19 |
| M4 | 1 | 4 | 2 | 7 |
| M5 | 6 | 3 | 1 | 10 |
| M6 | 2 | 6 | 1 | 9 |
| M7 | 0 | 1 | 3 | 4 |
| M8 | 0 | 5 | 2 | 7 |
| **Total** | **17** | **26** | **13** | **56** |
