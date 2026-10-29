"""官员端推送:登记设备、算一个官员此刻有几件待办、发一句泛化的计数。

锁屏上只写「有 N 件待你处理」—— 不含人名、案由、灵魂。点开后 App 自己取 `todo/`。
发送端口复用灵魂端的 `get_sender()`(同一个 Expo 通道、同一个 `SOUL_PUSH_SENDER` 换法)。

**为什么不走灵魂端的 PushDelivery 记录 / 退避**:那一套服务「灵魂的通知历史」(App 里有个
历史列表读它),官员端没有这个列表 —— 官员台的通知中心读 `UserNotification`。所以这里只做
一次尽力发送;Expo 报告设备未注册时停用该设备 —— 立即的 ticket 错误当场停用,
ticket 成功的留一行 `OfficerPushDelivery`,`check_receipts` 满 15 分钟后查回执,同样停用。celery 重试覆盖瞬时失败。

触发点(「有东西落进四组之一」):`WorkflowService.announce`(新节点轮到某人,含转生申请)、
`DispatchService._notify_target_tenant`(调拨提案)、`rebirth.request_cooldown_shortening`
(缩短冷却申请)。三处都只调 `notify_users(用户们)`,由本模块重算计数。
枉死申诉:`judgment.wangsi._notify_filed`(提出申诉,推给城隍名下官员)。
书信:`chat.inbox.push_to_assignee`(会话被分派 / 改派给他;已分派给他的会话来了灵魂的新信,同会话 10 分钟静默)。
"""
import logging

from celery import shared_task
from django.db import IntegrityError, transaction
from django.utils import timezone

from apps.authentication import signin_sessions
from apps.officer_app import todo
from apps.officer_app.models import OfficerPushDelivery, OfficerPushDevice
from apps.soul_push.expo import RECEIPT_BATCH, PushRequestError, PushTransientError, get_sender
from apps.soul_push.models import PushStatus
from apps.soul_push.services import DEVICE_NOT_REGISTERED, RECEIPT_DELAY, RECEIPT_EXPIRY, enabled

logger = logging.getLogger(__name__)

TITLE = {"zh-Hans": "灵魂簿 · 官员", "en": "SoulLedger · Officers"}
BODY = {"zh-Hans": "有 {n} 件待你处理", "en": "{n} items waiting on you"}
#: 官员端的推送类别(与灵魂端的 `data.screen` 分开,App 按它路由)。
CATEGORY = "officer_todo"


def register_device(user, token, platform, session=None):
    """登记或认领一个 token。已属于别人的 token **转给这位官员**(同一部手机换人登录,旧人从此收不到它)。
    同一个登录会话再登记一个**新** token(Expo 轮换了 token),这个会话上旧的那条停用 —— 否则每次轮换多留一条
    死登记,直到 Expo 报「设备未注册」才清。"""
    device, created = _register(user, token, platform, session)
    if session is not None:
        OfficerPushDevice.objects.filter(user=user, session=session, is_active=True).exclude(pk=device.pk).update(
            is_active=False)
    return device, created


def _register(user, token, platform, session):
    now = timezone.now()
    with transaction.atomic():
        device = OfficerPushDevice.objects.select_for_update(of=("self",)).filter(token=token).first()
        if device is None:
            try:
                with transaction.atomic():
                    return OfficerPushDevice.objects.create(user=user, token=token, platform=platform,
                                                            session=session, last_seen_at=now), True
            except IntegrityError:
                device = OfficerPushDevice.objects.select_for_update(of=("self",)).get(token=token)
        previous_user = device.user_id
        device.user, device.platform, device.is_active, device.last_seen_at = user, platform, True, now
        # 注册请求不带 `sid` 时不抹掉已记下的会话(那会让到期判断退回「按人」);但 token 换了主人,
        # 旧主人的会话不能留在新主人的行上。
        if session is not None or previous_user != user.pk:
            device.session = session
        device.save()
    return device, False


def unregister_device(user, token):
    """只停用属于本人的;别人的 token 不动,也不回答它是否存在。"""
    OfficerPushDevice.objects.filter(user=user, token=token, is_active=True).update(is_active=False)


def notify_users(users, target=None):
    """提交后(若在事务里)给这些人各发一次计数推送。0 件的人不发。

    `target` = `{"kind", "id"}`:触发这次推送的那一条(最新落进待办的)。随推送带给 App,点开直接落到那一条的详情;
    锁屏上仍只有计数,`data` 里不含人名、案由、灵魂。"""
    ids = sorted({u.pk for u in users})
    if not ids:
        return

    def _enqueue():
        try:
            # 没有任何已登记设备就不入队 —— 绝大多数工作流写入都落在这条上。
            ids_with_devices = list(OfficerPushDevice.objects.filter(
                user_id__in=ids, is_active=True).values_list("user_id", flat=True).distinct())
            if ids_with_devices:
                send_todo_push.delay(ids_with_devices, target)
        except Exception:  # noqa: BLE001 — 推送是派生物,不能拖垮业务写入
            logger.exception("officer_app: 入队推送失败")

    transaction.on_commit(_enqueue)


