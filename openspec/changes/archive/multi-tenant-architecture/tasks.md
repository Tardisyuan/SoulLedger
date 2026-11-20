# Multi-Tenant Architecture — Task List v2

> Rewritten to align with 6-milestone structure. Tasks grouped by milestone.
> Each task is: specific (concrete action), verifiable (can check), small (one session).

---

## M3: Multi-Tenant Backend Infrastructure

**Prerequisite:** M2 ✅ (JWT auth done)

### M3.1: Tenant Model + Seed Data

- [ ] **M3.1a — create_tenant_model** 🔴
  - Title: Create Tenant model
  - Action: Create `backend/apps/tenants/__init__.py`, `backend/apps/tenants/models.py`
  - Fields: `code` (CharField, unique, max_length=50), `display_name` (CharField, max_length=200), `description` (TextField, blank=True), `settings` (JSONField, default=dict), `is_active` (BooleanField, default=True), `dispatch_enabled` (BooleanField, default=False), `api_endpoint` (URLField, blank=True), `created_at` (DateTimeField, auto_now_add=True)
  - TDD: (1) Write test at `backend/tests/test_tenant_model.py` — `test_tenant_creation`, `test_tenant_str_method`; (2) `pytest backend/tests/test_tenant_model.py -v` → FAIL; (3) Implement model; (4) `pytest backend/tests/test_tenant_model.py -v` → PASS; (5) `git add backend/apps/tenants/ && git commit -m "feat(m3): add Tenant model"`
  - Regression: `pytest backend/tests/ -v --ignore=backend/tests/test_tenant_model.py` — all existing tests pass

- [ ] **M3.1b — register_tenants_app** 🟢
  - Title: Register tenants app in Django settings
  - Action: Add `'apps.tenants'` to INSTALLED_APPS in `backend/config/settings.py`; `python manage.py makemigrations tenants && python manage.py migrate tenants`
  - Verify: `python manage.py showmigrations tenants` shows [X] for initial migration
  - Commit: `git add backend/config/settings.py && git commit -m "feat(m3): register tenants app + run migrations"`

- [ ] **M3.1c — seed_tenant_data** 🟢
  - Title: Insert 3 tenant records via management command
  - Action: Create `backend/apps/tenants/management/commands/seed_tenants.py` — idempotent (uses get_or_create); inserts CN_DIYU (display_name='Chinese Afterlife'), EU_HEAVEN_HELL (display_name='European Afterlife'), EG_DUAT (display_name='Egyptian Afterlife'); all with dispatch_enabled=True
  - Verify: `python manage.py seed_tenants && python manage.py shell -c "from apps.tenants.models import Tenant; print(Tenant.objects.count())"` → 3
  - Commit: `git add backend/apps/tenants/management/ && git commit -m "feat(m3): seed 3 tenant records"`

### M3.2: Add tenant_id to All Business Models

Each sub-task: add nullable FK → create migration → backfill → commit. Per-file FK code provided.

- [ ] **M3.2a — add_tenant_id_to_realms** 🟡
  - Title: Add tenant FK to Realm model
  - File: `backend/apps/realms/models.py`
  - FK code: `tenant = models.ForeignKey('tenants.Tenant', on_delete=models.CASCADE, related_name='realms', null=True)`
  - TDD: (1) Write `test_realm_has_tenant_fk` in `backend/tests/test_tenant_fk.py` → FAIL; (2) Add FK + `python manage.py makemigrations realms && python manage.py migrate realms`; (3) Backfill: `python manage.py shell -c "from apps.realms.models import Realm; from apps.tenants.models import Tenant; cn=Tenant.objects.get(code='CN_DIYU'); Realm.objects.filter(tenant__isnull=True).update(tenant=cn)"`; (4) `pytest backend/tests/test_tenant_fk.py::test_realm_has_tenant_fk -v` → PASS
  - Commit: `git add backend/apps/realms/ && git commit -m "feat(m3): add tenant FK to Realm model"`
  - Regression: `pytest backend/tests/ -v` — all existing tests pass

- [ ] **M3.2b — add_tenant_id_to_actors** 🟡
  - Title: Add tenant FK to Actor model
  - File: `backend/apps/actors/models.py`
  - FK code: `tenant = models.ForeignKey('tenants.Tenant', on_delete=models.CASCADE, related_name='actors', null=True)`
  - TDD: (1) `test_actor_has_tenant_fk` in `backend/tests/test_tenant_fk.py` → FAIL; (2) Add FK + migrate; (3) Backfill from CN_DIYU; (4) Test → PASS
  - Commit: `git add backend/apps/actors/ && git commit -m "feat(m3): add tenant FK to Actor model"`

- [ ] **M3.2c — add_tenant_id_to_souls** 🔴 (Split into 4 sub-steps)
  - **M3.2c1:** Add nullable FK: `tenant = models.ForeignKey('tenants.Tenant', on_delete=models.CASCADE, related_name='souls', null=True)` to `backend/apps/souls/models.py`
    - TDD: `test_soul_has_tenant_fk` → FAIL → add FK + migrate → PASS
    - Commit: `git add backend/apps/souls/models.py && git commit -m "feat(m3): add nullable tenant FK to Soul"`
  - **M3.2c2:** Data migration: `python manage.py makemigrations souls --empty --name backfill_soul_tenant`; backfill all existing souls to CN_DIYU in `RunPython`; run `python manage.py migrate souls`
    - Verify: `python manage.py shell -c "from apps.souls.models import Soul; print(Soul.objects.filter(tenant__isnull=True).count())"` → 0
    - Commit: `git add backend/apps/souls/migrations/ && git commit -m "feat(m3): backfill soul tenant to CN_DIYU"`
  - **M3.2c3:** Make NOT NULL: alter FK to `null=False` in models.py; `python manage.py makemigrations souls && python manage.py migrate souls`
    - Verify: `python manage.py shell -c "from apps.souls.models import Soul; f=Soul._meta.get_field('tenant'); print(f.null)"` → False
    - Commit: `git add backend/apps/souls/ && git commit -m "feat(m3): make soul tenant FK NOT NULL"`
  - **M3.2c4:** Remove `civilization` field: remove field from `backend/apps/souls/models.py`; `python manage.py makemigrations souls && python manage.py migrate souls`; update any serializer/filter references
    - Verify: `python manage.py check && grep -r "civilization" backend/apps/souls/` returns no matches
    - Commit: `git add backend/apps/souls/ && git commit -m "feat(m3): remove civilization field from Soul (replaced by tenant)"`
  - Regression after all: `pytest backend/tests/test_soul_core.py backend/tests/test_soul_lifecycle.py -v` — all pass

