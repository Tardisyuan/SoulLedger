"""存量回填:灵魂的联系邮箱 → 本世账号的登录邮箱(2026-09-26 产品决定)。

此前只有 `Soul.contact_email` 被写,`User.email` 对灵魂账号从来是空的,而邮箱自助
重置按 `User.email` 找人 —— 所以没有一个灵魂收得到验证码。规则与
`apps/soul_accounts/services.py::sync_login_email` 相同:地址已被别的未删除账号占用
(大小写不敏感,authentication 0016)就不写。一家人共用一个地址时,开号最早的那个拿到它。

**记下写了哪些**:每写一个账号,留一条 AuditLog(`changes.login_email_backfill`)。
反向只清这些账号、且只在登录邮箱仍等于联系邮箱时清,然后删掉这些标记行。
幂等:登录邮箱已经等于联系邮箱的账号不再写,也不再留标记。
"""
from django.db import migrations

MARKER = "0003_sync_contact_email_to_login_email"


def forward(apps, schema_editor):
    SoulAccount = apps.get_model("soul_accounts", "SoulAccount")
    User = apps.get_model("authentication", "User")
    AuditLog = apps.get_model("audit", "AuditLog")

    accounts = (
        SoulAccount._default_manager.filter(retired_at__isnull=True).exclude(soul__contact_email="")
        .select_related("soul", "user").order_by("created_at", "pk")
    )
    for account in accounts:
        user, email = account.user, account.soul.contact_email
        if user.email.lower() == email.lower():
            continue
        if User._default_manager.filter(email__iexact=email, is_deleted=False).exclude(pk=user.pk).exists():
            continue
        user.email = email
        user.save(update_fields=["email"])
        AuditLog._default_manager.create(
            tenant_id=account.soul.home_tenant_id or account.soul.tenant_id, action="UPDATE",
            resource="soul_account", resource_id=str(account.pk),
            description="存量回填:联系邮箱同步为登录邮箱", changes={"login_email_backfill": MARKER},
        )


def backward(apps, schema_editor):
    SoulAccount = apps.get_model("soul_accounts", "SoulAccount")
    AuditLog = apps.get_model("audit", "AuditLog")

    markers = AuditLog._default_manager.filter(resource="soul_account", changes__login_email_backfill=MARKER)
    ids = list(markers.values_list("resource_id", flat=True))
    for account in SoulAccount._default_manager.filter(pk__in=ids).select_related("soul", "user"):
        if account.user.email.lower() == account.soul.contact_email.lower():
            account.user.email = ""
            account.user.save(update_fields=["email"])
    markers.delete()


class Migration(migrations.Migration):

    dependencies = [
        ("soul_accounts", "0002_rebirth_first_rejection"),
        ("authentication", "0017_user_preferences"),
        ("audit", "0010_auditlog_delete_cascade_id"),
        ("souls", "0036_soul_home_tenant"),
    ]

    operations = [migrations.RunPython(forward, backward)]
