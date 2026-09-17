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


def test_the_whole_rebirth_flow_pushes_results_without_their_content(cn_tenant, judge_user, push_on,  # noqa: F811
                                                                     django_capture_on_commit_callbacks, monkeypatch):
    """提交 → 驳回 → 申诉 → 申诉驳回,走真实接口。

    只有两次**结果**产生推送(提交与申诉是灵魂自己刚做的事,不推确认);
    锁屏区分驳回与申诉驳回,但不含驳回理由、陈述、内部备注、期望形态。"""
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
    assert not PushDelivery.objects.exists()  # 提交申请:不推
    decide(judge_user, application.workflow, "FAILED", "理由SECRET-REASON")
    with django_capture_on_commit_callbacks(execute=True):
        assert client.post(f"{APPLY}{application.pk}/appeal/", {"statement": "申诉SECRET-APPEAL"},
                           format="json").status_code == 200
    assert list(PushDelivery.objects.values_list("kind", flat=True)) == ["rebirth_rejected"]  # 提交申诉:不推
    application.refresh_from_db()
    decide(judge_user, application.appeal_workflow, "FAILED", "维持SECRET-REASON2")
    application.refresh_from_db()
    assert application.status == "APPEAL_REJECTED"

    kinds = list(PushDelivery.objects.order_by("created_at").values_list("kind", flat=True))
    assert kinds == ["rebirth_rejected", "rebirth_appeal_rejected"]
    assert list(PushDelivery.objects.order_by("created_at").values_list("title", flat=True)) == [
        "转生申请被驳回", "申诉被驳回"]
    assert sorted(sent_ids) == sorted(_ids())  # 每一条都在提交后入队了

    services.send_deliveries(sent_ids)
    everything = json.dumps(
        [list(PushDelivery.objects.values("title", "body", "data")), FakeSender.batches], ensure_ascii=False)
    for secret in ("SECRET", "陈述", "内部备注", "HUMAN", "默认给灵魂"):
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
    # 灵魂端 App 显示「打开灵魂簿查看理由」—— 理由本身不在推送里。
    assert "P-REJECTION" not in json.dumps(rows, ensure_ascii=False)
    assert "P-" not in json.dumps(rows, ensure_ascii=False)
    assert all(set(r["data"]) <= {"screen", "application_id", "kind"} for r in rows)


def test_what_is_and_is_not_pushed(cn_tenant, enqueued):  # noqa: F811
    account, _ = _soul_with_device(cn_tenant)
    soul = account.soul
    for event_type, payload in [
        # 提交申请与提交申诉:灵魂自己刚做的事,不推确认(2026-09-18 用户决定)。
        ("REBIRTH_APPLICATION_SUBMITTED", {"application_id": "a", "desired_form": "HUMAN"}),
        ("REBIRTH_STATUS_CHANGED", {"application_id": "a", "old_status": "REJECTED", "new_status": "APPEALING"}),
        ("REBIRTH_STATUS_CHANGED", {"application_id": "a", "old_status": "APPEALING", "new_status": "UNDER_REVIEW"}),
        # 调拨的提议 / 批准 / 驳回是官员之间的流程,灵魂的管辖没变。
        ("STATE_CHANGED", {"action": "DISPATCH_PROPOSED", "dispatch_id": "x"}),
        ("STATE_CHANGED", {"old_state": "JUDGING", "new_state": "DISPOSED"}),
        ("DISPOSITION_CREATED", {"disposition_id": "d"}),
        ("SOUL_ACCOUNT_CREATED", {"account_id": "x"}),
        ("REBIRTH_CROSS_CIV_DECIDED", {"application_id": "a", "cross_civilization": True}),
        ("KARMA_RECALCULATED", {"delta": 1}),
    ]:
        EventService.log(soul, event_type, payload)
    assert not PushDelivery.objects.exists()

    EventService.log(soul, "STATE_CHANGED", {"old_state": "DISPOSED", "new_state": "SETTLED"})
    for app_id, new in (("a", "APPROVED"), ("b", "REJECTED"), ("c", "APPEAL_REJECTED")):
        EventService.log(soul, "REBIRTH_STATUS_CHANGED",
                         {"application_id": app_id, "old_status": "UNDER_REVIEW", "new_status": new})
    _judgment(soul)
    assert sorted(PushDelivery.objects.values_list("kind", "data__screen")) == [
        ("disposition_executed", "Life"), ("judgment_result", "Life"),
        ("rebirth_appeal_rejected", "ApplicationDetail"), ("rebirth_approved", "ApplicationDetail"),
        ("rebirth_rejected", "ApplicationDetail")]
    assert set(PushDelivery.objects.values_list("title", flat=True)) == {
        "处置已执行", "审判有了结论", "转生申请已批准", "转生申请被驳回", "申诉被驳回"}