- [ ] **M3.2d — add_tenant_id_to_judgment** 🟡
  - Title: Add tenant FK to Judgment model
  - File: `backend/apps/judgment/models.py`
  - FK code: `tenant = models.ForeignKey('tenants.Tenant', on_delete=models.CASCADE, related_name='judgments', null=True)`
  - TDD: `test_judgment_has_tenant_fk` → FAIL → add FK + migrate → backfill → PASS
  - Commit: `git add backend/apps/judgment/ && git commit -m "feat(m3): add tenant FK to Judgment model"`

- [ ] **M3.2e — add_tenant_id_to_disposition** 🟡
  - Title: Add tenant FK to Disposition model
  - File: `backend/apps/disposition/models.py`
  - FK code: `tenant = models.ForeignKey('tenants.Tenant', on_delete=models.CASCADE, related_name='dispositions', null=True)`
  - TDD: `test_disposition_has_tenant_fk` → FAIL → add FK + migrate → backfill → PASS
  - Commit: `git add backend/apps/disposition/ && git commit -m "feat(m3): add tenant FK to Disposition model"`

- [ ] **M3.2f — add_tenant_id_to_reincarnation** 🟡
  - Title: Add tenant FK to Reincarnation model
  - File: `backend/apps/reincarnation/models.py`
  - FK code: `tenant = models.ForeignKey('tenants.Tenant', on_delete=models.CASCADE, related_name='reincarnations', null=True)`
  - TDD: `test_reincarnation_has_tenant_fk` → FAIL → add FK + migrate → backfill → PASS
  - Commit: `git add backend/apps/reincarnation/ && git commit -m "feat(m3): add tenant FK to Reincarnation model"`

- [ ] **M3.2g — add_tenant_id_to_events** 🟡
  - Title: Add tenant FK to SoulEvent model
  - File: `backend/apps/events/models.py`
  - FK code: `tenant = models.ForeignKey('tenants.Tenant', on_delete=models.CASCADE, related_name='soul_events', null=True)`
  - TDD: `test_events_has_tenant_fk` → FAIL → add FK + migrate → backfill → PASS
  - Commit: `git add backend/apps/events/ && git commit -m "feat(m3): add tenant FK to SoulEvent model"`

- [ ] **M3.2h — add_tenant_id_to_user** 🟡
  - Title: Add tenant FK to User model
  - File: `backend/apps/authentication/models.py`
  - FK code: `tenant = models.ForeignKey('tenants.Tenant', on_delete=models.CASCADE, related_name='users', null=True)`
  - TDD: `test_user_has_tenant_fk` → FAIL → add FK + migrate → backfill to CN_DIYU → PASS; then make NOT NULL in a follow-up migration
  - Verify: `python manage.py shell -c "from apps.authentication.models import User; print(User.objects.filter(tenant__isnull=True).count())"` → 0
  - Commit: `git add backend/apps/authentication/ && git commit -m "feat(m3): add tenant FK to User model"`

### M3.3: Middleware + TenantManager + ViewSet Filters

- [ ] **M3.3a — create_tenant_middleware** 🔴
  - Title: Create TenantMiddleware
  - Action: Create `backend/apps/tenants/middleware.py`; extract `tenant_code` from JWT in request auth header; resolve Tenant object; attach to `request.tenant`; if no JWT or no tenant_code → `request.tenant = None` (unauthenticated)
  - TDD: (1) Write `test_middleware_extracts_tenant_from_jwt` in `backend/tests/test_tenant_middleware.py` → FAIL; (2) Implement middleware; register in `MIDDLEWARE`; (3) `pytest backend/tests/test_tenant_middleware.py -v` → PASS
  - Commit: `git add backend/apps/tenants/middleware.py backend/config/settings.py && git commit -m "feat(m3): add TenantMiddleware with JWT extraction"`

- [ ] **M3.3b — create_tenant_manager** 🔴
  - Title: Create TenantManager base class
  - Action: Create `backend/apps/tenants/managers.py` with `TenantManager(models.Manager)`; override `get_queryset()` to filter by current tenant from thread-local/middleware; provide `current_tenant()` context manager helper
  - TDD: (1) Write `test_tenant_manager_filters_by_tenant` in `backend/tests/test_tenant_manager.py` → FAIL; (2) Implement TenantManager; (3) `pytest backend/tests/test_tenant_manager.py -v` → PASS
  - Commit: `git add backend/apps/tenants/managers.py && git commit -m "feat(m3): add TenantManager with auto-filtering"`

- [ ] **M3.3c — update_souls_manager** 🟡
  - File: `backend/apps/souls/managers.py` (create if not exists; else update existing)
  - Action: Set `objects = TenantManager()` on Soul model; ensure all default queries are tenant-scoped
  - TDD: `test_soul_manager_scoped` → FAIL → add TenantManager → PASS
  - Commit: `git add backend/apps/souls/ && git commit -m "feat(m3): tenant-scope Soul model queries"`

