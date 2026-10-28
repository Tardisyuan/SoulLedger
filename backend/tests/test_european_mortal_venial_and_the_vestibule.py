"""Mortal or venial, the seven terraces by sin, the vestibule for the neutrals (2026-10-28).

docs/01_欧洲天堂地狱整体架构.md §1.2-1.3: hell is for a mortal sin unrepented at death (CCC 1033); purgatory purges
the venial and the temporal punishment left by an absolved mortal sin (CCC 1030-1031).
docs/03_七宗罪与地狱惩罚.md §二 (大罪 / 小罪), §三 (前庭 Antinferno, Inf. III), §五 (the seven terraces by sin).
"""
import io

import pytest
from django.core.management import call_command

from apps.disposition.services import DispositionService
from apps.judgment.models import Judgment, Verdict
from apps.judgment.services import EvidenceAdmissionService
from apps.sentence_plan.requests import PlanChangeRefusedError
from apps.souls.models import Soul, SoulState
from apps.souls.record_models import RecordCategory, SinGravity, SoulRecord
from apps.tenants.models import Tenant
from tests.soul_account_support import officer_client

pytestmark = pytest.mark.django_db

D = DispositionService


def _soul(code="EU_HEAVEN_HELL", **fields):
    tenant = Tenant.objects.get_or_create(code=code, defaults={"display_name": code})[0]
    return Soul.objects.create(name="s", tenant=tenant, current_state=SoulState.JUDGING, death_year=1300, **fields)


def _demerit(soul, gravity="", statute_code=None, weight=5):
    from apps.judgment.models import Statute

    with SoulRecord.batch():
        record = SoulRecord.objects.create(soul=soul, record_type="DEMERIT", category=RecordCategory.DECEPTION,
                                           weight=weight, description="d", event_year=1300)
    fields = {"sin_gravity": gravity}
    if statute_code:
        fields["statute"] = Statute.all_objects.get(tenant_id=soul.tenant_id, code=statute_code)
    SoulRecord.all_objects.filter(pk=record.pk).update(**fields)
    soul.refresh_from_db()
    return record


def _refused(soul, verdict, excluded=()):
    with pytest.raises(PlanChangeRefusedError) as refused:
        D.refuse_against_gravity(soul, verdict, excluded=excluded)
    return refused.value.code


# ── 大罪 / 小罪 ─────────────────────────────────────────────────────────────


def test_an_unrepented_mortal_sin_bars_heaven_and_purgatory():
    soul = _soul()
    _demerit(soul, SinGravity.VENIAL)
    _demerit(soul, SinGravity.MORTAL)
    assert _refused(soul, Verdict.PASSED) == "mortal_sin_unrepented"
    assert _refused(soul, Verdict.PURGATORY) == "mortal_sin_unrepented"
    D.refuse_against_gravity(soul, Verdict.FAILED)  # hell: accepted
    D.refuse_against_gravity(soul, Verdict.RETRY)  # heard again: not checked


@pytest.mark.parametrize("gravities", [[SinGravity.VENIAL], [SinGravity.MORTAL_ABSOLVED, SinGravity.VENIAL]])
def test_venial_or_absolved_sins_are_purged_not_damned(gravities):
    soul = _soul()
    for gravity in gravities:
        _demerit(soul, gravity)
    assert _refused(soul, Verdict.FAILED) == "no_mortal_sin"
    D.refuse_against_gravity(soul, Verdict.PURGATORY)


def test_an_unclassified_deed_or_a_person_fact_leaves_failed_alone():
    """Absence: nothing here says what an unclassified deed, a denial of immortality or a neutral life weighs."""
    unclassified = _soul()
    _demerit(unclassified, SinGravity.VENIAL)
    _demerit(unclassified, "")
    D.refuse_against_gravity(unclassified, Verdict.FAILED)
    for fact in ({"denied_immortality": True}, {"neutral_in_life": True}):
        soul = _soul(**fact)
        _demerit(soul, SinGravity.VENIAL)
        D.refuse_against_gravity(soul, Verdict.FAILED)
    D.refuse_against_gravity(_soul(), Verdict.FAILED)  # no record at all: as before


