"""用户 2026-10-29 拍板的六件事,各一组:

1. 执行处置 = 开始服刑,刑期满了才往下走(`expiry.serving`、`DispositionService.finish_serving`、`release` 动作)。
2. 地府判无罪不发落、不建刑期节点,结案(流程走完)后直接候转世(`acquitted_to_rebirth`)。
3. 「再审」的裁决(RETRY,欧洲以外的 PURGATORY)四文明统一重开一案(`hears_again`);重开 / 申诉改判里拒绝。
4. 转世按灵魂已批准申请里的意愿六道,官员改道要写原因并留痕(`resolve_rebirth_form`)。
5. souls/0051 回填存量的地府善判灵魂。
6. 转世完成时出生日是当天,部洲阳寿从这天算。
"""
import datetime

import pytest
from django.utils import timezone

from apps.disposition.expiry import expire_for_tenant, releasable, serving
from apps.disposition.models import Disposition
from apps.disposition.services import DispositionService
from apps.events.models import SoulEvent
from apps.judgment.models import Judgment, Verdict
from apps.reincarnation.services import RebirthBlocked, ReincarnationService, assert_may_be_reborn
from apps.sentence_plan.models import SentenceNode, SentencePlan
from apps.souls.models import Soul, SoulState
from tests import sentence_plan_support as sp
from tests.soul_account_support import officer_client, ready_soul

pytestmark = pytest.mark.django_db


@pytest.fixture
def cn():
    return sp.tenant("CN_DIYU")


def _moderator(tenant, name="serve_mod"):
    return sp.officer(name, "MODERATOR", tenant)


def _termed(cn, years=3):
    """地府 FAILED 结案、判官定了刑期:一份挂在原属节点上的有期处置。返回 (soul, plan, disposition)。"""
    soul, case = sp.open_case(cn)
    case.conclude(Verdict.FAILED, "", term_years=years)
    soul.refresh_from_db()
    disposition = Disposition.all_objects.get(judgment=case)
    return soul, SentencePlan.all_objects.get(soul=soul), disposition


# ── 1. 执行即服刑 ─────────────────────────────────────────────────────────


def test_executing_a_termed_disposition_starts_serving_and_holds_the_plan(cn):
    soul, plan, disposition = _termed(cn)
    assert DispositionService.execute(disposition) is True
    disposition.refresh_from_db()
    soul.refresh_from_db()
    plan.refresh_from_db()
    assert serving(disposition) and not releasable(disposition)
    assert sp.node(plan, 1).status == "ACTIVE"  # 受刑中
    assert (plan.status, soul.current_state) == ("ACTIVE", SoulState.DISPOSED)
    with pytest.raises(RebirthBlocked) as blocked:
        assert_may_be_reborn(soul)
    assert blocked.value.detail["code"] == "term_not_served"
    assert blocked.value.detail["term_end"]["year"] == timezone.localdate().year + 3


def test_a_disposition_without_a_term_is_served_on_execution_as_before(cn):
    soul, case = sp.open_case(cn)
    case.conclude(Verdict.FAILED, "")
    disposition = Disposition.all_objects.get(judgment=case)
    assert DispositionService.execute(disposition) is True
    soul.refresh_from_db()
    assert soul.current_state == SoulState.REINCARNATING
    assert SentencePlan.all_objects.get(soul=soul).status == "COMPLETED"


