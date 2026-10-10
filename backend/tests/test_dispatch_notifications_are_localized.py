"""调度的四条站内通知(提案 / 批准 / 驳回 / 取消)各有专门的类型,标题与正文走语言包、按请求语言渲染。

此前批准 / 驳回 / 提案是英文字面量,取消是 SYSTEM 加英文。现在库里存 zh-Hans 渲染和 `params`,
读的时候按 `Accept-Language` 重渲染(`apps/notifications/messages.py`,权威在语言包 `official_notify`)。
每条都断言「该收的人收到」和「不该收的人没收到」;事务回滚不发。通知都是站内的:不进邮件、不进手机推送,
所以锁屏上没有灵魂名与理由的问题。
"""
import pytest
from django.contrib.auth import get_user_model
from django.db import transaction
from rest_framework.test import APIClient
from rest_framework_simplejwt.tokens import RefreshToken

from apps.dispatch.models import DispatchRecord
from apps.dispatch.services import DispatchService
from apps.notifications.models import UserNotification
from apps.souls.models import Soul, SoulState
from apps.tenants.models import Tenant

pytestmark = pytest.mark.django_db
User = get_user_model()


class Hall:
    pass


@pytest.fixture
def hall(db):
    w = Hall()
    tenants = [
        Tenant.objects.get_or_create(code=code, defaults={"display_name": code, "dispatch_enabled": True})[0]
        for code in ("NT_A", "NT_B", "NT_C")
    ]
    w.a, w.b, w.c = tenants
    users = [
        User.objects.create_user(username=f"nt_{t.code[-1].lower()}", password="x", role="MODERATOR", tenant=t)
        for t in tenants
    ]
    w.ua, w.ub, w.uc = users
    w.soul = Soul.objects.create(name="孟婆之魂", current_state=SoulState.ALIVE, tenant=w.a)
    return w


def _propose(w, capture):
    with capture(execute=True):
        return DispatchService.propose(w.a, w.b, w.soul, w.ua, "x" * 30)


def _mine(user, kind=None):
    rows = UserNotification.objects.filter(user=user)
    return rows.filter(notification_type=kind) if kind else rows


def _read(user, lang):
    client = APIClient()
    token = RefreshToken.for_user(user)
    token["tenant_code"] = user.tenant.code
    client.credentials(HTTP_AUTHORIZATION=f"Bearer {token.access_token}", HTTP_ACCEPT_LANGUAGE=lang)
    body = client.get("/api/v1/notifications/").json()
    return body.get("results", body)


def test_a_proposal_tells_the_target_hall_only(hall, django_capture_on_commit_callbacks):
    _propose(hall, django_capture_on_commit_callbacks)
    [note] = _mine(hall.ub, "DISPATCH_PROPOSED")
    assert note.params == {"soul": "孟婆之魂", "source": "NT_A"}
    assert note.related_resource == "DispatchRecord" and note.title == "收到移交提案"
    assert not _mine(hall.ua).exists() and not _mine(hall.uc).exists()
    [row] = _read(hall.ub, "en")
    assert row["title"] == "Dispatch proposal received" and "孟婆之魂" in row["message"]


def test_an_approval_tells_the_sending_hall_only(hall, django_capture_on_commit_callbacks):
    record = _propose(hall, django_capture_on_commit_callbacks)
    with django_capture_on_commit_callbacks(execute=True):
        DispatchService.approve(DispatchRecord.objects.get(pk=record.pk), hall.ub)
    [note] = _mine(hall.ua, "DISPATCH_APPROVED")
    assert note.params == {"soul": "孟婆之魂", "target": "NT_B"} and note.related_id == str(record.pk)
    assert not _mine(hall.uc).exists()
    assert not _mine(hall.ub, "DISPATCH_APPROVED").exists()
    [row] = _read(hall.ua, "en")
    assert row["title"] == "Dispatch proposal approved"


def test_a_rejection_carries_the_reason_and_has_a_sentence_for_none(hall, django_capture_on_commit_callbacks):
    record = _propose(hall, django_capture_on_commit_callbacks)
    with django_capture_on_commit_callbacks(execute=True):
        DispatchService.reject(DispatchRecord.objects.get(pk=record.pk), hall.ub, "名额已满")
    [note] = _mine(hall.ua, "DISPATCH_REJECTED")
    assert note.params["reason"] == "名额已满" and "名额已满" in note.message
    [row] = _read(hall.ua, "en")
    assert row["message"].endswith("Reason: 名额已满")

    bare_soul = Soul.objects.create(name="乙之魂", current_state=SoulState.ALIVE, tenant=hall.a)
    with django_capture_on_commit_callbacks(execute=True):
        second = DispatchService.propose(hall.a, hall.b, bare_soul, hall.ua, "x" * 30)
        DispatchService.reject(DispatchRecord.objects.get(pk=second.pk), hall.ub, "")
    bare = _mine(hall.ua, "DISPATCH_REJECTED").get(related_id=str(second.pk))
    assert "理由" not in bare.message and bare.message.endswith("的提案。")
    assert not _mine(hall.uc).exists()


def test_a_cancellation_tells_the_target_hall_only_and_names_soul_and_reason(hall, django_capture_on_commit_callbacks):
    record = _propose(hall, django_capture_on_commit_callbacks)
    with django_capture_on_commit_callbacks(execute=True):
        DispatchService.cancel_proposed(DispatchRecord.objects.get(pk=record.pk), hall.ua, "改派别处")
    [note] = _mine(hall.ub, "DISPATCH_CANCELLED")
    assert note.params == {"soul": "孟婆之魂", "source": "NT_A", "reason": "改派别处"}
    assert note.related_resource == "DispatchRecord" and note.related_id == str(record.pk)
    assert not _mine(hall.ua, "DISPATCH_CANCELLED").exists() and not _mine(hall.uc).exists()
    [row] = [r for r in _read(hall.ub, "en") if r["notification_type"] == "DISPATCH_CANCELLED"]
    assert row["title"] == "Dispatch proposal cancelled by its sender"
    assert "孟婆之魂" in row["message"] and "改派别处" in row["message"]
    [zh] = [r for r in _read(hall.ub, "zh-Hans") if r["notification_type"] == "DISPATCH_CANCELLED"]
    assert zh["title"] == "移交提案已被发起方取消"
    # egy 还没有 Design 的词:读作 zh-Hans,而不是 500。
    [egy] = [r for r in _read(hall.ub, "egy") if r["notification_type"] == "DISPATCH_CANCELLED"]
    assert egy["title"] == "移交提案已被发起方取消"


def test_a_rolled_back_cancellation_notifies_nobody(hall, django_capture_on_commit_callbacks):
    record = _propose(hall, django_capture_on_commit_callbacks)
    with django_capture_on_commit_callbacks(execute=True):
        try:
            with transaction.atomic():
                DispatchService.cancel_proposed(DispatchRecord.objects.get(pk=record.pk), hall.ua, "改派别处")
                raise RuntimeError("business rolled back")
        except RuntimeError:
            pass
    assert not _mine(hall.ub, "DISPATCH_CANCELLED").exists()
    assert DispatchRecord.objects.get(pk=record.pk).status == "PROPOSED"