def test_a_mortal_sin_the_case_did_not_admit_does_not_bar_purgatory():
    soul = _soul()
    record = _demerit(soul, SinGravity.MORTAL)
    _demerit(soul, SinGravity.VENIAL)
    D.refuse_against_gravity(soul, Verdict.PURGATORY, excluded=[record.pk])


def test_conclude_refuses_and_writes_nothing(admin_user):
    soul = _soul()
    _demerit(soul, SinGravity.MORTAL)
    case = Judgment.objects.create(soul=soul, tenant=soul.tenant, civilization="EUROPEAN", court="—")
    res = officer_client(admin_user).post(f"/api/v1/judgment/{case.pk}/conclude/",
                                          {"verdict": "PURGATORY", "create_workflow": False}, format="json")
    assert res.status_code == 400 and res.data["code"] == "mortal_sin_unrepented", res.data
    case.refresh_from_db()
    assert case.verdict is None and not case.is_final
    soul.refresh_from_db()
    assert soul.current_state == SoulState.JUDGING
    # Not admitting the deed (with a reason) lets the same verdict through.
    record = soul.records.get()
    EvidenceAdmissionService.rule(case, record.pk, False, "confessed on the deathbed")
    D.refuse_against_gravity(soul, Verdict.PURGATORY, excluded=EvidenceAdmissionService.not_admitted_ids(case))


def test_only_a_european_demerit_is_mortal_or_venial(admin_user):
    client = officer_client(admin_user)
    european, chinese = _soul(), _soul(code="CN_DIYU")
    body = {"record_type": "DEMERIT", "category": "DECEPTION", "weight": 5, "description": "d",
            "sin_gravity": "MORTAL"}
    assert client.post(f"/api/v1/souls/{european.pk}/add_record/", body, format="json").status_code in (200, 201)
    res = client.post(f"/api/v1/souls/{chinese.pk}/add_record/", body, format="json")
    assert res.status_code == 400 and "sin_gravity" in res.data, res.data
    res = client.post(f"/api/v1/souls/{european.pk}/add_record/", {**body, "record_type": "MERIT"}, format="json")
    assert res.status_code == 400 and "sin_gravity" in res.data, res.data


# ── 炼狱七层按罪种 ──────────────────────────────────────────────────────────


def test_a_purgatory_soul_starts_on_the_lowest_terrace_it_owes():
    call_command("seed_mythology", stdout=io.StringIO(), stderr=io.StringIO())
    soul = _soul()
    _demerit(soul, SinGravity.VENIAL, statute_code="EU-DS-T6")  # gluttony
    assert D._route_to_realm(soul, Verdict.PURGATORY) == "EU_PURGATORY_T6_GLUTTONY"
    _demerit(soul, SinGravity.VENIAL, statute_code="EU-DS-T2")  # envy, lower on the mountain
    assert D._route_to_realm(soul, Verdict.PURGATORY) == "EU_PURGATORY_T2_ENVY"
    # No cited capital sin: the mountain, as before; the culpa ladder never picks a terrace.
    assert D._route_to_realm(_soul(), Verdict.PURGATORY) == D.EU_PURGATORY
    # A FAILED soul is not sent up the mountain by what it cites.
    assert D._route_to_realm(soul, Verdict.FAILED) in D.EU_HELL_CIRCLES.values()


# ── 地狱前庭 ────────────────────────────────────────────────────────────────


def test_a_neutral_soul_goes_to_the_vestibule_unless_a_circle_is_cited():
    call_command("seed_mythology", stdout=io.StringIO(), stderr=io.StringIO())
    neutral = _soul(neutral_in_life=True)
    assert D._route_to_realm(neutral, Verdict.FAILED) == D.EU_ANTINFERNO
    assert D._route_to_realm(neutral, Verdict.PASSED) == D.EU_HEAVEN  # a fact, not a verdict
    assert D._route_to_realm(_soul(neutral_in_life=False), Verdict.FAILED) == D.EU_HELL_CIRCLES[2]
    cited = _soul(neutral_in_life=True)
    record = _demerit(cited, SinGravity.MORTAL)
    SoulRecord.all_objects.filter(pk=record.pk).update(inferno_article="EU-INF-C8")
    assert D._route_to_realm(cited, Verdict.FAILED) == D.EU_HELL_CIRCLES[8]