def test_release_refuses_before_the_term_ends_and_releases_once_it_has(cn):
    soul, plan, disposition = _termed(cn)
    mod = officer_client(_moderator(cn))
    assert mod.post(f"/api/v1/disposition/{disposition.pk}/release/").data["code"] == "not_serving"
    assert mod.post(f"/api/v1/disposition/{disposition.pk}/execute/", {}, format="json").status_code == 200
    early = mod.post(f"/api/v1/disposition/{disposition.pk}/release/")
    assert (early.status_code, early.data["code"]) == (409, "term_not_ended")
    soul.refresh_from_db()
    assert soul.current_state == SoulState.DISPOSED

    # 起算日改到五年前:刑期已满,每日检查还没跑到 —— 官员「期满释放」。
    Disposition.all_objects.filter(pk=disposition.pk).update(term_start_year=timezone.localdate().year - 5)
    listed = mod.get(f"/api/v1/disposition/{disposition.pk}/").data
    assert listed["can_release"] is True
    done = mod.post(f"/api/v1/disposition/{disposition.pk}/release/")
    assert done.status_code == 200, done.data
    assert done.data["expired_at"] is not None and done.data["can_release"] is False
    soul.refresh_from_db()
    plan.refresh_from_db()
    assert sp.node(plan, 1).status == "COMPLETED"
    assert (plan.status, soul.current_state) == ("COMPLETED", SoulState.REINCARNATING)
    assert SoulEvent.objects.filter(soul=soul, event_type="DISPOSITION_EXPIRED").count() == 1
    assert SoulEvent.objects.filter(soul=soul, event_type="REINCARNATION_TRIGGERED").count() == 1


def test_the_daily_sweep_ends_the_serving_stop_too(cn):
    soul, plan, disposition = _termed(cn, years=1)
    DispositionService.execute(disposition)
    later = timezone.localdate() + datetime.timedelta(days=400)
    assert expire_for_tenant(cn, later)["expired"] == 1
    soul.refresh_from_db()
    plan.refresh_from_db()
    assert (plan.status, soul.current_state) == ("COMPLETED", SoulState.REINCARNATING)


def test_release_needs_the_execute_permission(cn):
    _soul, _plan, disposition = _termed(cn)
    viewer = sp.officer("serve_judge", "JUDGE", cn)  # disposition.read,没有 disposition.execute
    assert officer_client(viewer).post(f"/api/v1/disposition/{disposition.pk}/release/").status_code == 403


# ── 2. 地府判无罪 ──────────────────────────────────────────────────────────


def test_a_diyu_acquittal_without_a_flow_goes_straight_to_rebirth(cn):
    soul, case = sp.open_case(cn)
    case.conclude(Verdict.PASSED, "", create_workflow=False)
    soul.refresh_from_db()
    plan = SentencePlan.all_objects.get(soul=soul)
    assert not Disposition.all_objects.filter(judgment=case).exists()
    assert not SentenceNode.all_objects.filter(plan=plan).exists()
    assert (plan.status, soul.current_state) == ("COMPLETED", SoulState.REINCARNATING)


def test_a_diyu_acquittal_waits_for_its_flow_then_goes_to_rebirth(cn):
    from apps.workflow.models import ApprovalWorkflow, ApprovalWorkflowStatus

    soul, case = sp.open_case(cn)
    case.conclude(Verdict.PASSED, "", create_workflow=True)
    soul.refresh_from_db()
    plan = SentencePlan.all_objects.get(soul=soul)
    assert (plan.status, soul.current_state) == ("ACTIVE", SoulState.DISPOSED)

    flow = ApprovalWorkflow.objects.get(judgment=case)
    flow._finish(ApprovalWorkflowStatus.COMPLETED, timezone.now())
    flow.save()
    soul.refresh_from_db()
    plan.refresh_from_db()
    assert (plan.status, soul.current_state) == ("COMPLETED", SoulState.REINCARNATING)


def test_a_european_acquittal_is_still_placed(eu_tenant):
    soul, case = sp.open_case(eu_tenant)
    case.conclude(Verdict.PASSED, "")
    assert Disposition.all_objects.filter(judgment=case).exists()


# ── 3. 再审统一为重开一案 ────────────────────────────────────────────────


@pytest.mark.parametrize("home, verdict", [
    ("CN_DIYU", "RETRY"), ("CN_DIYU", "PURGATORY"), ("GR_HADES", "RETRY"), ("GR_HADES", "PURGATORY"),
    ("EU_HEAVEN_HELL", "RETRY"),
])
def test_an_undecided_original_verdict_opens_a_retrial_and_places_nothing(home, verdict):
    soul, case = sp.open_case(sp.tenant(home))
    case.conclude(verdict, "")
    soul.refresh_from_db()
    assert soul.current_state == SoulState.JUDGING
    assert not Disposition.all_objects.filter(soul=soul).exists()
    assert not SentencePlan.all_objects.filter(soul=soul).exists()
    retrial = Judgment.objects.get(retrial_of=case)
    assert retrial.verdict is None
    assert SoulEvent.objects.get(soul=soul, event_type="JUDGMENT_INITIATED",
                                 payload__retrial_of=str(case.pk)).payload["reason"] == verdict


