# SoulLedger — Milestone Critical Review

> Date: 2026-05-08
> Reviewers: Hermes Agent (milestone planning expert)
> Methodology: writing-plans (bite-sized tasks + TDD) + spec-driven-system-design (acceptance criteria + gap analysis)
> Files reviewed: milestones-v2.md, tasks.md, SPEC.md §9, actual codebase

---

## Executive Summary

**Total Issues Found: 46**
- 🔴 Must fix: 18
- 🟡 Should fix: 22
- 🟢 Nice to fix: 6

**Critical Gaps:**
1. Zero TDD cycles — no task follows "test → code → verify → commit"
2. M3 contains 4 frontend tasks that belong in M4
3. SPEC field-level visibility table contradicts M3.7 task description
4. M6 karma tasks reference non-existent file paths
5. Per-file verification commands missing from 85% of tasks
6. M3.5 cleanup_civilization_references is dangerously under-specified

---

## Consistency Cross-Reference

| Concern | milestones-v2.md | tasks.md | SPEC.md | Codebase |
|---------|-----------------|----------|---------|----------|
| M3 sessions | 3–4 | 3–4 | 4–5 | — |
| M3 task count | 13 | 19 | 13 | — |
| M6 KarmaService path | Not specified | `backend/apps/souls/services.py` | Not specified | `backend/apps/karma/services.py` |
| Tenant FK nullable? | Not specified | "nullable" for realms | "NOT NULL" for all | — |
| Frontend context dir | Not specified | `frontend/contexts/` | Not specified | `frontend/src/contexts/` |
| Dockerfile location | `backend/Dockerfile` | `backend/Dockerfile` | Not specified | `/Dockerfile` (root) |

---

## M3: Multi-Tenant Backend Infrastructure (19 tasks, 🔴 Complex)

### What's Good
- Decomposition into logical sub-groups (models, migrations, middleware, api, data migration, testing, permissions) is sound
- Dependency ordering is mostly correct (models before middleware before viewsets)
- Seed data is concrete with 3 named tenants
- Tenant isolation test is a separate, testable deliverable

### Issues Found

#### 🔴 Issue M3-001 ✅ FIXED: Zero TDD cycles anywhere
**What's wrong:** Not a single task in M3 follows the TDD pattern (write failing test → run → write code → run → commit). Every task just jumps to "create/update X" then "verify Y".
**Fix:** Add explicit TDD sub-steps to M3.1 (Tenant model), M3.3 (middleware + manager), and M3.6 (isolation tests). Each should have: test file path, test code snippet, run command showing failure, then code, then run command showing success.
**Priority:** 🔴 Must fix

#### 🔴 Issue M3-002 ✅ FIXED ✅ FIXED ✅ FIXED: create_tenant_manager spans 7+ model files
**What's wrong:** Task "update all business models to use TenantManager" is NOT a 2-5 minute chunk. It touches `souls/models.py`, `realms/models.py`, `actors/models.py`, `judgment/models.py`, `disposition/models.py`, `reincarnation/models.py`, `events/models.py`, `authentication/models.py` — 8 files minimum.
**Fix:** Split into per-model sub-tasks: M3.3a update_souls_manager, M3.3b update_realms_manager, etc. Each verifies individually.
**Priority:** 🔴 Must fix

#### 🔴 Issue M3-003 ✅ FIXED ✅ FIXED ✅ FIXED: update_viewsets_tenant_filter spans 7+ viewsets
**What's wrong:** "Update all ViewSet get_queryset()" touches `souls/views.py`, `realms/views.py`, `actors/views.py`, `judgment/views.py`, `disposition/views.py`, `reincarnation/views.py`, `events/views.py`.
**Fix:** Split into per-viewset sub-tasks with exact file paths and per-viewset verification curl commands.
**Priority:** 🔴 Must fix

#### 🔴 Issue M3-004 ✅ FIXED ✅ FIXED ✅ FIXED: Frontend tasks wrongly placed in M3 (Backend)
**What's wrong:** M3.7 contains `create_useauth_hook` (frontend/), `add_route_guards` (frontend/) — these are frontend tasks that should be in M4. M3 is labeled "Multi-Tenant Backend Infrastructure."
**Fix:** Move M3.7 tasks create_useauth_hook and add_route_guards to M4. Keep M3 as backend-only.
**Priority:** 🔴 Must fix

#### 🔴 Issue M3-005 ✅ FIXED ✅ FIXED ✅ FIXED: Field-level serializer rules contradict SPEC
**What's wrong:** M3.7 `add_field_level_serializers` says "VIEWER cannot see karmic_balance/merit_score/demerit_score" but SPEC §6.X.2 table says VIEWER CAN see karmic_balance (✓), CANNOT see merit_score (✗), CANNOT see demerit_score (✗). Also SPEC says GUARDIAN CANNOT see karmic_balance (✗) but this isn't mentioned in the task.
**Fix:** Add explicit field-role matrix matching SPEC §6.X.2:
- VIEWER: karmic_balance ✓, merit_score ✗, demerit_score ✗, death_date ✓, dispatch_status ✗
- GUARDIAN: karmic_balance ✗, merit_score ✓, demerit_score ✓, death_date ✓, dispatch_status ✗
**Priority:** 🔴 Must fix

#### 🔴 Issue M3-006 ✅ FIXED ✅ FIXED ✅ FIXED: add_tenant_id_to_souls is a multi-step bomb
**What's wrong:** One task says: "Add tenant FK (NOT NULL); remove civilization field; migrate existing souls to CN_DIYU." This involves: (a) add nullable FK, (b) backfill, (c) make NOT NULL, (d) remove civilization field, (e) migrate data, (f) update serializers, (g) update filters. That's 7 sub-steps, each with migration risk.
**Fix:** Split into:
- M3.2c1: Add nullable tenant_id FK to Soul model
- M3.2c2: Data migration backfill tenant_id from civilization
- M3.2c3: Make tenant_id NOT NULL + add constraint
- M3.2c4: Remove civilization field (separate migration)
**Priority:** 🔴 Must fix

