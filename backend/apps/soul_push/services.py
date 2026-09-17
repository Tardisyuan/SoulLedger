"""推送的记录、发送、回执。

流程:

    业务代码 EventService.log(soul, ...)          ← 发布者的事务里(若有)
      └ SoulPushHandler(handler.py)
          └ record_for_event:按映射表决定推不推、推给谁,写 PushDelivery(QUEUED)
      └ 事务提交后 → celery `soul_push.send`
          └ send_deliveries:认领(SENDING)→ 按 ≤100 分批交给发送端口 → SENT + ticket / FAILED
    beat `soul_push.sweep`(每 5 分钟,apps/scheduler/registry.py)
      ├ 入队失败或 worker 崩掉而停住的 QUEUED / SENDING 重新入队
      └ SENT 满 15 分钟的查回执 → DELIVERED / FAILED;DeviceNotRegistered → 设备失效

**记与发分开**,与 `apps/events/handlers/webhook_handler.py` 同一个形状:行在发布者的事务里写,
所以事务回滚时推送也不存在;入队失败不丢,行停在 QUEUED 等 sweep。

投递是**至少一次**:认领后、写回 SENT 前 worker 崩掉,sweep 会把 SENDING 退回重发,手机可能收到两次。
同一**事件**被发布两次不会重推 —— 那由 `(dedupe_key, device)` 唯一约束挡。
"""
import logging
from datetime import timedelta

from django.conf import settings
from django.db import IntegrityError, transaction
from django.db.models import Q
from django.utils import timezone

from apps.soul_push import messages
from apps.soul_push.expo import (
    RECEIPT_BATCH,
    SEND_BATCH,
    PushRequestError,
    PushTransientError,
    get_sender,
)
from apps.soul_push.models import (
    DeviceInvalidReason,
    PushDelivery,
    PushDevice,
    PushPreference,
    PushStatus,
)

logger = logging.getLogger(__name__)

#: 一条投递最多被认领发送几次(含首次)。与 `apps/events/tasks.py::MAX_ATTEMPTS` 同值。
MAX_ATTEMPTS = 5
#: 退避:第 n 次失败后等 min(30·2ⁿ, 1 小时) 秒。
BACKOFF_BASE_SECONDS = 30
BACKOFF_CAP_SECONDS = 3600
#: Expo 建议发送约 15 分钟后再取回执;回执保留 24 小时。
RECEIPT_DELAY = timedelta(minutes=15)
RECEIPT_EXPIRY = timedelta(hours=24)
STALE_QUEUED = timedelta(minutes=5)
STALE_SENDING = timedelta(minutes=10)

DEVICE_NOT_REGISTERED = "DeviceNotRegistered"


def enabled() -> bool:
    return bool(getattr(settings, "SOUL_PUSH_ENABLED", False))


# ── 事件 → 推送 ──────────────────────────────────────────────────────────

#: 转生申请状态 → 推送种类。UNDER_REVIEW 不推(那是提交,由 SUBMITTED 事件推)。
REBIRTH_STATUS_KINDS = {
    "APPEALING": "rebirth_appeal_submitted",
    "APPROVED": "rebirth_result",
    "REJECTED": "rebirth_result",
    "APPEAL_REJECTED": "rebirth_result",
}

#: 处置执行没有自己的事件:`DispositionService.execute` 的可观察结果是灵魂状态
#: 进入 REINCARNATING(有来世)或 SETTLED(终局宇宙观),`transition_to` 为此发 STATE_CHANGED。
DISPOSITION_EXECUTED_STATES = ("REINCARNATING", "SETTLED")

#: **尚未存在的事件**,留映射位。依赖 feat/dispatch-residence 落地暂居(事件名以那条分支为准)。
#: 它们不在 `apps/events/models.py::EventType` 里;
#: `tests/test_soul_push_delivery.py::test_pending_residence_events_do_not_exist_yet` 在它们出现时变红,
#: 提醒把下面 `rule_for` 补上(category "residence",偏好字段已经在 PushPreference 里)。
PENDING_EVENTS = {
    "SOUL_RESIDENCE_STARTED": ("residence", "residence_started"),
    "SOUL_RESIDENCE_ENDED": ("residence", "residence_ended"),
}


