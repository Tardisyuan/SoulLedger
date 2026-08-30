"""合并两位同一位神的记录时,不会把某个账号丢在被退役的那一行上。

115 上实查 `authentication_user JOIN actors_actor WHERE is_deleted=true` → **恰 1 行**:
用户 `Pluto`(EU_HEAVEN_HELL,ADMIN,`is_active=false`,从未登录)指向 actor
`Pluto`(EUROPEAN,已于 2026-08-04 软删)。`User.actor` 的解析走 `_base_manager`,
所以 `user.actor` **仍取得回那一行**,而它在 API 与一切 `objects` 查询里不可见 ——
一个账号绑在系统性不可见的 actor 上。

那行的 `delete_reason` 与现行 `consolidate_eu_pantheon` 写的**不一致**,说明损坏来自
旧版命令;现行版本读起来是会拒绝的。**「读起来会拒绝」不是证据** —— 这个文件把它
变成证据。`apps/actors/migrations/0010` 已经示范过正确的次序:**先改指,后退役**。

(115 上那一行本身是一个待决:现存的 Hades 在 **GR_HADES** 租户,而这个用户属于
EU_HEAVEN_HELL —— 照账本说的「改指 GREEK Hades」会造出一条跨租户链接,正是这轮
审计一直在关的东西。数据怎么处置留给人拍板,代码这边先把复发堵住。)
"""
from io import StringIO

import pytest
from django.core.management import call_command

from apps.actors.models import Actor
from apps.authentication.models import User
from apps.tenants.models import Tenant


@pytest.fixture
def eu(db):
    return Tenant.objects.get_or_create(
        code="EU_HEAVEN_HELL", defaults={"display_name": "European Afterlife"}
    )[0]


def make_pair(tenant):
    """两行同一位神:欧洲的 Pluto 与希腊的 Hades,都是活的。"""
    pluto = Actor.objects.create(
        name="Pluto", civilization="EUROPEAN", role="OVERSEER", tenant=tenant, is_active=True
    )
    hades = Actor.objects.create(
        name="Hades", civilization="GREEK", role="OVERSEER", tenant=tenant, is_active=True
    )
    return pluto, hades


def orphaned_users():
    """指向一个已软删 actor 的账号。断言的判据,与 115 上那次查询逐字同形。"""
    return [
        (u.id, u.username)
        for u in User._base_manager.filter(actor__isnull=False)
        if Actor._base_manager.filter(pk=u.actor_id, is_deleted=True).exists()
    ]


@pytest.mark.django_db
def test_merging_never_leaves_an_account_on_the_retired_row(eu):
    pluto, hades = make_pair(eu)
    user = User.objects.create_user(
        username="pluto_admin", password="x", role="ADMIN", tenant=eu, actor=pluto
    )

    out = StringIO()
    call_command("consolidate_eu_pantheon", "--execute", stdout=out, stderr=out)

    user.refresh_from_db()
    assert orphaned_users() == [], (
        f"合并之后有账号挂在被退役的行上:{orphaned_users()}\n{out.getvalue()}"
    )
    # 而且要么这个用户被改指到留下来的那一行,要么这次合并根本没发生 ——
    # 两者都可接受,不可接受的是「行被删了、账号还指着它」。
    kept = Actor._base_manager.get(pk=user.actor_id)
    assert kept.is_deleted is False


@pytest.mark.django_db
def test_a_merge_with_accounts_on_both_rows_is_refused_outright(eu):
    """两行都被引用时,命令必须拒绝并把决定交回给人 —— 它自己选一个留下,
    就等于替人决定了另一个账号的身份归属。"""
    pluto, hades = make_pair(eu)
    User.objects.create_user(
        username="on_pluto", password="x", role="ADMIN", tenant=eu, actor=pluto
    )
    User.objects.create_user(
        username="on_hades", password="x", role="ADMIN", tenant=eu, actor=hades
    )

    out = StringIO()
    call_command("consolidate_eu_pantheon", "--execute", stdout=out, stderr=out)

    pluto.refresh_from_db()
    hades.refresh_from_db()
    assert pluto.is_deleted is False and hades.is_deleted is False, (
        "两行都被账号引用时仍然合并了 —— 那会替人决定另一个账号的身份归属"
    )
    assert "CONFLICT" in out.getvalue() or "ACTION REQUIRED" in out.getvalue(), (
        f"拒绝了但没说为什么:\n{out.getvalue()}"
    )
    assert orphaned_users() == []


@pytest.mark.django_db
def test_a_referenced_pluto_never_causes_hades_to_be_retired(eu):
    """恢复被合并掉的那一行之后,这条命令不许反过来把幸存者删掉。

    这是 2026-08-31 处置 115 上那条数据时发现的:`tenant_actors` **跨两个租户**取行,
    所以把 EU 的 Pluto 取消软删之后,下一次 `--execute` 会看到两行都活着;
    Pluto 被一个账号引用、Hades 没有,而旧的排序键第一项是 `-refs` ——
    **于是 Pluto 成为幸存者,Hades 被软删**,一次有据可查的合并被悄悄反转,
    留下来的那行还带着罗马名字。

    现在幸存者恒为 `MERGE_SURVIVOR`,而「要退役的那行被账号引用」由**拒绝**处理,
    不是由改变谁幸存来处理 —— 把账号改指到另一个租户的行,正是这个代码库一直在
    关的那种跨租户链接。
    """
    pluto, hades = make_pair(eu)
    User.objects.create_user(
        username="on_pluto_only", password="x", role="ADMIN", tenant=eu, actor=pluto
    )

    out = StringIO()
    call_command("consolidate_eu_pantheon", "--execute", stdout=out, stderr=out)

    pluto.refresh_from_db()
    hades.refresh_from_db()
    assert hades.is_deleted is False, (
        f"幸存者被删了 —— 一个账号的引用不该决定哪个名字活下来:\n{out.getvalue()}"
    )
    assert pluto.is_deleted is False, "被引用的那行也不该被删,应当拒绝并交回给人"
    assert "ACTION REQUIRED" in out.getvalue()
    assert orphaned_users() == []


@pytest.mark.django_db
def test_the_merge_actually_happens_when_nothing_references_either_row(eu):
    """正对照。

    没有它,一个「永远拒绝合并」的实现同样满足上面两条,而那会让这条清理命令
    彻底失效 —— 而且失效得完全无声。
    """
    pluto, hades = make_pair(eu)

    out = StringIO()
    call_command("consolidate_eu_pantheon", "--execute", stdout=out, stderr=out)

    pluto.refresh_from_db()
    hades.refresh_from_db()
    assert [pluto.is_deleted, hades.is_deleted].count(True) == 1, (
        f"没有任何引用时,两行应当合并成一行:\n{out.getvalue()}"
    )
    # 留下来的是希腊那个名字 —— 命令自己的注释说这是有意的(平局时按名字定,
    # 不按 created_at,免得种子插入顺序决定谁活下来)。
    assert hades.is_deleted is False
