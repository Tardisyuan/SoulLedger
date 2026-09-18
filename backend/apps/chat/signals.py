"""聊天跟着别处的事实变:转世停用、禁言 / 解禁、调拨与回归。

**转世停用账号时,把它的 Matrix 用户也停掉。**

接 `SOUL_ACCOUNT_RETIRED`(`apps/soul_accounts/services.py::retire_account_for_rebirth`
在转世的同一事务里写的 `SoulEvent`),而不是挂在 `SoulAccount` 的 post_save 上:
`retired_at` 有且只有那一条写路径,但 post_save 会对每一次保存都触发,包括改密、
重置凭据这些与聊天无关的写。

**`on_commit`,不是立即。** 停用要发 HTTP 到 Synapse:转世事务万一回滚,一个已经被
停用、踢出所有房间的 Matrix 用户是回滚不掉的。聊天没启用或 Synapse 不可达时只记日志,
不阻断转世(`services.deactivate_for_account`)—— 账号本身已经登不进来了。
"""
from django.db import transaction
from django.db.models.signals import post_save
from django.dispatch import receiver

from apps.events.models import SoulEvent
from apps.social.models import SocialMute

#: 改了 `Soul.tenant` 的两条写路径(apps/dispatch/services.py)写的 STATE_CHANGED 动作。
#: 文明变了,灵魂在私聊里的发言权跟着变(跨文明不能私聊),在收件箱里也是(只能写给当前殿司)。
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
    from apps.chat.services import sync_rooms_quietly

    sync_rooms_quietly(soul)


@receiver(post_save, sender=SoulEvent, dispatch_uid="chat_retire_matrix_user")
def _retire_matrix_user(sender, instance, created, **kwargs):
    if not created or instance.event_type != "SOUL_ACCOUNT_RETIRED":
        return
    account_id = _payload(instance).get("account_id")
    if not account_id:
        return
    transaction.on_commit(lambda: _deactivate(account_id))


def _deactivate(account_id):
    from apps.chat.services import deactivate_for_account
    from apps.soul_accounts.models import SoulAccount

    account = SoulAccount.objects.filter(pk=account_id).select_related("soul").first()
    if account is not None:
        deactivate_for_account(account)