def test_an_event_claiming_another_tenant_pushes_nothing(cn_tenant, eu_tenant, enqueued):  # noqa: F811
    from apps.events.event_bus import event_bus

    account, _ = _soul_with_device(cn_tenant)
    event_bus.publish("JUDGMENT_CONCLUDED", {"soul_id": str(account.soul_id), "judgment_id": "j"}, domain="soul",
                      tenant_code=eu_tenant.code)
    assert not PushDelivery.objects.exists()


def _residence_tenants():
    from apps.tenants.models import Tenant

    home = Tenant.objects.get_or_create(code="CN_DIYU", defaults={"display_name": "CN"})[0]
    away = Tenant.objects.get_or_create(code="EG_DUAT", defaults={"display_name": "EG"})[0]
    return home, away


def _dispatch(soul, away):
    from apps.dispatch.models import DispatchRecord, DispatchStatus
    from apps.dispatch.services import DispatchService

    record = DispatchRecord.objects.create(
        source_tenant_id=soul.tenant_id, target_tenant=away, soul=soul, status=DispatchStatus.APPROVED,
        reason="暂居理由SECRET-DISPATCH", tenant_id=soul.tenant_id)
    DispatchService.execute(record, "executor")
    soul.refresh_from_db()
    return record


def test_residence_start_and_return_are_pushed_through_the_real_dispatch_service(
        django_capture_on_commit_callbacks, monkeypatch):
    """暂居开始 = 调拨执行(DISPATCH_EXECUTED),回归 = DISPATCH_RETURNED。两者都是 DispatchService 直接写的
    SoulEvent,不经事件总线 —— 这条走真实的 service,证明 signals.py 真的接到了。"""
    from apps.dispatch.services import DispatchService

    calls = []
    monkeypatch.setattr(services, "enqueue", lambda ids: calls.append(list(ids)))
    home, away = _residence_tenants()
    account, _ = _soul_with_device(home)
    with django_capture_on_commit_callbacks(execute=True):
        record = _dispatch(account.soul, away)
    [started] = PushDelivery.objects.all()
    assert (started.kind, started.title, started.data) == (
        "residence_started", "暂居开始", {"screen": "Life", "kind": "residence_started"})
    assert started.dedupe_key == f"residence:{record.pk}:DISPATCH_EXECUTED"
    assert calls == [[str(started.pk)]]  # 提交后入队

    with django_capture_on_commit_callbacks(execute=True):
        DispatchService.end_residence(account.soul, actor="officer", trigger=DispatchService.RETURN_MANUAL,
                                      reason="回归理由SECRET-RETURN")
    returned = PushDelivery.objects.get(kind="residence_returned")
    assert returned.title == "暂居结束" and len(calls) == 2
    everything = json.dumps(list(PushDelivery.objects.values("title", "body", "data")), ensure_ascii=False)
    for secret in ("SECRET", "EG_DUAT", "CN_DIYU", str(record.pk)):
        assert secret not in everything, secret