- [ ] **M3.3d — update_realms_manager** 🟡
  - File: `backend/apps/realms/managers.py`
  - TDD: test → FAIL → code → PASS; Commit: `git add backend/apps/realms/ && git commit -m "feat(m3): tenant-scope Realm model queries"`

- [ ] **M3.3e — update_actors_manager** 🟡
  - File: `backend/apps/actors/managers.py`
  - TDD: test → FAIL → code → PASS; Commit: `git add backend/apps/actors/ && git commit -m "feat(m3): tenant-scope Actor model queries"`

- [ ] **M3.3f — update_judgment_manager** 🟡
  - File: `backend/apps/judgment/managers.py`
  - TDD: test → FAIL → code → PASS; Commit: `git add backend/apps/judgment/ && git commit -m "feat(m3): tenant-scope Judgment model queries"`

- [ ] **M3.3g — update_disposition_manager** 🟡
  - File: `backend/apps/disposition/managers.py`
  - TDD: test → FAIL → code → PASS; Commit: `git add backend/apps/disposition/ && git commit -m "feat(m3): tenant-scope Disposition model queries"`

- [ ] **M3.3h — update_reincarnation_manager** 🟡
  - File: `backend/apps/reincarnation/managers.py`
  - TDD: test → FAIL → code → PASS; Commit: `git add backend/apps/reincarnation/ && git commit -m "feat(m3): tenant-scope Reincarnation model queries"`

- [ ] **M3.3i — update_events_manager** 🟡
  - File: `backend/apps/events/managers.py`
  - TDD: test → FAIL → code → PASS; Commit: `git add backend/apps/events/ && git commit -m "feat(m3): tenant-scope SoulEvent model queries"`

- [ ] **M3.3j — update_auth_manager** 🟡
  - File: `backend/apps/authentication/managers.py`
  - TDD: test → FAIL → code → PASS; Commit: `git add backend/apps/authentication/ && git commit -m "feat(m3): tenant-scope User model queries"`

- [ ] **M3.3k — update_souls_viewset_filter** 🟡
  - File: `backend/apps/souls/views.py`; update `get_queryset()` — SYS_ADMIN bypasses, others filtered by `request.tenant`
  - Verify: `curl -H "Authorization: Bearer <cn_token>" http://localhost:8000/api/v1/souls/ | python -c "import sys,json; data=json.load(sys.stdin); assert all(s['tenant_code']=='CN_DIYU' for s in data['results'])"`
  - Commit: `git add backend/apps/souls/views.py && git commit -m "feat(m3): tenant-filter SoulViewSet"`

- [ ] **M3.3l — update_realms_viewset_filter** 🟡
  - File: `backend/apps/realms/views.py`
  - Verify: `curl -H "Authorization: Bearer <cn_token>" http://localhost:8000/api/v1/realms/` returns only CN_DIYU realms
  - Commit: `git add backend/apps/realms/views.py && git commit -m "feat(m3): tenant-filter RealmViewSet"`

- [ ] **M3.3m — update_actors_viewset_filter** 🟡
  - File: `backend/apps/actors/views.py`; same pattern; Commit: `git commit -m "feat(m3): tenant-filter ActorViewSet"`

- [ ] **M3.3n — update_judgment_viewset_filter** 🟡
  - File: `backend/apps/judgment/views.py`; same pattern

- [ ] **M3.3o — update_disposition_viewset_filter** 🟡
  - File: `backend/apps/disposition/views.py`; same pattern

- [ ] **M3.3p — update_reincarnation_viewset_filter** 🟡
  - File: `backend/apps/reincarnation/views.py`; same pattern

- [ ] **M3.3q — update_events_viewset_filter** 🟡
  - File: `backend/apps/events/views.py`; same pattern

### M3.4: Tenant API + Auth Updates

- [ ] **M3.4a — add_tenant_endpoints** 🟢
  - Title: Tenant management API (SYS_ADMIN only)
  - Action: Create `backend/apps/tenants/views.py`, `serializers.py`, `urls.py`; `GET /api/v1/tenants/` (list), `GET /api/v1/tenants/{code}/` (detail), `PATCH /api/v1/tenants/{code}/` (SYS_ADMIN only); register in `backend/config/urls.py`
  - TDD: (1) Write `test_tenant_api_sysadmin_list` in `backend/tests/test_tenant_api.py` → FAIL; (2) Implement views + serializers + urls; (3) `pytest backend/tests/test_tenant_api.py -v` → PASS
  - Verify: `curl -H "Authorization: Bearer <sysadmin_token>" http://localhost:8000/api/v1/tenants/ | python -c "import sys,json; assert len(json.load(sys.stdin)['results']) == 3"`
  - Commit: `git add backend/apps/tenants/ && git commit -m "feat(m3): add tenant management API (SYS_ADMIN)"`

- [ ] **M3.4b — update_auth_login_response** 🟢
  - Title: Login response includes tenant info
  - Action: Update `backend/apps/authentication/serializers.py`; login response JWT includes `tenant_code` claim; response body includes `tenant: {code, display_name}`
  - Verify: `curl -X POST http://localhost:8000/api/v1/auth/login/ -H "Content-Type: application/json" -d '{"username":"cn_user","password":"test"}' | python -c "import sys,json; d=json.load(sys.stdin); assert 'tenant' in d; assert d['tenant']['code']=='CN_DIYU'"` → PASS
  - Commit: `git add backend/apps/authentication/serializers.py && git commit -m "feat(m3): add tenant info to login response + JWT claims"`

### M3.5: Data Migration + Cleanup

