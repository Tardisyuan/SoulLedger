"""第六十三批 二 f:`queue-counts/` 把「待认领」拆成 `claimable_count` 与 `held_count`。

此前组头的数是前端拿 `unclaimed` 减去本页候着的行,翻页数就变。现在服务端数:候着 = 认领会被拒的那几种
(到不了殿、过不了阿刻戎、候至未到;`claims.held_q`,与 `claims._assert_not_held` 同一条规则)。
"""
import datetime

import pytest
from django.utils import timezone

from apps.judgment import claims
from apps.judgment.models import Judgment
from apps.souls.models import Soul
from tests.test_judgment_claim import BASE, _case, world  # noqa: F401  (world is a fixture)


def _held_by_rule(judgment) -> bool:
    try:
        claims._assert_not_held(Judgment.all_objects.select_related("soul").get(pk=judgment.pk))
    except claims.ClaimRefusedError:
        return True
    return False


@pytest.fixture
def cases(world):  # noqa: F811
    today = timezone.localdate()
    made = {name: _case(world.cn, name=name) for name in (
        "free", "held_ahead", "held_past", "nameless", "embalming", "unferried", "ferried_long_ago", "claimed_held",
    )}

    def set_(name, soul=None, **judgment):
        if judgment:
            Judgment.all_objects.filter(pk=made[name].pk).update(**judgment)
        if soul:
            Soul.all_objects.filter(pk=made[name].soul_id).update(**soul)

    set_("held_ahead", held_until=today + datetime.timedelta(days=3))
    set_("held_past", held_until=today - datetime.timedelta(days=1))
    set_("nameless", civilization="EGYPTIAN", duat_stage="NAMELESS")
    set_("embalming", civilization="EGYPTIAN", duat_stage="EMBALMING", held_until=today + datetime.timedelta(days=70))
    set_("unferried", civilization="GREEK", soul={"ferry_passage": "UNBURIED", "death_year": today.year - 5})
    set_("ferried_long_ago", civilization="GREEK", soul={"ferry_passage": "NO_FARE", "death_year": today.year - 150})
    # 别人认领了的不在「待认领」里,候着也不算进 held_count。
    set_("claimed_held", held_until=today + datetime.timedelta(days=3), claimed_by=world.users["b"])
    return made


@pytest.mark.django_db
class TestClaimableCount:
    def test_unclaimed_splits_into_claimable_and_held(self, world, cases):  # noqa: F811
        data = world.clients["a"].get(f"{BASE}queue-counts/").data
        # 待认领 7 件:free / held_past / ferried_long_ago 能认领;held_ahead / nameless / embalming / unferried 候着。
        assert data["unclaimed"] == 7
        assert data["held_count"] == 4
        assert data["claimable_count"] == 3
        assert data["claimable_count"] + data["held_count"] == data["unclaimed"]

    def test_the_count_and_the_claim_refusal_read_one_rule(self, world, cases):  # noqa: F811
        today = timezone.localdate()
        by_count = set(Judgment.all_objects.filter(claims.held_q(today)).values_list("pk", flat=True))
        by_claim = {j.pk for j in cases.values() if _held_by_rule(j)}
        assert by_count == by_claim
        assert {n for n, j in cases.items() if j.pk in by_count} == {
            "held_ahead", "nameless", "embalming", "unferried", "claimed_held",
        }

    def test_counts_follow_the_filters_like_the_groups(self, world, cases):  # noqa: F811
        data = world.clients["a"].get(f"{BASE}queue-counts/", {"search": "nameless"}).data
        assert (data["unclaimed"], data["claimable_count"], data["held_count"]) == (1, 0, 1)