def rule_for(event_type, payload, account):
    """`(category, kind, dedupe_key, data)`,或 None(这个事件不推)。

    `data` 只带导航需要的东西(屏幕名与 id),**不带 payload 里的任何其他字段** ——
    payload 里可能有 reason、new_identity、verdict。
    """
    if event_type == "REBIRTH_APPLICATION_SUBMITTED":
        app_id = payload.get("application_id")
        return ("rebirth", "rebirth_submitted", f"rebirth:{app_id}:SUBMITTED",
                {"screen": "ApplicationDetail", "application_id": app_id}) if app_id else None
    if event_type == "REBIRTH_STATUS_CHANGED":
        app_id, new = payload.get("application_id"), payload.get("new_status")
        kind = REBIRTH_STATUS_KINDS.get(new)
        if not (app_id and kind):
            return None
        return ("rebirth", kind, f"rebirth:{app_id}:{new}", {"screen": "ApplicationDetail", "application_id": app_id})
    if event_type == "JUDGMENT_CONCLUDED":
        judgment_id = payload.get("judgment_id")
        return ("judgment", "judgment_result", f"judgment:{judgment_id}", {"screen": "Life"}) if judgment_id else None
    if event_type == "STATE_CHANGED" and payload.get("new_state") in DISPOSITION_EXECUTED_STATES:
        # 一世一个账号,所以 (账号, 状态) 就是「这一世的这次处置执行」。
        return ("judgment", "disposition_executed", f"state:{account.pk}:{payload['new_state']}", {"screen": "Life"})
    return None


HANDLED_EVENTS = frozenset({"REBIRTH_APPLICATION_SUBMITTED", "REBIRTH_STATUS_CHANGED", "JUDGMENT_CONCLUDED",
                            "STATE_CHANGED"})


def record_for_event(event_type, payload, tenant_code):
    """写下该推的投递,返回新建的投递 id。已经记过的(同 dedupe_key、同设备)不再返回。"""
    from apps.soul_accounts.models import SoulAccount

    soul_id = payload.get("soul_id")
    if not soul_id or event_type not in HANDLED_EVENTS:
        return []
    tenant_filter = {"soul__tenant__code": tenant_code} if tenant_code else {"soul__tenant__isnull": True}
    # 与 AuditHandler 同一条:事件自称的租户与灵魂的租户必须一致,否则不推。
    account = SoulAccount.objects.filter(soul_id=soul_id, retired_at__isnull=True, **tenant_filter).first()
    if account is None:
        return []
    rule = rule_for(event_type, payload, account)
    if rule is None:
        return []
    category, kind, dedupe_key, data = rule
    preference = PushPreference.objects.filter(account=account).first()
    if preference is not None and not getattr(preference, category):
        return []
    title, body = messages.render(preference.locale if preference else messages.DEFAULT_LOCALE, kind)
    data = {**data, "kind": kind}
    created_ids = []
    for device in PushDevice.objects.filter(account=account, is_active=True):
        delivery, created = PushDelivery.objects.get_or_create(
            dedupe_key=dedupe_key, device=device,
            defaults={"account": account, "soul_id": account.soul_id, "event_type": event_type, "kind": kind,
                      "title": title, "body": body, "data": data},
        )
        if created:
            created_ids.append(str(delivery.pk))
    return created_ids


def enqueue(delivery_ids):
    """尽力入队。失败不丢:行停在 QUEUED,sweep 会捡。"""
    from apps.soul_push.tasks import send_push

    try:
        send_push.delay(list(delivery_ids))
    except Exception:  # noqa: BLE001
        logger.exception("soul_push: 入队 %s 条失败,留给 sweep", len(delivery_ids))


# ── 设备与偏好 ───────────────────────────────────────────────────────────


def register_device(account, token, platform):
    """登记或认领一个 token。已属于别的账号的 token **转给这个账号** —— 旧账号从此收不到它。"""
    now = timezone.now()
    with transaction.atomic():
        device = PushDevice.objects.select_for_update(of=("self",)).filter(token=token).first()
        if device is None:
            try:
                with transaction.atomic():
                    device = PushDevice.objects.create(account=account, soul=account.soul, token=token,
                                                       platform=platform, last_seen_at=now)
                return device, True
            except IntegrityError:  # 并发的同一 token 注册;退回认领路径
                device = PushDevice.objects.select_for_update(of=("self",)).get(token=token)
        device.account = account
        device.soul = account.soul
        device.platform = platform
        device.is_active = True
        device.invalid_reason = ""
        device.last_seen_at = now
        device.save()
    return device, False