#### 🔴 Issue M3-007 ✅ FIXED ✅ FIXED ✅ FIXED: cleanup_civilization_references is dangerously vague
**What's wrong:** "Search all code for civilization; replace with tenant; update serializers, filters, URLs" with verify `grep -r "civilization" backend/ returns no matches` — but what about legitimate uses? The karma service at `backend/apps/karma/services.py:52` has `"civilization": r.civilization` which may need to become `r.tenant.code`. The Soul model has a `civilization` field. The SoulRecord model may have one too. The SPEC mentions `civilization` in seeds. This is a multi-file refactor with no per-file plan.
**Fix:** List every file that currently references `civilization`, specify exact replacement for each, add per-file verification.
**Priority:** 🔴 Must fix

#### 🟡 Issue M3-008 ✅ FIXED ✅ FIXED ✅ FIXED: Missing exact field definitions in model tasks
**What's wrong:** `add_tenant_id_to_realms` says "Add tenant FK → Tenant (nullable)" — no code example, no field type, no related_name, no on_delete behavior.
**Fix:** Every model-change task needs: exact code snippet showing the field, e.g.:
```python
tenant = models.ForeignKey(
    'tenants.Tenant',
    on_delete=models.CASCADE,
    related_name='realms',
    null=True  # Phase 1: nullable for backfill
)
```
**Priority:** 🟡 Should fix

#### 🟡 Issue M3-009 ✅ FIXED ✅ FIXED ✅ FIXED: Verification commands are inconsistent and weak
**What's wrong:** M3.1 verify uses `python manage.py check` (config-only, no data validation). M3.1 seed uses raw SQL. M3.3 middleware uses "unit test" without path. M3.4 uses curl without expected output.
**Fix:** Standardize: every task gets a pytest command with expected output OR a curl command with exact expected JSON shape.
**Priority:** 🟡 Should fix

#### 🟡 Issue M3-010 ✅ FIXED ✅ FIXED ✅ FIXED: migrate_existing_data has no rollback or integrity check
**What's wrong:** "Create backend/scripts/migrate_to_multitenant.py" — data migration scripts are inherently risky. No mention of: dry-run mode, before/after row counts, transaction wrapping, rollback plan.
**Fix:** Add: "Script must print before/after counts; wrap in transaction; support --dry-run flag."
**Priority:** 🟡 Should fix

#### 🟡 Issue M3-011 ✅ FIXED ✅ FIXED ✅ FIXED: SPEC says 4-5 sessions, milestones-v2 says 3-4
**What's wrong:** SPEC.md line 1716: "Session 估算: 4–5 sessions". milestones-v2.md line 41: "Sessions: 3–4". With the correct breakdown (splitting oversized tasks), 4-5 is more realistic.
**Fix:** Align both to 4-5 sessions after task splitting.
**Priority:** 🟡 Should fix

#### 🟢 Issue M3-012: seed_tenant_data could use Django management command
**What's wrong:** Using a standalone script `backend/scripts/seed_tenants.py` instead of a Django management command means it doesn't have access to Django's test infrastructure.
**Fix:** Optionally convert to `python manage.py seed_tenants` for better testability, but standalone script is acceptable.
**Priority:** 🟢 Nice to fix

#### 🟢 Issue M3-013: Permission enforcement grouping loses clarity
**What's wrong:** M3.7 bundles DRF Permission Classes, field-level serializers, useAuth hook, route guards, and permission tests together. The grouping makes sense logically but some tasks are backend, some frontend.
**Fix:** Split M3.7: M3.7a (backend permissions: DRF classes + serializer filtering), relocate frontend tasks to M4, keep permission tests as M3.7b.
**Priority:** 🟢 Nice to fix

### M3 Gap Analysis

| Area | Covered? | Notes |
|------|----------|-------|
| Tenant model | ✅ | Good field list |
| Tenant seed data | ✅ | 3 records specified |
| FK migration strategy | ⚠️ | Nullable first approach mentioned but not per-model sequenced |
| TenantMiddleware | ✅ | Path specified |
| TenantManager | ⚠️ | Too large as single task |
| ViewSet filtering | ⚠️ | Too large as single task |
| Tenant API | ✅ | Endpoints listed |
| Data migration | ⚠️ | No rollback strategy |
| Civilization cleanup | 🔴 | Dangerously vague |
| Isolation tests | ✅ | Test file path given |
| **Tenant indexes** | 🔴 | NOT COVERED — SPEC §8.1 specifies composite indexes (idx_soul_tenant_state, etc.) but no task creates them |
| **Tenant constraints** | 🔴 | NOT COVERED — SPEC §8.2 specifies CHECK + CASCADE constraints but no task adds them |
| **Notification model** | 🔴 | NOT COVERED — SPEC §7.7 defines Notification model but not in any M3 task |

### M3 Acceptance Criteria (Optimized)

1. Tenant model exists at `backend/apps/tenants/models.py` with all fields
2. 3 tenant records seeded via `python manage.py seed_tenants`
3. All 8 business models have `tenant FK → Tenant` (NOT NULL after migration)
4. `TenantMiddleware` at `backend/apps/tenants/middleware.py` extracts tenant from JWT, attaches to request
5. All 8 business models use `TenantManager` with auto-filtering
6. All 7 ViewSets filter by `request.tenant` (SYS_ADMIN bypasses)
7. `pytest backend/tests/test_tenant_isolation.py -v` — 10+ tests pass
8. `pytest backend/tests/test_permissions.py -v` — 20+ tests pass
9. Tenant API returns 3 records for SYS_ADMIN
10. Login response includes `tenant.code` and `tenant.display_name`
11. Database indexes on all `tenant_id` columns per SPEC §8.1
12. Database CHECK constraints per SPEC §8.2

---

## M4: Tenant-Aware Frontend + Landing Page (7 tasks, 🟡 Moderate)