def test_residence_pushes_respect_the_residence_preference_and_roll_back(django_capture_on_commit_callbacks,
                                                                        enqueued):  # noqa: F811
    from apps.soul_push.models import PushPreference

    home, away = _residence_tenants()
    account, _ = _soul_with_device(home)
    PushPreference.objects.create(account=account, soul=account.soul, residence=False)
    _dispatch(account.soul, away)
    assert not PushDelivery.objects.exists()

    class RollbackError(Exception):
        pass

    PushPreference.objects.filter(account=account).update(residence=True)
    from apps.dispatch.services import DispatchService

    with pytest.raises(RollbackError), transaction.atomic():
        DispatchService.end_residence(account.soul, actor="officer", trigger=DispatchService.RETURN_MANUAL)
        assert PushDelivery.objects.count() == 1
        raise RollbackError
    assert not PushDelivery.objects.exists()


def test_other_soul_events_written_directly_are_not_pushed_twice(enqueued,  # noqa: F811
                                                                 django_capture_on_commit_callbacks):
    """AuditHandler 把总线事件写成 SoulEvent;signals.py 只接暂居的两个 action,不会把它们再推一遍。"""
    from apps.events.models import SoulEvent

    home, _ = _residence_tenants()
    account, _ = _soul_with_device(home)
    with django_capture_on_commit_callbacks(execute=True):
        _judgment(account.soul)
    assert SoulEvent.objects.filter(soul=account.soul, event_type="JUDGMENT_CONCLUDED").exists()
    assert PushDelivery.objects.count() == 1
    assert len(enqueued) == 1


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
    # 关着时 sweep 的补发一步什么都不动:DISABLED 仍是 DISABLED,不入队(也不提前过期)。
    assert services.backfill_disabled() == 0
    delivery.refresh_from_db()
    assert delivery.status == PushStatus.DISABLED and enqueued == []
    PushDelivery.objects.update(status=PushStatus.SENT, ticket_id="t", sent_at=timezone.now() - timedelta(hours=1))
    assert services.check_receipts() == 0
    from apps.soul_push.tasks import sweep

    assert sweep() == {"backfilled": 0, "requeued": 0, "receipts": 0}
    assert services.backfill_disabled() == 0  # 关着时不补、不过期


# ── 开启后补发(2026-09-18 用户决定:24 小时内补,更早的标过期)──────────


def _disabled_rows(settings, account, keys):
    """推送关着时记下几条,得到 DISABLED 行;返回 {key: row}。"""
    settings.SOUL_PUSH_ENABLED = False
    for key in keys:
        _judgment(account.soul, key)
    services.send_deliveries(_ids())
    settings.SOUL_PUSH_ENABLED = True
    rows = {row.dedupe_key.split(":")[1]: row for row in PushDelivery.objects.all()}
    assert {row.status for row in rows.values()} == {PushStatus.DISABLED}
    return rows


def _age(key, hours):
    PushDelivery.objects.filter(dedupe_key=f"judgment:{key}").update(created_at=timezone.now() - timedelta(hours=hours))


def test_turning_push_on_backfills_the_last_24_hours_and_expires_the_rest(cn_tenant, settings, push_on,  # noqa: F811
                                                                         enqueued):  # noqa: F811
    account, _ = _soul_with_device(cn_tenant)
    _disabled_rows(settings, account, ["fresh", "day-old", "stale"])
    _age("fresh", 1)
    _age("day-old", 23)
    _age("stale", 25)

    assert services.backfill_disabled() == 2
    by_key = {row.dedupe_key.split(":")[1]: row for row in PushDelivery.objects.all()}
    assert by_key["stale"].status == PushStatus.EXPIRED and "24 小时" in by_key["stale"].error
    assert by_key["fresh"].status == by_key["day-old"].status == PushStatus.QUEUED
    queued = {i for batch in enqueued for i in batch}
    assert queued == {str(by_key["fresh"].pk), str(by_key["day-old"].pk)}

    services.send_deliveries(list(queued))
    assert [len(b) for b in FakeSender.batches] == [2]
    assert {m["title"] for m in FakeSender.batches[0]} == {"审判有了结论"}  # 文案是记下时那一份
    assert PushDelivery.objects.count() == 3  # 补的是原行,不新建
    assert PushDelivery.objects.filter(status=PushStatus.EXPIRED).count() == 1  # 过期的不删