- [ ] **M3.5a — migrate_existing_data** 🔴
  - Title: Migrate existing data to multi-tenant with dry-run + rollback
  - Action: Create `backend/apps/tenants/management/commands/migrate_to_multitenant.py`; (a) print BEFORE counts per model; (b) `--dry-run` flag prints what would change without modifying; (c) wrap in transaction; (d) map civilization→tenant: CN→CN_DIYU, EU→EU_HEAVEN_HELL, EG→EG_DUAT; (e) print AFTER counts; (f) support `--rollback` to revert
  - Verify: `python manage.py migrate_to_multitenant --dry-run` shows planned changes; `python manage.py migrate_to_multitenant` completes; `python manage.py shell -c "from apps.souls.models import Soul; assert Soul.objects.filter(tenant__isnull=True).count()==0"` → no output (assertion passes)
  - Commit: `git add backend/apps/tenants/management/commands/migrate_to_multitenant.py && git commit -m "feat(m3): add data migration script with dry-run + rollback"`

- [ ] **M3.5b — cleanup_civilization_references** 🔴
  - Title: Remove civilization field references — per-file plan
  - File list and changes:
    1. `backend/apps/souls/models.py` — remove `civilization` field (already done in M3.2c4)
    2. `backend/apps/souls/serializers.py` — remove `civilization` from fields; add `tenant_code = serializers.CharField(source='tenant.code', read_only=True)`
    3. `backend/apps/souls/filters.py` — remove `civilization` filter; add `tenant_code` filter
    4. `backend/apps/souls/views.py` — remove civilization-related query params
    5. `backend/apps/karma/services.py` — replace `r.civilization` with `r.tenant.code`
    6. `backend/apps/realms/models.py` — remove any civilization references; add tenant FK if missing
    7. `backend/scripts/seed_*.py` — replace civilization with tenant lookups
    8. `backend/apps/souls/admin.py` — update list_filter, search_fields
  - Verify: `grep -rn "civilization" backend/apps/ backend/tests/` returns no matches (excluding migration history files)
  - Commit: `git add -A && git commit -m "feat(m3): remove all civilization references, use tenant"`

### M3.6: Testing

- [ ] **M3.6a — write_tenant_isolation_tests** 🔴
  - Title: Tenant isolation integration tests
  - Action: Create `backend/tests/test_tenant_isolation.py`; create test users in CN and EU; create souls in each; verify: CN user sees only CN souls (via ORM and API), EU user sees only EU souls, SYS_ADMIN sees all; cross-tenant access returns 403/empty
  - TDD: (1) Write all test cases (10+); (2) `pytest backend/tests/test_tenant_isolation.py -v` → some FAIL; (3) Fix middleware/managers until; (4) `pytest backend/tests/test_tenant_isolation.py -v` → ALL PASS
  - Commit: `git add backend/tests/test_tenant_isolation.py && git commit -m "test(m3): add tenant isolation integration tests (10+ cases)"`

### M3.7: Permission Enforcement (Backend)

- [ ] **M3.7a — add_drf_permission_classes** 🔴
  - Title: DRF Permission Classes for all ViewSets
  - Action: Create `backend/apps/tenants/permissions.py` with:
    - `TenantPermission`: checks `user.tenant == obj.tenant` for all non-SYS_ADMIN; SYS_ADMIN bypasses
    - `RolePermission`: checks `user.role in allowed_roles`; roles: SYS_ADMIN, GUARDIAN, DISPATCH_JUDGE, VIEWER
    - Apply to all 7 ViewSets via `permission_classes = [TenantPermission & RolePermission]`
  - TDD: (1) Write `backend/tests/test_permissions.py` with role×operation matrix; (2) `pytest backend/tests/test_permissions.py -v` → FAIL; (3) Implement permissions.py + apply to viewsets; (4) → PASS
  - Verify: `curl -H "Authorization: Bearer <cn_token>" http://localhost:8000/api/v1/souls/?tenant=EU_HEAVEN_HELL` → 403
  - Commit: `git add backend/apps/tenants/permissions.py && git commit -m "feat(m3): add DRF TenantPermission + RolePermission classes"`

- [ ] **M3.7b — add_field_level_serializers** 🟡
  - Title: Field-level serializer permissions (match SPEC §6.X.2)
  - Action: Create role-based field filtering in serializers using `get_fields()` override:
    - **VIEWER**: can see `karmic_balance` ✓, `death_date` ✓; cannot see `merit_score` ✗, `demerit_score` ✗, `dispatch_status` ✗
    - **GUARDIAN**: can see `merit_score` ✓, `demerit_score` ✓, `death_date` ✓; cannot see `karmic_balance` ✗, `dispatch_status` ✗
    - **DISPATCH_JUDGE**: can see `dispatch_status` ✓, `karmic_balance` ✓; cannot see `merit_score` ✗, `demerit_score` ✗
    - **SYS_ADMIN**: sees all fields
  - TDD: (1) Write `test_serializer_field_visibility_by_role` → FAIL; (2) Implement `get_fields()` in SoulSerializer; (3) `pytest backend/tests/test_serializer_permissions.py -v` → PASS
  - Verify: `curl -H "Authorization: Bearer <viewer_token>" http://localhost:8000/api/v1/souls/1/ | python -c "import sys,json; d=json.load(sys.stdin); assert 'karmic_balance' in d; assert 'merit_score' not in d"` → PASS
  - Commit: `git add backend/apps/souls/serializers.py && git commit -m "feat(m3): role-based field-level serializer permissions"`

- [ ] **M3.7c — write_permission_tests** 🟡
  - Title: Permission integration tests (full matrix)
  - Action: Extend `backend/tests/test_permissions.py`; test all CRUD operations × all roles × cross-tenant; verify correct 403/200 responses; assert response field set matches role
  - Verify: `pytest backend/tests/test_permissions.py -v` — 20+ tests all PASS
  - Commit: `git add backend/tests/test_permissions.py && git commit -m "test(m3): full role×operation permission matrix tests"`

