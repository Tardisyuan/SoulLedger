"""v4 界面改版要的后端(用户 2026-11-06):「不过」的理由(D6)、待定的理由码(D5)、审判期限(D10)、
希腊的文书与可医标记(D8 / D7,路由的那一半在 `test_greek_sentence_basis.py`)、欧洲罪种(D9)、
概览的数(统计)、文书时辰(D12)。

每条测试的说明里写着「变异」:改哪一行它会红。
"""
from datetime import UTC, timedelta
from types import SimpleNamespace
from zoneinfo import ZoneInfo

import pytest
from django.utils import timezone

from apps.events.models import SoulEvent
from apps.judgment import deadline
from apps.judgment.fail_reasons import FailReasonRefusedError, apply, check
from apps.judgment.models import CityGodStatus, Judgment, Verdict
from apps.souls.models import Civilization, Soul, SoulState
from apps.tenants.models import DEADLINE_SETTING, TIMEZONE_SETTING
from tests.soul_account_support import officer_client

BASE = "/api/v1/judgment/"


def _soul(**fields):
    return SimpleNamespace(**{"denied_immortality": False, "neutral_in_life": False, **fields})


def _code(verdict, civ, *, required=True, reasons=(), note="", account="", curability="", soul=None):
    case = SimpleNamespace(soul=soul or _soul())
    try:
        check(case, verdict, civ, reasons=reasons, note=note, account=account, curability=curability,
              required=required)
    except FailReasonRefusedError as exc:
        return exc.code
    return None


# ── D6:理由的规则(不碰数据库)────────────────────────────────────────────────────────────────


@pytest.mark.parametrize(("civ", "kwargs", "code"), [
    # 必填:经接口结原审。变异:check 里 `if required and choices` 去掉 → 三条 None,红。
    (Civilization.CHINESE, {}, "fail_reason_required"),
    (Civilization.EUROPEAN, {}, "fail_reason_required"),
    (Civilization.GREEK, {"account": "GORGIAS", "curability": "CURABLE"}, "fail_reason_required"),
    # 进程内(审批流、种子)不要求。
    (Civilization.CHINESE, {"required": False}, None),
    # 地府、欧洲恰好一项;希腊可多选。
    (Civilization.CHINESE, {"reasons": ["TRADE_FRAUD"]}, None),
    (Civilization.CHINESE, {"reasons": ["TRADE_FRAUD", "MURDER"]}, "fail_reason_invalid"),
    (Civilization.CHINESE, {"reasons": ["PERJURY"]}, "fail_reason_invalid"),
    (Civilization.EUROPEAN, {"reasons": ["MORTAL_SIN"]}, None),
    (Civilization.GREEK, {"reasons": ["PERJURY", "INJUSTICE"], "account": "GORGIAS", "curability": "CURABLE"}, None),
    # 每篇自己的一套:理想国没有「伪誓」。
    (Civilization.GREEK, {"reasons": ["PERJURY"], "account": "REPUBLIC", "curability": "CURABLE"},
     "fail_reason_invalid"),
    (Civilization.GREEK, {"reasons": ["BETRAYAL"], "account": "REPUBLIC", "curability": "INCURABLE"}, None),
    # 「其他」要一句。
    (Civilization.CHINESE, {"reasons": ["OTHER"]}, "fail_reason_note_required"),
    (Civilization.CHINESE, {"reasons": ["OTHER"], "note": "x" * 501}, "fail_reason_note_too_long"),
    (Civilization.CHINESE, {"reasons": ["OTHER"], "note": "欠一句"}, None),
    # 埃及:天平列理由,不能选;不给也不要求。
    (Civilization.EGYPTIAN, {"reasons": ["OTHER"], "note": "x"}, "fail_reason_not_selectable"),
    (Civilization.EGYPTIAN, {}, None),
    # 希腊:文书与标记必选;别的文明不收。
    (Civilization.GREEK, {"reasons": ["PERJURY"], "curability": "CURABLE"}, "greek_account_required"),
    (Civilization.GREEK, {"reasons": ["PERJURY"], "account": "GORGIAS"}, "curability_required"),
    (Civilization.CHINESE, {"reasons": ["MURDER"], "curability": "INCURABLE"}, "greek_mark_not_applicable"),
])
def test_the_reason_rules(civ, kwargs, code):
    assert _code(Verdict.FAILED, civ, **kwargs) == code


