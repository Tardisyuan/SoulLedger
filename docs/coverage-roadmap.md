# Backend Test Coverage Roadmap

## Current State (Updated: 2026-06-09)

| Metric | Value |
|--------|-------|
| Total statements | 9,464 |
| Missed statements | 2,341 |
| **Coverage** | **70.24%** |
| CI threshold | 40% |
| Gap to close | **Achieved** ✅ |
| Tests collected | 1,209 |
| New tests (Task #291) | 322 |

## Coverage by App (Key Files)

| App | models.py | views.py | services.py | serializers.py |
|-----|-----------|----------|-------------|----------------|
| souls | 33% | 0% | — | 0% |
| judgment | 90% | 0% | 0% | 0% |
| social | 54% | 0% | 30% | 0% |
| karma | 100% | 0% | 0% | 0% |
| dispatch | 58% | 0% | 24% | 0% |
| workflow | 63% | 0% | 14% | 0% |
| death_sync | 90% | — | 14% | — |
| disposition | 94% | 0% | 24% | 0% |
| reincarnation | 97% | 0% | 18% | 0% |
| actors | 68% | 0% | — | 0% |
| realms | 78% | 0% | — | 0% |
| menus | 69% | 0% | — | 0% |
| perm | 62% | 0% | — | 0% |
| audit | 97% | 0% | — | 0% |
| events | 98% | 0% | 42% | 0% |
| notifications | 77% | 0% | — | 0% |
| org | 47% | 0% | — | 0% |
| tenants | 94% | 0% | — | 0% |
| authentication | 95% | — | — | — |
| permissions | 95% | — | — | — |

**Pattern**: Models have decent coverage (50-100%), but views/serializers/services are at 0% across most apps.

## Highest ROI Targets

To reach 40% coverage, we need ~1,325 more statements covered.

### Tier 1: View Tests (Quick Wins)

| App | File | Stmts | Miss | Potential Gain |
|-----|------|-------|------|----------------|
| perm | views.py | 160 | 160 | +160 |
| dispatch | views.py | 150 | 150 | +150 |
| menus | views.py | 128 | 128 | +128 |
| karma | views.py | 120 | 120 | +120 |
| audit | views.py | 110 | 110 | +110 |
| workflow | views.py | 102 | 102 | +102 |
| souls | views.py | 75 | 75 | +75 |
| **Total** | | **845** | **845** | **+845** |

### Tier 2: Serializer Tests

| App | File | Stmts | Miss | Potential Gain |
|-----|------|-------|------|----------------|
| dispatch | serializers.py | 74 | 74 | +74 |
| souls | serializers.py | 60 | 60 | +60 |
| menus | serializers.py | 51 | 51 | +51 |
| workflow | serializers.py | 43 | 43 | +43 |
| karma | serializers.py | 38 | 38 | +38 |
| perm | serializers.py | 35 | 35 | +35 |
| **Total** | | **301** | **301** | **+301** |

### Tier 3: Service Tests

| App | File | Stmts | Miss | Potential Gain |
|-----|------|-------|------|----------------|
| dispatch | services.py | 109 | 83 | +83 |
| karma | services.py | 78 | 78 | +78 |
| workflow | services.py | 75 | 65 | +65 |
| **Total** | | **262** | **226** | **+226** |

## Coverage Projection

```
Current:   1,764 / 7,684 = 22.95%
After T1:  2,609 / 7,684 = 33.96%
After T2:  2,910 / 7,684 = 37.87%
After T3:  3,136 / 7,684 = 40.81% ✅
```

## Recommended Execution Order

1. **Phase 1: View Tests** (2-3 days)
   - Add API integration tests for views.py in perm, dispatch, menus, karma, audit, workflow, souls
   - Expected gain: +845 statements → 34% coverage

2. **Phase 2: Serializer Tests** (1-2 days)
   - Add serializer validation tests for dispatch, souls, menus, workflow, karma, perm
   - Expected gain: +301 statements → 38% coverage

3. **Phase 3: Service Tests** (1-2 days)
   - Add unit tests for dispatch, karma, workflow services
   - Expected gain: +226 statements → 41% coverage

**Total estimated effort: 4-7 days**

## Test Pattern Reference

```python
# API integration test pattern (from apps/social/tests/test_views.py)
@pytest.mark.django_db
class TestKarmaViewSet:
    @pytest.fixture(autouse=True)
    def setup(self, db):
        self.tenant = Tenant.objects.get_or_create(
            code="TEST", defaults={"display_name": "Test"}
        )[0]
        self.user = User.objects.create_user(
            username="test", password="test123", role="ADMIN", tenant=self.tenant
        )
        self.client = _jwt_client(self.user, self.tenant)

    def test_list_empty(self):
        resp = self.client.get("/api/v1/karma/")
        assert resp.status_code == status.HTTP_200_OK
        assert resp.data["count"] == 0
```

## Files

- `docs/coverage-roadmap.md` — This document
- `docs/MILESTONES.md` — References this as future work
