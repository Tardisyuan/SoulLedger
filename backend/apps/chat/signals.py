"""转世停用账号时,把它的 Matrix 用户也停掉。

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


@receiver(post_save, sender=SoulEvent, dispatch_uid="chat_retire_matrix_user")
def _retire_matrix_user(sender, instance, created, **kwargs):
    if not created or instance.event_type != "SOUL_ACCOUNT_RETIRED":
        return
    payload = instance.payload if isinstance(instance.payload, dict) else {}
    account_id = payload.get("account_id")
    if not account_id:
        return
    transaction.on_commit(lambda: _deactivate(account_id))


def _deactivate(account_id):
    from apps.chat.services import deactivate_for_account
    from apps.soul_accounts.models import SoulAccount

    account = SoulAccount.objects.filter(pk=account_id).select_related("soul").first()
    if account is not None:
        deactivate_for_account(account)
