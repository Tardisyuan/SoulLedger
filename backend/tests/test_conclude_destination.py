"""审判台「戊 · 发落」:结案时判官自选目的地与刑期,候选目的地,以及队列的「上一件」。

- `POST /judgment/{id}/conclude/` 多了可选的 `destination_realm_id` / `term_years` / `eternal`;
  三个都不给时行为与以前一字不差。
- `GET /judgment/{id}/destinations/?candidate_verdict=` 列出这个裁决可去的门。
- `GET /judgment/previous/?at=<id>` 是 `next/` 的对称:同一个队列、同样的排除。

「可去的门」来自自动分派的路由函数本身(apps/disposition/destination.py),
这里钉住它与路由常量完整一致,改了路由而这里扫不全时会红。
"""
import datetime
import uuid
from unittest.mock import patch

import pytest
from django.utils import timezone

from apps.disposition.destination import allowed_realm_codes
from apps.disposition.models import Disposition
from apps.disposition.services import DispositionService
from apps.judgment.models import Judgment, JudgmentKind
from apps.realms.models import Realm, SoulPathEntry
from apps.sentence_plan.models import SentenceNode
from apps.souls.models import Soul, SoulState
from tests.soul_account_support import officer_client

pytestmark = pytest.mark.django_db

HELL_5 = "DY_COURT_05_YANLUO"
HELL_9 = "DY_COURT_09_PINGDENG"


def _grant_judge():
    from apps.perm.models import Permission, Role, RolePermission

    role, _ = Role.objects.get_or_create(name="JUDGE", defaults={"display_name": "Judge"})
    for codename in ("judgment.read", "judgment.execute"):
        permission, _ = Permission.objects.get_or_create(
            codename=codename, defaults={"name": codename, "category": "judgment"})
        RolePermission.objects.get_or_create(role=role, permission=permission)


def _judge_client(django_user_model, tenant, name):
    _grant_judge()
    user = django_user_model.objects.create_user(username=name, password="x", role="JUDGE", tenant=tenant)
    return officer_client(user)


@pytest.fixture
def cn_judge(django_user_model, cn_tenant):
    return _judge_client(django_user_model, cn_tenant, "cn_desk_judge")


@pytest.fixture
def eu_judge(django_user_model, eu_tenant):
    return _judge_client(django_user_model, eu_tenant, "eu_desk_judge")


def _realm(code, tenant, civilization="CHINESE", *, eternal=False, capacity=None):
    return Realm.objects.create(
        realm_code=code, civilization=civilization, name_local=code, name_zh=code, realm_type="HELL",
        is_eternal=eternal, capacity=capacity, tenant=tenant,
    )


@pytest.fixture
def cn_realms(cn_tenant):
    return {
        "heaven": _realm("DY_01_HEAVEN", cn_tenant, eternal=True),
        "purgatory": _realm("DY_00_PURGATORY", cn_tenant),
        "hell2": _realm("DY_COURT_02_CHUJIANG", cn_tenant),
        "hell5": _realm(HELL_5, cn_tenant, capacity=1),
        "hell9": _realm(HELL_9, cn_tenant, eternal=True),
    }


def _case(tenant, name="发落之魂", at=None):
    soul = Soul.objects.create(name=name, tenant=tenant, current_state=SoulState.JUDGING)
    case = Judgment.objects.create(soul=soul, civilization=soul.civilization, court="第五殿", tenant=tenant)
    if at is not None:
        Judgment.all_objects.filter(pk=case.pk).update(created_at=at)
        case.refresh_from_db()
    return case


def _occupy(realm, tenant, n=1):
    for i in range(n):
        soul = Soul.objects.create(name=f"占位{i}", tenant=tenant, current_state=SoulState.DISPOSED)
        SoulPathEntry.all_objects.create(
            soul=soul, realm=realm, sequence=1, entered_at=timezone.now(), tenant=tenant)


def _conclude(client, case, **body):
    return client.post(f"/api/v1/judgment/{case.id}/conclude/", {"verdict": "FAILED", **body}, format="json")


def _nothing_written(case):
    case.refresh_from_db()
    assert case.verdict is None and not case.is_final
    assert not Disposition.all_objects.filter(judgment=case).exists()
    assert case.soul.current_state == SoulState.JUDGING


# ── 允许集合就是路由函数的像 ─────────────────────────────────────────────────


