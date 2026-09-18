"""「是否互关」「是否同文明」—— 聊天规则依赖的两个判定。

**合并时以 `feat/soul-social-2` 的实现为准。** 朋友圈那一轮会给出这两个函数的正式版本
(它拥有关注关系的全部写路径,也拥有「灵魂之间的可见性」这条规则)。这里写的是能让
聊天策略被执行、被测试的最小版本,放在 `apps/chat/` 而不是 `apps/social/` 是为了
两条分支不在同一个文件上改动:合并时删掉这个文件、把 import 指过去即可。

两处口径,不要在合并时丢掉:

* **互关按「当前账号」算**:`Follow` 连的是 `User`,而一个灵魂每一世换一个 User
  (`apps/soul_accounts/models.py`)。用已停用的前世账号去问互关,答案永远是否 —— 这不是
  错误,是正确的:前世的关注不该让今生免于 24 小时限制。
* **文明按「当前所在」算**,即 `Soul.tenant` 而不是 `home_tenant`
  (2026-09-17 用户决定:朋友圈与聊天都按当前所在,调拨是暂居)。
"""
from apps.social.models import Follow
from apps.soul_accounts.services import current_account_of


def _current_user_id(soul):
    account = current_account_of(soul)
    return account.user_id if account is not None else None


def are_mutual_follows(soul_a, soul_b):
    """两个灵魂的**当前**账号互相关注。"""
    a_user, b_user = _current_user_id(soul_a), _current_user_id(soul_b)
    if a_user is None or b_user is None:
        return False
    live = Follow.objects.filter(is_deleted=False)
    return (
        live.filter(follower_id=a_user, following_id=b_user).exists()
        and live.filter(follower_id=b_user, following_id=a_user).exists()
    )


def same_civilization(soul_a, soul_b):
    """同一个**当前所在**文明。两边都得有租户 —— 没有就不是「同一个」。"""
    return soul_a.tenant_id is not None and soul_a.tenant_id == soul_b.tenant_id