def test_reasons_go_with_a_failed_verdict_only_and_greek_passed_still_needs_its_account():
    assert _code(Verdict.PASSED, Civilization.CHINESE, reasons=["MURDER"]) == "fail_reason_not_failed"
    assert _code(Verdict.PASSED, Civilization.GREEK, account="GORGIAS", curability="CURABLE") == "fail_reason_not_failed"
    assert _code(Verdict.PASSED, Civilization.GREEK) == "greek_account_required"
    assert _code(Verdict.PASSED, Civilization.GREEK, account="REPUBLIC") is None
    assert _code(Verdict.RETRY, Civilization.GREEK) is None  # 再审不出文书


def test_the_european_reasons_that_quote_the_record_need_the_record():
    """「登记为中立者」「否认灵魂不灭」说的是灵魂登记里的事。变异:去掉 contradicts_record 那段 → 前两条 None,红。"""
    assert _code(Verdict.FAILED, Civilization.EUROPEAN, reasons=["NEUTRAL"]) == "fail_reason_contradicts_record"
    assert _code(Verdict.FAILED, Civilization.EUROPEAN,
                 reasons=["DENIED_IMMORTALITY"]) == "fail_reason_contradicts_record"
    assert _code(Verdict.FAILED, Civilization.EUROPEAN, reasons=["NEUTRAL"], soul=_soul(neutral_in_life=True)) is None


def test_a_diyu_offence_reason_becomes_the_offence_the_router_reads():
    """变异:apply 里写回 offence 那行删掉 → offence 仍是空串,红。「其他」不动它。"""
    case = SimpleNamespace(offence="")
    apply(case, Verdict.FAILED, Civilization.CHINESE, reasons=["TRADE_FRAUD"], note="", account="", curability="")
    assert (case.offence, case.fail_reasons) == ("TRADE_FRAUD", ["TRADE_FRAUD"])
    other = SimpleNamespace(offence="MURDER")
    apply(other, Verdict.FAILED, Civilization.CHINESE, reasons=["OTHER"], note=" 一句 ", account="", curability="")
    assert (other.offence, other.fail_reason_note) == ("MURDER", "一句")


# ── D6 经接口:拒绝什么都不写;结案存下理由、写进事件 ───────────────────────────────────────


def _grant_judge():
    from apps.perm.models import Permission, Role, RolePermission

    role, _ = Role.objects.get_or_create(name="JUDGE", defaults={"display_name": "Judge"})
    for codename in ("judgment.read", "judgment.execute"):
        permission, _ = Permission.objects.get_or_create(
            codename=codename, defaults={"name": codename, "category": "judgment"})
        RolePermission.objects.get_or_create(role=role, permission=permission)


@pytest.fixture
def cn_judge(db, django_user_model, cn_tenant):
    _grant_judge()
    user = django_user_model.objects.create_user(username="v4_judge", password="x", role="JUDGE", tenant=cn_tenant)
    return officer_client(user)


def _case(tenant, name="四版之魂", **fields):
    soul = Soul.objects.create(name=name, tenant=tenant, current_state=SoulState.JUDGING)
    return Judgment.objects.create(soul=soul, civilization=soul.civilization, court="第四殿", tenant=tenant, **fields)


@pytest.mark.django_db
def test_a_failed_conclusion_without_a_reason_is_refused_and_writes_nothing(cn_judge, cn_tenant):
    """变异:views.py 不再传 `require_fail_reason=True` → 200,红。"""
    case = _case(cn_tenant)
    response = cn_judge.post(f"{BASE}{case.pk}/conclude/", {"verdict": "FAILED"}, format="json")
    assert response.status_code == 400, response.data
    assert response.data["code"] == "fail_reason_required"
    assert "TRADE_FRAUD" in response.data["choices"]
    case.refresh_from_db()
    assert case.verdict is None and not case.is_final