def test_the_allowed_sets_are_the_whole_routing_image():
    D = DispositionService
    assert allowed_realm_codes("CHINESE", "FAILED") == frozenset(D.CHINESE_HELL_TIERS.values())
    assert allowed_realm_codes("CHINESE", "PASSED") == {D.CHINESE_HEAVEN}
    assert allowed_realm_codes("CHINESE", "PURGATORY") == {D.CHINESE_PURGATORY}
    assert allowed_realm_codes("EUROPEAN", "FAILED") == frozenset(D.EU_HELL_CIRCLES.values())
    assert allowed_realm_codes("EGYPTIAN", "RETRY", "HEART_WEIGHING") == {D.EG_DUAT_ENTRY}
    assert allowed_realm_codes("EGYPTIAN", "RETRY", "STANDARD") == {D.EG_DUAT_ENTRY, D.EG_AARU}
    assert allowed_realm_codes("GREEK", "FAILED") == {D.GR_TARTARUS}
    assert allowed_realm_codes("UNKNOWN", "FAILED") == frozenset()


# ── 不给 = 与以前一样 ────────────────────────────────────────────────────────


def test_omitted_is_the_automatic_routing_untouched(cn_judge, cn_realms):
    """不给三个字段:不进 resolve_placement,满员也照旧(自动分派从来不看容量)。"""
    _occupy(cn_realms["hell2"], cn_realms["hell2"].tenant)
    cn_realms["hell2"].capacity = 1
    cn_realms["hell2"].save()
    case = _case(cn_realms["hell2"].tenant)
    with patch("apps.disposition.destination.resolve_placement", side_effect=AssertionError("called")):
        response = _conclude(cn_judge, case)
    assert response.status_code == 200, response.data
    d = Disposition.all_objects.get(judgment=case)
    assert d.destination_realm_id == cn_realms["hell2"].pk  # 严重度 0 → 第二殿
    assert (d.sentence_years, d.is_eternal) == (None, False)


def test_omitted_copies_eternal_off_the_routed_realm(cn_judge, cn_realms, cn_tenant):
    case = _case(cn_tenant)
    assert _conclude(cn_judge, case, verdict="PASSED").status_code == 200
    d = Disposition.all_objects.get(judgment=case)
    assert (d.destination_realm_id, d.is_eternal, d.sentence_years) == (cn_realms["heaven"].pk, True, None)


# ── 选中的门 ────────────────────────────────────────────────────────────────


def test_a_chosen_destination_and_term_land_on_disposition_path_and_plan(cn_judge, cn_realms, cn_tenant):
    case = _case(cn_tenant)
    realm = cn_realms["hell5"]
    response = _conclude(cn_judge, case, destination_realm_id=str(realm.pk), term_years=3)
    assert response.status_code == 200, response.data

    d = Disposition.all_objects.get(judgment=case)
    assert (d.destination_realm_id, d.sentence_years, d.is_eternal) == (realm.pk, 3, False)
    [open_stop] = SoulPathEntry.all_objects.filter(soul=case.soul, left_at__isnull=True)
    assert open_stop.realm_id == realm.pk
    assert open_stop.realm_id != cn_realms["hell2"].pk  # 不是自动分派的第二殿
    node = SentenceNode.objects.get(disposition_id=d.pk)
    assert (node.realm_code, node.sentence_years, node.is_eternal) == (HELL_5, 3, False)


def test_eternal_in_an_eternal_capable_realm(cn_judge, cn_realms, cn_tenant):
    case = _case(cn_tenant)
    response = _conclude(cn_judge, case, destination_realm_id=str(cn_realms["hell9"].pk), eternal=True)
    assert response.status_code == 200, response.data
    d = Disposition.all_objects.get(judgment=case)
    assert (d.destination_realm_id, d.is_eternal, d.sentence_years) == (cn_realms["hell9"].pk, True, None)


def test_a_term_without_a_destination_goes_to_the_routed_realm(cn_judge, cn_realms, cn_tenant):
    case = _case(cn_tenant)
    assert _conclude(cn_judge, case, term_years=7).status_code == 200
    d = Disposition.all_objects.get(judgment=case)
    assert (d.destination_realm_id, d.sentence_years) == (cn_realms["hell2"].pk, 7)


# ── 拒绝 ────────────────────────────────────────────────────────────────────


