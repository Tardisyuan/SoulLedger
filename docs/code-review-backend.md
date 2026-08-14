# SoulLedger Backend Code Review

> Date: 2026-05-27
> Scope: All backend apps — models, views, services, middleware

## Critical Bugs

### 1. Disposition Double State Transition
**File**: `backend/apps/disposition/views.py`
**Severity**: CRITICAL

`execute` action calls both `DispositionService.execute()` AND `ReincarnationService.execute()`. `DispositionService.execute()` transitions the soul to `REINCARNATING`, then `ReincarnationService.execute()` tries the same transition — which fails silently (state guard returns False) or causes inconsistent state.

```python
# Current (broken):
DispositionService.execute(disposition)   # → REINCARNATING
ReincarnationService.execute(disposition) # → REINCARNATING again, no-op or error
```

**Fix**: Remove `ReincarnationService.execute()` call, or restructure so `DispositionService.execute()` handles only routing and `ReincarnationService.execute()` handles the state transition.

### 2. `require_permission` Decorator — Undefined Variable
**File**: `backend/apps/core/middleware.py` (line ~194)
**Severity**: CRITICAL

The decorator references `view_instance` which is only available inside the `wrapped_view` closure, not at decorator definition time. This will raise `NameError` at runtime for certain view configurations.

```python
# Bug: view_instance not in scope here
if hasattr(view_instance, 'view_class'):
```

**Fix**: Move this check inside `wrapped_view` where `view_instance` is available.

### 3. Karma Double-Counting Risk
**File**: `backend/apps/reincarnation/services.py` (lines 74-75)
**Severity**: HIGH

`complete_rebirth()` applies 80% karma reduction (keeps 20%) AND `KarmaService.get_reincarnation_inheritance()` also calculates 20% inheritance. If both are used in sequence, karma could be reduced to 4% (20% × 20%) instead of the intended 20%.

```python
# reincarnation/services.py line 74-75:
new_merit = int(soul.merit_score * 0.2)    # keeps 20%
new_demerit = int(soul.demerit_score * 0.2)

# karma/services.py also calculates 20%:
inherited = int(parent_karma * 0.2)
```

**Fix**: Ensure only ONE of these reductions is applied, not both.

## High-Severity Issues

### 4. Karma N+1 Query Problem
**File**: `backend/apps/karma/views.py`, `KarmaOverviewStatsView`
**Severity**: HIGH (performance)

`state_breakdown` query runs inside a loop for each tenant, causing N+1 queries. With 3 tenants this is minor, but scales poorly.

```python
for tenant in tenants:
    # This runs a separate query per tenant
    state_breakdown = Soul.objects.filter(tenant=tenant).values(...)
```

**Fix**: Use a single query with `values('tenant', 'current_state').annotate(count=Count('id'))` and group in Python.

### 5. Karma Export Tenant Isolation Bypass
**File**: `backend/apps/karma/views.py`, `KarmaExportStatsView`
**Severity**: HIGH (security)

Admin check is duplicated (line 135 + 280). When admin, exports ALL souls bypassing tenant isolation — but the code comment suggests this is intentional. Verify this is desired behavior.

### 6. Events Ordering Fields Mismatch
**File**: `backend/apps/events/views.py` (line 19)
**Severity**: MEDIUM

`ordering_fields = ["created_at"]` but `SoulEvent` uses `create_time` from `AuditUserFields`. This will cause ordering to silently fail or error.

```python
# Current:
ordering_fields = ["created_at"]  # Wrong field name
# Should be:
ordering_fields = ["create_time"]
```

### 7. Authentication Reset Password Comment/Code Mismatch
**File**: `backend/apps/authentication/views.py`
**Severity**: LOW

Comment says "6-digit code" (line ~476) but code generates 8-digit code (line ~500). Not a bug, but confusing for maintainers.

## Medium-Severity Issues

### 8. Missing Notification Composite Index
**File**: `backend/apps/tenants/models.py` — `Notification` model
**Severity**: MEDIUM (performance)

Missing composite index on `(recipient, is_read)`. Most queries filter by both fields together.

**Fix**: Add `indexes = [models.Index(fields=["recipient", "is_read"])]` to Meta.

### 9. Manual Admin Checks vs IsAdminPermission
**File**: Multiple views (karma, authentication)
**Severity**: MEDIUM (code quality)

Views use `getattr(user, 'role', None) != 'ADMIN'` instead of using `IsAdminPermission` from `core/permissions.py`. This is inconsistent and harder to maintain.

### 10. Reincarnation Memory Reset Incomplete
**File**: `backend/apps/reincarnation/services.py`
**Severity**: MEDIUM

`complete_rebirth()` only clears `description`, doesn't handle `birth_name` or other identity fields. The `MemoryResetMechanism` in disposition models suggests a more complete reset was intended.

## Positive Patterns

- **Soul state machine**: Proper `select_for_update()` locking in `transition_to()` prevents race conditions
- **AuditUserFields**: Auto-populates create_user/update_user from thread-local, includes version field with optimistic locking
- **TenantManager**: Clean tenant-scoped querysets with thread-local request context
- **PermissionCache**: Redis-backed with memory fallback and cascade invalidation for descendant roles
- **KarmaService**: Time decay formula (`e^(-0.01×years)`) with Redis caching — well-implemented
- **DispositionService**: Civilization-specific routing with sensible formulas for tier/circle calculation
- **DispatchService**: Proper `transaction.atomic()` usage for cross-tenant operations
