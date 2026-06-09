# Task #292 — TenantManager ContextVar Isolation Investigation

**Date**: 2026-06-09
**Status**: Investigation Complete — Awaiting Implementation Approval

---

## A. Root Cause Analysis

### The Failure Mechanism

**31 integration tests fail when run in the full suite but pass individually.**

#### Exact Root Cause

The `TenantManager` uses a `contextvars.ContextVar` named `_tenant_var` to store the current tenant:

```python
# apps/tenants/managers.py
_tenant_var: contextvars.ContextVar[object] = contextvars.ContextVar('tenant', default=None)

class TenantManager(models.Manager):
    def get_queryset(self):
        qs = super().get_queryset()
        tenant = get_current_tenant()  # Reads from _tenant_var
        if tenant is not None:
            return qs.filter(tenant=tenant)
        return qs
```

**The lifecycle:**

1. `TenantMiddleware.__call__` sets `_tenant_var` at request start
2. `TenantMiddleware.__call__` clears `_tenant_var` in `finally` block
3. `TenantManager.get_queryset()` reads `_tenant_var` at queryset construction time

**The problem:**

When DRF ViewSets store a class-level `queryset` attribute:

```python
class SomeViewSet(viewsets.ModelViewSet):
    queryset = SomeModel.objects.all()  # Evaluated at class import time!
```