def test_a_european_purgatory_verdict_is_still_a_destination(eu_tenant):
    soul, case = sp.open_case(eu_tenant)
    case.conclude(Verdict.PURGATORY, "")
    assert Disposition.all_objects.filter(judgment=case).exists()


@pytest.mark.parametrize("home, verdict, refused", [
    ("CN_DIYU", "PURGATORY", True), ("GR_HADES", "RETRY", True), ("EG_DUAT", "PURGATORY", True),
    ("EU_HEAVEN_HELL", "PURGATORY", False), ("CN_DIYU", "FAILED", False),
])
def test_reopen_and_appeal_refuse_an_undecided_verdict(home, verdict, refused):
    from apps.sentence_plan.requests import PlanChangeRefusedError, _refuse_undecided

    soul = Soul.objects.create(name="再审", tenant=sp.tenant(home))
    if refused:
        with pytest.raises(PlanChangeRefusedError) as exc:
            _refuse_undecided(soul, verdict)
        assert exc.value.code == "retry_not_a_destination"
    else:
        _refuse_undecided(soul, verdict)


# ── 4. 转世按灵魂所愿 ─────────────────────────────────────────────────────


def _approved(cn, desired):
    from apps.soul_accounts import rebirth
    from apps.soul_accounts.models import RebirthApplication
    from tests.soul_account_support import sentence_served

    account, _client = ready_soul(cn, name="愿转")
    sentence_served(account)
    application = rebirth.submit(account, desired_form=desired)
    RebirthApplication.objects.filter(pk=application.pk).update(status="APPROVED")
    return Soul.objects.get(pk=account.soul_id)


def _reborn(client, soul, **body):
    return client.post("/api/v1/reincarnation/reborn/", {"soul_id": str(soul.pk), **body}, format="json")


def test_the_officer_reborn_defaults_to_the_souls_approved_wish(cn, admin_user):
    soul = _approved(cn, "ANIMAL")
    assert officer_client(admin_user).get(f"/api/v1/souls/{soul.pk}/").data["desired_rebirth_form"] == "ANIMAL"
    response = _reborn(officer_client(admin_user), soul)
    assert response.status_code == 201, response.data
    assert response.data["rebirth_form"] == "ANIMAL"
    payload = SoulEvent.objects.get(soul=soul, event_type="REINCARNATION_COMPLETED").payload
    assert (payload["desired_form"], payload["rebirth_form_reason"]) == ("ANIMAL", "")


def test_another_path_than_the_wish_needs_a_reason_and_is_recorded(cn, admin_user):
    soul = _approved(cn, "ANIMAL")
    client = officer_client(admin_user)
    refused = _reborn(client, soul, rebirth_form="HUMAN")
    assert (refused.status_code, refused.data["code"], refused.data["desired_form"]) == (
        400, "rebirth_form_reason_required", "ANIMAL")
    assert Soul.objects.get(pk=soul.pk).current_state == SoulState.REINCARNATING  # nothing moved

    done = _reborn(client, soul, rebirth_form="HUMAN", rebirth_form_reason="阎罗复核:功德足人道")
    assert done.status_code == 201, done.data
    payload = SoulEvent.objects.get(soul=soul, event_type="REINCARNATION_COMPLETED").payload
    assert (payload["rebirth_form"], payload["desired_form"], payload["rebirth_form_reason"]) == (
        "HUMAN", "ANIMAL", "阎罗复核:功德足人道")