def test_a_realm_of_another_tenant_is_refused_as_not_found(cn_judge, cn_realms, cn_tenant, eu_tenant):
    """同文明、裁决也允许的门,只因不在本案租户里就被拒 —— 这一条守的是租户检查。"""
    foreign = _realm("DY_COURT_03_SONGDI", eu_tenant)
    case = _case(cn_tenant)
    response = _conclude(cn_judge, case, destination_realm_id=str(foreign.pk))
    assert (response.status_code, response.data["code"]) == (400, "realm_not_found")
    _nothing_written(case)


def test_a_realm_of_another_civilization_is_refused(cn_judge, cn_realms, cn_tenant):
    eu_hell = _realm("EU_HELL_9TH", cn_tenant, civilization="EUROPEAN")
    case = _case(cn_tenant)
    response = _conclude(cn_judge, case, destination_realm_id=str(eu_hell.pk))
    assert (response.status_code, response.data["code"]) == (400, "realm_not_found")
    _nothing_written(case)


def test_an_unknown_realm_is_refused(cn_judge, cn_realms, cn_tenant):
    case = _case(cn_tenant)
    response = _conclude(cn_judge, case, destination_realm_id=str(uuid.uuid4()))
    assert (response.status_code, response.data["code"]) == (400, "realm_not_found")


def test_a_realm_the_verdict_cannot_route_to_is_refused(cn_judge, cn_realms, cn_tenant):
    """PASSED 只能上天;送去第五殿被拒。这一条守的是裁决过滤。"""
    case = _case(cn_tenant)
    response = _conclude(cn_judge, case, verdict="PASSED", destination_realm_id=str(cn_realms["hell5"].pk))
    assert (response.status_code, response.data["code"]) == (400, "realm_not_allowed")
    _nothing_written(case)


def test_a_full_realm_is_refused_with_realm_full(cn_judge, cn_realms, cn_tenant):
    _occupy(cn_realms["hell5"], cn_tenant)  # capacity 1
    case = _case(cn_tenant)
    response = _conclude(cn_judge, case, destination_realm_id=str(cn_realms["hell5"].pk))
    assert (response.status_code, response.data["code"]) == (409, "realm_full")
    _nothing_written(case)


def test_a_departed_soul_frees_its_seat(cn_judge, cn_realms, cn_tenant):
    _occupy(cn_realms["hell5"], cn_tenant)
    SoulPathEntry.all_objects.filter(realm=cn_realms["hell5"]).update(left_at=timezone.now())
    case = _case(cn_tenant)
    assert _conclude(cn_judge, case, destination_realm_id=str(cn_realms["hell5"].pk)).status_code == 200


def test_the_soul_already_standing_there_does_not_count_against_itself(cn_judge, cn_realms, cn_tenant):
    """待审所判 PURGATORY:灵魂本来就在那扇门里,不占第二个位子。"""
    purgatory = cn_realms["purgatory"]
    purgatory.capacity = 1
    purgatory.save()
    case = _case(cn_tenant)
    SoulPathEntry.all_objects.create(
        soul=case.soul, realm=purgatory, sequence=1, entered_at=timezone.now(), tenant=cn_tenant)
    response = _conclude(cn_judge, case, verdict="PURGATORY", destination_realm_id=str(purgatory.pk))
    assert response.status_code == 200, response.data


@pytest.mark.parametrize("body, code", [
    ({"term_years": 3, "eternal": True}, "term_conflict"),
    ({"eternal": True}, "eternal_not_allowed"),  # 第五殿不是永恒之所
])
def test_term_and_eternal_combinations_refused(cn_judge, cn_realms, cn_tenant, body, code):
    case = _case(cn_tenant)
    response = _conclude(cn_judge, case, destination_realm_id=str(cn_realms["hell5"].pk), **body)
    assert (response.status_code, response.data["code"]) == (400, code)
    _nothing_written(case)


def test_eternal_with_the_routed_realm_not_eternal_is_refused(cn_judge, cn_realms, cn_tenant):
    case = _case(cn_tenant)
    response = _conclude(cn_judge, case, eternal=True)  # 自动分派到第二殿,非永恒
    assert (response.status_code, response.data["code"]) == (400, "eternal_not_allowed")


@pytest.mark.parametrize("term", [0, -1, 1.5, "三", True, 2**31])
def test_a_term_that_is_not_a_positive_integer_is_refused(cn_judge, cn_realms, cn_tenant, term):
    case = _case(cn_tenant)
    response = _conclude(cn_judge, case, term_years=term)
    assert response.status_code == 400
    assert "term_years" in response.data
    _nothing_written(case)