def unregister_device(account, token):
    """只停用属于本账号的那一个;别人的 token 不动,也不回答它是否存在。"""
    PushDevice.objects.filter(account=account, token=token, is_active=True).update(
        is_active=False, invalid_reason=DeviceInvalidReason.UNREGISTERED)


def invalidate_account_devices(account, reason=DeviceInvalidReason.ACCOUNT_RETIRED):
    return PushDevice.objects.filter(account=account, is_active=True).update(is_active=False, invalid_reason=reason)


def preference_for(account):
    return PushPreference.objects.filter(account=account).first() or PushPreference(account=account, soul=account.soul)


# ── 发送 ─────────────────────────────────────────────────────────────────


class PushRetryError(Exception):
    def __init__(self, delivery_ids, countdown):
        super().__init__(f"retry {len(delivery_ids)} in {countdown}s")
        self.delivery_ids = delivery_ids
        self.countdown = countdown


def backoff_seconds(attempts):
    return min(BACKOFF_BASE_SECONDS * 2 ** attempts, BACKOFF_CAP_SECONDS)


def _message(delivery):
    return {"to": delivery.device.token, "title": delivery.title, "body": delivery.body, "data": delivery.data,
            "sound": "default", "priority": "high"}


def _claim(delivery_ids):
    """把可发的行从 QUEUED 改成 SENDING 并返回它们。同一批 id 被两个 worker 拿到时,
    后一个在锁上等,醒来看到的已不是 QUEUED —— 不会两个都发。"""
    claimed, touched = [], []
    with transaction.atomic():
        rows = (PushDelivery.objects.select_for_update(of=("self",))
                .select_related("device", "account").filter(pk__in=delivery_ids, status=PushStatus.QUEUED))
        for row in rows:
            if (not row.device.is_active or row.device.account_id != row.account_id
                    or row.account.retired_at is not None):
                # 事件记下之后设备被注销、转给了别的账号、或账号已转世停用:不推。
                row.status, row.error = PushStatus.CANCELLED, "设备已失效或已不属于该账号"
            elif not enabled():
                row.status, row.error = PushStatus.DISABLED, "推送未启用(SOUL_PUSH_ENABLED 未打开)"
            else:
                row.status = PushStatus.SENDING
                row.attempts += 1
                claimed.append(row)
            touched.append(row)
        _save(touched, ["status", "error", "attempts"])
    return claimed


def _invalidate_device(device_id):
    PushDevice.objects.filter(pk=device_id, is_active=True).update(
        is_active=False, invalid_reason=DeviceInvalidReason.DEVICE_NOT_REGISTERED)


def _apply_ticket(row, ticket, now):
    ticket = ticket if isinstance(ticket, dict) else {}
    if ticket.get("status") == "ok" and ticket.get("id"):
        row.status, row.ticket_id, row.sent_at, row.error = PushStatus.SENT, str(ticket["id"])[:64], now, ""
        return
    details = ticket.get("details") or {}
    row.status = PushStatus.FAILED
    row.error = (details.get("error") or ticket.get("message") or "无效的 ticket")[:200]
    if details.get("error") == DEVICE_NOT_REGISTERED:
        _invalidate_device(row.device_id)


def _save(rows, fields):
    """bulk_update 不触发 auto_now,updated_at 手动写 —— sweep 靠它判断「卡住多久了」。"""
    now = timezone.now()
    for row in rows:
        row.updated_at = now
    PushDelivery.objects.bulk_update(rows, [*fields, "updated_at"])


