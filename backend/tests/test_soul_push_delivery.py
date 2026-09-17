"""事件 → 推送 → Expo 的全程。发送端口一律是假实现(`tests/soul_push_support.py`),不访问网络。"""
import json
from datetime import timedelta
from unittest.mock import MagicMock, patch

import pytest
from django.db import transaction
from django.utils import timezone

from apps.events.services import EventService
from apps.soul_accounts.models import RebirthApplication
from apps.soul_push import services
from apps.soul_push.expo import ExpoPushSender, PushRequestError, PushTransientError
from apps.soul_push.models import PushDelivery, PushDevice, PushStatus
from tests.soul_account_support import officer_client, ready_soul
from tests.soul_push_support import (  # noqa: F401
    TOKEN_A,
    TOKEN_B,
    ExplodingSender,
    FakeSender,
    enqueued,
    push_on,
    register,
)

pytestmark = pytest.mark.django_db

APPLY = "/api/v1/me/rebirth-applications/"


def _soul_with_device(tenant, name="亡魂甲", token=TOKEN_A):
    account, client = ready_soul(tenant, name=name)
    assert register(client, token).status_code == 201
    return account, client


def _judgment(soul, judgment_id="j-1"):
    EventService.log(soul, "JUDGMENT_CONCLUDED", {"judgment_id": judgment_id, "verdict": "GUILTY"})


def _ids():
    return [str(pk) for pk in PushDelivery.objects.values_list("pk", flat=True)]


# ── 映射与内容 ───────────────────────────────────────────────────────────


def test_the_whole_rebirth_flow_pushes_generic_text_only(cn_tenant, judge_user, push_on,  # noqa: F811
                                                         django_capture_on_commit_callbacks, monkeypatch):
    """提交 → 驳回 → 申诉 → 申诉驳回,走真实接口。每一条推送都**不含**驳回理由、陈述、内部备注。"""
    sent_ids = []
    monkeypatch.setattr(services, "enqueue", lambda ids: sent_ids.extend(ids))
    account, client = _soul_with_device(cn_tenant)

    def decide(user, workflow, verdict, reason):
        with django_capture_on_commit_callbacks(execute=True):
            response = officer_client(user).post(
                f"/api/v1/workflows/{workflow.pk}/approve_node/",
                {"verdict": verdict, "notes": "内部备注SECRET-NOTE", "rejection_reason_for_soul": reason},
                format="json")
        assert response.status_code == 200, response.data

    with django_capture_on_commit_callbacks(execute=True):
        created = client.post(APPLY, {"desired_form": "HUMAN", "statement": "陈述SECRET-STATEMENT"}, format="json")
    application = RebirthApplication.objects.get(pk=created.data["id"])
    decide(judge_user, application.workflow, "FAILED", "理由SECRET-REASON")
    with django_capture_on_commit_callbacks(execute=True):
        assert client.post(f"{APPLY}{application.pk}/appeal/", {"statement": "申诉SECRET-APPEAL"},
                           format="json").status_code == 200
    application.refresh_from_db()
    decide(judge_user, application.appeal_workflow, "FAILED", "维持SECRET-REASON2")
    application.refresh_from_db()
    assert application.status == "APPEAL_REJECTED"

    kinds = list(PushDelivery.objects.order_by("created_at").values_list("kind", flat=True))
    assert kinds == ["rebirth_submitted", "rebirth_result", "rebirth_appeal_submitted", "rebirth_result"]
    assert sorted(sent_ids) == sorted(_ids())  # 每一条都在提交后入队了

    services.send_deliveries(sent_ids)
    everything = json.dumps(
        [list(PushDelivery.objects.values("title", "body", "data")), FakeSender.batches], ensure_ascii=False)
    for secret in ("SECRET", "理由", "陈述", "申诉SECRET", "内部备注", "HUMAN", "APPEAL_REJECTED", "驳回"):
        assert secret not in everything, secret
    assert {m["data"]["application_id"] for batch in FakeSender.batches for m in batch} == {str(application.pk)}
    assert all(set(m) == {"to", "title", "body", "data", "sound", "priority"}
               for batch in FakeSender.batches for m in batch)


