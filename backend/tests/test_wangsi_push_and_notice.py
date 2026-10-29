"""枉死城冤情申诉的推送与通知(2026-10-29 用户决定):四种结论推给灵魂 App(`soul_push.services._wangsi_rule`),
提出申诉通知城隍名下官员(`apps/judgment/wangsi.py::_notify_filed`)。都在提交之后。"""
from datetime import date, timedelta

import pytest

from apps.judgment import wangsi
from apps.judgment.models import CityGod, GrievanceLevel, Judgment
from apps.notifications.models import UserNotification
from apps.soul_accounts import services as svc
from apps.soul_accounts.models import AccountOrigin
from apps.soul_push.models import PushDelivery
from apps.souls.models import Soul
from tests import sentence_plan_support as sp
from tests.soul_account_support import soul_client
from tests.soul_push_support import enqueued, push_on, register  # noqa: F401

pytestmark = pytest.mark.django_db


@pytest.fixture
def god(cn_tenant):
    return CityGod.objects.create(tenant=cn_tenant, name="常熟县城隍", regions=["常熟"], is_default=True)


@pytest.fixture
def officer_pushes(monkeypatch):
    from apps.officer_app import push

    calls = []
    monkeypatch.setattr(push, "notify_users", lambda users, target=None: calls.append(
        (sorted(u.pk for u in users), target)))
    return calls


def _held(tenant, level=GrievanceLevel.SEVERE):
    fated = date.today() + timedelta(days=400)
    soul = Soul.objects.create(name="钱谦益", tenant=tenant, origin_location="常熟", fated_death_year=fated.year,
                               fated_death_month=fated.month, fated_death_day=fated.day)
    case = soul.die(death_date=date.today())
    assert case.untimely
    Judgment.all_objects.filter(pk=case.pk).update(grievance_level=level)
    account, _ = svc.provision_account(soul, AccountOrigin.OFFICER)
    account.must_change_password = False
    account.initial_password_expires_at = None
    account.save()
    return account, case


# ── 提出:通知城隍名下官员 ─────────────────────────────────────────────


def test_filing_tells_the_city_gods_officers_after_commit(cn_tenant, god, officer_pushes,
                                                          django_capture_on_commit_callbacks):
    clerk = sp.officer("clerk", "JUDGE", cn_tenant)
    bystander = sp.officer("bystander", "JUDGE", cn_tenant)
    lead = sp.officer("lead", "MODERATOR", cn_tenant)
    god.officers.add(clerk)
    account, case = _held(cn_tenant)
    UserNotification.objects.all().delete()  # 收案那条(CITY_GOD_CASE_RECEIVED)不是这里测的
    officer_pushes.clear()

    with django_capture_on_commit_callbacks(execute=False) as pending:
        wangsi.file_grievance(case.pk, None, "为人所害", account=account)
    assert not UserNotification.objects.exists()  # 提交之前什么都不发
    for callback in pending:
        callback()

    note = UserNotification.objects.get(user=clerk)
    assert note.notification_type == "WANGSI_GRIEVANCE_FILED" and "钱谦益" in note.message
    assert (note.related_resource, note.related_id) == ("judgment", str(case.pk))
    assert "为人所害" not in note.message  # 申诉原文不进通知
    assert not UserNotification.objects.filter(user__in=[bystander, lead]).exists()
    assert officer_pushes == [([clerk.pk], {"kind": "wangsi", "id": str(case.pk)})]


def test_a_city_god_with_no_officers_falls_back_to_the_hall_admins_without_an_app_push(
        cn_tenant, god, officer_pushes, django_capture_on_commit_callbacks):
    lead = sp.officer("lead", "MODERATOR", cn_tenant)
    judge = sp.officer("judge", "JUDGE", cn_tenant)
    account, case = _held(cn_tenant)
    UserNotification.objects.all().delete()
    officer_pushes.clear()
    with django_capture_on_commit_callbacks(execute=True):
        wangsi.file_grievance(case.pk, None, "冤", account=account)
    assert UserNotification.objects.get(user=lead).notification_type == "WANGSI_GRIEVANCE_FILED"
    assert not UserNotification.objects.filter(user=judge).exists()
    # 「枉死申诉」待办只列城隍名下官员的,管理员的 App 里没有这一件:不推。
    assert officer_pushes == [([], {"kind": "wangsi", "id": str(case.pk)})]


def test_the_notice_falls_in_the_city_god_category_and_the_push_target_too():
    from apps.notifications.categories import category_of
    from apps.officer_app.push import CATEGORY_OF_TARGET

    assert category_of("WANGSI_GRIEVANCE_FILED") == "city_god"
    assert CATEGORY_OF_TARGET["wangsi"] == "city_god"


# ── 结论:推给灵魂 ─────────────────────────────────────────────────────


@pytest.mark.parametrize(("upheld", "deliver", "late", "kind"), [
    (True, False, False, "wangsi_upheld"),
    (True, False, True, "wangsi_upheld_late"),
    (True, True, False, "wangsi_delivered"),
    (False, False, False, "wangsi_rejected"),
])
def test_each_conclusion_is_pushed_to_the_soul(cn_tenant, god, admin_user, push_on, enqueued,  # noqa: F811
                                               django_capture_on_commit_callbacks, upheld, deliver, late, kind):
    account, case = _held(cn_tenant)
    assert register(soul_client(account)).status_code == 201
    with django_capture_on_commit_callbacks(execute=True):
        wangsi.file_grievance(case.pk, None, "为人所害", account=account)
    assert not PushDelivery.objects.filter(kind__startswith="wangsi").exists()  # 提出不推
    if late:
        Judgment.all_objects.filter(pk=case.pk).update(held_until=date.today() - timedelta(days=1))
    with django_capture_on_commit_callbacks(execute=True):
        wangsi.decide_grievance(case.pk, admin_user, upheld=upheld, note="审核批语", deliver=deliver)

    delivery = PushDelivery.objects.get(kind__startswith="wangsi")
    assert delivery.kind == kind and delivery.account_id == account.pk
    assert delivery.data == {"screen": "Life", "judgment_id": str(case.pk), "kind": kind}
    assert "审核批语" not in delivery.body and "为人所害" not in delivery.body
    assert [str(delivery.pk)] in enqueued


def test_a_second_rejection_after_refiling_is_pushed_again(cn_tenant, god, admin_user, push_on, enqueued,  # noqa: F811
                                                           django_capture_on_commit_callbacks):
    account, case = _held(cn_tenant)
    assert register(soul_client(account)).status_code == 201
    for _ in range(2):
        with django_capture_on_commit_callbacks(execute=True):
            wangsi.file_grievance(case.pk, None, "冤", account=account)
            wangsi.decide_grievance(case.pk, admin_user, upheld=False, note="不属实")
    assert PushDelivery.objects.filter(kind="wangsi_rejected", account=account).count() == 2


def test_a_rolled_back_decision_pushes_nothing(cn_tenant, god, admin_user, push_on, enqueued):  # noqa: F811
    from django.db import transaction

    account, case = _held(cn_tenant)
    assert register(soul_client(account)).status_code == 201
    wangsi.file_grievance(case.pk, None, "冤", account=account)
    with pytest.raises(RuntimeError), transaction.atomic():
        wangsi.decide_grievance(case.pk, admin_user, upheld=False, note="x")
        raise RuntimeError
    assert not PushDelivery.objects.filter(kind__startswith="wangsi").exists()
    assert enqueued == []