### M3.8: Database Indexes + Constraints (SPEC §8)

- [ ] **M3.8a — add_tenant_composite_indexes** 🟡
  - Title: Create composite indexes on tenant_id + key columns (SPEC §8.1)
  - Action: Add to each model's Meta.indexes:
    - Soul: `models.Index(fields=['tenant', 'state'], name='idx_soul_tenant_state')`, `models.Index(fields=['tenant', 'karmic_balance'], name='idx_soul_tenant_karma')`
    - Realm: `models.Index(fields=['tenant', 'realm_type'], name='idx_realm_tenant_type')`
    - Actor: `models.Index(fields=['tenant', 'actor_type'], name='idx_actor_tenant_type')`
    - Judgment: `models.Index(fields=['tenant', 'status'], name='idx_judgment_tenant_status')`
    - DispatchRecord: `models.Index(fields=['source_tenant', 'target_tenant', 'status'], name='idx_dispatch_tenants_status')`
    - User: `models.Index(fields=['tenant', 'role'], name='idx_user_tenant_role')`
  - TDD: (1) Write `test_composite_indexes_exist` checking `django.db.connection.introspection` → FAIL; (2) Add indexes + `python manage.py makemigrations && python manage.py migrate`; (3) → PASS
  - Verify: `python manage.py shell -c "from django.db import connection; cursor=connection.cursor(); cursor.execute('SELECT indexname FROM pg_indexes WHERE tablename=%s', ['souls_soul']); print([r[0] for r in cursor.fetchall()])"` — includes idx_soul_tenant_state, idx_soul_tenant_karma
  - Commit: `git add backend/apps/*/models.py && git commit -m "feat(m3): add tenant composite indexes per SPEC §8.1"`

- [ ] **M3.8b — add_tenant_constraints** 🟡
  - Title: Add database-level constraints (SPEC §8.2)
  - Action: Add to models:
    - Soul: `models.CheckConstraint(check=~models.Q(state=''), name='ck_soul_state_not_empty')`
    - Tenant: `models.CheckConstraint(check=models.Q(dispatch_enabled=True) | models.Q(api_endpoint=''), name='ck_dispatch_requires_endpoint')`
    - DispatchRecord: ensure source_tenant != target_tenant via `models.CheckConstraint(check=~models.Q(source_tenant=models.F('target_tenant')), name='ck_dispatch_diff_tenants')`
  - TDD: `test_constraints_enforced` → FAIL → add constraints + migrate → PASS
  - Verify: `python manage.py shell -c "from apps.souls.models import Soul; from django.db import IntegrityError; try: Soul.objects.create(name='test', state=''); except IntegrityError: print('PASS')"`
  - Commit: `git add backend/apps/*/models.py && git commit -m "feat(m3): add CHECK constraints per SPEC §8.2"`

### M3.9: Notification Model (SPEC §7.7)

- [ ] **M3.9a — create_notification_model** 🟡
  - Title: Create Notification model
  - Action: Create `backend/apps/tenants/models.py` addition: `Notification` model with fields: `recipient` (FK User), `notification_type` (CharField: DISPATCH_PROPOSED, DISPATCH_APPROVED, DISPATCH_REJECTED, CROSS_JUDGMENT_INVITED, JUDGMENT_CONCLUDED, KARMA_THRESHOLD, SYSTEM), `title`, `message`, `is_read` (BooleanField, default=False), `related_object_id`, `related_object_type`, `created_at`
  - TDD: (1) Write `test_notification_model` → FAIL; (2) Add model + `python manage.py makemigrations tenants && python manage.py migrate tenants`; (3) → PASS
  - Verify: `python manage.py shell -c "from apps.tenants.models import Notification; n=Notification.objects.create(recipient_id=1, notification_type='SYSTEM', title='Test', message='Hello'); print(n.id)"` → prints ID
  - Commit: `git add backend/apps/tenants/models.py && git commit -m "feat(m3): add Notification model per SPEC §7.7"`

---

## M4: Tenant-Aware Frontend + Landing Page

**Prerequisite:** M3 ✅

### M4.1: Core Frontend Tenant Support

- [ ] **M4.1a — update_api_client_tenant** 🟡
  - Title: API client injects tenant context from JWT
  - Action: Update `frontend/lib/api.ts`; add interceptor that decodes JWT, extracts `tenant_code`, injects `X-Tenant-Code` header on every request
  - Code:
    ```typescript
    // frontend/lib/api.ts — add interceptor
    import { getCookie } from './cookies';
    const getTenantFromJWT = (): string | null => {
      const token = getCookie('access_token');
      if (!token) return null;
      try {
        const payload = JSON.parse(atob(token.split('.')[1]));
        return payload.tenant_code || null;
      } catch { return null; }
    };
    api.interceptors.request.use((config) => {
      const tenant = getTenantFromJWT();
      if (tenant) config.headers['X-Tenant-Code'] = tenant;
      return config;
    });
    ```
  - TDD: (1) Write test: mock JWT with tenant_code='CN_DIYU', assert header present; (2) Run: `npm test -- --testPathPattern=api` → FAIL; (3) Implement interceptor; (4) → PASS
  - Verify: `curl` from frontend with valid JWT shows `X-Tenant-Code` header in request
  - Regression: `npm run build` succeeds
  - Commit: `git add frontend/lib/api.ts && git commit -m "feat(m4): add tenant header interceptor to API client"`

- [ ] **M4.1b — create_tenant_context** 🟡
  - Title: TenantContext React context
  - Action: Create `frontend/src/contexts/TenantContext.tsx`; decode JWT on mount; store `tenantCode`, `displayName`, `role`; expose via `useTenant()` hook
  - TDD: (1) Write `frontend/src/__tests__/TenantContext.test.tsx` testing context values from mock JWT → FAIL; (2) Implement context + provider; (3) `npm test -- --testPathPattern=TenantContext` → PASS
  - Verify: Wrap App with `<TenantProvider>`, `console.log(useTenant())` in any page returns correct tenant
  - Commit: `git add frontend/src/contexts/TenantContext.tsx && git commit -m "feat(m4): add TenantContext with JWT decode"`

