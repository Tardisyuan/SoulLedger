"""Open the GONGGUOGE corpus, and put its 73 citation keys on databases that
already hold a cosmology.

背景
----
中国侧的 13 条 CN-HL-* 「冥律条文」已由 judgment/0012 整批撤回：不存在成文
冥律，《玉历宝钞》是逐殿叙述的善书，没有条款编号也没有刑期。撤回的是**框架**
而不只是细节，所以补齐那份名单是唯一不能做的修复。

现在中国侧回来了，而且是另一种文本：《太微仙君功過格》（1171，正統道藏洞真部
戒律類雨字號），73 条转录条目、逐条带原文分值。它**不是**冥律的正确版本——
功過格是在世者自记的道德账簿，原生赏罚是在世奪紀奪算、成仙阈值与子孙余庆余
殃，全文不出现任何地狱名。本系统拿它作审判计分依据是一次**有意的挪用**，每
一行的 `source_notes` 都带着这句话。详见 seed_mythology.py 中 CHINESE_STATUTES
上方的说明与 docs/lore-verification/gongguoge.md §6。

这个迁移做什么
--------------
1. **AlterField**：`corpus` 的 choices 增加 GONGGUOGE。HELL_LAW 一并保留——
   0012 软删的行、以及它因为已被判决引用而**故意没动**的行，都还带着那个值，
   而一个离开 enum 的取值会让某个已决案件的依据不再渲染、不再校验、不再回滚。
   `code` 的 help_text 同时更新（示例码改为现存的 CN-GGG-* / EU-DS-T*）。

2. **RunPython**：在**已有语料**的库上建 73 条的**标识列**——code / ordinal /
   polarity / corpus / civilization / payload 里的門与門内序号。正文、分值、
   provenance 与全部校勘注记**不在这里**，由下一次 `seed_mythology --update`
   写入。这是 realms/0012、0013、0014 一致的分工：迁移里再抄一份条文正文，
   就是第二份没人保持同步的副本。

   这里刻意重复的只有两样：**门的分段数**（11/7/5/12/15/8/10/5）和**排列顺序**。
   它们是本次工作的核心事实——门题作十二條而两个独立转录本都只给 11 段、门题
   作六條而都只给 5 段——重复一次，就没有任何一处能单方面悄悄改掉它。

空库守卫
--------
一个还没有任何 Statute 的库是全新安装：`seed_mythology` 会把三套语料连同正文
一起写全，迁移抢在它前面半播种，只会交给它一批自己没建、没租户、且 `--dry-run`
本应报空的行。realms/0012 就是这么栽的，0013/0014 都带同一个守卫。

租户从既有的中国侧条文行上取（`_base_manager` 看得见 0012 软删的 CN-HL-*），
取不到就留空——`seed_mythology._upsert` 有一条专门的 tenant-only 补写路径，
不需要这里去猜一个 tenant code。

可逆性
------
`backwards` 只删本迁移可能建过的那 73 个 code，且**只删没有被判决引用过的**。
引用是一个案子当时依据了什么的证据；一条被引用过的条文即使是回滚也不能消失，
`JudgmentCitation.statute` 是 PROTECT，硬删要么被数据库拒绝要么把已记录的依据
变成悬空外键。跳过的行会打印出来。正反向都可重复执行。

全部行访问走 `_base_manager`：`Statute.objects` 是租户过滤 + 软删过滤的，迁移
里没有租户上下文，它会在一张没被碰过的表上报告静默成功。
"""
from django.db import migrations, models

CORPUS = "GONGGUOGE"
CIVILIZATION = "CHINESE"

#: (code segment, polarity, 門, 門题所称条数, 转录实得段数)
#:
#: 顺序即文本顺序：功格四門在前，過律四門在后。`ordinal` 由此连续编号 1..73,
#: 而不是門内序号——`Statute.Meta.ordering` 按 ordinal 排，門内编号会把救濟門
#: 第一条和不仁門第一条排到一起，读出来不是这份文献的顺序。
GATES = [
    ("F-JJ", "MERIT", "救濟門", "十二條", 11),
    ("F-JD", "MERIT", "教典門", "七條", 7),
    ("F-FX", "MERIT", "焚修門", "五條", 5),
    ("F-YS", "MERIT", "用事門", "十二條", 12),
    ("G-BR", "OFFENCE", "不仁門", "十五條", 15),
    ("G-BS", "OFFENCE", "不善門", "八條", 8),
    ("G-BY", "OFFENCE", "不義門", "十條", 10),
    ("G-BG", "OFFENCE", "不軌門", "六條", 5),
]


