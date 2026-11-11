"""聊天跟着别处的事实变:转世停用、禁言 / 解禁、调拨与回归(只影响殿司收件箱)。

**转世停用账号时,把它的 Matrix 用户也停掉。**

接 `SOUL_ACCOUNT_RETIRED`(`apps/soul_accounts/services.py::retire_account_for_rebirth`
在转世的同一事务里写的 `SoulEvent`),而不是挂在 `SoulAccount` 的 post_save 上:
`retired_at` 有且只有那一条写路径,但 post_save 会对每一次保存都触发,包括改密、
重置凭据这些与聊天无关的写。

**库内关会话在注销的事务里;Synapse 那一半 `on_commit` 后交给 celery。** 关会话只写库,放在事务外的话,进程在提交之后
死掉就没有任何东西补它:账号已注销、会话还开着,「一对灵魂一个未关闭会话」的唯一约束也一直占着(2026-11-01 审查)。
停用要发 HTTP 到 Synapse:转世事务万一回滚,一个已经被停用、踢出所有房间的 Matrix 用户是回滚不掉的。
聊天没启用或 Synapse 不可达时只记日志,不阻断转世(`services.deactivate_matrix_side`)—— 账号本身已经登不进来了。
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


@receiver(post_save, sender="souls.Soul", dispatch_uid="chat_soul_recycled")
def _soul_recycled(sender, instance, created, update_fields=None, **kwargs):
    """进回收站与恢复(`SoftDeleteMixin.soft_delete` / `restore` 都以 `update_fields` 含 `is_deleted` 保存):
    重算它所有房间的发言权 —— 删了降到 0,恢复了按规则算回来(审计 2026-11-11 A2-01)。
    幂等:`set_user_levels` 没变就不写。"""
    if not created and update_fields is not None and "is_deleted" in update_fields:
        transaction.on_commit(lambda: _sync(instance))


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
    from apps.chat.services import close_conversations_for_account
    from apps.soul_accounts.models import SoulAccount

    account = SoulAccount.objects.filter(pk=account_id).first()
    if account is None:
        return
    # 这里抛错就让注销一起回滚:事件日志同一条规矩,不吞。
    ids = close_conversations_for_account(account)
    transaction.on_commit(lambda: _deactivate(account.pk, ids))


def _deactivate(account_id, conversation_ids):
    """Synapse 那一半进 celery,不拖住转世的请求。入队失败只记日志:留下的一方由 `sync_rooms` 补降权。"""
    from apps.chat.tasks import deactivate_matrix_task

    try:
        deactivate_matrix_task.delay(account_id, conversation_ids)
    except Exception:  # noqa: BLE001
        logger.exception("chat: 停用 Matrix 用户入队失败 account=%s", account_id)
