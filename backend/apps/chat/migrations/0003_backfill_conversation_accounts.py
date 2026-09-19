"""存量会话补上双方那一世的账号。

**取法**:会话一方的账号 = 那个灵魂在**会话建立时刻之前**建的账号里最新的一个。
一世一个账号、前后相接(`SoulAccount.previous_account`),而建房时后端已经为双方各取过一次
本世账号(`ensure_identity`)—— 所以建房那一刻活着的,就是那之前最后建的那个。
已关闭的会话照同一条取:关闭改变的是 `closed_at`,不改变会话属于哪一世。

找不到(理论上不会:建房要求双方已有账号)就留空,那一行从此不出现在任何灵魂的列表里,
也不参与发言权计算 —— 宁可不列,不猜给新一世。

不包 try/except:PostgreSQL 上失败的语句会中止整个迁移事务,吞掉只会把错报到下一句上
(CLAUDE.md「SQLITE HIDES A WHOLE CLASS OF DEFECT」)。幂等:只补仍为空的列。
"""
from django.db import migrations


def _account_at(accounts, soul_id, moment):
    if soul_id is None:
        return None
    return (accounts.objects.filter(soul_id=soul_id, created_at__lte=moment)
            .order_by("-created_at").values_list("pk", flat=True).first())


def backfill(apps, schema_editor):
    Conversation = apps.get_model("chat", "Conversation")
    SoulAccount = apps.get_model("soul_accounts", "SoulAccount")
    for row in Conversation.objects.filter(account_a__isnull=True).iterator():
        Conversation.objects.filter(pk=row.pk).update(
            account_a_id=_account_at(SoulAccount, row.soul_a_id, row.created_at),
            account_b_id=_account_at(SoulAccount, row.soul_b_id, row.created_at),
        )


class Migration(migrations.Migration):

    dependencies = [
        ("chat", "0002_conversation_accounts"),
        ("soul_accounts", "0002_rebirth_first_rejection"),
    ]

    operations = [migrations.RunPython(backfill, migrations.RunPython.noop)]
