"""Data migration: 业务码拆族(用户 2026-10-29 第 3 条)+ 只许 ADMIN 的码收口 + 删死码 reincarnation.complete。

1. **拆码,行为不变。** 每个新码授给「此刻持有旧码的角色」,与 checker 同一个判法:旧码有存活 Permission 行
   → 看它的 RolePermission(含自建角色、含管理员在矩阵里做过的增减);没有行 → 看 ROLE_PERMISSIONS 字典
   (冻结在下面 `DICT_HOLDERS`,迁移不读活的字典)。新码一律落 Permission 行,矩阵里看得见、能单独收放。
   `ledger.calculate` 例外:取 ledger.manage 的持有者**去掉 GUARDIAN** —— GUARDIAN 的 ledger.manage 是
   souls/0053 为写功过记录给的,重算原来不归它(fix-queue「fix-be1 遗留」)。
2. **只许 ADMIN 的码**(soul.correct_settlement、menu.manage、scheduler.manage、recycle_bin.restore /
   hard_delete):删掉非 ADMIN 角色身上的授予。checker 已对它们恒答「无」,留着只会让矩阵打勾说假话。
3. **删 reincarnation.complete**:没有任何路由要它(reincarnation/views.py),删行连同授予。

幂等:get_or_create,限定 is_deleted=False。Backward:删掉第 1 步建的码(RolePermission 级联);
第 2、3 步不还原 —— 被删的授予 checker 本来就不认,死码没有消费者。
"""
from django.db import migrations

#: (新码, 名称, 族, 旧码)。
SPLITS = [
    ("city_god.read", "查看城隍", "city_god", "judgment.read"),
    ("city_god.manage", "管理城隍", "city_god", "judgment.assign"),
    ("city_god.execute", "城隍初审", "city_god", "judgment.execute"),
    ("tudi.read", "查看土地公", "tudi", "judgment.read"),
    ("tudi.manage", "管理土地公", "tudi", "judgment.assign"),
    ("tudi.register", "以土地公名义登记死亡", "tudi", "soul.die"),
    ("wangsi.read", "查看枉死城", "wangsi", "judgment.read"),
    ("wangsi.manage", "代办枉死申诉", "wangsi", "judgment.assign"),
    ("wangsi.execute", "审枉死申诉", "wangsi", "judgment.execute"),
    ("capture.read", "查看勾魂牒", "capture", "soul.read"),
    ("capture.issue", "发勾魂牒", "capture", "soul.die"),
    ("capture.execute", "执行勾魂", "capture", "soul.die"),
    ("soul.export", "导出灵魂", "soul", "soul.read"),
    ("judgment.export", "导出审判", "judgment", "judgment.read"),
    ("disposition.export", "导出处置", "disposition", "disposition.read"),
    ("dispatch.export", "导出调度", "dispatch", "dispatch.read"),
    ("cross_judgment.export", "导出跨域审判", "cross_judgment", "cross_judgment.read"),
    ("workflow.export", "导出工作流", "workflow", "workflow.read"),
    ("audit.export", "导出审计日志", "audit", "audit.read"),
    ("ledger.export", "导出功德", "ledger", "ledger.read"),
    ("ledger.calculate", "重算功德", "ledger", "ledger.manage"),
]

#: 新码 -> 不从旧码继承的角色。
NOT_INHERITED = {"ledger.calculate": {"GUARDIAN"}}

#: ROLE_PERMISSIONS 里旧码的持有者,冻结于 2026-10-29。
_ALL = ["ADMIN", "MODERATOR", "JUDGE", "GUARDIAN", "VIEWER"]
DICT_HOLDERS = {
    "judgment.read": ["ADMIN", "MODERATOR", "JUDGE"],
    "judgment.execute": ["ADMIN", "MODERATOR", "JUDGE"],
    "judgment.assign": ["ADMIN", "MODERATOR"],
    "soul.read": _ALL,
    "soul.die": ["ADMIN", "MODERATOR", "JUDGE"],
    "disposition.read": ["ADMIN", "MODERATOR", "JUDGE", "GUARDIAN"],
    "dispatch.read": ["ADMIN", "MODERATOR", "GUARDIAN"],
    "cross_judgment.read": ["ADMIN", "MODERATOR", "JUDGE"],
    "workflow.read": ["ADMIN", "MODERATOR", "JUDGE"],
    "audit.read": ["ADMIN", "MODERATOR"],
    "ledger.read": _ALL,
    "ledger.manage": ["ADMIN", "MODERATOR", "GUARDIAN"],
}

ADMIN_ONLY = ["soul.correct_settlement", "menu.manage", "scheduler.manage",
              "recycle_bin.restore", "recycle_bin.hard_delete"]
DEAD = ["reincarnation.complete"]


def _holders(alias, models, codename):
    """Live roles that hold `codename` now, the way apps/perm/checker.py answers it."""
    permission_model, role_model, grant_model = models
    row = permission_model.all_objects.using(alias).filter(codename=codename, is_deleted=False).first()
    roles = role_model.all_objects.using(alias).filter(is_deleted=False)
    if row is None:
        return list(roles.filter(name__in=DICT_HOLDERS[codename]))
    ids = grant_model.all_objects.using(alias).filter(permission=row, is_deleted=False).values_list("role_id", flat=True)
    return list(roles.filter(pk__in=list(ids)))


def forward(apps, schema_editor):
    alias = schema_editor.connection.alias
    Permission = apps.get_model("perm", "Permission")
    Role = apps.get_model("perm", "Role")
    RolePermission = apps.get_model("perm", "RolePermission")

    # Holders first, every one of them, before any new row exists.
    plan = [
        (codename, name, family,
         [r for r in _holders(alias, (Permission, Role, RolePermission), old)
          if r.name not in NOT_INHERITED.get(codename, ())])
        for codename, name, family, old in SPLITS
    ]
    for codename, name, family, roles in plan:
        perm, _ = Permission.all_objects.using(alias).get_or_create(
            codename=codename, is_deleted=False, defaults={"name": name, "category": family}
        )
        for role in roles:
            RolePermission.all_objects.using(alias).get_or_create(role=role, permission=perm, is_deleted=False)

    RolePermission.all_objects.using(alias).filter(
        permission__codename__in=ADMIN_ONLY,
    ).exclude(role__name="ADMIN").delete()
    Permission.all_objects.using(alias).filter(codename__in=DEAD).delete()


def backward(apps, schema_editor):
    alias = schema_editor.connection.alias
    Permission = apps.get_model("perm", "Permission")
    Permission.all_objects.using(alias).filter(codename__in=[c for c, _, _, _ in SPLITS]).delete()


class Migration(migrations.Migration):
    dependencies = [
        ("perm", "0028_session_manage_permission"),
        ("souls", "0053_grant_ledger_manage_to_record_writers"),
    ]

    operations = [
        migrations.RunPython(forward, backward),
    ]
