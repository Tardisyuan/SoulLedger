# Backend Test Coverage Roadmap

## Current State (Updated: 2026-08-28)

| Metric | Value |
|--------|-------|
| **Coverage** | **91.43%** |
| CI threshold (`--cov-fail-under` in `pytest.ini`) | 80% |
| Status | Threshold met ✅ |
| Suite | 2,694 passed, 9 skipped, 0 failed |

Measured 2026-08-28, exit code 0, **nothing excluded**:

```
redis-server --port 6399 --daemonize yes --save '' --appendonly no
cd backend && DATABASE_URL="sqlite:///:memory:" REDIS_URL="redis://127.0.0.1:6399/0" \
  CELERY_BROKER_URL="redis://127.0.0.1:6399/1" \
  CELERY_RESULT_BACKEND="redis://127.0.0.1:6399/2" \
  python -m pytest
```

THE WEBSOCKET EXCLUSION IS RETIRED, AND HOW IT SURVIVED IS THE POINT. Earlier
revisions of this file — and every measurement quoted in this repository through
2026-08-28 — ran with
`--ignore=tests/test_websocket.py --ignore=tests/test_websocket_m12.py`, on the stated
ground that those tests need a Redis the sandbox could not reach. That ground was
**disproved on 2026-08-27**: both `192.168.2.115:6379` and `:5432` answered in 0.00s.
The reason was struck from the project notes and the `--ignore` was left in place, so
the numbers kept being quoted from a deliberately narrowed suite for another day.

The two files hold **22 tests, not 18**, and they pass in twelve seconds against any
reachable Redis — including the throwaway local one above. `notifications/consumers.py`
is no longer an artefact row: it is measured.

**When a justification is withdrawn, withdraw what it was justifying.** Deleting only the
reason leaves a practice that now rests on nothing, and looks exactly like one that was
re-examined.

`DATABASE_URL="sqlite:///:memory:"` is still required locally; the default `.env` points at
the shared PostgreSQL and a stale `test_soulledger` database produces a wall of errors.
`REDIS_URL` needs overriding for a different reason — without it the suite writes
permission-cache keys into the production Redis. See `CLAUDE.md` → Build & Test.

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
| judgment | 450 | 16 | 96% |
| workflow | 543 | 22 | 96% |
| ledger | 428 | 25 | 94% |
| authentication | 491 | 31 | 94% |
| realms | 125 | 8 | 94% |
| permissions | 31 | 2 | 94% |
| social | 568 | 42 | 93% |
| menus | 227 | 17 | 93% |
| disposition | 249 | 19 | 92% |
| events | 418 | 32 | 92% |
| dispatch | 525 | 41 | 92% |
| reincarnation | 173 | 15 | 91% |
| souls | 1,004 | 91 | 91% |
| actors | 756 | 73 | 90% |
| perm | 657 | 88 | 87% |
| core | 617 | 90 | 85% |
| audit | 480 | 71 | 85% |
| org | 112 | 17 | 85% |
| death_sync | 623 | 107 | 83% |
| notifications | 188 | 75 | 60% |
| tenants | 183 | 76 | 58% |
| **Total (production)** | **8,848** | **958** | **89%** |

The earlier "views/serializers/services are at 0% across most apps" pattern no longer holds —
those layers now carry API integration tests in every app. `actors` no longer reads low either:
it was 33% while its management commands were untested, and is now 90%.

## Remaining Gaps

Ranked by uncovered statements. Not all of these are worth closing.

| Module | Stmts | Missed | Cover | Note |
|--------|-------|--------|-------|------|
| `notifications/consumers.py` | 98 | 40 | 59% | Measured with the WebSocket tests included. The 22% this row used to show was an artefact of excluding them — the exclusion is retired, so this is now a real figure |
| `tenants/management/commands/migrate_to_multitenant.py` | 53 | 53 | 0% | One-time migration script; low value to test |
| `audit/signals.py` | 290 | 53 | 80% | Signal branches not exercised |
| `death_sync/webhook_service.py` | 83 | 39 | 48% | **Real gap** — outbound webhook retry/failure paths |
| `perm/export.py` | 57 | 35 | 29% | Export path |
| `souls/filters.py` | 77 | 30 | 53% | Filter branches |
| `actors/mythology/seeding.py` | 150 | 29 | 78% | Seed-writer branches |
| `souls/querysets.py` | 52 | 26 | 42% | Queryset branches |
| `core/middleware.py` | 72 | 22 | 66% | Permission-decorator paths |
| `core/ws_permissions.py` | 35 | 19 | 44% | Same WebSocket exclusion as above |
| `disposition/views.py` | 45 | 16 | 59% | Custom actions |

The two entries this table carried on 2026-08-13 as its top **real** gaps — `ledger/serializers.py`
and `ledger/filters.py`, both listed at 0% — **no longer exist**; neither file is in
`backend/apps/ledger/`. Do not go looking for them.

Priority order if this is picked up: `death_sync/webhook_service.py` (failure paths in an
external integration), then `perm/export.py`, then `souls/querysets.py` / `souls/filters.py`.

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