def test_an_amendment_takes_no_destination(cn_judge, cn_realms, cn_tenant):
    case = _case(cn_tenant)
    Judgment.all_objects.filter(pk=case.pk).update(kind=JudgmentKind.AMENDMENT)
    response = _conclude(cn_judge, case, destination_realm_id=str(cn_realms["hell5"].pk))
    assert (response.status_code, response.data["code"]) == (400, "destination_not_applicable")


def test_another_tenants_judgment_cannot_be_concluded_with_a_destination(eu_judge, cn_realms, cn_tenant):
    case = _case(cn_tenant)
    response = _conclude(eu_judge, case, destination_realm_id=str(cn_realms["hell5"].pk))
    assert response.status_code == 404
    _nothing_written(case)


# ── 候选目的地 ──────────────────────────────────────────────────────────────


def _options(client, case, verdict):
    return client.get(f"/api/v1/judgment/{case.id}/destinations/", {"candidate_verdict": verdict})


def test_options_are_filtered_by_verdict(cn_judge, cn_realms, cn_tenant, eu_tenant):
    _realm("DY_COURT_03_SONGDI", eu_tenant)  # 允许的码,但别的租户的:不列
    _occupy(cn_realms["hell5"], cn_tenant)
    case = _case(cn_tenant)

    failed = _options(cn_judge, case, "FAILED")
    assert failed.status_code == 200, failed.data
    codes = [o["realm_code"] for o in failed.data["options"]]
    assert set(codes) == {"DY_COURT_02_CHUJIANG", HELL_5, HELL_9}
    assert "DY_01_HEAVEN" not in codes and "DY_COURT_03_SONGDI" not in codes
    hell5 = next(o for o in failed.data["options"] if o["realm_code"] == HELL_5)
    assert (hell5["capacity"], hell5["occupancy"], hell5["is_eternal"]) == (1, 1, False)
    assert set(hell5) == {"id", "name", "realm_code", "kind", "capacity", "occupancy", "is_eternal"}
    assert str(failed.data["default_realm_id"]) == str(cn_realms["hell2"].pk)
    assert failed.data["default_term_years"] is None

    passed = _options(cn_judge, case, "PASSED")
    assert [o["realm_code"] for o in passed.data["options"]] == ["DY_01_HEAVEN"]
    assert str(passed.data["default_realm_id"]) == str(cn_realms["heaven"].pk)


def test_options_need_a_real_verdict(cn_judge, cn_realms, cn_tenant):
    response = _options(cn_judge, _case(cn_tenant), "MAYBE")
    assert (response.status_code, response.data["code"]) == (400, "invalid_verdict")


def test_options_are_tenant_isolated(eu_judge, cn_realms, cn_tenant):
    assert _options(eu_judge, _case(cn_tenant), "FAILED").status_code == 404


def test_an_amendment_has_no_options(cn_judge, cn_realms, cn_tenant):
    case = _case(cn_tenant)
    Judgment.all_objects.filter(pk=case.pk).update(kind=JudgmentKind.AMENDMENT)
    response = _options(cn_judge, case, "FAILED")
    assert (response.data["options"], response.data["default_realm_id"]) == ([], None)


# ── 上一件 ─────────────────────────────────────────────────────────────────


@pytest.fixture
def three(cn_tenant):
    t0 = timezone.now() - datetime.timedelta(days=3)
    return [_case(cn_tenant, name=f"第{i}件", at=t0 + datetime.timedelta(hours=i)) for i in range(3)]


def _prev(client, at, **params):
    return client.get("/api/v1/judgment/previous/", {"at": str(at), **params})


def _next(client, **params):
    return client.get("/api/v1/judgment/next/", params)


def _id(response):
    assert response.status_code == 200, response.data
    return response.data["judgment"] and response.data["judgment"]["id"]


def test_previous_walks_back_and_mirrors_next(cn_judge, three):
    a, b, c = three
    assert _id(_prev(cn_judge, c.id)) == str(b.id)
    assert _id(_prev(cn_judge, b.id)) == str(a.id)
    assert _id(_prev(cn_judge, a.id)) is None
    # 对称:从 x 往前一步得到 w,则从 w 往后一步(next 跳过 w 之前的与 w)得到 x。
    for w, x in ((a, b), (b, c)):
        back = _prev(cn_judge, x.id)
        assert _id(back) == str(w.id)
        assert back.data["position"] == _next(cn_judge, at=str(w.id)).data["position"]
        skips = [str(j.id) for j in three if j.created_at <= w.created_at]
        assert _id(_next(cn_judge, skip=",".join(skips))) == str(x.id)