@pytest.mark.django_db
def test_the_reason_is_stored_written_back_as_the_offence_and_carried_by_the_event(cn_judge, cn_tenant):
    """变异:log_judgment_concluded 不带 fail_reasons → 事件那条红;apply 不写回 offence → offence 那条红;
    services.py 不写 concluded_tz → 时区那条红(D12:按殿的时区写死,地府默认 Asia/Shanghai)。"""
    case = _case(cn_tenant)
    response = cn_judge.post(f"{BASE}{case.pk}/conclude/",
                             {"verdict": "FAILED", "fail_reasons": ["TRADE_FRAUD"]}, format="json")
    assert response.status_code == 200, response.data
    case.refresh_from_db()
    assert case.fail_reasons == ["TRADE_FRAUD"]
    assert case.offence == "TRADE_FRAUD"
    event = SoulEvent.all_objects.get(soul=case.soul, event_type="JUDGMENT_CONCLUDED")
    assert event.payload["fail_reasons"] == ["TRADE_FRAUD"]
    assert case.concluded_tz == "Asia/Shanghai"
    assert response.data["concluded_at_local"].endswith("+08:00")


@pytest.mark.django_db
def test_the_document_hour_does_not_move_when_the_hall_changes_its_time_zone(cn_judge, cn_tenant):
    """D12 写死:改殿的时区之后,已结的案子仍按落印时的时区。变异:serializer 改读 `tenant.hall_timezone` → 红。"""
    case = _case(cn_tenant)
    cn_judge.post(f"{BASE}{case.pk}/conclude/", {"verdict": "FAILED", "fail_reasons": ["MURDER"]}, format="json")
    cn_tenant.settings = {**(cn_tenant.settings or {}), TIMEZONE_SETTING: "Europe/London"}
    cn_tenant.save(update_fields=["settings"])
    detail = cn_judge.get(f"{BASE}{case.pk}/").data
    assert detail["concluded_tz"] == "Asia/Shanghai"
    assert detail["concluded_at_local"].endswith("+08:00")


# ── D5:待定的理由码在 test_judgment_claim.py::TestDefer ─────────────────────────────────────


# ── D10:期限 ────────────────────────────────────────────────────────────────────────────────


@pytest.mark.django_db
def test_the_deadline_runs_from_claimable_and_uses_the_civilizations_default(cn_tenant):
    """地府 7 天。变异:DEFAULT_DEADLINE_DAYS 的 CHINESE 改成 8 → 红。"""
    case = _case(cn_tenant)
    assert case.claimable_since is not None
    assert deadline.deadline_at(case) == case.claimable_since + timedelta(days=7)
    cn_tenant.settings = {DEADLINE_SETTING: 3}
    cn_tenant.save(update_fields=["settings"])
    case.refresh_from_db()
    assert deadline.deadline_at(case) == case.claimable_since + timedelta(days=3)


@pytest.mark.django_db
def test_a_case_with_the_city_god_has_no_deadline_until_sent_on(cn_tenant):
    """从解送起算,不从开案。变异:refresh_claimable_since 不看 AT_CITY_GOD → 开案就有起点,第一条红。"""
    case = _case(cn_tenant, city_god_status=CityGodStatus.PENDING)
    assert case.claimable_since is None and deadline.deadline_at(case) is None
    case.city_god_status = CityGodStatus.SENT_ON
    case.sent_on_at = timezone.now()
    case.save(update_fields=["city_god_status", "sent_on_at"])
    case.refresh_from_db()
    assert case.claimable_since is not None and case.claimable_since >= case.created_at


@pytest.mark.django_db
def test_a_held_case_starts_on_its_release_day_in_the_halls_time_zone(cn_tenant):
    released = timezone.localdate() + timedelta(days=30)
    case = _case(cn_tenant, held_until=released)
    start = case.claimable_since.astimezone(ZoneInfo("Asia/Shanghai"))
    assert (start.date(), start.hour, start.minute) == (released, 0, 0)