### What's Good
- Clear frontend focus with routing, context, API client, and landing page
- Correct dependency on M3
- Task names are descriptive of the deliverable

### Issues Found

#### 🔴 Issue M4-001 ✅ FIXED ✅ FIXED ✅ FIXED: Wrong file path for TenantContext
**What's wrong:** Task says `frontend/contexts/TenantContext.tsx` but actual project structure has contexts at `frontend/src/contexts/` (e.g., `frontend/src/contexts/I18nContext.tsx`).
**Fix:** Change path to `frontend/src/contexts/TenantContext.tsx`.
**Priority:** 🔴 Must fix

#### 🔴 Issue M4-002 ✅ FIXED ✅ FIXED ✅ FIXED: add_tenant_routing is not a 2-5 minute task
**What's wrong:** "Create frontend/app/[tenant]/layout.tsx; update page.tsx; all business pages under [tenant] dynamic route" — this requires restructuring ALL existing pages (souls, souls/[id]) into the [tenant] folder, updating all internal links, and testing every route. This is a 20-30 minute task.
**Fix:** Split into:
- M4.1c1: Create `frontend/app/[tenant]/layout.tsx` with tenant param extraction
- M4.1c2: Move `frontend/app/souls/` → `frontend/app/[tenant]/souls/`
- M4.1c3: Move `frontend/app/souls/[id]/` → `frontend/app/[tenant]/souls/[id]/`
- M4.1c4: Update all internal links and redirects
Each verified with `npm run build` or page load test.
**Priority:** 🔴 Must fix

#### 🟡 Issue M4-003 ✅ FIXED ✅ FIXED ✅ FIXED: Missing exact code for API client tenant injection
**What's wrong:** "decode JWT to extract tenant_code; add tenant header/query param to all requests" — needs exact code showing axios/fetch interceptor pattern.
**Fix:** Add code example:
```typescript
// frontend/lib/api.ts
const getTenantFromJWT = (): string | null => {
  const token = getCookie('access_token');
  if (!token) return null;
  const payload = JSON.parse(atob(token.split('.')[1]));
  return payload.tenant_code;
};

api.interceptors.request.use((config) => {
  const tenant = getTenantFromJWT();
  if (tenant) config.headers['X-Tenant-Code'] = tenant;
  return config;
});
```
**Priority:** 🟡 Should fix

#### 🟡 Issue M4-004 ✅ FIXED ✅ FIXED ✅ FIXED: update_login_redirect missing JWT decode details
**What's wrong:** "decode JWT tenant_code and redirect to /{tenant_code}/souls/" — doesn't specify which library or how to extract payload. Also doesn't address edge case: what if tenant_code is missing from JWT?
**Fix:** Add: "Use jwt-decode library; if tenant_code missing, show error; verify with console.log before redirect."
**Priority:** 🟡 Should fix

#### 🟡 Issue M4-005 ✅ FIXED ✅ FIXED ✅ FIXED: create_landing_page_tenant_selection says "Update" but should say "Rewrite"
**What's wrong:** "Update frontend/app/page.tsx" — the current page.tsx may already be a landing page. The task should clarify: "Replace current landing content with 3 tenant selection cards."
**Fix:** Clarify whether this is a modification or complete replacement. Add: "Preserve existing i18n support; each card links to /login?tenant=CN_DIYU."
**Priority:** 🟡 Should fix

#### 🟡 Issue M4-006 ✅ FIXED ✅ FIXED ✅ FIXED: update_language_switcher is too vague
**What's wrong:** "Ensure language switcher works on all pages; dispatch/judgment content respects user locale" — no specific file to change, no verification criteria.
**Fix:** Specify: "Update `frontend/components/LanguageSwitcher.tsx` to read language from I18nContext; add to [tenant]/layout.tsx so it appears on all tenant pages. Verify: switch to 'en' on /CN_DIYU/souls/ and check soul names use English locale."
**Priority:** 🟡 Should fix

#### 🟢 Issue M4-007 ✅ FIXED ✅ FIXED ✅ FIXED: UI Framework (M4.3) tasks shouldn't be "Optional" without clear marking
**What's wrong:** M4.3 tasks (theme provider, color picker, settings drawer, personal center, navigation modes) are listed without "(Optional)" tag in milestones-v2.md. SPEC §7.X explicitly labels them optional.
**Fix:** Add "(Optional)" prefix to each M4.3 task title and note they can be deferred to post-M8.
**Priority:** 🟢 Nice to fix

### M4 Gap Analysis

| Area | Covered? | Notes |
|------|----------|-------|
| Tenant routing | ✅ | /[tenant]/ pattern specified |
| TenantContext | ⚠️ | Wrong file path |
| API client injection | ⚠️ | Missing code example |
| Login redirect | ✅ | Logic described |
| NavBar tenant display | ✅ | File path correct |
| Landing page | ✅ | 3 cards design |
| Language switcher | ⚠️ | Too vague |
| **Route guards from SPEC** | 🔴 | NOT COVERED — SPEC §7.X discusses route guards per role but M4 doesn't have tasks for them (they're wrongly in M3.7) |
| **useAuth hook** | 🔴 | NOT COVERED — wrongly placed in M3.7 |
| **Profile page i18n** | 🔴 | NOT COVERED — profile page mentioned in M4.3 but no i18n tasks for it |

---

## M5: Dispatch Module (10 tasks, 🔴 Complex)

### What's Good
- Clear state machine design (propose → approve/reject → execute)
- Cross-tenant judgment has well-defined participant roles
- API endpoints are enumerated
- Integration tests are a separate deliverable

### Issues Found

#### 🔴 Issue M5-001 ✅ FIXED ✅ FIXED ✅ FIXED: create_dispatch_models creates 3 models in one task
**What's wrong:** "Create DispatchRecord + CrossTenantJudgment + CrossTenantJudgmentParticipant models" in one task. Each model has 6-8 fields. The verify is just `python manage.py check` which only validates syntax.
**Fix:** Split into:
- M5.1a: Create `backend/apps/dispatch/models.py` with DispatchRecord model
- M5.1b: Test: `python manage.py makemigrations dispatch --check`
- M5.1c: Add CrossTenantJudgment model to same file
- M5.1d: Test: verify both models in Django shell
- M5.1e: Add CrossTenantJudgmentParticipant model
- M5.1f: Test: `pytest backend/tests/test_dispatch_models.py -v`
**Priority:** 🔴 Must fix