def test_the_vestibule_is_seeded_eternal_hell_outside_the_circles():
    from apps.realms.models import Realm

    call_command("seed_mythology", stdout=io.StringIO(), stderr=io.StringIO())
    row = Realm.all_objects.get(realm_code="EU_ANTINFERNO")
    assert (row.civilization, row.realm_type, row.tier, row.is_eternal) == ("EUROPEAN", "HELL", 0, True)
    assert row.name_egy == ""  # Design has not given the egy word: pending, not invented


def test_the_vestibule_comes_before_the_first_circle_in_the_placement_list():
    """Design 第五十七批 §9:发落下拉里地狱前庭排在第一圈前面。下拉按 `_tenant_realms` 的 (order, tier, code) 排,
    欧洲各圈都没有 order,前庭的 tier 0 让它排在 tier 1 的第一圈之前 —— 这条钉住它,改 tier 或排序会红。"""
    from types import SimpleNamespace

    from apps.disposition.destination import destination_options

    call_command("seed_mythology", stdout=io.StringIO(), stderr=io.StringIO())
    tenant = Tenant.objects.get(code="EU_HEAVEN_HELL")
    judgment = SimpleNamespace(tenant_id=tenant.pk, soul=SimpleNamespace(civilization="EUROPEAN"),
                               judgment_method="STANDARD")
    codes = [r.realm_code for r in destination_options(judgment, Verdict.FAILED)]
    assert "EU_ANTINFERNO" in codes and D.EU_HELL_CIRCLES[1] in codes, codes
    assert codes.index("EU_ANTINFERNO") < codes.index(D.EU_HELL_CIRCLES[1]), codes


def test_only_a_european_soul_records_a_neutral_life(admin_user):
    client = officer_client(admin_user)
    res = client.patch(f"/api/v1/souls/{_soul().pk}/", {"neutral_in_life": True}, format="json")
    assert res.status_code == 200 and res.data["neutral_in_life"] is True, res.data
    res = client.patch(f"/api/v1/souls/{_soul(code='CN_DIYU').pk}/", {"neutral_in_life": True}, format="json")
    assert res.status_code == 400 and "neutral_in_life" in res.data, res.data


# ── 核对读的文明与路由一致(2026-10-29 审查)─────────────────────────────────


def test_a_residing_european_souls_reopened_case_is_checked_as_european(cn_tenant):
    """重开审判按原属文明路由(`conclude_reopened` → `_route_home_realm`),大罪 / 小罪的核对也要按原属读。
    此前读管辖文明:原属欧洲、暂居地府的灵魂重开时一条未悔的大罪也能判 PASSED。"""
    from apps.judgment.models import JudgmentKind
    from apps.judgment.services import JudgmentConclusionService

    eu = Tenant.objects.get_or_create(code="EU_HEAVEN_HELL", defaults={"display_name": "EU"})[0]
    soul = Soul.objects.create(name="暂居", tenant=cn_tenant, home_tenant=eu, current_state=SoulState.DISPOSED,
                               death_year=1300)
    assert (soul.civilization, soul.home_civilization) == ("CHINESE", "EUROPEAN")
    _demerit(soul, SinGravity.MORTAL)
    reopen = Judgment.objects.create(soul=soul, tenant=eu, civilization="EUROPEAN", kind=JudgmentKind.REOPEN,
                                     court="重开审判")
    with pytest.raises(PlanChangeRefusedError) as refused:
        JudgmentConclusionService.conclude_judgment(reopen, Verdict.PASSED)
    assert refused.value.code == "mortal_sin_unrepented"
    assert Judgment.all_objects.get(pk=reopen.pk).verdict is None
