"""A create must leave a tenant on the row — checked by creating one, not by
reading the class's bases.

Why this file exists
--------------------
`tests/test_every_writable_audit_viewset_sets_the_user.py` walks the URLconf and
asserts `issubclass(cls, AuditUserViewSetMixin)`. `TenantCreateMixin` had no
equivalent at all, and even the audit one asks the wrong question: inheriting a
mixin does not mean the mixin runs.

Measured 2026-09-07, all three found by an audit rather than by a test:

* `JudgmentViewSet` **lists** `TenantCreateMixin` among its bases and then
  overrides `perform_create` with a bare `serializer.save()`. The mixin was
  never in the call path. Every Judgment was written with `tenant = NULL`.
* `DispositionViewSet` and `ReincarnationViewSet` did not inherit it at all,
  and neither serializer declares a `tenant` field, and neither model overrides
  `save()`. Nothing was going to fill the column.

`tenant` is `null=True` on these models (18 of 25 tenant FKs are), so the
database accepted every one of these rows. The damage is on the read side:
`scope_to_tenant` filters `tenant=X`, and SQL NULL matches no value, so the row
became invisible to the tenant that created it. For Judgment that is worse than
a lost row — `perform_create` also calls `soul.transition_to(JUDGING)`, so the
soul left ALIVE while nobody in that tenant could see the case to conclude it.

Why the existing tests were green: `tests/test_judgment_api.py:55-62` builds both
of its clients with `role="ADMIN"`, and ADMIN bypasses scoping entirely
(`apps/core/tenant.py:19-27`). A defect that only shows for non-ADMIN callers
cannot be seen through an ADMIN client.

Why this is a POST and not an introspection
-------------------------------------------
The bases-based question is what let this through: `JudgmentViewSet` would have
passed an `issubclass` check on the day it was writing NULLs. So this file
issues a real authenticated POST as a non-ADMIN and reads the stored row back.

What "would really fail" means here
-----------------------------------
Each case was checked by reverting its fix and watching this file go red:

* dropping `super()` from `JudgmentViewSet.perform_create` reddened
  `test_a_judgment_created_by_a_judge_carries_the_tenant` (since 2026-10-30 the row is written by
  `JudgmentService.open_case`; filing it under `tenant=None` there reddens the same test);
* removing `TenantCreateMixin` from `DispositionViewSet` reddens
  `test_a_disposition_created_by_a_judge_carries_the_tenant`;
* `ReincarnationViewSet` lost its create route on 2026-10-27 (the record is
  read-only; review business #8), so `TenantCreateMixin` went with it. Its one
  writer, `ReincarnationService.complete_rebirth`, stamps `tenant=soul.tenant`
  itself; dropping that keyword reddens
  `test_a_rebirth_carries_the_souls_tenant`.
"""

import pytest

from apps.disposition.models import Disposition
from apps.judgment.models import Judgment
from apps.reincarnation.models import Reincarnation
from apps.souls.models import Soul, SoulState


@pytest.fixture
def cn_soul(cn_tenant):
    # `civilization` is a derived property on Soul (read from the tenant), not a
    # settable field.
    return Soul.objects.create(name="租户戳记探针", tenant=cn_tenant, current_state=SoulState.ALIVE)


@pytest.mark.django_db
class TestCreateStampsTheTenant:
    """Each test POSTs as a non-ADMIN and reads the row back from the database.

    Reading the row rather than the response matters: the response is rendered
    by a serializer that does not include `tenant` on two of these three, so a
    NULL would not have shown up there either.
    """

    def test_the_probe_is_not_vacuous(self, judge_user, cn_tenant, cn_soul):
        """Guard the guard: a non-ADMIN judge, a soul, and a tenant must exist."""
        assert judge_user.role != "ADMIN"
        assert judge_user.tenant_id == cn_tenant.pk
        assert cn_soul.tenant_id == cn_tenant.pk

    def test_a_judgment_created_by_a_judge_carries_the_tenant(
        self, api_client, auth_headers, cn_tenant, cn_soul
    ):
        from tests.city_god_support import default_city_god
        default_city_god(cn_tenant)  # 地府开案要有城隍收案(no_city_god)
        res = api_client.post(
            "/api/v1/judgment/",
            {"soul": str(cn_soul.id), "civilization": cn_soul.civilization},
            format="json",
            **auth_headers,
        )
        assert res.status_code == 201, res.data
        row = Judgment.all_objects.get(id=res.data["id"])
        assert row.tenant_id == cn_tenant.pk, (
            "Judgment was created with tenant=NULL; scope_to_tenant will hide it "
            "from the tenant that created it, while the soul has already moved "
            "to JUDGING."
        )

    def test_a_disposition_created_by_a_judge_carries_the_tenant(
        self, api_client, auth_headers, cn_tenant, cn_soul
    ):
        judgment = Judgment.objects.create(
            soul=cn_soul, civilization=cn_soul.civilization, court="第一殿", tenant=cn_tenant
        )
        res = api_client.post(
            "/api/v1/disposition/",
            {"soul": str(cn_soul.id), "judgment": str(judgment.id)},
            format="json",
            **auth_headers,
        )
        assert res.status_code == 201, res.data
        row = Disposition.all_objects.get(id=res.data["id"])
        assert row.tenant_id == cn_tenant.pk

    def test_a_rebirth_carries_the_souls_tenant(self, cn_tenant, cn_soul):
        from apps.reincarnation.services import ReincarnationService

        cn_soul.current_state = SoulState.REINCARNATING
        cn_soul.save(update_fields=["current_state"])
        row = ReincarnationService.complete_rebirth(soul=cn_soul, new_identity="下一世")
        assert Reincarnation.all_objects.get(pk=row.pk).tenant_id == cn_tenant.pk