def _locale(user):
    return "en" if (user.preferences or {}).get("email_locale") == "en" else "zh-Hans"


#: 推送落到的条目 → 个人中心「通知」表的类别。按「站内」那一格(推送是站内通知的手机形态)。
#: 没有 `target` 的推送(只有计数)不属于任何一类,照发。
CATEGORY_OF_TARGET = {"approval": "approval", "rebirth": "approval", "cooldown": "approval",
                      "reassignment": "dispatch", "letter": "letter_handoff", "pick": "approval",
                      "city_god": "city_god", "wangsi": "city_god"}


def send_to_user(user, sender=None, target=None):
    from apps.notifications.categories import wants

    if target and not wants(user, CATEGORY_OF_TARGET.get(target["kind"]), "site"):
        return 0
    devices = list(signin_sessions.live_devices(
        OfficerPushDevice.objects.filter(user=user, is_active=True),
        user_field="user_id", lifetime=signin_sessions.officer_app_lifetime()))
    if not devices:
        return 0
    n = todo.total(user)
    if n == 0:
        return 0
    locale = _locale(user)
    sender = sender or get_sender()
    data = {"category": CATEGORY, **({"target": {"kind": target["kind"], "id": str(target["id"])}} if target else {})}
    messages = [{"to": d.token, "title": TITLE[locale], "body": BODY[locale].format(n=n),
                 "data": data, "sound": "default", "priority": "high"} for d in devices]
    tickets = sender.send(messages)
    for device, ticket in zip(devices, tickets, strict=True):
        ticket = ticket if isinstance(ticket, dict) else {}
        if (ticket.get("details") or {}).get("error") == DEVICE_NOT_REGISTERED:
            OfficerPushDevice.objects.filter(pk=device.pk).update(is_active=False)
        elif ticket.get("status") == "ok" and ticket.get("id"):
            OfficerPushDelivery.objects.create(device=device, ticket_id=str(ticket["id"])[:64])
    return len(devices)


def check_receipts(now=None, sender=None, limit=RECEIPT_BATCH):
    """SENT 满 15 分钟的查回执(与灵魂端 `soul_push.services.check_receipts` 同一套规则);
    回执报「设备未注册」就停用该官员设备。推送没启用时不查。"""
    if not enabled():
        return 0
    now = now or timezone.now()
    rows = list(OfficerPushDelivery.objects.filter(
        status=PushStatus.SENT, created_at__lt=now - RECEIPT_DELAY).order_by("created_at")[:limit])
    if not rows:
        return 0
    try:
        receipts = (sender or get_sender()).receipts([row.ticket_id for row in rows])
    except (PushTransientError, PushRequestError) as exc:
        logger.warning("officer_app: 取回执失败 %s,下个周期再试", exc)
        return 0
    changed = []
    for row in rows:
        receipt = receipts.get(row.ticket_id)
        if receipt is None:
            if row.created_at < now - RECEIPT_EXPIRY:
                row.status, row.error = PushStatus.EXPIRED, "回执已过期(24 小时内未取到)"
                changed.append(row)
            continue
        changed.append(row)
        if receipt.get("status") == "ok":
            row.status = PushStatus.DELIVERED
            continue
        details = receipt.get("details") or {}
        row.status = PushStatus.FAILED
        row.error = (details.get("error") or receipt.get("message") or "回执报错")[:200]
        if details.get("error") == DEVICE_NOT_REGISTERED:
            OfficerPushDevice.objects.filter(pk=row.device_id).update(is_active=False)
    OfficerPushDelivery.objects.bulk_update(changed, ["status", "error"])
    return len(rows)


@shared_task(name="officer_app.check_receipts")
def check_receipts_task():
    """登记在 apps/scheduler/registry.py,与 `soul_push.sweep` 同一节奏。"""
    return check_receipts()


@shared_task(name="officer_app.send_todo_push", bind=True, max_retries=3)
def send_todo_push(self, user_ids, target=None):
    from apps.authentication.models import User

    later = []
    for user in User.objects.filter(pk__in=user_ids, is_active=True).exclude(role="SOUL"):
        try:
            send_to_user(user, target=target)
        except PushTransientError:
            later.append(user.pk)
        except PushRequestError:
            logger.warning("officer_app: Expo 拒绝了整批请求(用户 %s)", user.pk)
        except Exception:  # noqa: BLE001 — 一个人失败不拖累其余
            logger.exception("officer_app: 给用户 %s 推送失败", user.pk)
    if later:
        raise self.retry(args=[later, target], countdown=60)
