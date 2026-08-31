"""希腊路由的双向勾稽 —— 但丁那侧有,希腊这侧一直没有。

`tests/test_greek_sentence_basis.py` 里所有路由断言都写成
`_route_to_realm(...) == DispositionService.GR_ISLES`,期望取自**被测类自身**。
如果 `GR_ISLES` 与 `GR_TARTARUS` 的**值**(两个都真实存在的 realm code)被互换:

* 那个文件全绿 —— 期望跟着动;
* `test_every_realm_disposition_routing_can_return_actually_exists` 只查存在性,绿;
* `test_greek_civilization.py` 有字面量但从不接触 `DispositionService`,绿;
* `NOT_GREEK_GROUND` 只拦跨文明泄漏,拦不住希腊内部对调。

于是「判定通过的灵魂被送进塔尔塔罗斯」这件事,没有任何一条测试会红。
对照组是但丁侧的 `test_the_circle_anchors_agree_with_the_router_s_own_table`。

这里从**两个互相独立的方向**钉:
1. 字面量 —— 常量的值就是那三个字符串;
2. 语义 —— 路由目的地在 realm 表里的 `realm_type` 必须对得上
   (通过 → BLISS,失败 → HELL,未决 → 既不是 BLISS 也不是 HELL)。
第 2 条即使有人把字面量和常量一起改了也还站得住:它问的是**那个地方是什么**,
而这个答案写在语料里,不写在路由器里。
"""
import io

import pytest
from django.core.management import call_command

from apps.disposition.services import DispositionService
from apps.judgment.models import Verdict
from apps.realms.models import Realm, RealmType
from apps.souls.models import Soul
from apps.tenants.models import Tenant


@pytest.fixture
def seed_greek_realms(db):
    """A database with seed_mythology applied once — same as the Inferno tests.

    The realm rows are the *independent* half of this reconciliation, so they
    have to come from the corpus rather than be hand-built here; a fixture that
    created `GR_ISLES_OF_THE_BLESSED` with `realm_type=BLISS` inline would be
    asserting the answer it checks.
    """
    out = io.StringIO()
    call_command("seed_mythology", stdout=out, stderr=out)
    return out.getvalue()


@pytest.fixture
def greek_soul(seed_greek_realms):
    tenant, _ = Tenant.objects.get_or_create(
        code="GR_HADES", defaults={"display_name": "GR_HADES"}
    )
    return Soul.objects.create(name="希腊灵魂", tenant=tenant)


def test_the_three_greek_constants_hold_the_codes_they_are_named_for():
    """字面量。**期望不取自被测类** —— 这正是本文件存在的理由。"""
    assert DispositionService.GR_ISLES == "GR_ISLES_OF_THE_BLESSED"
    assert DispositionService.GR_TARTARUS == "GR_TARTARUS"
    assert DispositionService.GR_MEADOW == "EU_PLATO_MEADOW"


@pytest.mark.django_db
def test_the_router_sends_the_just_to_a_place_the_realm_table_calls_bliss(greek_soul):
    code = DispositionService._route_to_realm(greek_soul, Verdict.PASSED)
    realm = Realm.all_objects.get(realm_code=code)
    assert realm.realm_type == RealmType.BLISS, (
        f"通过判定的希腊灵魂被送到 {code},而 realm 表说那里是 "
        f"{realm.realm_type}"
    )


@pytest.mark.django_db
def test_the_router_sends_the_unjust_to_a_place_the_realm_table_calls_hell(greek_soul):
    code = DispositionService._route_to_realm(greek_soul, Verdict.FAILED)
    realm = Realm.all_objects.get(realm_code=code)
    assert realm.realm_type == RealmType.HELL, (
        f"未通过判定的希腊灵魂被送到 {code},而 realm 表说那里是 "
        f"{realm.realm_type}"
    )


@pytest.mark.django_db
@pytest.mark.parametrize("verdict", [Verdict.PURGATORY, Verdict.RETRY])
def test_an_unfinished_verdict_lands_on_ground_that_is_neither(greek_soul, verdict):
    """未决不是第三条路 —— 它是「还站在分岔口上」。

    所以它的落点**必须既不是 BLISS 也不是 HELL**;断这一条比断
    `== GR_MEADOW` 强,后者在三个常量一起被改时仍然会绿。
    """
    code = DispositionService._route_to_realm(greek_soul, verdict)
    realm = Realm.all_objects.get(realm_code=code)
    assert realm.realm_type not in (RealmType.BLISS, RealmType.HELL), (
        f"未决的希腊灵魂被送到 {code}({realm.realm_type}) —— 那是一个结局,"
        f"而 524a 的分岔口上还没有结局"
    )


@pytest.mark.django_db
def test_the_three_destinations_are_three_different_places(greek_soul):
    """守卫的守卫:上面三条在三个常量指向同一行时会一起绿掉两条。"""
    codes = {
        DispositionService._route_to_realm(greek_soul, v)
        for v in (Verdict.PASSED, Verdict.FAILED, Verdict.PURGATORY)
    }
    assert len(codes) == 3, codes