#### 🔴 Issue M5-002 ✅ FIXED ✅ FIXED ✅ FIXED: create_dispatch_services creates 2 services with 8 methods
**What's wrong:** "propose_dispatch, approve_dispatch, reject_dispatch, execute_dispatch, create_judgment_session, join_judgment, conclude_judgment" — 7 methods across 2 services. Each method has state machine logic, permission checks, and side effects. This is easily 30+ minutes.
**Fix:** Split per-method:
- M5.1.1a: `propose_dispatch()` method + unit test
- M5.1.1b: `approve_dispatch()` method + unit test
- M5.1.1c: `reject_dispatch()` method + unit test
- M5.1.1d: `execute_dispatch()` method + unit test
- M5.1.2a: `create_judgment_session()` + unit test
- M5.1.2b: `join_judgment()` + unit test
- M5.1.2c: `conclude_judgment()` + unit test
**Priority:** 🔴 Must fix

#### 🔴 Issue M5-003 ✅ FIXED ✅ FIXED ✅ FIXED: add_dispatch_api creates 3 files + 6 endpoints
**What's wrong:** "Create backend/apps/dispatch/views.py, serializers.py, urls.py" — each file is significant. Plus 6 API endpoints. Massive task.
**Fix:** Split by endpoint:
- M5.2a: Create `backend/apps/dispatch/serializers.py` with DispatchRecordSerializer
- M5.2b: Create `backend/apps/dispatch/views.py` with POST /dispatch/propose/ + unit test
- M5.2c: Add GET /dispatch/ list endpoint
- M5.2d: Add POST /dispatch/{id}/approve/
- M5.2e: Add POST /dispatch/{id}/reject/
- M5.2f: Add POST /dispatch/{id}/execute/
- M5.2g: Create `backend/apps/dispatch/urls.py` + register in config/urls.py
**Priority:** 🔴 Must fix

#### 🟡 Issue M5-004 ✅ FIXED ✅ FIXED ✅ FIXED: Missing TDD cycle for every dispatch service method
**What's wrong:** "Verify: python manage.py check; unit tests for each service method" — unit tests come after code. TDD requires test FIRST.
**Fix:** Each service method task: write test (expect failure) → run test → write implementation → run test (expect pass) → commit.
**Priority:** 🟡 Should fix

#### 🟡 Issue M5-005 ✅ FIXED ✅ FIXED ✅ FIXED: Cross-tenant API access not addressed in tasks
**What's wrong:** SPEC §6.X.5 describes cross-tenant API access mechanism (JWT-based, DISPATCH_JUDGE role, read-only mode for cross-tenant). Neither M3 nor M5 tasks cover this middleware logic.
**Fix:** Add M5.0 task: "Implement cross-tenant access check in TenantMiddleware per SPEC §6.X.5; DISPATCH_JUDGE gets read-only access to target tenant resources."
**Priority:** 🟡 Should fix

#### 🟡 Issue M5-006 ✅ FIXED ✅ FIXED ✅ FIXED: Missing notification integration for dispatch events
**What's wrong:** SPEC §7.7 defines Notification types: DISPATCH_PROPOSED, DISPATCH_APPROVED, DISPATCH_REJECTED, CROSS_JUDGMENT_INVITED, etc. No M5 task creates these notifications.
**Fix:** Add M5.1.3: "Create Notification model in dispatch or tenants app; emit notifications on dispatch state changes per SPEC §7.7."
**Priority:** 🟡 Should fix

#### 🟢 Issue M5-007: No WebSocket/polling task for cross-judgment UI
**What's wrong:** SPEC §7.6 says "页面通过轮询（每 30 秒）或 WebSocket 更新投票状态" but no task implements polling or WebSocket.
**Fix:** Add M5.3e: "Add 30-second polling to cross-judgment page for vote status updates" or make it explicit that this is deferred to post-MVP.
**Priority:** 🟢 Nice to fix

### M5 Gap Analysis

| Area | Covered? | Notes |
|------|----------|-------|
| DispatchRecord model | ✅ | Fields listed |
| CrossTenantJudgment model | ✅ | Fields listed |
| DispatchService methods | ⚠️ | Too large as single task |
| Dispatch API endpoints | ⚠️ | Too large as single task |
| Dispatch frontend pages | ✅ | 4 pages specified |
| Integration tests | ✅ | Test file specified |
| **Cross-tenant middleware** | 🔴 | NOT COVERED — SPEC §6.X.5 logic not implemented |
| **Notification model** | 🔴 | NOT COVERED — SPEC §7.7 notifications for dispatch events |
| **Soul state transitions** | 🔴 | NOT COVERED — dispatch execution must update Soul.dispatch_status, not mentioned |
| **Vote deadline enforcement** | 🟡 | Not covered — no Celery task to auto-close expired votes |

---

## M6: Karma System + Statistics Dashboard (9 tasks, 🟡 Moderate)

### What's Good
- Karma formula is mathematically specified
- Redis caching strategy is clear
- Celery tasks are named
- Dashboard charts are specified by type

### Issues Found

#### 🔴 Issue M6-001 ✅ FIXED ✅ FIXED ✅ FIXED: Wrong file path for karma time-decay — souls has no services.py
**What's wrong:** Task says "Add to `backend/apps/souls/services.py`" but:
- `backend/apps/souls/` does NOT have a `services.py` file
- `backend/apps/karma/services.py` DOES exist and contains `KarmaService`
**Fix:** Change path to `backend/apps/karma/services.py`. Add `calculate_effective_karma(soul_id)` method to existing `KarmaService` class.
**Priority:** 🔴 Must fix

