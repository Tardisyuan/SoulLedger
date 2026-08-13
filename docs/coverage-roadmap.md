# Backend Test Coverage Roadmap

## Current State (Updated: 2026-08-13)

| Metric | Value |
|--------|-------|
| **Coverage** | **87.04%** |
| CI threshold (`--cov-fail-under` in `pytest.ini`) | 80% |
| Status | Threshold met ✅ |
| Suite | 1,949 passed, 16 skipped, 6 xpassed |

Measured by the full backend suite from the repo root:
`python -m pytest` (config in `pytest.ini`: `--cov=apps --cov-branch`). Individual runs land
between 86.3% and 87.0% depending on working-tree state.

These are a snapshot, not a live figure — re-measure before quoting them. `git log` is the
accurate record of project state (`README.md:339`).

> **History**: this document originally planned the climb from a 22.95% baseline to the then
> 40% CI floor. That plan was executed (M14 / Task #291) and the goal was overshot. The
> projection tables that drove it have been removed because they described a state the repo
> left behind; the sections below describe where coverage actually stands. The `karma` app
> referenced by the old tables has since been renamed `ledger`.

## Coverage by App

Production modules only — migrations and test files are excluded here, although the CI figure
above measures the whole `apps` package.

| App | Statements | Missed | Coverage |
|-----|-----------|--------|----------|
| judgment | 229 | 7 | 97% |
| authentication | 495 | 31 | 94% |
| permissions | 31 | 2 | 94% |
| souls | 1,565 | 111 | 93% |
| social | 583 | 43 | 93% |
| perm | 1,331 | 99 | 93% |
| events | 418 | 32 | 92% |
| dispatch | 525 | 41 | 92% |
| menus | 217 | 19 | 91% |
| reincarnation | 155 | 16 | 90% |
| disposition | 193 | 21 | 89% |
| realms | 124 | 16 | 87% |
| workflow | 462 | 60 | 87% |
| audit | 495 | 78 | 84% |
| death_sync | 637 | 108 | 83% |
| ledger | 728 | 127 | 83% |
| core | 676 | 139 | 79% |
| notifications | 190 | 42 | 78% |
| tenants | 188 | 77 | 59% |
| org | 112 | 52 | 54% |
| actors | 398 | 265 | 33% |
| **Total (production)** | **9,752** | **1,386** | **86%** |

The earlier "views/serializers/services are at 0% across most apps" pattern no longer holds —
those layers now carry API integration tests in every app.

## Remaining Gaps

Ranked by uncovered statements. Not all of these are worth closing.

| Module | Stmts | Missed | Cover | Note |
|--------|-------|--------|-------|------|
| `actors/management/commands/*` | 254 | 254 | 0% | One-off data-seeding/migration commands; low value to test |
| `tenants/management/commands/migrate_to_multitenant.py` | 53 | 53 | 0% | Same — a one-time migration script |
| `org/management/commands/init_organizations.py` | 36 | 36 | 0% | Same |
| `ledger/serializers.py` | 62 | 62 | 0% | **Real gap** — serializer validation untested |
| `ledger/filters.py` | 40 | 40 | 0% | **Real gap** |
| `audit/signals.py` | 290 | 51 | 81% | Signal branches not exercised |
| `notifications/consumers.py` | 98 | 40 | 59% | WebSocket consumer paths |
| `death_sync/webhook_service.py` | 83 | 39 | 48% | **Real gap** — outbound webhook retry/failure paths |
| `workflow/views.py` | 141 | 39 | 68% | Custom actions |
| `perm/export.py` | 57 | 35 | 29% | Export path |
| `souls/filters.py` / `souls/querysets.py` | 129 | 56 | 43-53% | Filter/queryset branches |

`actors` reads low (33%) almost entirely because of the untested management commands; its
models and views are covered.

Priority order if this is picked up: `ledger/serializers.py` + `ledger/filters.py` (untested
validation on a core app), then `death_sync/webhook_service.py` (failure paths in an external
integration), then `notifications/consumers.py`.

## Test Pattern Reference

```python
# API integration test pattern (from apps/social/tests/test_views.py)
def _jwt_client(user, tenant):
    """APIClient authenticated via JWT carrying the tenant_code claim,
    so TenantMiddleware sets request.tenant."""
    client = APIClient()
    token = RefreshToken.for_user(user)
    token["tenant_code"] = tenant.code
    client.credentials(HTTP_AUTHORIZATION=f"Bearer {token.access_token}")
    return client


@pytest.mark.django_db
class TestPostCRUD:
    @pytest.fixture(autouse=True)
    def setup(self, db):
        self.tenant = Tenant.objects.get_or_create(
            code="VP_T1", defaults={"display_name": "Post View Tenant"}
        )[0]
        self.user = User.objects.create_user(
            username="test", password="test123", role="ADMIN", tenant=self.tenant
        )
        self.client = _jwt_client(self.user, self.tenant)

    def test_list_empty(self):
        resp = self.client.get("/api/v1/social/posts/")
        assert resp.status_code == status.HTTP_200_OK
        assert resp.data["count"] == 0
```

Note: backend tests live in two places — `backend/apps/*/tests.py` and `backend/tests/`.
Running only one of them gives a misleadingly green result.

## Files

- `docs/coverage-roadmap.md` — This document
- `docs/post-coverage-audit-report.md` — Task #291 audit (2026-06-09); its 70.24% figure is
  superseded by the numbers above
- `docs/MILESTONES.md` — References this as future work
