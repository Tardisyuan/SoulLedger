"""转世的业务闸(2026-10-27 用户决定,功能审查 #1 #3 #5 #9)。

- 受刑计划没走完、或本世有未赦免的永久刑期 → `reborn` 409,灵魂与计划原地不动;
- 本世最近一份转生申请驳回 / 未决 → 409 `rebirth_not_approved`;已批准照常(仍受配额);没申请过的官员照样能办;
- 孟婆汤按原属文明判断,重开计划清掉已饮的记录;
- `disposition_id` 只认这个灵魂自己的处置。
"""
from types import SimpleNamespace

import pytest

from apps.disposition.models import Disposition
from apps.sentence_plan.models import SentencePlan, SentencePlanStatus
from apps.soul_accounts.models import RebirthApplication, RebirthApplicationStatus
from apps.souls.models import Soul, SoulState
from apps.workflow.models import ApprovalWorkflow, CaseType
from tests.soul_account_support import officer_client, ready_soul

pytestmark = pytest.mark.django_db

REBORN = "/api/v1/reincarnation/reborn/"


def _reborn(admin_user, soul, **extra):
    return officer_client(admin_user).post(REBORN, {"soul_id": str(soul.pk), **extra}, format="json")


def _disposed(tenant, name="待转"):
    return Soul.objects.create(name=name, tenant=tenant, current_state=SoulState.DISPOSED)


def test_an_unfinished_sentence_plan_refuses_rebirth_and_nothing_moves(cn_tenant, admin_user):
    soul = _disposed(cn_tenant)
    plan = SentencePlan.all_objects.create(soul=soul, tenant=cn_tenant, status=SentencePlanStatus.ACTIVE)
    res = _reborn(admin_user, soul)
    assert (res.status_code, res.data["code"]) == (409, "plan_in_progress"), res.data
    soul.refresh_from_db()
    plan.refresh_from_db()
    assert soul.current_state == SoulState.DISPOSED and plan.status == SentencePlanStatus.ACTIVE
    assert not soul.reincarnations.exists()


def test_an_eternal_sentence_refuses_rebirth_unless_pardoned(cn_tenant, admin_user):
    from apps.sentence_plan.models import SentenceNode, SentenceNodeStatus

    soul = _disposed(cn_tenant)
    eternal = Disposition.objects.create(soul=soul, tenant=cn_tenant, is_eternal=True)
    res = _reborn(admin_user, soul, disposition_id=str(eternal.pk))
    assert (res.status_code, res.data["code"]) == (409, "eternal_sentence"), res.data
    # Without naming the disposition the soul's own eternal sentence still stands in the way.
    assert _reborn(admin_user, soul).data["code"] == "eternal_sentence"
    assert Soul.objects.get(pk=soul.pk).current_state == SoulState.DISPOSED
    # Pardoned (the plan was cancelled: the eternal node became ABORTED) → the road is open again.
    plan = SentencePlan.all_objects.create(soul=soul, tenant=cn_tenant, status=SentencePlanStatus.CANCELLED)
    SentenceNode.all_objects.create(plan=plan, order=1, tenant_code=cn_tenant.code, is_home=True,
                                    status=SentenceNodeStatus.ABORTED, disposition_id=eternal.pk, is_eternal=True)
    assert _reborn(admin_user, soul, disposition_id=str(eternal.pk)).status_code == 201


def _application(account, status):
    soul = account.soul
    return RebirthApplication.objects.create(
        soul=soul, account=account, cycle=account.cycle, desired_form="HUMAN", status=status,
        workflow=ApprovalWorkflow.objects.create(soul=soul, workflow_name="x", case_type=CaseType.REBIRTH_APPLICATION),
    )


@pytest.mark.parametrize("status", [RebirthApplicationStatus.REJECTED, RebirthApplicationStatus.UNDER_REVIEW,
                                    RebirthApplicationStatus.APPEALING, RebirthApplicationStatus.APPEAL_REJECTED])