def test_payload_fields_never_reach_the_push(cn_tenant, enqueued):  # noqa: F811
    """事件 payload 里可能有的敏感字段,一个都不进 title / body / data。"""
    account, _ = _soul_with_device(cn_tenant)
    poison = {"reason": "P-REASON", "new_identity": "P-IDENTITY", "evidence_json": {"x": "P-EVIDENCE"},
              "password": "P-PASSWORD", "rejection_reason": "P-REJECTION", "verdict": "P-VERDICT"}
    EventService.log(account.soul, "REBIRTH_STATUS_CHANGED",
                     {"application_id": "a-1", "old_status": "UNDER_REVIEW", "new_status": "REJECTED", **poison})
    _judgment(account.soul)
    EventService.log(account.soul, "STATE_CHANGED", {"old_state": "DISPOSED", "new_state": "REINCARNATING", **poison})
    rows = list(PushDelivery.objects.values("title", "body", "data"))
    assert len(rows) == 3
    assert "P-" not in json.dumps(rows, ensure_ascii=False)
    assert all(set(r["data"]) <= {"screen", "application_id", "kind"} for r in rows)


def test_what_is_and_is_not_pushed(cn_tenant, enqueued):  # noqa: F811
    account, _ = _soul_with_device(cn_tenant)
    soul = account.soul
    for event_type, payload in [
        ("REBIRTH_STATUS_CHANGED", {"application_id": "a", "old_status": "APPEALING", "new_status": "UNDER_REVIEW"}),
        ("STATE_CHANGED", {"old_state": "JUDGING", "new_state": "DISPOSED"}),
        ("DISPOSITION_CREATED", {"disposition_id": "d"}),
        ("SOUL_ACCOUNT_CREATED", {"account_id": "x"}),
        ("REBIRTH_CROSS_CIV_DECIDED", {"application_id": "a", "cross_civilization": True}),
        ("KARMA_RECALCULATED", {"delta": 1}),
    ]:
        EventService.log(soul, event_type, payload)
    assert not PushDelivery.objects.exists()

    EventService.log(soul, "STATE_CHANGED", {"old_state": "DISPOSED", "new_state": "SETTLED"})
    EventService.log(soul, "REBIRTH_STATUS_CHANGED",
                     {"application_id": "a", "old_status": "UNDER_REVIEW", "new_status": "APPROVED"})
    _judgment(soul)
    assert sorted(PushDelivery.objects.values_list("kind", "data__screen")) == [
        ("disposition_executed", "Life"), ("judgment_result", "Life"), ("rebirth_result", "ApplicationDetail")]
    assert set(PushDelivery.objects.values_list("title", flat=True)) == {
        "处置已执行", "审判有了结论", "转生申请有了结果"}


def test_an_event_claiming_another_tenant_pushes_nothing(cn_tenant, eu_tenant, enqueued):  # noqa: F811
    from apps.events.event_bus import event_bus

    account, _ = _soul_with_device(cn_tenant)
    event_bus.publish("JUDGMENT_CONCLUDED", {"soul_id": str(account.soul_id), "judgment_id": "j"}, domain="soul",
                      tenant_code=eu_tenant.code)
    assert not PushDelivery.objects.exists()


def test_pending_residence_events_do_not_exist_yet():
    """暂居事件由 feat/dispatch-residence 落地。它们一出现在 EventType 里这条就红:去 `rule_for` 补映射。"""
    from apps.events.models import EventType

    assert set(services.PENDING_EVENTS).isdisjoint(EventType.values)
    assert not set(services.PENDING_EVENTS) & services.HANDLED_EVENTS


# ── 事务、幂等、偏好 ─────────────────────────────────────────────────────


def test_a_rolled_back_event_is_never_recorded_or_enqueued(cn_tenant, django_capture_on_commit_callbacks,
                                                           monkeypatch):
    calls = []
    monkeypatch.setattr(services, "enqueue", lambda ids: calls.append(ids))
    account, _ = _soul_with_device(cn_tenant)

    class BoomError(Exception):
        pass

    with django_capture_on_commit_callbacks(execute=True) as callbacks, pytest.raises(BoomError), \
            transaction.atomic():
        _judgment(account.soul)
        assert PushDelivery.objects.count() == 1  # 在事务里确实写了
        raise BoomError
    assert not PushDelivery.objects.exists()
    assert calls == [] and callbacks == []

    with django_capture_on_commit_callbacks(execute=True):
        _judgment(account.soul)
    assert calls == [_ids()]