def test_without_an_application_the_officer_chooses_as_before(cn, admin_user):
    from tests.soul_account_support import sentence_served

    account, _ = ready_soul(cn, name="无申请")
    sentence_served(account)
    soul = Soul.objects.get(pk=account.soul_id)
    response = _reborn(officer_client(admin_user), soul, rebirth_form="ASURA")
    assert (response.status_code, response.data["rebirth_form"]) == (201, "ASURA")


# ── 6. 出生日 = 转世那天 ────────────────────────────────────────────────


def test_rebirth_is_born_today_and_the_continent_lifespan_counts_from_today(cn):
    soul = Soul.objects.create(name="旧生", tenant=cn, birth_year=1900, birth_month=3, birth_day=4,
                               current_state=SoulState.REINCARNATING)
    ReincarnationService.complete_rebirth(soul=soul, new_identity="新生", rebirth_form="HUMAN",
                                          rebirth_continent="NANZHAN")
    soul.refresh_from_db()
    today = timezone.localdate()
    assert (soul.birth_year, soul.birth_month, soul.birth_day) == (today.year, today.month, today.day)
    assert soul.fated_death_year == today.year + 100  # 南瞻部洲人寿百岁(docs/07 §人道)


# ── 5. 回填 ────────────────────────────────────────────────────────────────


def test_the_backfill_reopens_rebirth_for_souls_parked_in_diyu_heaven(cn):
    import importlib

    from django.apps import apps as registry
    from django.db import connection

    from apps.realms.models import Realm

    heaven = Realm.all_objects.create(realm_code="DY_01_HEAVEN", civilization="CHINESE", name_local="天",
                                      realm_type="BLISS", is_eternal=True, tenant=cn)
    hell = Realm.all_objects.create(realm_code="DY_COURT_02_CHUJIANG", civilization="CHINESE", name_local="殿",
                                    realm_type="HELL", tenant=cn)

    def parked(name, realm):
        soul = Soul.objects.create(name=name, tenant=cn)
        Soul.all_objects.filter(pk=soul.pk).update(current_state=SoulState.SETTLED)
        d = Disposition.objects.create(soul=soul, tenant=cn, destination_realm=realm, is_eternal=True,
                                       is_executed=True, executed_at=timezone.now())
        p = SentencePlan.all_objects.create(soul=soul, tenant=cn, status="COMPLETED", completed_at=timezone.now())
        SentenceNode.all_objects.create(plan=p, order=1, tenant_code="CN_DIYU", is_home=True, status="ETERNAL",
                                        realm_code=realm.realm_code, is_eternal=True, disposition_id=d.pk)
        return soul, d

    acquitted, d1 = parked("善魂", heaven)
    damned, d2 = parked("永狱", hell)  # 永久的殿,不动
    eu = sp.tenant("EU_HEAVEN_HELL")
    european = Soul.objects.create(name="欧魂", tenant=eu)
    Soul.all_objects.filter(pk=european.pk).update(current_state=SoulState.SETTLED)
    Disposition.objects.create(soul=european, tenant=eu, destination_realm=heaven, is_eternal=True,
                               is_executed=True, executed_at=timezone.now())

    migration = importlib.import_module("apps.souls.migrations.0051_backfill_diyu_acquitted_to_rebirth")

    class Editor:
        pass

    editor = Editor()
    editor.connection = connection
    migration.backfill(registry, editor)

    states = dict(Soul.all_objects.filter(pk__in=[acquitted.pk, damned.pk, european.pk])
                  .values_list("pk", "current_state"))
    assert states == {acquitted.pk: "REINCARNATING", damned.pk: "SETTLED", european.pk: "SETTLED"}
    assert Disposition.all_objects.get(pk=d1.pk).is_eternal is False
    assert Disposition.all_objects.get(pk=d2.pk).is_eternal is True
    node = SentenceNode.all_objects.get(disposition_id=d1.pk)
    assert (node.status, node.is_eternal) == ("COMPLETED", False)
    assert_may_be_reborn(Soul.objects.get(pk=acquitted.pk))  # 不再被当成永久刑期
    assert not SoulEvent.objects.filter(soul=acquitted, event_type="STATE_CHANGED").exists()  # 迁移不写事件