def test_a_rejected_or_undecided_application_refuses_rebirth(cn_tenant, admin_user, status):
    account, _ = ready_soul(cn_tenant, state=SoulState.REINCARNATING)
    _application(account, status)
    res = _reborn(admin_user, account.soul)
    assert (res.status_code, res.data["code"]) == (409, "rebirth_not_approved"), res.data
    assert Soul.objects.get(pk=account.soul_id).current_state == SoulState.REINCARNATING


def test_an_approved_application_waits_for_a_free_quota_slot(cn_tenant, admin_user):
    cn_tenant.settings = {**(cn_tenant.settings or {}), "rebirth_monthly_quota": {"HUMAN": 0}}
    cn_tenant.save(update_fields=["settings"])
    account, _ = ready_soul(cn_tenant, state=SoulState.REINCARNATING)
    _application(account, RebirthApplicationStatus.APPROVED)
    res = _reborn(admin_user, account.soul, rebirth_form="HUMAN")
    assert (res.status_code, res.data["code"]) == (409, "rebirth_quota_full")
    cn_tenant.settings = {**cn_tenant.settings, "rebirth_monthly_quota": {"HUMAN": 1}}
    cn_tenant.save(update_fields=["settings"])
    assert _reborn(admin_user, account.soul, rebirth_form="HUMAN").status_code == 201


def test_a_soul_that_never_applied_may_still_be_reborn_by_an_officer(cn_tenant, admin_user):
    soul = Soul.objects.create(name="未申请", tenant=cn_tenant, current_state=SoulState.REINCARNATING)
    assert _reborn(admin_user, soul).status_code == 201


def test_another_souls_disposition_is_not_found(cn_tenant, admin_user):
    soul = _disposed(cn_tenant, "本魂")
    soul.description = "记得前尘"
    soul.save()
    other = _disposed(cn_tenant, "他魂")
    theirs = Disposition.objects.create(soul=other, tenant=cn_tenant, memory_reset="FULL")
    res = _reborn(admin_user, soul, disposition_id=str(theirs.pk))
    assert res.status_code == 404
    soul.refresh_from_db()
    assert soul.current_state == SoulState.DISPOSED and soul.description == "记得前尘"


def test_the_soup_follows_the_home_civilization(cn_tenant, eu_tenant, settings):
    from apps.reincarnation.services import ReincarnationService, SoupNotTaken, drink_soup, needs_soup

    settings.MENGPO_SOUP_REQUIRED = True
    soul = Soul.objects.create(name="暂居", tenant=cn_tenant, current_state=SoulState.REINCARNATING)
    Soul.all_objects.filter(pk=soul.pk).update(tenant=eu_tenant)  # resides abroad, belongs to Diyu
    soul = Soul.all_objects.get(pk=soul.pk)
    assert soul.civilization == "EUROPEAN" and needs_soup(soul)
    with pytest.raises(SoupNotTaken):
        ReincarnationService.complete_rebirth(soul=soul)
    drink_soup(soul)  # not refused as `not_diyu`
    assert Soul.all_objects.get(pk=soul.pk).soup_taken_at is not None


def test_reopening_the_plan_clears_the_soup(cn_tenant):
    from django.utils import timezone

    from apps.sentence_plan.requests import _reopen

    soul = Soul.objects.create(name="重开", tenant=cn_tenant, current_state=SoulState.REINCARNATING)
    Soul.all_objects.filter(pk=soul.pk).update(soup_taken_at=timezone.now())
    soul = Soul.all_objects.get(pk=soul.pk)
    plan = SentencePlan.all_objects.create(soul=soul, tenant=cn_tenant, status=SentencePlanStatus.COMPLETED)
    assert _reopen(soul, plan, [], SimpleNamespace(pk="j"))
    soul = Soul.all_objects.get(pk=soul.pk)
    assert soul.current_state == SoulState.DISPOSED and soul.soup_taken_at is None