def _skeleton():
    """(code, ordinal, polarity, payload) for all 73, in document order."""
    rows = []
    ordinal = 0
    for segment, polarity, gate, titled, transcribed in GATES:
        for gate_ordinal in range(1, transcribed + 1):
            ordinal += 1
            rows.append((
                f"CN-GGG-{segment}-{gate_ordinal:02d}",
                ordinal,
                polarity,
                {
                    "gate": gate,
                    "gate_ordinal": gate_ordinal,
                    "gate_titled_count": titled,
                },
            ))
    return rows


def forwards(apps, schema_editor):
    Statute = apps.get_model("judgment", "Statute")

    # 空库：什么都不写。见模块 docstring 的「空库守卫」。
    if not Statute._base_manager.exists():
        return

    # 租户从中国侧任意一行既有条文取，包括 0012 软删掉的 CN-HL-*。猜一个
    # tenant code 会把这些行挂到一个没人指定过的所有者名下。
    sibling = (
        Statute._base_manager.filter(civilization=CIVILIZATION)
        .exclude(tenant__isnull=True)
        .first()
    )
    tenant_id = sibling.tenant_id if sibling else None

    for code, ordinal, polarity, payload in _skeleton():
        Statute._base_manager.get_or_create(
            code=code,
            defaults={
                "civilization": CIVILIZATION,
                "corpus": CORPUS,
                "ordinal": ordinal,
                "polarity": polarity,
                # 标识列以外一律留空：正文、分值、source 与校勘注记由
                # seed_mythology 拥有，下一次 --update 写入。
                "payload_json": payload,
                "tenant_id": tenant_id,
            },
        )


def backwards(apps, schema_editor):
    Statute = apps.get_model("judgment", "Statute")
    JudgmentCitation = apps.get_model("judgment", "JudgmentCitation")

    codes = [row[0] for row in _skeleton()]
    rows = list(
        Statute._base_manager.filter(code__in=codes, corpus=CORPUS).values_list("pk", "code")
    )
    if not rows:
        return

    cited = set(
        JudgmentCitation._base_manager.filter(
            statute_id__in=[pk for pk, _ in rows]
        ).values_list("statute_id", flat=True)
    )
    if cited:
        print(
            "\n  [judgment.0013] KEPT — these 功過格 articles have been cited by "
            "real judgments and were NOT removed by the rollback:\n"
            f"    {', '.join(sorted(code for pk, code in rows if pk in cited))}\n"
            "  A citation is the recorded basis of a decided case."
        )

    removable = [pk for pk, _ in rows if pk not in cited]
    if removable:
        Statute._base_manager.filter(pk__in=removable).delete()


class Migration(migrations.Migration):

    dependencies = [
        ("judgment", "0012_withdraw_fabricated_statutes"),
    ]

    operations = [
        migrations.AlterField(
            model_name="statute",
            name="code",
            field=models.CharField(
                help_text=(
                    "Stable citation key, e.g. CN-GGG-F-JJ-01 / EG-NC-07 / EU-DS-T3. "
                    "CN-HL-* and EU-DS-01..07 are withdrawn keys and are not reused."
                ),
                max_length=40,
            ),
        ),
        migrations.AlterField(
            model_name="statute",
            name="corpus",
            field=models.CharField(
                choices=[
                    ("HELL_LAW", "冥律 — Hell Law (Chinese)"),
                    ("GONGGUOGE", "功過格 — Ledger of Merit and Demerit (Chinese)"),
                    ("NEGATIVE_CONFESSION", "Declaration of Innocence (Egyptian)"),
                    ("DEADLY_SIN", "Seven Deadly Sins (European)"),
                ],
                max_length=30,
            ),
        ),
        migrations.RunPython(forwards, backwards),
    ]
