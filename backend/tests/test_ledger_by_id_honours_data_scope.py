"""A soul's ledger by id obeys the same row-level data scope as the souls list (security review 2026-10-27 #4).

Before, `/ledger/<kind>/<soul_id>/` filtered by hall only, so a role scoped to some souls could
read any in-hall soul's ledger by its UUID.
"""
import pytest

from apps.perm.models import Role, RowLevelDataScope
from apps.souls.models import Soul, SoulState
from tests.soul_account_support import officer_client

pytestmark = pytest.mark.django_db

KINDS = ("balance", "effective", "inheritance")


@pytest.fixture
def souls(cn_tenant):
    return (Soul.objects.create(name="在审", tenant=cn_tenant, current_state=SoulState.JUDGING),
            Soul.objects.create(name="在世", tenant=cn_tenant, current_state=SoulState.ALIVE))


def test_a_soul_outside_the_scope_is_404_and_one_inside_is_not(judge_user, souls):
    inside, outside = souls
    client = officer_client(judge_user)
    unscoped = {kind: client.get(f"/api/v1/ledger/{kind}/{outside.pk}/").status_code for kind in KINDS}
    assert all(code == 200 for code in unscoped.values()), unscoped  # the judge can read ledgers at all

    RowLevelDataScope.objects.create(
        role=Role.objects.get_or_create(name="JUDGE")[0], model_name="soul", scope_type="READ",
        filter_conditions={"current_state": SoulState.JUDGING}, is_active=True,
    )
    for kind in KINDS:
        assert client.get(f"/api/v1/ledger/{kind}/{outside.pk}/").status_code == 404, kind
        assert client.get(f"/api/v1/ledger/{kind}/{inside.pk}/").status_code == 200, kind