- [ ] **M4.1c — add_tenant_routing** 🔴 (Split into 4 sub-steps)
  - **M4.1c1:** Create `frontend/app/[tenant]/layout.tsx` — extract tenant param from URL; verify tenant exists; pass to TenantProvider
    - TDD: render test → FAIL → implement → PASS
    - Commit: `git add frontend/app/[tenant]/layout.tsx && git commit -m "feat(m4): add [tenant] dynamic route layout"`
  - **M4.1c2:** Move `frontend/app/souls/` → `frontend/app/[tenant]/souls/`; update all imports; verify page renders
    - Verify: `npm run build` succeeds; `curl http://localhost:3000/CN_DIYU/souls/` → 200
    - Commit: `git add frontend/app/[tenant]/souls/ && git commit -m "feat(m4): move souls pages under [tenant] route"`
  - **M4.1c3:** Move `frontend/app/realms/` → `frontend/app/[tenant]/realms/`, `frontend/app/actors/` → `frontend/app/[tenant]/actors/`
    - Verify: All page URLs resolve under /CN_DIYU/ prefix
    - Commit: `git add frontend/app/[tenant]/ && git commit -m "feat(m4): move realms + actors under [tenant] route"`
  - **M4.1c4:** Update all internal links (`<Link>`, `router.push`) to include tenant prefix; add redirect from `/souls/` → `/{tenant}/souls/`
    - Verify: All navigation works without 404s; `npm run build` succeeds
    - Commit: `git add frontend/ && git commit -m "feat(m4): update internal links for tenant routing"`

- [ ] **M4.1d — update_navbar_tenant_context** 🟡
  - Title: NavBar shows tenant + user info
  - Action: Update `frontend/components/NavBar.tsx`; use `useTenant()` to show `displayName`; show user role badge; logout button; SYS_ADMIN sees admin dashboard link
  - TDD: (1) Write NavBar render test with mock TenantContext → FAIL; (2) Update NavBar; (3) → PASS
  - Verify: NavBar displays "Chinese Afterlife (CN_DIYU)" when logged in as CN user; SYS_ADMIN sees "Admin Dashboard" link
  - Commit: `git add frontend/components/NavBar.tsx && git commit -m "feat(m4): NavBar shows tenant + role context"`

- [ ] **M4.1e — update_login_redirect** 🟢
  - Title: Login redirects to tenant dashboard
  - Action: Update `frontend/app/(auth)/login/page.tsx`; on successful login, use `jwt-decode` library to extract `tenant_code` from JWT payload; redirect to `/{tenant_code}/souls/`; if `tenant_code` missing from JWT, show error toast
  - TDD: (1) Write test: mock login response with JWT containing tenant_code='EU_HEAVEN_HELL' → assert redirect to /EU_HEAVEN_HELL/souls/ → FAIL; (2) Implement redirect logic; (3) → PASS
  - Verify: Login as CN user → redirects to /CN_DIYU/souls/; login as EU user → redirects to /EU_HEAVEN_HELL/souls/
  - Commit: `git add frontend/app/(auth)/login/page.tsx && git commit -m "feat(m4): login redirects to /{tenant_code}/souls/"`

- [ ] **M4.1f — create_useauth_hook** 🟡 (Moved from M3.7)
  - Title: Frontend useAuth() permission hook
  - Action: Create `frontend/src/hooks/useAuth.ts`; expose `hasPermission(operation: string): boolean`, `role`, `tenantCode`, `isAuthenticated`; read role from JWT; permission map: SYS_ADMIN→all, GUARDIAN→soul.*+judgment.*+read, DISPATCH_JUDGE→dispatch.*+cross_judgment.*, VIEWER→read-only
  - TDD: (1) Write `frontend/src/__tests__/useAuth.test.ts` → FAIL; (2) Implement hook; (3) `npm test -- --testPathPattern=useAuth` → PASS
  - Verify: `const { hasPermission } = useAuth(); hasPermission('soul.create')` returns true for GUARDIAN, false for VIEWER
  - Commit: `git add frontend/src/hooks/useAuth.ts && git commit -m "feat(m4): add useAuth permission hook"`

- [ ] **M4.1g — add_route_guards** 🟡 (Moved from M3.7)
  - Title: Frontend route guards based on role
  - Action: Create `frontend/src/components/RouteGuard.tsx`; wraps pages, checks `useAuth().hasPermission(requiredPermission)`; redirects to /403 if unauthorized; apply guards: dispatch pages require DISPATCH_JUDGE+; admin pages require SYS_ADMIN; hide forbidden nav items in NavBar
  - TDD: (1) Write RouteGuard render tests for each role → FAIL; (2) Implement; (3) → PASS
  - Verify: As VIEWER, navigate to /CN_DIYU/dispatch/propose → redirected to /403; menu items show/hide per role
  - Commit: `git add frontend/src/components/RouteGuard.tsx && git commit -m "feat(m4): add route guards per role"`

### M4.2: Landing Page

- [ ] **M4.2a — create_landing_page_tenant_selection** 🟡
  - Title: Rewrite landing page with tenant selection
  - Action: Rewrite `frontend/app/page.tsx` — replace current content with 3 clickable tenant cards: Chinese Afterlife (CN_DIYU), European Afterlife (EU_HEAVEN_HELL), Egyptian Afterlife (EG_DUAT); each card shows display_name + description; clicking navigates to `/{tenant_code}/login`; preserve existing i18n support
  - TDD: (1) Write landing page render test: assert 3 cards rendered, each links to correct /login?tenant= → FAIL; (2) Implement; (3) → PASS
  - Verify: Landing page at `/` shows 3 civilization cards; click "Chinese Afterlife" → navigates to /CN_DIYU/login
  - Commit: `git add frontend/app/page.tsx && git commit -m "feat(m4): rewrite landing page with 3-tenant selection cards"`