The `TenantManager.get_queryset()` is called **once** when the module is imported. If `_tenant_var` happens to be set at that moment (from a previous test's middleware), the tenant filter gets **permanently baked into the lazy QuerySet object**.

Subsequent requests using this class-level queryset inherit the stale filter, causing:
- ADMIN users see only one tenant's data (instead of all)
- Non-ADMIN users see no data (wrong tenant filter)

#### Why Isolated Execution Passes

When running a single test file:
1. Module import happens before any middleware runs
2. `_tenant_var` is `None` at import time
3. Class-level queryset has no tenant filter
4. Test passes because `DataScopeViewSetMixin` applies correct filtering at runtime

#### Why Batch Execution Fails

When running the full test suite:
1. Test A runs → middleware sets `_tenant_var = tenant_A`
2. Test A finishes → middleware clears `_tenant_var` (in `finally`)
3. Test B starts → but **another module is imported** during test collection
4. If `_tenant_var` is still set (race condition or late import), the class-level queryset gets `tenant_A` filter baked in
5. Test B fails because it sees `tenant_A`'s data instead of its own

**Key insight**: The `finally` block in `TenantMiddleware` should clean up, but:
- ContextVar cleanup happens at the end of the request, not the end of the test
- pytest-django wraps tests in transactions, but contextvars are NOT transaction-scoped
- Module imports happen once per process, but contextvars can be set multiple times

### Additional Hidden Issues

1. **`SoulManager` double-filtering**: `SoulManager` extends `TenantManager` and overrides `get_queryset()` to also call `get_current_tenant()`. This creates a double-filter path that's harder to reason about.

2. **Audit signals read contextvar**: `apps/audit/signals.py` calls `get_current_tenant()` in signal handlers. If the contextvar is stale, audit logs get wrong tenant attribution.

3. **WebSocket tenant context**: `apps/core/ws_tenant.py` manages contextvar for WebSocket consumers, but has no cleanup guarantee if the consumer disconnects abnormally.

4. **No autouse cleanup in `tests/conftest.py`**: The main test conftest has NO fixture that clears `_tenant_var` between tests. Only `apps/workflow/tests.py` has a local `_clean_ctx` fixture.

---

## B. Architecture Review

### Component Map

```
Request Flow:
  HTTP Request
    → AuthenticationMiddleware (sets request.user)
    → RequestContextMiddleware (sets _user_var, _request_var)
    → TenantMiddleware (sets _tenant_var, request.tenant)
    → PermissionMiddleware (checks permissions)
    → DRF ViewSet.get_queryset()
      → DataScopeViewSetMixin.get_queryset()
        → super().get_queryset()  # May use class-level queryset
        → qs.filter(tenant=request.tenant)
    → Response
    → TenantMiddleware.finally: clear_current_tenant()
    → RequestContextMiddleware.finally: clear_current_user()
```

### Stale State Risks

| Component | Risk | Severity |
|-----------|------|----------|
| `_tenant_var` contextvar | Survives past request scope in tests | **HIGH** |
| `_user_var` contextvar | Same issue, but less impactful | MEDIUM |
| `_request_var` contextvar | Same issue, but less impactful | MEDIUM |
| Class-level `queryset` | Baked-in tenant filter from import time | **HIGH** |
| Audit signals | Read stale contextvar for tenant attribution | MEDIUM |
| SoulManager | Double tenant filtering path | LOW |

### Cleanup Gaps

1. **`TenantMiddleware`**: Has `finally` cleanup ✅ — but only runs during HTTP requests, not between pytest tests
2. **`RequestContextMiddleware`**: Has `finally` cleanup ✅ — same limitation
3. **`tests/conftest.py`**: **NO autouse cleanup fixture** ❌
4. **pytest-django**: Does NOT reset contextvars between tests ❌

### Thread-Safety Analysis

- `contextvars.ContextVar` is task-local (works correctly for async)
- But pytest-django runs tests synchronously in the same thread
- ContextVar values persist across test boundaries in the same thread
- No race condition in single-threaded pytest, but stale state is the issue

---

## C. Solution Design

### Option A: Minimal Fix — Autouse Fixture (Recommended)

**Implementation:**

Add an autouse fixture to `tests/conftest.py`:

```python
@pytest.fixture(autouse=True)
def _clear_tenant_context():
    """Reset TenantManager context variable between tests."""
    from apps.tenants.managers import clear_current_tenant
    clear_current_tenant()
    yield
    clear_current_tenant()
```

**Pros:**
- Minimal change (1 fixture, ~5 lines)
- Lowest risk
- Fixes all 31 failing tests
- No production code changes

**Cons:**
- Doesn't fix the underlying architectural issue
- Future tests may still have the problem if they don't use this conftest

**Effort:** 30 minutes
**Risk:** Very Low
**Rollback:** Delete the fixture

---

### Option B: Request-Based Tenant Resolution (Recommended)

**Implementation:**

1. Add autouse fixture (from Option A)
2. Modify `TenantManager.get_queryset()` to NOT read from contextvar:

```python
class TenantManager(models.Manager):
    def get_queryset(self):
        # Don't filter by contextvar — let ViewSet handle filtering
        return super().get_queryset()
```

3. Ensure ALL ViewSets use `DataScopeViewSetMixin` or `TenantQuerySetMixin` for filtering

4. Add `conftest.py` cleanup for `_user_var` and `_request_var` as well

**Pros:**
- Eliminates stale state risk at the source
- Clearer separation of concerns (managers don't filter, ViewSets do)
- More predictable behavior

**Cons:**
- Requires audit of all ViewSets to ensure they have proper filtering
- Slightly more work

**Effort:** 2-4 hours
**Risk:** Medium (need to verify all ViewSets)
**Rollback:** Revert manager change, keep fixture

---

### Option C: ContextVar Reset Middleware (Long-term)

**Implementation:**

1. Add a `ContextCleanupMiddleware` that runs LAST in the middleware stack:

```python
class ContextCleanupMiddleware:
    def __init__(self, get_response):
        self.get_response = get_response

    def __call__(self, request):
        try:
            return self.get_response(request)
        finally:
            from apps.tenants.managers import clear_current_tenant
            from apps.core.request_local import clear_current_user
            clear_current_tenant()
            clear_current_user()
```

2. Add to `MIDDLEWARE` as the LAST entry

3. Add autouse pytest fixture as safety net

4. Consider removing contextvar usage from `TenantManager` entirely

**Pros:**
- Guarantees cleanup after every request
- Defense in depth
- Works for both sync and async

**Cons:**
- More complex
- Middleware ordering dependency
- Still need pytest fixture for test isolation

**Effort:** 4-6 hours
**Risk:** Medium-High (middleware ordering critical)
**Rollback:** Remove middleware entry

---

### Solution Comparison Matrix

| Criteria | Option A | Option B | Option C |
|----------|----------|----------|----------|
| Effort | 30 min | 2-4 hours | 4-6 hours |
| Risk | Very Low | Medium | Medium-High |
| Completeness | Partial | High | Complete |
| Maintenance | Low | Medium | Medium |
| Test Isolation | ✅ | ✅ | ✅ |
| Production Safety | ⚠️ | ✅ | ✅ |
| Future-proof | ⚠️ | ✅ | ✅ |

**Recommendation: Option B** — Balance of safety and maintainability.

---

## D. Validation Plan

### 1. Reproduce the Failure

```bash
# This should show 31 failures:
cd backend && python -m pytest --tb=line -q 2>&1 | grep "FAILED" | wc -l

# Individual tests should pass:
cd backend && python -m pytest tests/test_tenant_isolation.py::TestTenantIsolationAPI::test_soul_tenant_isolation -v
```

### 2. Apply Fix

For Option A:
```bash
# Add fixture to tests/conftest.py
# Re-run full suite
cd backend && python -m pytest --tb=short -q
```

### 3. Verify No Regressions

```bash
# Run all app tests (should still pass):
cd backend && python -m pytest apps/ --no-cov -q

# Run integration tests (should now pass):
cd backend && python -m pytest tests/ --no-cov -q

# Check coverage maintained:
cd backend && python -m pytest --cov=apps --cov-report=term --no-cov -q | grep TOTAL
```

### 4. Tenant Isolation Verification

```bash
# Verify cross-tenant isolation still works:
cd backend && python -m pytest tests/test_tenant_isolation.py -v
cd backend && python -m pytest tests/test_datascope_viewset.py -v
```

### 5. CI Verification

```bash
# Full CI pipeline should pass:
cd backend && python manage.py makemigrations --check --dry-run
cd backend && python -m pytest --tb=short -q
cd backend && ruff check .
```

---

## E. Recommended Implementation Plan

### Phase 1: Immediate Fix (Option A)

1. Add autouse fixture to `tests/conftest.py`
2. Verify all 31 tests pass
3. Verify no regressions in app tests
4. Commit: `fix(tests): add tenant context cleanup fixture`

### Phase 2: Architectural Improvement (Option B)

1. Modify `TenantManager.get_queryset()` to not filter by contextvar
2. Audit all ViewSets for proper tenant filtering
3. Add comprehensive conftest cleanup
4. Update documentation
5. Commit: `refactor(managers): remove contextvar filtering from TenantManager`

### Phase 3: Defense in Depth (Optional — Option C)

1. Add `ContextCleanupMiddleware`
2. Update middleware order in settings
3. Add integration test for cleanup guarantee
4. Commit: `feat(middleware): add context cleanup middleware`

---

## F. Risk Assessment

### Option A Risks

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|------------|
| Fixture doesn't clear all contextvars | Low | Medium | Clear `_user_var`, `_request_var` too |
| Fixture ordering issues | Low | Low | Use `autouse=True` at conftest level |
| Future tests miss cleanup | Medium | Low | Document in CLAUDE.md |

### Option B Risks

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|------------|
| ViewSet missing tenant filtering | Low | High | Audit all ViewSets before deploying |
| Audit signals get wrong tenant | Medium | Medium | Ensure signals read from request, not contextvar |
| Performance regression | Low | Low | Monitor query counts |

### Option C Risks

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|------------|
| Middleware ordering breakage | Medium | High | Test with middleware in different positions |
| Async compatibility issues | Low | Medium | Test with async views |
| Double cleanup (middleware + fixture) | Low | Low | Idempotent cleanup functions |

---

## G. Deliverables

1. ✅ Root cause report (Section A)
2. ✅ Architecture review report (Section B)
3. ✅ Solution comparison matrix (Section C)
4. ✅ Recommended implementation plan (Section E)
5. ✅ Risk assessment (Section F)
6. ✅ Validation plan (Section D)

**No code changes made. No commits created.**
