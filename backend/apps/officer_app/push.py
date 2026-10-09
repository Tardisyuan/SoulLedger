"""官员端推送:登记设备、算一个官员此刻有几件待办、发一句泛化的计数。

锁屏上只写「有 N 件待你处理」—— 不含人名、案由、灵魂。点开后 App 自己取 `todo/`。
发送端口复用灵魂端的 `get_sender()`(同一个 Expo 通道、同一个 `SOUL_PUSH_SENDER` 换法)。

**为什么不走灵魂端的 PushDelivery 记录 / 回执 / 退避**:那一套服务「灵魂的通知历史」(App 里有个
历史列表读它),官员端没有这个列表 —— 官员台的通知中心读 `UserNotification`。所以这里只做
一次尽力发送;Expo 报告设备未注册时停用该设备。celery 重试覆盖瞬时失败。

触发点(「有东西落进四组之一」):`WorkflowService.announce`(新节点轮到某人,含转生申请)、
`DispatchService._notify_target_tenant`(调拨提案)、`rebirth.request_cooldown_shortening`
(缩短冷却申请)。三处都只调 `notify_users(用户们)`,由本模块重算计数。
"""
import logging

from celery import shared_task
from django.db import IntegrityError, transaction
from django.utils import timezone

from apps.officer_app import todo
from apps.officer_app.models import OfficerPushDevice
from apps.soul_push.expo import PushRequestError, PushTransientError, get_sender

logger = logging.getLogger(__name__)

TITLE = {"zh-Hans": "灵魂簿 · 官员", "en": "SoulLedger · Officers"}
BODY = {"zh-Hans": "有 {n} 件待你处理", "en": "{n} items waiting on you"}
#: 官员端的推送类别(与灵魂端的 `data.screen` 分开,App 按它路由)。
CATEGORY = "officer_todo"


def register_device(user, token, platform):
    now = timezone.now()
    with transaction.atomic():
        device = OfficerPushDevice.objects.select_for_update(of=("self",)).filter(token=token).first()
        if device is None:
            try:
                with transaction.atomic():
                    return OfficerPushDevice.objects.create(user=user, token=token, platform=platform,
                                                            last_seen_at=now), True
            except IntegrityError:
                device = OfficerPushDevice.objects.select_for_update(of=("self",)).get(token=token)
        device.user, device.platform, device.is_active, device.last_seen_at = user, platform, True, now
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


def send_to_user(user, sender=None, target=None):
    devices = list(OfficerPushDevice.objects.filter(user=user, is_active=True))
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
        if isinstance(ticket, dict) and (ticket.get("details") or {}).get("error") == "DeviceNotRegistered":
            OfficerPushDevice.objects.filter(pk=device.pk).update(is_active=False)
    return len(devices)


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