- [ ] **M4.2b — update_language_switcher** 🟢
  - Title: Language switcher on all tenant pages
  - Action: Update `frontend/components/LanguageSwitcher.tsx` — read current language from I18nContext; add to `frontend/app/[tenant]/layout.tsx` so it appears on all tenant pages; verify realm names, actor names, and judgment content respect locale
  - Verify: On /CN_DIYU/souls/, switch language to 'en' → soul names, labels, and realm names use English locale; switch to 'zh' → uses Chinese
  - Commit: `git add frontend/components/LanguageSwitcher.tsx frontend/app/[tenant]/layout.tsx && git commit -m "feat(m4): add language switcher to tenant layout"`

### M4.3: UI Framework (Optional — can defer to post-M8)

- [ ] **M4.3a — (Optional) add_theme_provider** 🟡
  - Title: ThemeProvider context
  - Action: Create `frontend/src/contexts/ThemeContext.tsx`; wrap app with ThemeProvider; support light/dark/system; persist to localStorage
  - Verify: Theme persists across page reloads
  - Commit: `git add frontend/src/contexts/ThemeContext.tsx && git commit -m "feat(m4): add optional ThemeProvider"`

- [ ] **M4.3b — (Optional) add_theme_color_picker** 🟡
  - Title: Accent color picker
  - Action: Create color picker component; 6 presets (Amber/Crimson/Jade/Lapis/Obsidian/Custom); apply via CSS variables `--color-accent`
  - Verify: UI accent color changes based on selection
  - Commit: `git commit -m "feat(m4): add optional accent color picker"`

- [ ] **M4.3c — (Optional) add_settings_drawer** 🟡
  - Title: Settings drawer component
  - Action: Create slide-in drawer from right; include language, theme, accent color, compact mode toggles; persist to localStorage
  - Verify: Settings drawer opens from navbar; settings persist across page loads
  - Commit: `git commit -m "feat(m4): add optional settings drawer"`

- [ ] **M4.3d — (Optional) add_personal_center** 🟡
  - Title: Personal center page
  - Action: Create `frontend/app/[tenant]/profile/page.tsx`; profile info, change password, notification preferences, activity history
  - Verify: All sections render with user data
  - Commit: `git commit -m "feat(m4): add optional personal center page"`

- [ ] **M4.3e — (Optional) add_navigation_modes** 🟢
  - Title: Compact/classic navigation modes
  - Action: Add sidebar mode toggle; classic = expanded icons+labels; compact = icon-only with hover expand; store in localStorage
  - Verify: Sidebar switches between modes correctly
  - Commit: `git commit -m "feat(m4): add optional navigation mode toggle"`

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
  - Action: Add `calculate_effective_karma(soul_id)` to `backend/apps/karma/services.py`; formula: `effective_score = original × e^(-0.01 × years_since_event)`
  - TDD: (1) Write `backend/tests/test_karma.py::test_time_decay_formula` → FAIL; (2) Implement; (3) `pytest backend/tests/test_karma.py -v` → PASS (expected: karma 100 merit 10 years ago → approx 90.48)
  - Commit: `git add backend/apps/karma/services.py backend/tests/test_karma.py && git commit -m "feat(m6): add karma time-decay formula"`
  - Regression: `pytest backend/tests/ -v` — all existing tests pass

- [ ] **implement_karma_redis_cache** 🟡
  - Title: Redis karma cache
  - Action: Add Redis caching to `KarmaService.calculate_effective_karma()` in `backend/apps/karma/services.py`; cache key `karma:{soul_id}`; TTL=5 min; invalidate on soul change via Django signal in `backend/apps/karma/signals.py`
  - TDD: (1) Write test: first call hits DB, second call within TTL hits cache → FAIL; (2) Implement caching + signal; (3) `pytest backend/tests/test_karma.py::test_karma_cache -v` → PASS
  - Verify: `redis-cli KEYS "karma:*"` shows keys after first call
  - Commit: `git add backend/apps/karma/ && git commit -m "feat(m6): add Redis caching to KarmaService"`

- [ ] **add_karma_api_endpoint** 🟡
  - Title: Karma API endpoint
  - Action: Add nested endpoint to `backend/apps/souls/views.py`; `GET /souls/{id}/karma/` returns `{original, effective, breakdown: [...]}`; or add to `backend/apps/karma/views.py` as `GET /api/v1/karma/souls/{id}/` and register in urls
  - TDD: (1) Write test at `backend/tests/test_karma_api.py` → FAIL; (2) Implement; (3) → PASS
  - Verify: `curl -H "Authorization: Bearer *** http://localhost:8000/api/v1/souls/1/karma/ | python -c "import sys,json; d=json.load(sys.stdin); assert 'effective' in d; assert 'original' in d; assert 'breakdown' in d"` → PASS
  - Commit: `git add backend/apps/souls/views.py && git commit -m "feat(m6): add karma API endpoint"`

- [ ] **implement_celery_karma_tasks** 🟡
  - Title: Celery karma tasks
  - Action: Create `backend/apps/karma/tasks.py`; daily karma recalculation (`recalculate_all_karma`); overdue judgment check (`alert_overdue_judgments` for souls in JUDGING > 30 days); register in `backend/config/celery.py`
  - Verify: `celery -A config inspect registered` shows tasks; `celery -A config call karma.tasks.recalculate_all_karma` executes
  - Commit: `git add backend/apps/karma/tasks.py backend/config/celery.py && git commit -m "feat(m6): add Celery karma tasks"`

