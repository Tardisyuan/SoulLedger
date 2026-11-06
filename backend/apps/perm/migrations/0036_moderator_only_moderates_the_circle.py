"""Data migration: 朋友圈巡察(MODERATOR)只管朋友圈审核(用户 2026-11-07)。

perm/0035 收回了 `judgment.execute` / `judgment.assign`;这里收回其余一切殿务 —— 审判读写、工作流设计、
调拨、处置、轮回、功德、灵魂增改、灵魂账号与收件箱、审计、组织。`ROLE_PERMISSIONS["MODERATOR"]` 同步只剩
`social.moderate` 加 `dashboard.read` / `notification.read` / `menu.read`。

只删 MODERATOR 这个角色名下、下面这些码名的 RolePermission;别的角色(含自建角色、兼任)不动,
管理员给 MODERATOR 另授的、不在这份清单里的码也不动。码名写死:迁移是冻结的快照。
没有 MODERATOR 角色行、或没有某条 Permission 行的库,对应那条什么都不做。

可逆:backward 在 Permission 行存在时给 MODERATOR 补回这些授予(get_or_create,限定 is_deleted=False)。
"""
from django.db import migrations

ROLE = "MODERATOR"
CODENAMES = [
    "workflow.read", "workflow.create", "workflow.update", "workflow.delete", "workflow.escalate", "workflow.export",
    "soul.read", "soul.create", "soul.update", "soul.die", "soul.transition", "soul.export",
    "judgment.read", "judgment.create", "judgment.export",
    "city_god.read", "city_god.manage", "city_god.execute",
    "tudi.read", "tudi.manage", "tudi.register",
    "wangsi.read", "wangsi.manage", "wangsi.execute",
    "capture.read", "capture.issue", "capture.execute",
    "disposition.read", "disposition.execute", "disposition.export",
    "reincarnation.read", "reincarnation.manage", "reincarnation.reborn",
    "ledger.read", "ledger.manage", "ledger.calculate", "ledger.export",
    "dispatch.read", "dispatch.manage", "dispatch.approve", "dispatch.reject", "dispatch.execute",
    "dispatch.return", "dispatch.export", "sentence_plan.cancel",
    "cross_judgment.read", "cross_judgment.create", "cross_judgment.export",
    "realms.read", "actors.read",
    "org.read", "org.manage",
    "audit.read", "audit.export",
    "soul_account.read", "soul_account.manage",
    "soul_inbox.read", "soul_inbox.reply",
]


def forward(apps, schema_editor):
    alias = schema_editor.connection.alias
    RolePermission = apps.get_model("perm", "RolePermission")
    RolePermission.all_objects.using(alias).filter(
        role__name=ROLE, permission__codename__in=CODENAMES
    ).delete()


def backward(apps, schema_editor):
    alias = schema_editor.connection.alias
    Permission = apps.get_model("perm", "Permission")
    Role = apps.get_model("perm", "Role")
    RolePermission = apps.get_model("perm", "RolePermission")
    role = Role.all_objects.using(alias).filter(name=ROLE, is_deleted=False).first()
    if role is None:
        return
    for perm in Permission.all_objects.using(alias).filter(codename__in=CODENAMES, is_deleted=False):
        RolePermission.all_objects.using(alias).get_or_create(role=role, permission=perm, is_deleted=False)


class Migration(migrations.Migration):
    dependencies = [
        ("perm", "0035_moderator_drops_judgment_execute_assign"),
    ]

    operations = [
        migrations.RunPython(forward, backward),
    ]