def test_the_same_event_twice_is_pushed_once(cn_tenant, push_on, enqueued):  # noqa: F811
    account, _ = _soul_with_device(cn_tenant)
    _judgment(account.soul)
    _judgment(account.soul)
    assert PushDelivery.objects.count() == 1
    ids = _ids()
    assert services.send_deliveries(ids) == 1
    assert services.send_deliveries(ids) == 0  # at-least-once 的队列重复投递:第二次什么也不发
    assert len(FakeSender.batches) == 1


def test_a_device_that_changed_hands_before_sending_is_not_pushed(cn_tenant, push_on, enqueued):  # noqa: F811
    first, _ = _soul_with_device(cn_tenant, name="甲")
    _, second_client = ready_soul(cn_tenant, name="乙")
    _judgment(first.soul)
    assert register(second_client).status_code == 200  # 记下之后、发送之前,手机换了主人
    services.send_deliveries(_ids())
    assert FakeSender.batches == []
    assert PushDelivery.objects.get().status == PushStatus.CANCELLED


def test_a_retired_account_is_not_pushed_even_if_already_queued(cn_tenant, push_on, enqueued):  # noqa: F811
    account, _ = _soul_with_device(cn_tenant)
    _judgment(account.soul)
    type(account).objects.filter(pk=account.pk).update(retired_at=timezone.now())
    services.send_deliveries(_ids())
    assert FakeSender.batches == [] and PushDelivery.objects.get().status == PushStatus.CANCELLED


# ── 未启用 ───────────────────────────────────────────────────────────────


def test_unconfigured_push_records_marks_disabled_and_never_builds_a_sender(cn_tenant, settings,
                                                                          enqueued):  # noqa: F811
    settings.SOUL_PUSH_ENABLED = False
    settings.SOUL_PUSH_SENDER = "tests.soul_push_support.ExplodingSender"
    account, _ = _soul_with_device(cn_tenant)
    _judgment(account.soul)
    assert services.send_deliveries(_ids()) == 0
    delivery = PushDelivery.objects.get()
    assert delivery.status == PushStatus.DISABLED and "未启用" in delivery.error
    PushDelivery.objects.update(status=PushStatus.SENT, ticket_id="t", sent_at=timezone.now() - timedelta(hours=1))
    assert services.check_receipts() == 0
    from apps.soul_push.tasks import sweep

    assert sweep() == {"requeued": 0, "receipts": 0}


# ── 发送:分批、ticket、重试 ─────────────────────────────────────────────


def test_messages_go_out_in_batches_of_at_most_100(cn_tenant, push_on, enqueued):  # noqa: F811
    account, _ = _soul_with_device(cn_tenant)
    PushDevice.objects.bulk_create([
        PushDevice(account=account, soul=account.soul, token=f"ExponentPushToken[device{i:05d}xx]",
                   platform="ANDROID", last_seen_at=timezone.now()) for i in range(200)])
    _judgment(account.soul)
    assert PushDelivery.objects.count() == 201
    assert services.send_deliveries(_ids()) == 201
    assert [len(b) for b in FakeSender.batches] == [100, 100, 1]
    assert set(PushDelivery.objects.values_list("status", flat=True)) == {PushStatus.SENT}
    assert PushDelivery.objects.exclude(ticket_id="").count() == 201


def test_device_not_registered_in_a_ticket_invalidates_the_device(cn_tenant, push_on, enqueued):  # noqa: F811
    account, _ = _soul_with_device(cn_tenant)
    register(ready_soul(cn_tenant, name="乙")[1], TOKEN_B)
    _judgment(account.soul)
    FakeSender.script = [lambda messages: [{"status": "error", "message": "not registered",
                                            "details": {"error": "DeviceNotRegistered"}}]]
    services.send_deliveries(_ids())
    delivery = PushDelivery.objects.get()
    assert delivery.status == PushStatus.FAILED and delivery.error == "DeviceNotRegistered"
    assert PushDevice.objects.get(token=TOKEN_A).invalid_reason == "DEVICE_NOT_REGISTERED"
    assert PushDevice.objects.get(token=TOKEN_B).is_active  # 只动那一台


