"""驳回与取消的理由单独存:`DispatchRecord.decision_reason` / `decided_by` / `decided_at`。

此前 `DispatchService.reject` / `cancel_proposed` 把 `Rejection reason: …` / `Cancellation reason: …` 追加在
`reason` 末尾,读的一侧(官员 App、受刑计划的 `last_refusal`)靠这两个英文标记切字符串。现在:
  * `reason` 永远是发起方提出时的原文;
  * 决定的理由 / 人 / 时间在各自的字段里,API 给出同一份;
  * 通知的 `params["reason"]` 与存下的字段是同一个值。
"""
import pytest
from django.contrib.auth import get_user_model
from rest_framework.test import APIClient
from rest_framework_simplejwt.tokens import RefreshToken

from apps.dispatch.models import DispatchRecord, DispatchStatus
from apps.dispatch.services import DispatchService
from apps.notifications.models import UserNotification
from apps.souls.models import Soul, SoulState
from apps.tenants.models import Tenant

pytestmark = pytest.mark.django_db
User = get_user_model()
BASE = "/api/v1/dispatch/records/"
ORIGINAL = "这一世功过相抵,请贵殿收下并安排界域。" * 2
WHY = "本殿今年名额已满"


def _client(user, tenant):
    client = APIClient()
    token = RefreshToken.for_user(user)
    token["tenant_code"] = tenant.code
    client.credentials(HTTP_AUTHORIZATION=f"Bearer {token.access_token}")
    return client


@pytest.fixture
def world(db):
    a = Tenant.objects.get_or_create(code="DR_A", defaults={"display_name": "DR A"})[0]
    b = Tenant.objects.get_or_create(code="DR_B", defaults={"display_name": "DR B"})[0]
    mod_a = User.objects.create_user(username="dr_mod_a", password="x", role="MODERATOR", tenant=a)
    mod_b = User.objects.create_user(username="dr_mod_b", password="x", role="MODERATOR", tenant=b)
    soul = Soul.objects.create(name="DecidedSoul", current_state=SoulState.ALIVE, tenant=a)
    record = DispatchRecord.objects.create(
        source_tenant=a, target_tenant=b, soul=soul, reason=ORIGINAL,
        dispatched_by=mod_a, status=DispatchStatus.PROPOSED, tenant=a,
    )
    return {"a": a, "b": b, "mod_a": mod_a, "mod_b": mod_b, "record": record,
            "client_a": _client(mod_a, a), "client_b": _client(mod_b, b)}


def _fresh(world):
    return DispatchRecord.all_objects.get(pk=world["record"].pk)


def test_a_rejection_keeps_the_proposers_words_and_stores_the_decision_apart(world, django_capture_on_commit_callbacks):
    with django_capture_on_commit_callbacks(execute=True):
        res = world["client_b"].post(f"{BASE}{world['record'].pk}/reject/", {"reason": WHY}, format="json")
    assert res.status_code == 200, res.data
    record = _fresh(world)
    assert record.status == DispatchStatus.REJECTED
    assert record.reason == ORIGINAL
    assert record.decision_reason == WHY and record.decided_by_id == world["mod_b"].pk and record.decided_at is not None
    # API 给出同一份字段;`reason` 不含决定的话。
    for body in (res.data, world["client_a"].get(f"{BASE}{record.pk}/").data):
        assert body["reason"] == ORIGINAL and body["decision_reason"] == WHY
    # 拍板人:目标殿自己看得到;发起殿只见对方殿名(决定 24)。
    assert res.data["decided_by"] == world["mod_b"].pk and res.data["decided_by_name"] == "dr_mod_b"
    theirs = world["client_a"].get(f"{BASE}{record.pk}/").data
    assert (theirs["decided_by"], theirs["decided_by_name"]) == (None, None)
    # 通知带的是同一个理由。
    [note] = UserNotification.objects.filter(user=world["mod_a"], related_id=str(record.pk))
    assert note.notification_type == "DISPATCH_REJECTED" and note.params["reason"] == record.decision_reason


def test_a_cancellation_stores_its_reason_apart_too(world):
    res = world["client_a"].post(f"{BASE}{world['record'].pk}/cancel/", {"reason": "改派别处"}, format="json")
    assert res.status_code == 200, res.data
    record = _fresh(world)
    assert record.reason == ORIGINAL and record.decision_reason == "改派别处"
    assert record.decided_by_id == world["mod_a"].pk
    assert res.data["reason"] == ORIGINAL and res.data["decision_reason"] == "改派别处"
    # 撤回人是源殿自己的人:源殿看得到名字,目标殿看不到。
    assert res.data["decided_by"] == world["mod_a"].pk
    theirs = world["client_b"].get(f"{BASE}{world['record'].pk}/").data
    assert (theirs["decided_by"], theirs["decided_by_name"]) == (None, None)


def test_a_bare_rejection_leaves_the_reason_alone_and_the_decision_empty(world):
    DispatchService.reject(world["record"], world["mod_b"])
    record = _fresh(world)
    assert record.reason == ORIGINAL and record.decision_reason == "" and record.decided_by_id == world["mod_b"].pk


def test_approving_records_who_decided_but_has_no_reason(world):
    DispatchService.approve(world["record"], world["mod_b"])
    record = _fresh(world)
    assert record.reason == ORIGINAL and record.decision_reason == "" and record.decided_by_id == world["mod_b"].pk


def test_the_decision_fields_are_not_writable_through_the_record_endpoint(world):
    res = world["client_a"].patch(
        f"{BASE}{world['record'].pk}/", {"decision_reason": "伪造", "decided_by": world["mod_b"].pk}, format="json",
    )
    assert res.status_code in (200, 400, 403), res.data
    record = _fresh(world)
    assert record.decision_reason == "" and record.decided_by_id is None