def test_previous_carries_the_whole_decision_surface(cn_judge, three):
    response = _prev(cn_judge, three[1].id)
    assert response.data["soul"]["id"] == str(three[0].soul_id)
    assert (response.data["total"], response.data["position"]) == (3, 1)


def test_previous_excludes_deferred_unless_asked(cn_judge, three):
    a, b, c = three
    Judgment.all_objects.filter(pk=b.pk).update(deferred_at=timezone.now())
    assert _id(_prev(cn_judge, c.id)) == str(a.id)
    assert _id(_prev(cn_judge, c.id, include_deferred="true")) == str(b.id)


def test_previous_honours_skips_and_excludes_concluded(cn_judge, three, cn_realms):
    a, b, c = three
    assert _id(_prev(cn_judge, c.id, skip=str(b.id))) == str(a.id)
    assert _conclude(cn_judge, b).status_code == 200
    assert _id(_prev(cn_judge, c.id)) == str(a.id)


def test_previous_works_from_a_case_just_concluded(cn_judge, three, cn_realms):
    a, b, c = three
    assert _conclude(cn_judge, c).status_code == 200
    assert _id(_prev(cn_judge, c.id)) == str(b.id)


@pytest.mark.parametrize("at", ["", "not-a-uuid", str(uuid.uuid4())])
def test_previous_without_a_usable_anchor_is_an_empty_200(cn_judge, three, at):
    response = cn_judge.get("/api/v1/judgment/previous/", {"at": at})
    assert response.status_code == 200
    assert (response.data["judgment"], response.data["position"], response.data["total"]) == (None, None, 3)


def test_previous_is_tenant_isolated(cn_judge, eu_judge, three, eu_tenant):
    a, b, c = three
    # 别的租户看不见锚点,也就没有「之前」。
    assert _id(_prev(eu_judge, c.id)) is None
    # 别的租户更早的案子不会出现在这里。
    _case(eu_tenant, name="欧洲的案子", at=timezone.now() - datetime.timedelta(days=30))
    assert _id(_prev(cn_judge, a.id)) is None
    assert _prev(cn_judge, a.id).data["total"] == 3


# ── 下一件(next/?after=)────────────────────────────────────────────────────


def test_after_is_the_mirror_of_previous(cn_judge, three):
    a, b, c = three
    assert _id(_next(cn_judge, after=str(a.id))) == str(b.id)
    assert _id(_next(cn_judge, after=str(b.id))) == str(c.id)
    assert _id(_next(cn_judge, after=str(c.id))) is None
    # 不是 `skip=` 的队首:从 b 往后是 c,而 `skip=b` 给的是 a。
    assert _id(_next(cn_judge, skip=str(b.id))) == str(a.id)


def test_after_works_from_a_case_just_concluded(cn_judge, three, cn_realms):
    a, b, c = three
    assert _conclude(cn_judge, a).status_code == 200
    assert _id(_next(cn_judge, after=str(a.id))) == str(b.id)


def test_after_excludes_deferred_unless_asked(cn_judge, three):
    a, b, c = three
    Judgment.all_objects.filter(pk=b.pk).update(deferred_at=timezone.now())
    assert _id(_next(cn_judge, after=str(a.id))) == str(c.id)
    assert _id(_next(cn_judge, after=str(a.id), include_deferred="true")) == str(b.id)


@pytest.mark.parametrize("after", ["", "not-a-uuid", str(uuid.uuid4())])
def test_after_without_a_usable_anchor_is_an_empty_200(cn_judge, three, after):
    response = _next(cn_judge, after=after)
    assert response.status_code == 200
    assert (response.data["judgment"], response.data["position"], response.data["total"]) == (None, None, 3)


def test_after_is_tenant_isolated(cn_judge, eu_judge, three, eu_tenant):
    a, b, c = three
    # 别的租户看不见锚点,也就没有「之后」—— 哪怕它自己的队列里有排在锚点之后的案子;
    # 别的租户更晚的案子也不会出现在这里。
    _case(eu_tenant, name="欧洲的案子", at=timezone.now())
    assert _id(_next(eu_judge)) is not None
    assert _id(_next(eu_judge, after=str(a.id))) is None
    assert _id(_next(cn_judge, after=str(c.id))) is None
