"""灵魂账号 → Matrix 用户。

**mxid 不能反推回账号,也不能正着算出来。** 它是 `soul_` 加上
`HMAC-SHA256(MATRIX_USER_SALT, 账号 id)` 的前 24 个十六进制位:

* 不是账号主键 —— 主键是内部标识,出现在别人客户端的 `sender` 字段里就等于泄漏;
* 不是灵魂编号 —— 编号**就是登录名**(`apps/soul_accounts/services.py`),
  放进 mxid 等于把每个人的用户名广播给它聊过天的所有人;
* 不是姓名、邮箱或手机号;
* 派生而不是随机,所以同一个账号重复调用得到同一个人,不需要先查库再决定。

盐与 `SECRET_KEY` 分开一份:拿到其中一个不等于拿到另一个能做的事。**盐换了,所有
mxid 就换了** —— 老房间里的人从此对不上号,所以它和签名密钥一样不可轮换(见
docs/DEPLOYMENT.md「灵魂聊天」)。

显示名是灵魂在朋友圈的显示名(`User.display_name`,开号时取姓名):同文明的灵魂本来就按它
互相搜索;homeserver 模板关掉了 `enable_set_displayname`,所以这个值只能由后端写。
"""
import hashlib
import hmac

from django.conf import settings
from django.db import transaction
from django.utils import timezone

from apps.chat.matrix import get_client
from apps.chat.models import ChatIdentity


def localpart_for(account):
    digest = hmac.new(
        settings.MATRIX_USER_SALT.encode(), str(account.id).encode(), hashlib.sha256
    ).hexdigest()
    return f"soul_{digest[:24]}"


def display_name(account):
    """朋友圈里的显示名 —— 灵魂互相认识的是这个名字(搜索也按它)。"""
    return account.user.display_name or account.soul.name


def ensure_identity(account, *, client=None):
    """取或建这一世的 Matrix 用户。幂等:重复调用只是再确认一次显示名。"""
    client = client or get_client()
    localpart = localpart_for(account)
    client.ensure_user(localpart, display_name(account))
    with transaction.atomic():
        identity, _ = ChatIdentity.objects.get_or_create(
            account=account,
            defaults={
                "soul": account.soul,
                "localpart": localpart,
                "matrix_user_id": client.user_id(localpart),
            },
        )
        if identity.deactivated_at is not None:
            identity.deactivated_at = None
            identity.save(update_fields=["deactivated_at"])
    return identity


def deactivate_identity(account, *, client=None):
    """转世停用账号时调用。Synapse 的 deactivate 同时让该用户离开所有房间。

    没有 `ChatIdentity` 行就什么都不做:这一世从来没开过聊天。
    """
    identity = ChatIdentity.objects.filter(account=account, deactivated_at__isnull=True).first()
    if identity is None:
        return None
    (client or get_client()).deactivate_user(identity.localpart)
    identity.deactivated_at = timezone.now()
    identity.save(update_fields=["deactivated_at"])
    return identity
