# Security Closure Report


> ### Follow-up — 2026-08-28
>
> The "Tenant bypass for non-ADMIN ✅ Clean — No bypass paths found" row was **overturned on
> 2026-08-07** by the multi-tenant audit in [`docs/MILESTONE_M15.md`](MILESTONE_M15.md), which
> found 4 CRITICAL, 4 HIGH and 15 MEDIUM tenant-isolation findings in this same codebase. This
> closure only looked at DRF ViewSets and `AllowAny`; the gaps were in the **service layer and
> Celery tasks**, which it never examined — including `death_sync.cleanup_old_requests`, a
> physical `DELETE` with no tenant boundary.
>
> Kept as the record of what was checked on 2026-05-30. The current state is `git log`.

**Date**: 2026-05-30
**Status**: ✅ All P0 Security Items Resolved

---

## Summary

| Category | Status | Details |
|----------|--------|---------|
| EventService tenant | ✅ Fixed | `tenant=soul.tenant` added |
| TenantPermission | ✅ Fixed | Added to 4 ViewSets |
| HealthCheckDetailed | ✅ Fixed | Requires ADMIN auth |
| Redis KEYS | ✅ Fixed | Replaced with SCAN |
| AllowAny on sensitive endpoints | ✅ Clean | All AllowAny on auth endpoints only |
| Tenant bypass for non-ADMIN | ✅ Clean | No bypass paths found |
| RBAC chain integrity | ✅ Intact | CodenameViewSetMixin → Middleware → check_permission |

## Remaining Low-Priority Items

| Item | Severity | Recommendation |
|------|----------|----------------|
| Legacy FBVs in menus use IsAuthenticated | Low | Consolidate with ViewSets |
| Manual ADMIN checks (30+ locations) | Medium (architectural) | Standardize in future refactor |
| Login failures not in AuditLog | Low | Add AuditLog entry for failed logins |

## Verification

- Backend: 366 tests passed
- No AllowAny on sensitive endpoints
- No tenant bypass for non-ADMIN users
- RBAC chain intact for all class-based ViewSets
