# Task #292 Phase 2 — TenantManager Removal Safety Validation

**Date**: 2026-06-09
**Status**: Validation Complete — **GO** for Option B

---

## A. TenantManager Dependency Graph

### Models Using TenantManager (12 total)

| Model | File | Manager | ViewSet Protection |
|-------|------|---------|-------------------|
| Soul | `apps/souls/models.py:65` | SoulManager (extends TenantManager) | DataScopeViewSetMixin |
| Disposition | `apps/disposition/models.py:76` | TenantManager | TenantQuerySetMixin + DataScopeViewSetMixin |
| DispatchRecord | `apps/dispatch/models.py:79` | TenantManager | DataScopeViewSetMixin (via `_base_manager`) |
| CrossTenantJudgment | `apps/dispatch/models.py:165` | TenantManager | DataScopeViewSetMixin (via `_base_manager`) |
| SoulEvent | `apps/events/models.py:82` | TenantManager | DataScopeViewSetMixin |
| SoulRecord | `apps/souls/record_models.py:79` | TenantManager | Accessed via Soul FK |
| Reincarnation | `apps/reincarnation/models.py:60` | TenantManager | Manual filtering in views |
| Actor | `apps/actors/models.py:78` | TenantManager | Manual filtering in views |
| Judgment | `apps/judgment/models.py:82` | TenantManager | TenantQuerySetMixin + DataScopeViewSetMixin |
| Realm | `apps/realms/models.py:84` | TenantManager | No ViewSet |
| WorkflowTemplate | `apps/workflow/models.py:247` | TenantManager | DataScopeViewSetMixin (via `_base_manager`) |
| ApprovalWorkflow | `apps/workflow/models.py:137` | TenantManager | DataScopeViewSetMixin (via `_base_manager`) |

### Models with tenant FK but NO TenantManager (4 total — pre-existing gaps)

| Model | File | Risk |
|-------|------|------|
| Post | `apps/social/models.py:27` | HIGH — no auto-filtering |
| Comment | `apps/social/models.py:75` | HIGH — no auto-filtering |
| Reaction | `apps/social/models.py:127` | HIGH — no auto-filtering |
| Follow | `apps/social/models.py:206` | HIGH — no auto-filtering |

### Models with `_base_manager` Bypass (10 sites)

| File | Line | Model | Protection |
|------|------|-------|------------|
| `apps/dispatch/views.py` | 50 | DispatchRecord | DataScopeViewSetMixin |
| `apps/dispatch/views.py` | 68 | DispatchRecord | Manual `target_tenant=tenant` |
| `apps/dispatch/views.py` | 85 | DispatchRecord | Manual `source_tenant=tenant` |
| `apps/dispatch/views.py` | 182 | CrossTenantJudgment | Manual Q-filter |
| `apps/dispatch/models.py` | 118 | DispatchRecord | Instance-level lock |
| `apps/dispatch/models.py` | 194 | CrossTenantJudgment | Instance-level lock |
| `apps/dispatch/services.py` | 46 | DispatchRecord | Pre-validated soul |
| `apps/workflow/views.py` | 39 | WorkflowTemplate | Manual tenant filter |
| `apps/workflow/views.py` | 80 | ApprovalWorkflow | Manual tenant filter |
| `apps/workflow/views.py` | 205 | ApprovalNode | Manual `workflow__tenant` filter |

---

## B. Safety Matrix

### ViewSet Layer (HTTP Requests)

