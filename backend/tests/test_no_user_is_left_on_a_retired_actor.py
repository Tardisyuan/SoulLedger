"""合并两位同一位神的记录时,不会把某个账号丢在被退役的那一行上。

115 上实查 `authentication_user JOIN actors_actor WHERE is_deleted=true` → **恰 1 行**:
用户 `Pluto`(EU_HEAVEN_HELL,ADMIN,`is_active=false`,从未登录)指向 actor
`Pluto`(EUROPEAN,已于 2026-08-04 软删)。`User.actor` 的解析走 `_base_manager`,
所以 `user.actor` **仍取得回那一行**,而它在 API 与一切 `objects` 查询里不可见 ——
一个账号绑在系统性不可见的 actor 上。

**2026-08-31:那次合并本身被推翻了。** 一轮专门的调查(见
`apps/actors/mythology/actors_european.py` 的 Pluto 行注释)查明:合并所依据的考据
是对的但用错了地方 —— 但丁另有一个 Pluto 守着第四圈(Inf. VII.2),欧洲语料早就
把他记成 circle 4 的 guardian,而 Charon / Minos / Cerberus 都是照这个身份种下的。
Pluto 行已恢复,`consolidate_eu_pantheon` 的合并步骤已退役。

于是这个文件里三条依赖那个步骤的测试没有了对象。**保留的是与那个步骤无关的那半**:
一个账号不该挂在一个软删的 actor 上。(守 `--purge-norse` 的两条随命令本身于 2026-11-21
删除 —— 一次性清理已做完,命令与测试都在 git 历史里。)

根因也在那轮调查里定死了,而且不是推断:commit `7e93f3a` 的正文自陈「survivor 的
选择与孤儿账号的停用是手做的」,时间比 Pluto 行的 `deleted_at` 晚 8 分钟 ——
那次手工操作做了「退役旧行」和「停用账号」,唯独漏了 `0010` 已经示范过的
**先改指、后退役**。
"""
from io import StringIO

import pytest
from django.core.management import call_command

from apps.actors.models import Actor
from apps.authentication.models import User


def orphaned_users():
    """指向一个已软删 actor 的账号。断言的判据,与 115 上那次查询逐字同形。"""
    return [
        (u.id, u.username)
        for u in User._base_manager.filter(actor__isnull=False)
        if Actor._base_manager.filter(pk=u.actor_id, is_deleted=True).exists()
    ]


@pytest.mark.django_db
def test_no_seeded_database_leaves_an_account_on_a_deleted_actor(db):
    """数据面的不变式,与任何一条清理命令无关。

    115 上那一行(账号 `Pluto` 指着软删的 actor)是**手工**操作留下的,不是任何
    代码路径产生的 —— 所以按命令去守它守不住。这一条直接查那个形状本身。
    """
    call_command("seed_mythology", stdout=StringIO())
    assert orphaned_users() == [], (
        "一次全新的种子之后就已经有账号挂在软删 actor 上"
    )