def test_other_ticket_errors_fail_the_row_but_keep_the_device(cn_tenant, push_on, enqueued):  # noqa: F811
    account, _ = _soul_with_device(cn_tenant)
    _judgment(account.soul)
    FakeSender.script = [lambda messages: [{"status": "error", "message": "too big",
                                            "details": {"error": "MessageTooBig"}}]]
    services.send_deliveries(_ids())
    assert PushDelivery.objects.get().error == "MessageTooBig"
    assert PushDevice.objects.get().is_active


def test_transient_failures_back_off_exponentially_then_give_up(cn_tenant, push_on, enqueued):  # noqa: F811
    account, _ = _soul_with_device(cn_tenant)
    _judgment(account.soul)
    ids = _ids()
    countdowns = []
    for _ in range(services.MAX_ATTEMPTS - 1):
        FakeSender.script = [PushTransientError("HTTP 503")]
        with pytest.raises(services.PushRetryError) as later:
            services.send_deliveries(ids)
        countdowns.append(later.value.countdown)
        row = PushDelivery.objects.get()
        assert row.status == PushStatus.QUEUED and row.next_attempt_at > timezone.now()
    assert countdowns == [60, 120, 240, 480]
    FakeSender.script = [PushTransientError("HTTP 429")]
    services.send_deliveries(ids)  # 第五次:不再重试
    row = PushDelivery.objects.get()
    assert row.status == PushStatus.FAILED and row.attempts == services.MAX_ATTEMPTS and "放弃" in row.error


def test_a_transient_failure_then_success(cn_tenant, push_on, enqueued):  # noqa: F811
    account, _ = _soul_with_device(cn_tenant)
    _judgment(account.soul)
    FakeSender.script = [PushTransientError("ConnectionError")]
    with pytest.raises(services.PushRetryError):
        services.send_deliveries(_ids())
    services.send_deliveries(_ids())
    assert PushDelivery.objects.get().status == PushStatus.SENT and len(FakeSender.batches) == 2


def test_the_task_turns_retry_later_into_a_celery_retry(cn_tenant, push_on, enqueued):  # noqa: F811
    from apps.soul_push.tasks import send_push

    account, _ = _soul_with_device(cn_tenant)
    _judgment(account.soul)
    FakeSender.script = [PushTransientError("HTTP 502")]
    with patch.object(send_push, "retry", side_effect=RuntimeError("retry called")) as retry, \
            pytest.raises(RuntimeError, match="retry called"):
        send_push.run(_ids())
    assert retry.call_args.kwargs["countdown"] == 60 and retry.call_args.kwargs["args"] == [_ids()]


# ── sweep:兜底入队与回执 ────────────────────────────────────────────────


def test_sweep_requeues_stuck_rows_but_respects_backoff(cn_tenant, push_on, enqueued):  # noqa: F811
    account, _ = _soul_with_device(cn_tenant)
    _judgment(account.soul, "old")
    _judgment(account.soul, "backing-off")
    _judgment(account.soul, "stuck-sending")
    _judgment(account.soul, "fresh")
    past = timezone.now() - timedelta(minutes=30)
    PushDelivery.objects.filter(dedupe_key="judgment:old").update(updated_at=past)
    PushDelivery.objects.filter(dedupe_key="judgment:backing-off").update(
        updated_at=past, next_attempt_at=timezone.now() + timedelta(minutes=10))
    PushDelivery.objects.filter(dedupe_key="judgment:stuck-sending").update(status=PushStatus.SENDING, updated_at=past)

    assert services.requeue_stale() == 1
    requeued = {str(pk) for batch in enqueued for pk in batch}
    assert requeued == {str(PushDelivery.objects.get(dedupe_key="judgment:old").pk)}
    assert PushDelivery.objects.get(dedupe_key="judgment:stuck-sending").status == PushStatus.QUEUED
    # 退回的 SENDING 下一轮(满 5 分钟后)才入队
    later = timezone.now() + timedelta(minutes=6)
    enqueued.clear()
    services.requeue_stale(now=later)
    keys = set(PushDelivery.objects.filter(pk__in=[i for b in enqueued for i in b]).values_list("dedupe_key", flat=True))
    assert keys == {"judgment:old", "judgment:stuck-sending", "judgment:fresh"}