@pytest.mark.django_db
def test_time_on_hold_is_not_counted(cn_judge, cn_tenant):
    """待定期间停表:撤销待定时那一段加进 deferred_total。变异:_apply_undefer 不累加 → 截止时间不后移,红。"""
    case = _case(cn_tenant)
    before = deadline.deadline_at(case)
    cn_judge.post(f"{BASE}{case.pk}/defer/", {"reason": "待补证"}, format="json")
    Judgment.all_objects.filter(pk=case.pk).update(deferred_at=timezone.now() - timedelta(days=2))
    case.refresh_from_db()
    frozen = deadline.remaining_seconds(case)
    assert not deadline.is_overdue(case)
    assert cn_judge.post(f"{BASE}{case.pk}/undefer/", {}, format="json").status_code == 200
    case.refresh_from_db()
    assert case.deferred_total >= timedelta(days=2)
    assert deadline.deadline_at(case) >= before + timedelta(days=2)
    assert abs(deadline.remaining_seconds(case) - frozen) < 60


@pytest.mark.django_db
def test_overdue_is_one_rule_for_the_row_the_filter_and_the_count(cn_judge, cn_tenant):
    """变异:overdue_q 用 `__gt` → 过期的那件不进 ?overdue=true,计数为 0,红。待定中的不算过期。"""
    late = _case(cn_tenant, name="过期")
    held = _case(cn_tenant, name="过期但待定")
    fresh = _case(cn_tenant, name="未过")
    Judgment.all_objects.filter(pk__in=[late.pk, held.pk]).update(
        claimable_since=timezone.now() - timedelta(days=8))
    Judgment.all_objects.filter(pk=held.pk).update(deferred_at=timezone.now(), defer_reason="x")

    rows = cn_judge.get(BASE, {"overdue": "true"}).data
    ids = {r["id"] for r in (rows["results"] if isinstance(rows, dict) else rows)}
    assert ids == {str(late.pk)}
    assert str(fresh.pk) not in ids
    counts = cn_judge.get(f"{BASE}queue-counts/").data
    assert counts["overdue"] == 1
    row = cn_judge.get(f"{BASE}{late.pk}/").data
    assert row["is_overdue"] is True and row["deadline_remaining_seconds"] < 0


# ── 退回重审 与 概览 ──────────────────────────────────────────────────────────────────────────


@pytest.mark.django_db
def test_returned_counts_retry_retrials_in_the_queue_and_city_god_returns_in_the_stats(cn_judge, cn_tenant):
    """用户:「退回重审」= 判 RETRY 与城隍退回补正两种都算。变异:hall_stats 漏加 CITY_GOD_RETURNED 那一项 → 1,红。"""
    first = _case(cn_tenant, name="重审")
    first.conclude("RETRY", "")
    retrial = Judgment.all_objects.get(retrial_of=first)
    returned = _case(cn_tenant, name="退回补正")
    SoulEvent.objects.create(soul=returned.soul, tenant=cn_tenant, event_type="CITY_GOD_RETURNED",
                             payload={"judgment_id": str(returned.pk)})

    assert cn_judge.get(f"{BASE}queue-counts/").data["returned"] == 1
    rows = cn_judge.get(BASE, {"returned": "true"}).data
    assert {r["id"] for r in (rows["results"] if isinstance(rows, dict) else rows)} == {str(retrial.pk)}

    stats = cn_judge.get(f"{BASE}hall-stats/").data
    assert stats["returned_this_month"] == 2
    assert stats["concluded_this_month"] == 1
    assert stats["timezone"] == "Asia/Shanghai"
    assert len(stats["weeks"]) == 12 and stats["weeks"][-1]["concluded"] == 1


@pytest.mark.django_db
def test_hall_stats_average_leaves_out_time_on_hold(cn_judge, cn_tenant):
    """平均用时 = 可认领到结案,扣掉待定。变异:hall_stats 不减 deferred_total → 3.0,红。"""
    case = _case(cn_tenant)
    case.conclude("FAILED", "")
    Judgment.all_objects.filter(pk=case.pk).update(
        claimable_since=case.concluded_at - timedelta(days=3), deferred_total=timedelta(days=1))
    assert cn_judge.get(f"{BASE}hall-stats/").data["avg_days"] == 2.0