### M6.2: Statistics Backend

- [ ] **add_global_stats_api** 🟡
  - Title: Global statistics API (SYS_ADMIN only)
  - Action: Create `backend/apps/stats/views.py`, serializers.py; `GET /stats/global/` (all-tenant counts), `GET /stats/by-tenant/` (per-tenant breakdown), `GET /stats/realm-occupancy/` (soul count per realm); SYS_ADMIN role required
  - Verify: SYS_ADMIN token returns full stats; non-SYS_ADMIN returns 403

### M6.3: Karma Frontend

- [ ] **add_karma_chart** 🟡
  - Title: Soul detail karma chart
  - Action: Update `frontend/app/[tenant]/souls/[id]/page.tsx`; add Recharts LineChart showing karma over time (timeline of merit/demerit events)
  - Verify: Karma chart renders with real soul data

### M6.4: Statistics Dashboard Frontend

- [ ] **add_admin_dashboard_page** 🔴
  - Title: Admin statistics dashboard
  - Action: Create `frontend/app/admin/dashboard/page.tsx`; Recharts: PieChart (soul state distribution), BarChart (tenant comparison), Histogram (karma distribution)
  - Verify: Dashboard renders with real API data when logged in as SYS_ADMIN

- [ ] **add_dispatch_audit_page** 🟢
  - Title: Dispatch audit page (read-only)
  - Action: Create `frontend/app/admin/dispatch/audit/page.tsx`; paginated table of all dispatch records; read-only; SYS_ADMIN only
  - Verify: Page shows all dispatches across tenants; no edit controls

---

## M7: Extended Civilizations Data

**Prerequisite:** M3 ✅

- [ ] **seed_european_data** 🟢
  - Title: Seed European realms + actors
  - Action: Create `backend/scripts/seed_european_data.py`; 17 realms (Heaven 3 + Purgatory 7 + Hell 9); 5 actors (St. Peter, Hades, Satan, Michael, Lucifer); each with tenant_id=EU_HEAVEN_HELL
  - Verify: `python manage.py shell -c "from apps.realms.models import Realm; print(Realm.objects.filter(tenant__code='EU_HEAVEN_HELL').count())"` → 17; actors → 5

- [ ] **seed_egyptian_data** 🟢
  - Title: Seed Egyptian realms + actors
  - Action: Create `backend/scripts/seed_egyptian_data.py`; 5 realms (Aaru + Duat regions); 4 actors (Osiris, Anubis, Thoth, Ma'at); each with tenant_id=EG_DUAT
  - Verify: `SELECT COUNT(*) FROM realms_realm WHERE tenant_id=<EG_ID>;` = 5; actors = 4

- [ ] **verify_civilization_dispatch_routing** 🟡
  - Title: Verify dispatch routing per civilization
  - Action: After all seed scripts run, test dispatch routing from CN→EU and CN→EG via API; scripts use `Tenant.objects.get(code='...')` for tenant lookup, not hardcoded IDs
  - Verify: Each tenant's souls show correct realm count; dispatch propose from CN_DIYU to EU_HEAVEN_HELL works via API

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
  - Action: Create/rewrite `Dockerfile` (project root); multi-stage build (builder + runtime); final image < 500MB; separate frontend Dockerfile at `Dockerfile.frontend`
  - Verify: `docker build -f Dockerfile .` produces image < 500MB (check `docker images`)

- [ ] **configure_nginx_https** 🟡
  - Title: Nginx HTTPS configuration
  - Action: Create `nginx/nginx.conf`; SSL termination, HTTP → HTTPS redirect, proxy to Next.js (port 3333) and Django (port 8000); self-signed certs for staging, document Let's Encrypt for prod
  - Verify: Nginx starts with `nginx -t -c nginx/nginx.conf` and serves HTTPS on port 443

### M8.2: Observability

- [ ] **add_health_endpoints** 🟢
  - Title: Health check endpoints
  - Action: Add `GET /health/` to `backend/config/urls.py` (returns 200 + {"status": "ok"}); create `frontend/app/api/health/route.ts` for Next.js App Router with `export async function GET() { return Response.json({status:'ok'}); }`
  - Verify: `curl localhost:8000/health/` returns 200; `curl localhost:3333/api/health` returns 200

- [ ] **configure_structured_logging** 🟡
  - Title: Structured logging with structlog
  - Action: Update `backend/config/settings.py`; configure structlog with JSON output; add request ID to all logs
  - Verify: Django logs output JSON format (not plain text)

- [ ] **integrate_sentry** 🟡
  - Title: Sentry error tracking
  - Action: Install `sentry-sdk`; configure in `backend/config/settings.py`; add source maps to Docker build
  - Verify: `sentry-cli test` connects; test error triggers Sentry event

### M8.3: Operations + Security

- [ ] **add_security_hardening** 🟡
  - Title: Production security hardening
  - Action: Update `backend/config/settings.py`:
    - CSRF: `CSRF_COOKIE_SECURE=True`, `CSRF_TRUSTED_ORIGINS=[...]`
    - HSTS: `SECURE_HSTS_SECONDS=31536000`, `SECURE_HSTS_INCLUDE_SUBDOMAINS=True`
    - SSL: `SECURE_SSL_REDIRECT=True`, `SESSION_COOKIE_SECURE=True`
    - CORS: `CORS_ALLOWED_ORIGINS` restricted to prod domains
    - Rate limiting: `django-ratelimit` on auth endpoints (5 req/min)
  - Verify: HTTPS redirect works; auth endpoints rate-limited after 5 attempts
  - Commit: `git add backend/config/settings.py && git commit -m "feat(m8): add security hardening (HSTS, CORS, rate limiting)"`

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