#### 🔴 Issue M6-002 ✅ FIXED ✅ FIXED ✅ FIXED: implement_karma_redis_cache references non-existent KarmaService in wrong location
**What's wrong:** "Update KarmaService" — with corrected path this references `backend/apps/karma/services.py`, but the service currently has no Redis integration. Also, "invalidate on soul record change" requires Django signals not mentioned.
**Fix:** Specify: "Add Redis caching to KarmaService.calculate_effective_karma() in backend/apps/karma/services.py; connect to Soul post_save signal for cache invalidation in backend/apps/karma/signals.py."
**Priority:** 🔴 Must fix

#### 🟡 Issue M6-003 ✅ FIXED ✅ FIXED ✅ FIXED: add_karma_api_endpoint has wrong URL pattern
**What's wrong:** "Add to backend/apps/souls/views.py; GET /souls/{id}/karma/" — but karma already has its own app at `backend/apps/karma/views.py` with `backend/apps/karma/urls.py`. Adding to souls would create confusion.
**Fix:** Add to `backend/apps/karma/views.py` as `GET /api/v1/karma/souls/{id}/` or keep it as a nested endpoint but route through karma app. Specify which file gets the change.
**Priority:** 🟡 Should fix

#### 🟡 Issue M6-004 ✅ FIXED ✅ FIXED ✅ FIXED: Missing file path for Celery tasks
**What's wrong:** "Create backend/apps/souls/tasks.py" — souls app has no tasks.py. Also, Celery config is at `backend/config/celery.py`, not in an app.
**Fix:** Create `backend/apps/karma/tasks.py` (consistent with other karma code) or `backend/apps/souls/tasks.py` if it's soul-specific. Also update `backend/config/celery.py` to auto-discover tasks. Verify with `celery -A config inspect registered`.
**Priority:** 🟡 Should fix

#### 🟡 Issue M6-005 ✅ FIXED ✅ FIXED ✅ FIXED: add_global_stats_api creates 3 files without path list
**What's wrong:** "Create backend/apps/stats/views.py, serializers.py" — plural "serializers" but naming is `serializers.py`. Also needs `urls.py` and `__init__.py`. Missing: register in `backend/config/urls.py`.
**Fix:** Full file list: `backend/apps/stats/__init__.py`, `backend/apps/stats/views.py`, `backend/apps/stats/serializers.py`, `backend/apps/stats/urls.py`. Register `path("api/v1/stats/", include("apps.stats.urls"))` in config/urls.py.
**Priority:** 🟡 Should fix

#### 🟡 Issue M6-006 ✅ FIXED ✅ FIXED ✅ FIXED: add_admin_dashboard_page missing API integration details
**What's wrong:** "Create frontend/app/admin/dashboard/page.tsx; Recharts: PieChart, BarChart, Histogram" — no mention of which API endpoint each chart calls, no expected data shape.
**Fix:** Specify: PieChart calls `GET /api/v1/stats/global/` expecting `{state_distribution: [{state, count}]}`; BarChart calls `GET /api/v1/stats/by-tenant/`; Histogram calls `GET /api/v1/stats/realm-occupancy/`.
**Priority:** 🟡 Should fix

#### 🟡 Issue M6-007 ✅ FIXED ✅ FIXED ✅ FIXED: Missing test for karma decay formula
**What's wrong:** "Verify: Unit test: karma 100 merit 10 years ago → ~90.48 effective" — but no file path for the test. Expected value is approximate (≈) — should be exact.
**Fix:** Specify test at `backend/tests/test_karma.py`, exact expected value: `100 * math.exp(-0.01 * 10) = 90.483741...`, assert with `pytest.approx(90.48, rel=1e-3)`.
**Priority:** 🟡 Should fix

#### 🟢 Issue M6-008: No Redis availability check task
**What's wrong:** Karma Redis cache task assumes Redis is running but no task verifies Redis connection in Django settings or adds redis configuration.
**Fix:** Add prerequisite task: "Verify Redis connection in backend/config/settings.py; CACHES['redis'] configured."
**Priority:** 🟢 Nice to fix

### M6 Gap Analysis

| Area | Covered? | Notes |
|------|----------|-------|
| Karma decay formula | ✅ | Formula specified |
| Redis cache | ⚠️ | Wrong file path |
| Karma API endpoint | ⚠️ | Wrong file placement |
| Celery tasks | ⚠️ | Missing file path |
| Stats API | ✅ | Endpoints listed |
| Admin dashboard | ✅ | Charts specified |
| Dispatch audit page | ✅ | Read-only specified |
| **Signal wiring** | 🔴 | NOT COVERED — cache invalidation on soul change needs Django signals |
| **Karma unit tests** | 🟡 | Formula test mentioned but no file path |

---

## M7: Extended Civilizations Data (4 tasks, 🟢 Simple)

### What's Good
- Specific realm/actor counts for each civilization
- Verification uses SQL with expected counts
- Simple and self-contained

### Issues Found

#### 🔴 Issue M7-001 ✅ FIXED ✅ FIXED ✅ FIXED: seed_european_data verification references non-existent table
**What's wrong:** "SELECT COUNT(*) FROM realms_realmmembership" — this table name is incorrect. The Realm model creates `realms_realm`. What is "realmmembership"? Should be `realms_realm`.
**Fix:** Change to `SELECT COUNT(*) FROM realms_realm WHERE tenant_id=<EU_ID>;`. Also verify with Django: `python manage.py shell -c "from apps.realms.models import Realm; print(Realm.objects.filter(tenant__code='EU_HEAVEN_HELL').count())"`.
**Priority:** 🔴 Must fix

#### 🟡 Issue M7-002 ✅ FIXED ✅ FIXED ✅ FIXED: verify_civilization_dispatch_routing depends on non-existent script
**What's wrong:** "Run backend/scripts/seed_all_tenants.py" — this file doesn't exist. It's not created in any prior milestone.
**Fix:** Either create this aggregator script in M7.3, or change verify to use individual seed scripts: `python manage.py seed_tenants && python manage.py seed_european_data && python manage.py seed_egyptian_data`.
**Priority:** 🟡 Should fix

