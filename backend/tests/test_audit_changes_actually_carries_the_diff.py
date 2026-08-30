"""`AuditLog.changes` 装得下一次 UPDATE 的前后值。

`_on_post_save` 此前这样取旧行:

    old_instance = sender.objects.get(pk=instance.pk)
    changes = _build_changes(instance, old_instance)

post_save 在行写完**之后**触发,所以那次查询拿回来的是**新行**。`_build_changes`
把实例和它自己比,每个字段都相等,`changes` 出来是 None。PostgreSQL 上端到端实测:
`UPDATE approvalworkflow changes=None`。

`AuditLog.changes` 被文档化为 `{"field": ["old", "new"]}`,由 `/audit-logs/timeline/`
渲染 —— **它从来没有装过一次 UPDATE 的 diff**。`apps/audit/tests.py` 里一条信号测试
都没有,所以没有任何东西说过相反的话。

同一个缺陷的第二处在 `_invalidate_permission_cache` 的 Role 分支:
`old_role.permissions.all()` 与 `instance.permissions.all()` 是同一个 pk 上的同一个
查询,`old == new` 恒真,于是 **`Role` 的保存从不产生任何 PERMISSION_CHANGE 审计行**。

这个文件必须跑在 `transaction=True` 下:审计写入走 `transaction.on_commit`,普通
`django_db` 的事务最后回滚、回调永不执行,断言会落在一张空表上 ——
`apps/audit/oncommit_guard.py` 就是为这件事装的。
"""
import pytest

from apps.audit.models import AuditAction, AuditLog
from apps.perm.models import Permission, Role, RolePermission
from apps.souls.models import Soul
from apps.tenants.models import Tenant


def latest_update_for(resource_id):
    return (
        AuditLog.objects.filter(action=AuditAction.UPDATE, resource_id=str(resource_id))
        .order_by("-timestamp")
        .first()
    )


@pytest.mark.django_db(transaction=True)
def test_an_update_records_both_the_old_and_the_new_value():
    tenant, _ = Tenant.objects.get_or_create(
        code="CN_DIYU", defaults={"display_name": "中国地府"}
    )
    soul = Soul.objects.create(name="改名前", tenant=tenant, current_state="ALIVE")

    soul.name = "改名后"
    soul.save()

    entry = latest_update_for(soul.pk)
    assert entry is not None, "改名之后没有 UPDATE 审计行"
    assert entry.changes, (
        f"changes 是 {entry.changes!r} —— 它此前对每一次 UPDATE 都是 None"
    )
    assert "name" in entry.changes, f"改的是 name,而 changes 里只有 {list(entry.changes)}"
    # 前后两个值都要在。只断言「有 name 这个键」的话,一个把新值写两遍的实现
    # 也能过,而那正是修之前的形状(实例和它自己比,只是那时连键都没有)。
    assert entry.changes["name"] == ["改名前", "改名后"], entry.changes["name"]


@pytest.mark.django_db(transaction=True)
def test_a_save_that_changes_nothing_records_no_diff():
    """反对照。

    没有它,一个「把每个字段都写成 [值, 值]」的实现同样满足上面那条,而那样的
    时间线上每一行都在报告一次没发生的改动。
    """
    tenant, _ = Tenant.objects.get_or_create(
        code="CN_DIYU", defaults={"display_name": "中国地府"}
    )
    soul = Soul.objects.create(name="没动过", tenant=tenant, current_state="ALIVE")
    AuditLog.objects.filter(resource_id=str(soul.pk)).delete()

    soul.save()

    entry = latest_update_for(soul.pk)
    if entry is not None:
        assert not entry.changes, f"什么都没改,却记了 {entry.changes}"