# ── 冥界年报 ──────────────────────────────────────────────────────────────────────────────────


def _concluded(tenant, verdict, at, *, days=1.0, name="年报之魂", soul=None):
    case = _case(tenant, name=name) if soul is None else Judgment.objects.create(
        soul=soul, civilization=soul.civilization, court="第四殿", tenant=tenant)
    case.conclude(verdict, "")
    Judgment.all_objects.filter(pk=case.pk).update(
        created_at=at - timedelta(days=days), claimable_since=at - timedelta(days=days), concluded_at=at)
    case.refresh_from_db()
    return case


@pytest.mark.django_db
def test_annual_counts_souls_once_and_places_only_real_destinations(cn_judge, cn_tenant):
    """收了 = 今年开案的灵魂(重审另开的一件不再算一个);有了去处 = 结案且不是「再审一次」。
    变异:annual.py 的 `placed` 去掉 `.exclude(HEARS_AGAIN_Q)` → 2,红;`received` 去掉 `.distinct()` → 4,红。"""
    first = _case(cn_tenant, name="重审后有去处")
    first.conclude("RETRY", "")
    Judgment.all_objects.get(retrial_of=first).conclude("FAILED", "")
    _case(cn_tenant, name="只重审").conclude("RETRY", "")
    _case(cn_tenant, name="还没审")

    data = cn_judge.get(f"{BASE}annual/").data
    assert data["received"] == 3
    assert data["placed"] == 1
    assert data["by_civ"] == [{"civilization": "CHINESE", "received": 3}]
    assert data["concluded"] == 3
    assert data["returned"] == 2 and data["returned_pct"] == 66.7
    assert data["timezone"] == "Asia/Shanghai" and len(data["monthly"]) == 12


@pytest.mark.django_db
def test_annual_reads_the_year_in_the_halls_timezone_and_names_the_longest_case(cn_judge, cn_tenant):
    """UTC 2024-12-31 16:30 在上海已是 2025 年 1 月 1 日。变异:`_year_bounds` 用 UTC、或 `_monthly` 不 astimezone →
    这一件落进 2024 / 12 月,红。最久 = 可认领到结案扣掉待定,整天数;变异:`max` 改 `min` → 案号不对,红。"""
    from datetime import datetime

    new_year = datetime(2024, 12, 31, 16, 30, tzinfo=UTC)
    long = _concluded(cn_tenant, "FAILED", new_year, days=41.4, name="最久")
    _concluded(cn_tenant, "FAILED", new_year + timedelta(days=40), days=2)
    _concluded(cn_tenant, "RETRY", datetime(2024, 6, 1, 4, tzinfo=UTC))

    data = cn_judge.get(f"{BASE}annual/", {"year": "2025"}).data
    assert data["year"] == 2025
    assert data["monthly"][:2] == [1, 1] and sum(data["monthly"]) == 2
    assert data["last_year_monthly"][5] == 1 and sum(data["last_year_monthly"]) == 1
    assert data["longest"] == {"case_number": long.case_number, "soul_name": "最久", "days": 41}
    assert data["avg_days"] == 21.7
    # 上一年只有一件,判 RETRY:退回率 100;今年没有退回。
    assert data["returned_pct"] == 0.0 and data["last_year_returned_pct"] == 100.0


@pytest.mark.django_db
def test_annual_names_the_most_cited_article(cn_judge, cn_tenant):
    """变异:`_most_cited` 的 `order_by("-n", …)` 改成 `order_by("n", …)` → 引用一次的那条,红。"""
    from datetime import datetime

    from apps.judgment.models import JudgmentCitation, Statute

    def article(code, ordinal):
        return Statute.objects.create(tenant=cn_tenant, code=code, civilization="CHINESE", corpus="GONGGUOGE",
                                      ordinal=ordinal, polarity="OFFENCE", title_zh=code, title_en=code)

    often, once = article("CN-V4-T-01", 1), article("CN-V4-T-02", 2)
    at = datetime(2025, 3, 1, 4, tzinfo=UTC)
    for statutes in ([often, once], [often]):
        case = _concluded(cn_tenant, "FAILED", at)
        for statute in statutes:
            JudgmentCitation.objects.create(judgment=case, statute=statute, tenant=cn_tenant)

    cited = cn_judge.get(f"{BASE}annual/", {"year": "2025"}).data["most_cited"]
    assert cited["code"] == "CN-V4-T-01" and cited["citations"] == 2
    assert cited["corpus"] == "GONGGUOGE" and cited["ordinal"] == 1
    assert cited["corpus_size"] == Statute.objects.filter(tenant=cn_tenant, corpus="GONGGUOGE").count()