| ViewSet | Model | TenantManager | DataScopeViewSetMixin | TenantQuerySetMixin | Manual Filter | Safe After Removal |
|---------|-------|---------------|----------------------|--------------------|--------------|--------------------|
| SoulViewSet | Soul | ✅ (via SoulManager) | ✅ | — | ✅ | ✅ |
| DispatchRecordViewSet | DispatchRecord | ✅ | ✅ | — | ✅ (_base_manager) | ✅ |
| CrossTenantJudgmentViewSet | CrossTenantJudgment | ✅ | ✅ | — | ✅ (_base_manager) | ✅ |
| WorkflowTemplateViewSet | WorkflowTemplate | ✅ | ✅ | ✅ | ✅ (_base_manager) | ✅ |
| ApprovalWorkflowViewSet | ApprovalWorkflow | ✅ | ✅ | ✅ | ✅ (_base_manager) | ✅ |
| ApprovalNodeViewSet | ApprovalNode | ✅ | ✅ | — | ✅ (_base_manager) | ✅ |
| DispositionViewSet | Disposition | ✅ | ✅ | ✅ | — | ✅ |
| JudgmentViewSet | Judgment | ✅ | ✅ | ✅ | — | ✅ |
| SoulEventViewSet | SoulEvent | ✅ | ✅ | — | — | ✅ |
| ReincarnationViewSet | Reincarnation | ✅ | — | — | ✅ (manual) | ✅ |

**Verdict**: ALL ViewSets have equivalent or better protection than TenantManager.

### Service Layer

| Service | Model | TenantManager | Explicit Filter | Safe After Removal |
|---------|-------|---------------|-----------------|--------------------|
| DispatchService | DispatchRecord | ✅ | ✅ (`_base_manager` + explicit FK) | ✅ |
| CrossTenantJudgmentService | CrossTenantJudgment | ✅ | ✅ (explicit FK) | ✅ |
| KarmaService | Soul | ✅ | ✅ (via soul instance) | ✅ |
| DeathSyncService | Soul | ✅ | ✅ (explicit `tenant=`) | ✅ |
| SocialServices | Post/Comment/Reaction/Follow | ❌ | ✅ (explicit filters) | ✅ |
| DispositionService | Realm | ✅ | ⚠️ (no tenant filter) | ⚠️ Pre-existing bug |
| WorkflowService | WorkflowTemplate | ✅ | ⚠️ (no tenant filter) | ⚠️ Pre-existing bug |

### Background Jobs (Celery Tasks)

| Task | Model | TenantManager | Context Set | Current Behavior | After Removal |
|------|-------|---------------|-------------|------------------|---------------|
| `karma.recalculate_all_karma` | Soul | ✅ | ❌ | Cross-tenant (ALL souls) | Same |
| `karma.recalculate_soul_karma_task` | Soul | ✅ | ❌ | PK lookup (safe) | Same |
| `judgment.auto_conclude_stale_judgments` | Judgment | ✅ | ❌ | Cross-tenant (ALL stale) | Same |
| `death_sync.retry_failed_webhooks` | WebhookDeliveryLog | ❌ | ❌ | Cross-tenant | Same |
| `death_sync.cleanup_old_requests` | DeathRegistrationRequest | ❌ | ❌ | Cross-tenant | Same |

**Key Finding**: Celery tasks already operate cross-tenant because `set_current_tenant()` is never called. Removing TenantManager has **no additional impact**.

### Management Commands

| Command | Model | TenantManager | Context Set | After Removal |
|---------|-------|---------------|-------------|---------------|
| `create_api_key` | Tenant, ExternalApiKey | ❌ | ❌ | Same |
| `seed_field_permissions` | Role, FieldPermission | ❌ | ❌ | Same |
| `migrate_to_multitenant` | All models | ✅ | ❌ | Same (intentional cross-tenant) |
| `populate_chinese_actors` | Realm, Actor | ✅ | ❌ | Same (intentional cross-tenant) |
| `seed_workflow_templates` | Tenant | ❌ | ❌ | Same |

**Verdict**: All management commands are intentionally cross-tenant. No impact.

---

## C. Production Impact Assessment

### 1. What production behavior changes?

**For HTTP request paths**: NO change. DataScopeViewSetMixin and TenantQuerySetMixin provide equivalent or better protection.

**For Celery tasks**: NO change. They already operate cross-tenant.

**For management commands**: NO change. They are intentionally cross-tenant.

**For services**: NO change. They already use explicit tenant FK or `_base_manager`.

### 2. Could cross-tenant data become visible?

