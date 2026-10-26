"""聊天跟着别处的事实变:转世停用、禁言 / 解禁、调拨与回归(只影响殿司收件箱)。

**转世停用账号时,把它的 Matrix 用户也停掉。**

接 `SOUL_ACCOUNT_RETIRED`(`apps/soul_accounts/services.py::retire_account_for_rebirth`
在转世的同一事务里写的 `SoulEvent`),而不是挂在 `SoulAccount` 的 post_save 上:
`retired_at` 有且只有那一条写路径,但 post_save 会对每一次保存都触发,包括改密、
重置凭据这些与聊天无关的写。

**`on_commit`,不是立即;Synapse 那一半再交给 celery。** 停用要发 HTTP 到 Synapse:转世事务万一回滚,一个已经被
停用、踢出所有房间的 Matrix 用户是回滚不掉的。聊天没启用或 Synapse 不可达时只记日志,
不阻断转世(`services.deactivate_for_account`)—— 账号本身已经登不进来了。
"""
import logging

from django.db import transaction
from django.db.models.signals import post_save
from django.dispatch import receiver

from apps.events.models import SoulEvent
from apps.social.models import SocialMute

logger = logging.getLogger(__name__)

#: 改了 `Soul.tenant` 的两条写路径(apps/dispatch/services.py)写的 STATE_CHANGED 动作。
#: 私聊不看文明(2026-09-19),这里要同步的只剩**殿司收件箱**:灵魂只能写给当前所在的殿司,
#: 调走之后原殿司那封变只读(它在房间里降到 0),回来之后恢复。灵魂之间的房间 `sync_rooms`
#: 也会算一遍,但级别不变、不写(`set_user_levels` 没变就不写)。
TENANT_MOVES = {"DISPATCH_EXECUTED", "DISPATCH_RETURNED"}


def _payload(instance):
    return instance.payload if isinstance(instance.payload, dict) else {}


@receiver(post_save, sender=SoulEvent, dispatch_uid="chat_soul_moved")
def _soul_moved(sender, instance, created, **kwargs):
    if created and _payload(instance).get("action") in TENANT_MOVES:
        soul = instance.soul
        transaction.on_commit(lambda: _sync(soul))


@receiver(post_save, sender=SocialMute, dispatch_uid="chat_mute_changed")
def _mute_changed(sender, instance, **kwargs):
    """禁言与解禁(`lift_mute` 写 `lifted_at`)都是 SocialMute 的一次保存。"""
    account = getattr(instance.user, "soul_account", None)
    if account is not None:
        soul = account.soul
        transaction.on_commit(lambda: _sync(soul))


def _sync(soul):
    from apps.chat.services import enqueue_sync_rooms

    enqueue_sync_rooms(soul)


@receiver(post_save, sender=SoulEvent, dispatch_uid="chat_retire_matrix_user")
def _retire_matrix_user(sender, instance, created, **kwargs):
    if not created or instance.event_type != "SOUL_ACCOUNT_RETIRED":
        return
    account_id = _payload(instance).get("account_id")
    if not account_id:
        return
    transaction.on_commit(lambda: _deactivate(account_id))


def _deactivate(account_id):
    """库内关会话在这里(快、一定成功);Synapse 那一半进 celery,不拖住转世的请求。"""
    from apps.chat.services import close_conversations_for_account
    from apps.chat.tasks import deactivate_matrix_task
    from apps.soul_accounts.models import SoulAccount

    account = SoulAccount.objects.filter(pk=account_id).select_related("soul").first()
    if account is None:
        return
    ids = close_conversations_for_account(account)
    try:
        deactivate_matrix_task.delay(account.pk, ids)
    except Exception:  # noqa: BLE001
        logger.exception("chat: 停用 Matrix 用户入队失败 account=%s", account.pk)