def send_deliveries(delivery_ids, sender=None):
    """发送这些投递中仍 QUEUED 的。可重试的失败抛 `PushRetryError`(由任务转成 celery retry)。"""
    claimed = _claim(delivery_ids)
    if not claimed:
        return 0
    sender = sender or get_sender()
    fields = ["status", "ticket_id", "sent_at", "error"]
    for start in range(0, len(claimed), SEND_BATCH):
        chunk = claimed[start:start + SEND_BATCH]
        try:
            tickets = sender.send([_message(row) for row in chunk])
        except PushTransientError as exc:
            _defer(claimed[start:], str(exc))  # 抛 PushRetryError;全部用尽次数时不抛
            break  # 这一批与后面各批都已由 _defer 处置
        except Exception as exc:  # noqa: BLE001 — PushRequestError 及意外:记下,不让一批拖垮其余批
            for row in chunk:
                row.status, row.error = PushStatus.FAILED, f"{type(exc).__name__}: {exc}"[:200]
            _save(chunk, fields)
            continue
        now = timezone.now()
        for row, ticket in zip(chunk, tickets, strict=True):
            _apply_ticket(row, ticket, now)
        _save(chunk, fields)
    return len(claimed)


def _defer(rows, error):
    """429 / 5xx / 网络:剩下的行退回 QUEUED 等退避后重试;已用满次数的判失败。"""
    retry, attempts = [], 0
    for row in rows:
        if row.attempts >= MAX_ATTEMPTS:
            row.status, row.error = PushStatus.FAILED, f"放弃:已试 {row.attempts} 次,最后一次 {error}"[:200]
        else:
            row.status, row.error = PushStatus.QUEUED, error[:200]
            retry.append(row)
            attempts = max(attempts, row.attempts)
    countdown = backoff_seconds(attempts)
    for row in retry:
        # 记下退避到期时刻:celery 的 retry 丢了,sweep 也按这个时刻而不是提前重发。
        row.next_attempt_at = timezone.now() + timedelta(seconds=countdown)
    _save(rows, ["status", "error", "next_attempt_at"])
    if retry:
        raise PushRetryError([str(row.pk) for row in retry], countdown)


# ── sweep:兜底入队 + 回执 ────────────────────────────────────────────────


def requeue_stale(now=None, limit=500):
    now = now or timezone.now()
    PushDelivery.objects.filter(status=PushStatus.SENDING, updated_at__lt=now - STALE_SENDING).update(
        status=PushStatus.QUEUED, updated_at=now)
    due = Q(next_attempt_at__isnull=True, updated_at__lt=now - STALE_QUEUED) | Q(next_attempt_at__lt=now)
    ids = [str(pk) for pk in PushDelivery.objects.filter(due, status=PushStatus.QUEUED).order_by("created_at")
        .values_list("pk", flat=True)[:limit]]
    for start in range(0, len(ids), SEND_BATCH):
        enqueue(ids[start:start + SEND_BATCH])
    return len(ids)


def check_receipts(now=None, sender=None, limit=RECEIPT_BATCH):
    """SENT 满 15 分钟的查回执。没配置推送时不查(不存在 SENT 行以外的理由,也没有可问的对象)。"""
    if not enabled():
        return 0
    now = now or timezone.now()
    rows = list(PushDelivery.objects.filter(
        status=PushStatus.SENT, receipt_checked_at__isnull=True, sent_at__lt=now - RECEIPT_DELAY,
    ).exclude(ticket_id="").order_by("sent_at")[:limit])
    if not rows:
        return 0
    try:
        receipts = (sender or get_sender()).receipts([row.ticket_id for row in rows])
    except (PushTransientError, PushRequestError) as exc:
        logger.warning("soul_push: 取回执失败 %s,下个周期再试", exc)
        return 0
    for row in rows:
        receipt = receipts.get(row.ticket_id)
        if receipt is None:
            if row.sent_at < now - RECEIPT_EXPIRY:
                row.receipt_checked_at, row.error = now, "回执已过期(24 小时内未取到)"
            continue
        row.receipt_checked_at = now
        if receipt.get("status") == "ok":
            row.status = PushStatus.DELIVERED
            continue
        details = receipt.get("details") or {}
        row.status = PushStatus.FAILED
        row.error = (details.get("error") or receipt.get("message") or "回执报错")[:200]
        if details.get("error") == DEVICE_NOT_REGISTERED:
            _invalidate_device(row.device_id)
    _save(rows, ["status", "error", "receipt_checked_at"])
    return len(rows)