#### 🟡 Issue M7-003 ✅ FIXED ✅ FIXED ✅ FIXED: Missing tenant_id in seed data scripts
**What's wrong:** Tasks say "each with tenant_id=EU_HEAVEN_HELL" but don't specify how to look up the tenant ID. The seed script needs to query `Tenant.objects.get(code='EU_HEAVEN_HELL')` first.
**Fix:** Add: "Script queries Tenant by code, not hardcoded ID. Uses get_or_create pattern for idempotency."
**Priority:** 🟡 Should fix

#### 🟢 Issue M7-004: verify_i18n_all_locales has no automated verification
**What's wrong:** "Switch frontend to zh/en/eg locale; verify all labels..." — this is manual QA. Should have automated checks.
**Fix:** Add: "Run `python manage.py test apps.realms.tests --tag=i18n` after adding locale-specific test cases."
**Priority:** 🟢 Nice to fix

### M7 Gap Analysis

| Area | Covered? | Notes |
|------|----------|-------|
| European realms | ✅ | 17 specified |
| European actors | ✅ | 5 specified |
| Egyptian realms | ✅ | 5 specified |
| Egyptian actors | ✅ | 4 specified |
| Dispatch routing verify | ⚠️ | Wrong script reference |
| i18n verify | ⚠️ | Manual only |
| **Soul seed data per civilization** | 🔴 | NOT COVERED — no task to create sample souls for EU/EG tenants |

---

## M8: Production Ready (7 tasks, 🟡 Moderate)

### What's Good
- Docker, HTTPS, logging, monitoring all covered
- Specific acceptance criteria (Dockerfile < 500MB, /health/ returns 200)
- .env.example is security-conscious

### Issues Found

#### 🔴 Issue M8-001 ✅ FIXED ✅ FIXED ✅ FIXED: Dockerfile path is wrong
**What's wrong:** Task says `backend/Dockerfile` but the actual Dockerfile is at `/Dockerfile` (project root).
**Fix:** Change path to `Dockerfile` (project root). Also there's a `Dockerfile.frontend` — the task should clarify whether to merge them or keep separate.
**Priority:** 🔴 Must fix

#### 🟡 Issue M8-002 ✅ FIXED ✅ FIXED ✅ FIXED: create_docker_compose_prod doesn't reference existing docker-compose
**What's wrong:** "Create docker-compose.prod.yml" — there's already a `docker-compose.yml` at project root. The production version should be based on it. No mention of differences.
**Fix:** Specify: "Based on docker-compose.yml; add: named volumes for postgres/redis data persistence, restart: unless-stopped, resource limits, separate network, no exposed dev ports."
**Priority:** 🟡 Should fix

