"""SYSTEM_ADMIN 与文明管理员(2026-11-15,docs/ARCHITECTURE-tenant-sharding.md §7.5)。

1. `User.civilization`(可空):只对无殿 ADMIN 有意义 —— 它从此只管这个文明的殿。
2. 回填:每个无殿 ADMIN 的文明由 `actor.tenant` 推(种子殿按 code,其余按 `declared_civilization`,与
   `Tenant.civilization` 同一条规则;映射抄在这里,迁移是冻结的快照)。**推不出的升为 SYSTEM_ADMIN**
   (主会话 2026-11-15 定:保持它们现在「看全部」的行为),迁移输出列出它们的用户名。
3. 种子:控制库自带一个系统管理员 —— 用户名 `settings.SYSTEM_ADMIN_USERNAME`(默认 sysadmin),无殿、
   无文明、**无可用密码**;凭证由 `manage.py bootstrap_system_admin` 设。幂等;同名的非系统管理员账号已存在
   时大声失败,不把别人的账号升权。

可逆:backward 软删种子账号、把其余 SYSTEM_ADMIN 降回 ADMIN、再删列。只在控制库跑(`placed_here`)。
"""
from django.conf import settings
from django.contrib.auth.hashers import UNUSABLE_PASSWORD_PREFIX
from django.db import migrations, models
from django.utils import timezone

from apps.core.migration_ops import placed_here

#: `apps/souls/models.py::TENANT_CIVILIZATION` 在 2026-11-15 的样子。
SEEDED = {"CN_DIYU": "CHINESE", "EU_HEAVEN_HELL": "EUROPEAN", "EG_DUAT": "EGYPTIAN", "GR_HADES": "GREEK"}
CIVILIZATIONS = {"CHINESE", "EUROPEAN", "EGYPTIAN", "GREEK"}


def _civilization_of(tenant):
    if tenant is None:
        return None
    if tenant.code in SEEDED:
        return SEEDED[tenant.code]
    return tenant.declared_civilization if tenant.declared_civilization in CIVILIZATIONS else None


def backfill(apps, schema_editor):
    if not placed_here(schema_editor, apps, "authentication.User", "actors.Actor", "tenants.Tenant"):
        return
    User = apps.get_model("authentication", "User")
    promoted = []
    hall_less = (
        User._base_manager.using(schema_editor.connection.alias)
        .filter(role="ADMIN", tenant__isnull=True)
        .select_related("actor__tenant")
        .order_by("pk")
    )
    for user in hall_less:
        civ = _civilization_of(user.actor.tenant if user.actor_id else None)
        if civ is None:
            user.role = "SYSTEM_ADMIN"
            promoted.append(user.username)
        user.civilization = civ
        user.save(using=schema_editor.connection.alias, update_fields=["role", "civilization"])
    if promoted:
        print(f"\n  authentication.0030: no civilization derivable, promoted to SYSTEM_ADMIN: {', '.join(promoted)}")


def unbackfill(apps, schema_editor):
    if not placed_here(schema_editor, apps, "authentication.User"):
        return
    User = apps.get_model("authentication", "User")
    User._base_manager.using(schema_editor.connection.alias).filter(role="SYSTEM_ADMIN").exclude(
        username=settings.SYSTEM_ADMIN_USERNAME
    ).update(role="ADMIN")


def seed_system_admin(apps, schema_editor):
    if not placed_here(schema_editor, apps, "authentication.User"):
        return
    User = apps.get_model("authentication", "User")
    username = settings.SYSTEM_ADMIN_USERNAME
    user, created = User._base_manager.using(schema_editor.connection.alias).get_or_create(
        username=username,
        # 不可用密码(`has_usable_password()` 为假)。不用 make_password(None):它带随机后缀,同一份迁移跑两次
        # 结果不同,测试模板库的「真迁移 vs 模板」核对会报漂移(config/sqlite_template.py)。
        defaults={"role": "SYSTEM_ADMIN", "display_name": "系统管理员", "is_active": True,
                  "password": f"{UNUSABLE_PASSWORD_PREFIX}seeded-by-authentication-0030"},
    )
    if created:
        return
    if user.role != "SYSTEM_ADMIN":
        raise RuntimeError(
            f"authentication.0030: a {user.role} account named {username!r} already exists; refusing to make it the "
            "system administrator. Set SYSTEM_ADMIN_USERNAME to a free name and migrate again."
        )
    # 反向迁移软删过它:再次正向时恢复,不另建一个。
    user.is_deleted, user.deleted_at, user.is_active, user.tenant_id, user.civilization = False, None, True, None, None
    user.save(using=schema_editor.connection.alias,
              update_fields=["is_deleted", "deleted_at", "is_active", "tenant", "civilization"])


def unseed_system_admin(apps, schema_editor):
    if not placed_here(schema_editor, apps, "authentication.User"):
        return
    User = apps.get_model("authentication", "User")
    User._base_manager.using(schema_editor.connection.alias).filter(
        username=settings.SYSTEM_ADMIN_USERNAME, role="SYSTEM_ADMIN"
    ).update(is_deleted=True, deleted_at=timezone.now(), is_active=False)


class Migration(migrations.Migration):
    dependencies = [
        ("authentication", "0029_officer_device_login"),
        ("actors", "0021_cn_ghost_emperors_and_ox_head"),
        ("tenants", "0022_egypt_description_names_seeded_stations"),
    ]

    operations = [
        migrations.AddField(
            model_name="user",
            name="civilization",
            field=models.CharField(
                blank=True,
                choices=[
                    ("CHINESE", "Chinese Diyu"),
                    ("EUROPEAN", "European Heaven/Hell"),
                    ("EGYPTIAN", "Egyptian Duat"),
                    ("GREEK", "Greek Underworld"),
                ],
                max_length=20,
                null=True,
            ),
        ),
        migrations.RunPython(backfill, unbackfill),
        migrations.RunPython(seed_system_admin, unseed_system_admin),
    ]