def test_backfill_is_idempotent_with_itself_and_with_normal_sending(cn_tenant, settings, push_on,  # noqa: F811
                                                                   enqueued):  # noqa: F811
    account, _ = _soul_with_device(cn_tenant)
    _disabled_rows(settings, account, ["once"])
    assert services.backfill_disabled() == 1
    assert services.backfill_disabled() == 0  # 第二次 sweep:没有 DISABLED 可补
    ids = _ids()
    services.send_deliveries(ids)
    services.send_deliveries(ids)
    _judgment(account.soul, "once")  # 同一事件在开启后又被发布一次
    assert services.send_deliveries(_ids()) == 0
    assert len(FakeSender.batches) == 1 and PushDelivery.objects.count() == 1

    # 之后又有一条未启用期间记下的行被补发:已经发出的那条不能被一起「复活」再发一遍。
    PushDelivery.objects.create(dedupe_key="judgment:later", device=PushDevice.objects.get(), account=account,
                                soul=account.soul, event_type="JUDGMENT_CONCLUDED", kind="judgment_result",
                                title="审判有了结论", body="b", status=PushStatus.DISABLED)
    assert services.backfill_disabled() == 1
    services.send_deliveries(_ids())
    assert sum(len(batch) for batch in FakeSender.batches) == 2
    assert PushDelivery.objects.get(dedupe_key="judgment:once").status == PushStatus.SENT


def test_backfill_rechecks_preference_device_and_account(cn_tenant, settings, push_on, enqueued):  # noqa: F811
    from apps.soul_push.models import PushPreference

    # 三个灵魂各占一种情形,互不遮挡:任何一道核对被拿掉,对应那一行就会被发出去。
    pref_off, _ = _soul_with_device(cn_tenant, name="甲")
    dead_device, _ = _soul_with_device(cn_tenant, name="乙", token=TOKEN_B)
    retired, _ = _soul_with_device(cn_tenant, name="丙", token="ExponentPushToken[cccccccccccccccccccccc]")
    settings.SOUL_PUSH_ENABLED = False
    for owner, key in ((pref_off, "pref"), (dead_device, "device"), (retired, "retired")):
        _judgment(owner.soul, key)
    services.send_deliveries(_ids())
    settings.SOUL_PUSH_ENABLED = True
    assert set(PushDelivery.objects.values_list("status", flat=True)) == {PushStatus.DISABLED}

    PushPreference.objects.create(account=pref_off, soul=pref_off.soul, judgment=False)  # 关了这一类
    PushDevice.objects.filter(token=TOKEN_B).update(is_active=False)                     # 设备失效
    type(retired).objects.filter(pk=retired.pk).update(retired_at=timezone.now())         # 账号已停用

    assert services.backfill_disabled() == 3
    services.send_deliveries([i for batch in enqueued for i in batch])
    assert FakeSender.batches == []
    errors = {d.dedupe_key.split(":")[1]: (d.status, d.error) for d in PushDelivery.objects.all()}
    assert errors == {
        "pref": (PushStatus.CANCELLED, "灵魂已关闭这一类推送"),
        "device": (PushStatus.CANCELLED, "设备已失效或已不属于该账号"),
        "retired": (PushStatus.CANCELLED, "设备已失效或已不属于该账号"),
    }


def test_the_sweep_runs_the_backfill(cn_tenant, settings, push_on, enqueued):  # noqa: F811
    from apps.soul_push.tasks import sweep

    account, _ = _soul_with_device(cn_tenant)
    _disabled_rows(settings, account, ["via-sweep"])
    assert sweep()["backfilled"] == 1


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