def test_receipts_mark_delivered_failed_and_invalidate_unregistered_devices(cn_tenant, push_on,  # noqa: F811
                                                                            enqueued):  # noqa: F811
    account, _ = _soul_with_device(cn_tenant)
    register(ready_soul(cn_tenant, name="乙")[1], TOKEN_B)
    for key in ("ok", "gone", "pending", "expired", "recent"):
        _judgment(account.soul, key)
    now = timezone.now()
    for key, sent in (("ok", 20), ("gone", 20), ("pending", 20), ("expired", 60 * 25), ("recent", 5)):
        PushDelivery.objects.filter(dedupe_key=f"judgment:{key}").update(
            status=PushStatus.SENT, ticket_id=f"t-{key}", sent_at=now - timedelta(minutes=sent))
    FakeSender.receipt_answers = {
        "t-ok": {"status": "ok"},
        "t-gone": {"status": "error", "message": "x", "details": {"error": "DeviceNotRegistered"}},
    }
    assert services.check_receipts(now=now) == 4
    assert sorted(FakeSender.receipt_calls[0]) == ["t-expired", "t-gone", "t-ok", "t-pending"]  # recent 未满 15 分钟
    row = {d.dedupe_key.split(":")[1]: d for d in PushDelivery.objects.all()}
    assert row["ok"].status == PushStatus.DELIVERED
    assert row["gone"].status == PushStatus.FAILED and row["gone"].error == "DeviceNotRegistered"
    assert row["pending"].status == PushStatus.SENT and row["pending"].receipt_checked_at is None
    assert row["expired"].receipt_checked_at is not None and "过期" in row["expired"].error
    assert PushDevice.objects.get(token=TOKEN_A).invalid_reason == "DEVICE_NOT_REGISTERED"
    assert PushDevice.objects.get(token=TOKEN_B).is_active


def test_the_sweep_is_a_registered_scheduled_job():
    from apps.scheduler import registry

    spec = registry.get("soul_push.sweep")
    assert spec is not None and spec.scope == registry.GLOBAL and spec.max_runtime < 300


# ── Expo 实现(requests 被替换,不出网)──────────────────────────────────


def _response(status, body):
    response = MagicMock(status_code=status)
    response.json.return_value = body
    return response


def test_expo_sender_posts_the_documented_shape(settings):
    settings.EXPO_ACCESS_TOKEN = ""
    with patch("apps.soul_push.expo.requests.post",
               return_value=_response(200, {"data": [{"status": "ok", "id": "r1"}]})) as post:
        assert ExpoPushSender().send([{"to": TOKEN_A}]) == [{"status": "ok", "id": "r1"}]
    args, kwargs = post.call_args
    assert args[0] == "https://exp.host/--/api/v2/push/send" and kwargs["json"] == [{"to": TOKEN_A}]
    assert "Authorization" not in kwargs["headers"] and kwargs["allow_redirects"] is False

    settings.EXPO_ACCESS_TOKEN = "expo-secret"
    with patch("apps.soul_push.expo.requests.post", return_value=_response(200, {"data": {"r1": {"status": "ok"}}})) \
            as post:
        assert ExpoPushSender().receipts(["r1"]) == {"r1": {"status": "ok"}}
    assert post.call_args.args[0] == "https://exp.host/--/api/v2/push/getReceipts"
    assert post.call_args.kwargs["json"] == {"ids": ["r1"]}
    assert post.call_args.kwargs["headers"]["Authorization"] == "Bearer expo-secret"


@pytest.mark.parametrize("status,body,error", [
    (429, {}, PushTransientError),
    (503, {}, PushTransientError),
    (200, {"errors": [{"code": "TOO_MANY_REQUESTS"}]}, PushTransientError),
    (400, {"errors": [{"code": "PUSH_TOO_MANY_EXPERIENCE_IDS"}]}, PushRequestError),
    (401, {"errors": [{"code": "UNAUTHORIZED"}]}, PushRequestError),
    (200, {"data": []}, PushRequestError),  # ticket 数对不上
])
def test_expo_sender_classifies_failures(status, body, error):
    with patch("apps.soul_push.expo.requests.post", return_value=_response(status, body)), pytest.raises(error):
        ExpoPushSender().send([{"to": TOKEN_A}])


def test_expo_sender_network_errors_are_transient():
    import requests

    with patch("apps.soul_push.expo.requests.post", side_effect=requests.ConnectionError("down")), \
            pytest.raises(PushTransientError):
        ExpoPushSender().receipts(["x"])