@pytest.mark.django_db
@pytest.mark.parametrize("year", ["abc", "20", "3000"])
def test_annual_refuses_a_year_that_is_not_one(cn_judge, year):
    """变异:views.py 去掉年份的检查 → `int("abc")` 500 / 一个空年报 200,红。"""
    assert cn_judge.get(f"{BASE}annual/", {"year": year}).status_code == 400


# ── D9:欧洲罪种 ───────────────────────────────────────────────────────────────────────────────


def test_the_seven_terraces_name_the_seven_sins_in_order():
    """炼狱一至七台:傲慢、嫉妒、愤怒、懒惰、贪婪、暴食、淫欲(Purg. X–XXVII)。键名同 `reject_reason.eu.sin.*`。"""
    from apps.judgment.fail_reasons import DEADLY_SIN_BY_STATUTE

    assert [DEADLY_SIN_BY_STATUTE[f"EU-DS-T{n}"] for n in range(1, 8)] == [
        "pride", "envy", "wrath", "sloth", "greed", "gluttony", "lust"]


# ── 迁移 judgment/0051:往返 ──────────────────────────────────────────────────────────────────


def test_0051_backfills_claimable_since_and_goes_back(migration_round_trip):
    """起点 = 开案 / 解送 / held_until 0 点(UTC)取最晚;在城隍处、到不了审判殿的留空。降回 0050 七列消失。
    变异:回填里去掉 `.exclude(city_god_status__in=AT_CITY_GOD)` → M-4 有了起点,红。"""
    import datetime as dt

    from tests.migration_roundtrip import migrate_to

    before = [("judgment", "0050_backfill_judgment_owner_org")]
    after = [("judgment", "0051_v4_fail_reasons_deadline_doc_tz")]
    state = migrate_to(before)
    tenant = state.get_model("tenants", "Tenant")._base_manager.create(code="CN_DIYU", display_name="地府")
    soul = state.get_model("souls", "Soul")._base_manager.create(name="回填", tenant=tenant, home_tenant=tenant)
    rows = state.get_model("judgment", "Judgment")._base_manager
    sent = timezone.now() + dt.timedelta(hours=1)  # 晚于开案:回填取最晚的那个,才看得出用的是解送时间
    held = (timezone.now() + dt.timedelta(days=40)).date()
    rows.create(soul=soul, tenant=tenant, case_number="M-1")
    rows.create(soul=soul, tenant=tenant, case_number="M-2", city_god_status="SENT_ON", sent_on_at=sent)
    rows.create(soul=soul, tenant=tenant, case_number="M-3", held_until=held)
    rows.create(soul=soul, tenant=tenant, case_number="M-4", city_god_status="RETURNED")
    rows.create(soul=soul, tenant=tenant, case_number="M-5", duat_stage="NAMELESS")

    state = migrate_to(after)
    manager = state.get_model("judgment", "Judgment")._base_manager
    got = dict(manager.values_list("case_number", "claimable_since"))
    created = dict(manager.values_list("case_number", "created_at"))
    assert got["M-1"] == created["M-1"]
    assert got["M-2"] == sent
    assert got["M-3"] == dt.datetime.combine(held, dt.time.min, tzinfo=dt.UTC)
    assert got["M-4"] is None and got["M-5"] is None

    state = migrate_to(before)
    names = {f.name for f in state.get_model("judgment", "Judgment")._meta.get_fields()}
    assert not names & {"fail_reasons", "fail_reason_note", "greek_account", "greek_curability", "concluded_tz",
                        "claimable_since", "deferred_total"}