@pytest.mark.django_db(transaction=True)
def test_replacing_a_roles_grants_records_both_sets_in_one_row(api_client, admin_user, cn_tenant):
    """一次指派要在时间线上留下**完整的**前后两个集合。

    第二处缺陷的真实形状,比审计账本记的更准,是实测出来的:
    `assign_role_permissions` 先 `.delete()` 再 `bulk_create`。前者逐行发 post_delete,
    每行产生一条「这条授权被撤销」;后者**一个 post_save 都不发**。实测 —— 一个持有
    {asg.0, asg.1, asg.2} 的角色被指派为 {asg.0}(保留一条、撤掉两条):

        PC rolepermission 20 {'permissions': {'old': ['asg.0'], 'new': []}}
        PC rolepermission 21 {'permissions': {'old': ['asg.1'], 'new': []}}
        PC rolepermission 22 {'permissions': {'old': ['asg.2'], 'new': []}}

    **三条撤销,零条授予。** 读 `/audit-logs/timeline/` 的人看到的是一个被扒光的角色,
    而它其实保住了三分之一。逐行那些条目不是错的,它们是一次替换的一半,而活下来的
    正好是吓人的那一半。
    """
    from rest_framework_simplejwt.tokens import RefreshToken

    token = RefreshToken.for_user(admin_user)
    if admin_user.tenant:
        token["tenant_code"] = admin_user.tenant.code
    api_client.credentials(HTTP_AUTHORIZATION=f"Bearer {token.access_token}")

    role, _ = Role.objects.get_or_create(
        name="DIFF_PROBE", defaults={"display_name": "Diff Probe"}
    )
    perms = []
    for i in range(3):
        p, _ = Permission.objects.get_or_create(
            codename=f"diff.probe.{i}",
            defaults={"name": f"Diff Probe {i}", "category": "test"},
        )
        perms.append(p)
        RolePermission.objects.get_or_create(role=role, permission=p)

    AuditLog.objects.filter(action=AuditAction.PERMISSION_CHANGE).delete()

    response = api_client.post(
        "/api/v1/perm/role-permissions/assign/",
        {"role": role.name, "permission_ids": [perms[0].id]},
        format="json",
    )
    assert response.status_code == 200, response.data

    rows = AuditLog.objects.filter(
        action=AuditAction.PERMISSION_CHANGE, resource="role", resource_id=str(role.pk)
    )
    assert rows.count() == 1, (
        f"一次替换应当留下**一条**说明前后集合的记录,实际 {rows.count()} 条。"
        f"逐行的 rolepermission 条目仍在,它们说的是别的事。"
    )
    diff = rows.first().changes["permissions"]
    assert diff["old"] == ["diff.probe.0", "diff.probe.1", "diff.probe.2"], diff
    assert diff["new"] == ["diff.probe.0"], diff


@pytest.mark.django_db(transaction=True)
def test_an_assignment_that_changes_nothing_records_no_replacement_row(
    api_client, admin_user, cn_tenant
):
    """反对照。没有它,一个「每次指派都写一行」的实现同样满足上面那条,
    而那会在时间线上堆满没发生的改动。"""
    from rest_framework_simplejwt.tokens import RefreshToken

    token = RefreshToken.for_user(admin_user)
    if admin_user.tenant:
        token["tenant_code"] = admin_user.tenant.code
    api_client.credentials(HTTP_AUTHORIZATION=f"Bearer {token.access_token}")

    role, _ = Role.objects.get_or_create(
        name="SAME_PROBE", defaults={"display_name": "Same Probe"}
    )
    p, _ = Permission.objects.get_or_create(
        codename="same.probe.0", defaults={"name": "Same", "category": "test"}
    )
    RolePermission.objects.get_or_create(role=role, permission=p)

    AuditLog.objects.filter(action=AuditAction.PERMISSION_CHANGE).delete()

    response = api_client.post(
        "/api/v1/perm/role-permissions/assign/",
        {"role": role.name, "permission_ids": [p.id]},
        format="json",
    )
    assert response.status_code == 200, response.data

    assert not AuditLog.objects.filter(
        action=AuditAction.PERMISSION_CHANGE, resource="role", resource_id=str(role.pk)
    ).exists()