#### 🟡 Issue M8-003 ✅ FIXED ✅ FIXED ✅ FIXED: configure_nginx_https has no file path
**What's wrong:** "Create infrastructure/nginx.conf" — `infrastructure/` directory doesn't exist in the project. Also, no mention of SSL certificate generation (self-signed for dev? Let's Encrypt for prod?).
**Fix:** Specify path: create `nginx/nginx.conf` (or keep infrastructure/ and create it). Add: "Use self-signed certs for staging; document Let's Encrypt setup in README."
**Priority:** 🟡 Should fix

#### 🟡 Issue M8-004 ✅ FIXED ✅ FIXED ✅ FIXED: add_health_endpoints — Next.js path may not exist
**What's wrong:** "Add Next.js /api/health route" — Next.js 14 App Router uses `app/api/health/route.ts`, not `pages/api/health`. Correct path depends on router type.
**Fix:** Specify: "Create `frontend/app/api/health/route.ts` with `export async function GET() { return Response.json({status: 'ok'}); }`" for App Router.
**Priority:** 🟡 Should fix

#### 🟡 Issue M8-005 ✅ FIXED ✅ FIXED ✅ FIXED: configure_structured_logging lacks code example
**What's wrong:** "Update backend/config/settings.py; configure structlog with JSON output" — no code snippet showing the LOGGING dict or structlog configuration.
**Fix:** Add the LOGGING configuration snippet with structlog processor chain and JSON renderer.
**Priority:** 🟡 Should fix

#### 🟡 Issue M8-006 ✅ FIXED ✅ FIXED ✅ FIXED: Missing security hardening tasks
**What's wrong:** M8 is labeled "Production Ready" but has no tasks for: CSRF hardening, CORS configuration, rate limiting, security headers (HSTS, CSP), dependency vulnerability scanning, database backup strategy.
**Fix:** Add at minimum: CORS_ORIGIN_WHITELIST in settings, Django SECURE_* settings (HSTS, SSL redirect), rate limiting on auth endpoints.
**Priority:** 🟡 Should fix

#### 🟢 Issue M8-007: Missing CI/CD pipeline task
**What's wrong:** No task for GitHub Actions or other CI to run tests on push.
**Fix:** Optionally add: "Create .github/workflows/test.yml; run pytest and eslint on push/PR."
**Priority:** 🟢 Nice to fix

### M8 Gap Analysis

| Area | Covered? | Notes |
|------|----------|-------|
| Docker compose prod | ✅ | Named |
| Multi-stage Dockerfile | ✅ | <500MB target |
| Nginx HTTPS | ⚠️ | Missing directory |
| Health endpoints | ⚠️ | Next.js path wrong |
| Structured logging | ⚠️ | Missing code example |
| Sentry | ✅ | Integration specified |
| .env.example | ✅ | Specified |
| **Security hardening** | 🔴 | NOT COVERED — no HSTS, CORS, rate limiting, CSP |
| **Database backup** | 🔴 | NOT COVERED — no backup strategy for production |
| **CI/CD** | 🟡 | NOT COVERED — no automated test pipeline |
| **Migration safety** | 🔴 | NOT COVERED — no migration testing in CI |

---

## Cross-Cutting Issues

### Issue CC-001 ✅ FIXED ✅ FIXED ✅ FIXED: No TDD Pattern Anywhere 🔴
None of the 56 tasks follows the TDD cycle. Every task should be structured as:
```
1. [ ] Write failing test at <test_file_path>
2. [ ] Run test: `pytest <test_path> -v` → FAIL
3. [ ] Implement code at <source_file_path>
4. [ ] Run test: `pytest <test_path> -v` → PASS
5. [ ] Commit: `git add <files> && git commit -m "<message>"`
```

### Issue CC-002 ✅ FIXED ✅ FIXED ✅ FIXED: Missing Notification Milestone 🔴
SPEC §7.7 defines a comprehensive Notification system (Notification model, unread badge, dropdown panel, 7 notification types). This is not covered in ANY milestone. It's a cross-cutting concern that touches M3 (backend model), M4 (NavBar badge), M5 (dispatch notifications), and M6 (Celery tasks for notification generation).

### Issue CC-003 ✅ FIXED ✅ FIXED ✅ FIXED: No per-task commit instructions 🟡
writing-plans methodology requires "Frequent commits after every task." Tasks.md has no commit commands.

### Issue CC-004 ✅ FIXED ✅ FIXED ✅ FIXED: Verification command format is inconsistent 🟡
Some use `python manage.py check`, some use raw SQL, some use curl, some use pytest. Should standardize: unit tests → pytest, API verification → curl with expected output, Django config → manage.py check, data integrity → manage.py shell.

### Issue CC-005 ✅ FIXED ✅ FIXED ✅ FIXED: M3 session estimate mismatch between documents 🟡
SPEC.md says 4-5 sessions, milestones-v2.md says 3-4. After proper task splitting (19 tasks → ~28 tasks), 4-5 sessions is the minimum realistic estimate.

### Issue CC-006: No dependency on existing tests passing 🟡
No task checks that existing tests still pass after changes. Every migration/model-change task should include: "Verify: `pytest backend/tests/test_soul_core.py backend/tests/test_soul_lifecycle.py -v` — all 12 tests still pass."

---

## Summary Table

| # | Milestone | Issue | Severity | Category |
|---|-----------|-------|----------|----------|
| M3-001 | M3 | Zero TDD cycles anywhere | 🔴 | Granularity |
| M3-002 ✅ FIXED ✅ FIXED ✅ FIXED | M3 | TenantManager spans 8 models — too big | 🔴 | Granularity |
| M3-003 ✅ FIXED ✅ FIXED ✅ FIXED | M3 | ViewSet filtering spans 7 viewsets — too big | 🔴 | Granularity |
| M3-004 ✅ FIXED ✅ FIXED ✅ FIXED | M3 | Frontend tasks in M3 (useAuth, route guards) | 🔴 | Structure |
| M3-005 ✅ FIXED ✅ FIXED ✅ FIXED | M3 | Field-level rules contradict SPEC §6.X.2 | 🔴 | Consistency |
| M3-006 ✅ FIXED ✅ FIXED ✅ FIXED | M3 | Soul tenant migration is a multi-step bomb | 🔴 | Granularity |
| M3-007 ✅ FIXED ✅ FIXED ✅ FIXED | M3 | Civilization cleanup dangerously vague | 🔴 | Granularity |
| M3-008 ✅ FIXED ✅ FIXED ✅ FIXED | M3 | Missing exact field definitions | 🟡 | Granularity |
| M3-009 ✅ FIXED ✅ FIXED ✅ FIXED | M3 | Weak/inconsistent verifications | 🟡 | Granularity |
| M3-010 ✅ FIXED ✅ FIXED ✅ FIXED | M3 | Data migration no rollback strategy | 🟡 | Structure |
| M3-011 ✅ FIXED ✅ FIXED ✅ FIXED | M3 | Session estimate mismatch (3-4 vs 4-5) | 🟡 | Consistency |
| M3-012 | M3 | Seed script vs management command | 🟢 | Structure |
| M3-013 | M3 | Permission grouping loses clarity | 🟢 | Structure |
| M3-GAP1 ✅ FIXED ✅ FIXED ✅ FIXED | M3 | Missing tenant DB indexes (SPEC §8.1) | 🔴 | Gap |
| M3-GAP2 ✅ FIXED ✅ FIXED ✅ FIXED | M3 | Missing tenant DB constraints (SPEC §8.2) | 🔴 | Gap |
| M3-GAP3 ✅ FIXED ✅ FIXED ✅ FIXED | M3 | Missing Notification model (SPEC §7.7) | 🔴 | Gap |
| M4-001 ✅ FIXED ✅ FIXED ✅ FIXED | M4 | Wrong TenantContext file path | 🔴 | Consistency |
| M4-002 ✅ FIXED ✅ FIXED ✅ FIXED | M4 | Routing restructure too large | 🔴 | Granularity |
| M4-003 ✅ FIXED ✅ FIXED ✅ FIXED | M4 | Missing API client code example | 🟡 | Granularity |
| M4-004 ✅ FIXED ✅ FIXED ✅ FIXED | M4 | Login redirect missing JWT decode details | 🟡 | Granularity |
| M4-005 ✅ FIXED ✅ FIXED ✅ FIXED | M4 | Landing page "Update" vs "Rewrite" unclear | 🟡 | Structure |
| M4-006 ✅ FIXED ✅ FIXED ✅ FIXED | M4 | Language switcher too vague | 🟡 | Granularity |
| M4-007 ✅ FIXED ✅ FIXED ✅ FIXED | M4 | Optional UI tasks not marked optional | 🟢 | Structure |
| M4-GAP1 ✅ FIXED ✅ FIXED ✅ FIXED | M4 | Route guards not in M4 | 🔴 | Gap |
| M4-GAP2 ✅ FIXED ✅ FIXED ✅ FIXED | M4 | useAuth hook not in M4 | 🔴 | Gap |
| M5-001 ✅ FIXED ✅ FIXED ✅ FIXED | M5 | 3 models in one task | 🔴 | Granularity |
| M5-002 ✅ FIXED ✅ FIXED ✅ FIXED | M5 | 7 service methods in one task | 🔴 | Granularity |
| M5-003 ✅ FIXED ✅ FIXED ✅ FIXED | M5 | 3 files + 6 endpoints in one task | 🔴 | Granularity |
| M5-004 ✅ FIXED ✅ FIXED ✅ FIXED | M5 | Missing TDD cycles for services | 🟡 | Granularity |
| M5-005 ✅ FIXED ✅ FIXED ✅ FIXED | M5 | Cross-tenant middleware not in tasks | 🟡 | Gap |
| M5-006 ✅ FIXED ✅ FIXED ✅ FIXED | M5 | Notification integration for dispatch | 🟡 | Gap |
| M5-007 | M5 | No WebSocket/polling task | 🟢 | Gap |
| M5-GAP1 ✅ FIXED ✅ FIXED ✅ FIXED | M5 | Soul state transitions on dispatch | 🔴 | Gap |
| M6-001 ✅ FIXED ✅ FIXED ✅ FIXED | M6 | Wrong file path for karma service | 🔴 | Consistency |
| M6-002 ✅ FIXED ✅ FIXED ✅ FIXED | M6 | Redis cache references wrong file | 🔴 | Consistency |
| M6-003 ✅ FIXED ✅ FIXED ✅ FIXED | M6 | Karma API placement ambiguous | 🟡 | Structure |
| M6-004 ✅ FIXED ✅ FIXED ✅ FIXED | M6 | Missing Celery tasks file path | 🟡 | Granularity |
| M6-005 ✅ FIXED ✅ FIXED ✅ FIXED | M6 | Stats API missing file list | 🟡 | Granularity |
| M6-006 ✅ FIXED ✅ FIXED ✅ FIXED | M6 | Dashboard missing API integration details | 🟡 | Granularity |
| M6-007 ✅ FIXED ✅ FIXED ✅ FIXED | M6 | Karma test missing file path | 🟡 | Granularity |
| M6-008 | M6 | No Redis availability check | 🟢 | Structure |
| M7-001 ✅ FIXED ✅ FIXED ✅ FIXED | M7 | Wrong table name in verification | 🔴 | Consistency |
| M7-002 ✅ FIXED ✅ FIXED ✅ FIXED | M7 | Non-existent script reference | 🟡 | Consistency |
| M7-003 ✅ FIXED ✅ FIXED ✅ FIXED | M7 | Missing tenant lookup in seed scripts | 🟡 | Granularity |
| M7-004 | M7 | i18n verify is manual only | 🟢 | Granularity |
| M8-001 ✅ FIXED ✅ FIXED ✅ FIXED | M8 | Wrong Dockerfile path | 🔴 | Consistency |
| M8-002 ✅ FIXED ✅ FIXED ✅ FIXED | M8 | No reference to existing docker-compose | 🟡 | Structure |
| M8-003 ✅ FIXED ✅ FIXED ✅ FIXED | M8 | Nginx path/directory doesn't exist | 🟡 | Consistency |
| M8-004 ✅ FIXED ✅ FIXED ✅ FIXED | M8 | Next.js health route path wrong | 🟡 | Consistency |
| M8-005 ✅ FIXED ✅ FIXED ✅ FIXED | M8 | Missing logging code example | 🟡 | Granularity |
| M8-006 ✅ FIXED ✅ FIXED ✅ FIXED | M8 | Missing security hardening | 🟡 | Gap |
| M8-007 | M8 | Missing CI/CD pipeline | 🟢 | Gap |
| CC-001 ✅ FIXED ✅ FIXED ✅ FIXED | All | No TDD pattern in any task | 🔴 | Cross |
| CC-002 ✅ FIXED ✅ FIXED ✅ FIXED | All | Missing Notification milestone | 🔴 | Cross |
| CC-003 ✅ FIXED ✅ FIXED ✅ FIXED | All | No per-task commit instructions | 🟡 | Cross |
| CC-004 ✅ FIXED ✅ FIXED ✅ FIXED | All | Inconsistent verification format | 🟡 | Cross |
| CC-005 ✅ FIXED ✅ FIXED ✅ FIXED | All | Session estimate mismatch | 🟡 | Cross |
| CC-006  ✅ FIXED ✅ FIXED ✅ FIXED| All | No existing-test regression check | 🟡 | Cross |

---

## Recommendations (Priority Order)

1. **Split M3.2, M3.3, M5.1, M5.2 oversized tasks** — these are the biggest blockers to bite-sized execution
2. **Correct all file paths** — M4-001 ✅ FIXED ✅ FIXED ✅ FIXED, M6-001 ✅ FIXED ✅ FIXED ✅ FIXED, M6-002 ✅ FIXED ✅ FIXED ✅ FIXED, M7-001 ✅ FIXED ✅ FIXED ✅ FIXED, M8-001 ✅ FIXED ✅ FIXED ✅ FIXED, M8-004 ✅ FIXED ✅ FIXED ✅ FIXED
3. **Add TDD pattern to every task** — test file path + fail → code + pass → commit
4. **Move frontend tasks from M3.7 to M4** — useAuth hook, route guards
5. **Fix field-level rules to match SPEC** — M3-005 ✅ FIXED ✅ FIXED ✅ FIXED
6. **Add missing DB index/constraint tasks to M3** — M3-GAP1 ✅ FIXED ✅ FIXED ✅ FIXED, M3-GAP2 ✅ FIXED ✅ FIXED ✅ FIXED
7. **Add Notification milestone or integrate into M5** — CC-002 ✅ FIXED ✅ FIXED ✅ FIXED
8. **Add security hardening to M8** — M8-006 ✅ FIXED ✅ FIXED ✅ FIXED
9. **Align session estimates across documents** — CC-005 ✅ FIXED ✅ FIXED ✅ FIXED