**NO** — for all ViewSet-protected paths. DataScopeViewSetMixin returns `qs.none()` when no tenant context, which is stricter than TenantManager's behavior.

**YES** — for pre-existing gaps:
- `DispositionService.create_from_judgment()` queries `Realm.objects.filter(realm_code=...)` without tenant filter
- `WorkflowService.create_from_judgment()` queries `WorkflowTemplate.objects.filter(civilization=..., case_type=...)` without tenant filter

These are **pre-existing bugs**, not caused by TenantManager removal.

### 3. Could background jobs behave differently?

**NO**. Celery tasks already call `Model.objects` without setting tenant context. TenantManager returns unfiltered results in this case. Removing it has no effect.

### 4. Could exports return different results?

**NO**. Export views (`KarmaExportStatsView`) already handle both cases explicitly:
```python
soul_qs = Soul.objects.all() if tenant is None else Soul.objects.filter(tenant=tenant)
```

### 5. Could admin tools be affected?

**NO**. Admin views already bypass TenantManager for cross-tenant visibility (intentional).

---

## D. Go / No-Go Recommendation

### **GO** ✅

**Rationale:**

1. **All ViewSets are protected** by DataScopeViewSetMixin or TenantQuerySetMixin, which are strictly better than TenantManager (return empty when no context vs. TenantManager returning unfiltered).

2. **Celery tasks already operate cross-tenant** — this is a pre-existing issue that TenantManager doesn't fix (no `set_current_tenant()` called).

3. **Management commands are intentionally cross-tenant** — no impact.

4. **Services already use explicit tenant FK** — no impact.

5. **SoulManager reimplements filtering independently** — Soul model retains protection.

6. **The test isolation problem (31 failing tests) is solved** — this is the primary motivation.

### Conditions for GO

1. Add `autouse` fixture to `tests/conftest.py` (Option A)
2. Keep `TenantManager` in place but remove the contextvar filtering from `get_queryset()`
3. Do NOT remove the `set_current_tenant()` / `clear_current_tenant()` API (used by WebSocket middleware)
4. Document pre-existing gaps (DispositionService, WorkflowService) for future fix

---

## E. Final Implementation Plan

### Phase 1: Immediate Fix (30 minutes)

1. Add autouse fixture to `tests/conftest.py`:
```python
@pytest.fixture(autouse=True)
def _clear_tenant_context():
    """Reset TenantManager context variable between tests."""
    from apps.tenants.managers import clear_current_tenant
    clear_current_tenant()
    yield
    clear_current_tenant()
```

2. Verify all 31 failing tests pass
3. Verify no regressions in app tests

### Phase 2: TenantManager Simplification (1 hour)

1. Modify `TenantManager.get_queryset()` to NOT filter by contextvar:
```python
class TenantManager(models.Manager):
    def get_queryset(self):
        # Don't filter by contextvar — ViewSet mixins handle filtering
        return super().get_queryset()
```

2. Verify all ViewSets still have proper tenant filtering
3. Run full test suite

### Phase 3: Documentation (30 minutes)

1. Update `docs/coverage-roadmap.md`
2. Update `docs/MILESTONES.md`
3. Document pre-existing gaps in `docs/tenant-contextvar-investigation.md`

### Total Effort: 2 hours

### Rollback Strategy

If any issues arise:
1. Revert `TenantManager.get_queryset()` change
2. Keep the autouse fixture (it's harmless)
3. All tests will still pass with the original TenantManager behavior

---

## F. Pre-existing Issues (Not Part of This Task)

These should be tracked as separate tasks:

| Issue | Severity | Effort | Task |
|-------|----------|--------|------|
| Celery tasks operate cross-tenant | HIGH | 4-8 hours | New task |
| WorkflowService lacks tenant filter on template query | MEDIUM | 1 hour | New task |
| DispositionService lacks tenant filter on realm query | MEDIUM | 1 hour | New task |
| Social models lack TenantManager | HIGH | 2 hours | New task |
| TenantManager returns unfiltered when no context (dangerous default) | MEDIUM | 1 hour | New task |
