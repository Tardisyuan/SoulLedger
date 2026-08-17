"""Open the INFERNO corpus, and put its 26 citation keys on databases that
already hold a cosmology.

背景
----
欧洲侧此前只有一套语料：DEADLY_SIN，七宗罪，一条对应炼狱山一层。那是 8308204
撤回 EU-DS-01..07 之后重新锚定的结果——七宗罪排的是《炼狱篇》的七层山，不是
《地狱篇》的九圈。

现在《地狱篇》自己进来了，作为**另一套**语料而不是七宗罪的扩写：地狱的分层依据
是维吉尔在 Inf. XI.79-84 亲口引的亚里士多德三分法（不节制／恶意／狂兽性），与七
宗罪毫无关系；傲慢、嫉妒、懒惰在地狱根本没有圈。把两者并进同一套语料，就是重新
制造 8308204 撤回的那张图表。见 docs/lore-verification/verify-christian-structure.md
§2、§3.1、§6，以及 apps/actors/mythology/__init__.py 的语料出处契约。

这**不是** `dante_circle` 回来了。那个键是挂在**一条罪**上的圈号，替傲慢／嫉妒／
懒惰指了诗里没给它们的圈。这里的圈不是任何东西的属性——**圈本身就是条文**，正如
第三层露台的条文本身就是第三层。没有任何一行带那个键，
tests/test_purgatorio_terraces.py 仍然对全部语料断言这一点。

这个迁移做什么
--------------
1. **AlterField**：`corpus` 的 choices 增加 INFERNO；其余取值（含空的 HELL_LAW）
   一并保留，理由与 0013 相同——离开 enum 的取值会让某个已决案件的依据不再渲染、
   不再校验、不再回滚。`code` 的 help_text 同时补上 EU-INF-* 这个新的引用键形状。

2. **RunPython**：在**已有语料**的库上建 26 条的**标识列**——code / ordinal /
   polarity / corpus / civilization，以及 payload 里的坐标：圈号、细分种类与序号、
   父条文码、以及**是否在狄斯城墙之内**。正文、出处、守卫者、contrapasso 与全部
   校勘注记**不在这里**，由下一次 `seed_mythology --update` 写入。这是 realms/0013、
   0014、0016 与 judgment/0013 一致的分工：迁移里再抄一份条文正文，就是第二份没人
   保持同步的副本。

   这里刻意重复的只有两样：**狄斯城墙的位置**（1-5 圈在外，6-9 圈在内）和**细分的
   条数**（第七圈三环、第八圈十囊、第九圈四带）。它们是本次工作的核心事实——城墙是
   但丁唯一真正的分层界线，被扁平化抹掉后九个圈才看起来像一条线性严重度阶梯
   （§6.5）——重复一次，就没有任何一处能单方面悄悄改掉它。

空库守卫
--------
一个还没有任何 Statute 的库是全新安装：`seed_mythology` 会把四套语料连同正文一起
写全，迁移抢在它前面半播种，只会交给它一批自己没建、没租户、且 `--dry-run` 本应报
空的行。realms/0012 就是这么栽的，0013/0014/0016 与 judgment/0013 都带同一个守卫。

租户从既有的欧洲侧条文行上取（`_base_manager` 看得见 0012 软删的 EU-DS-0*），取不到
就留空——`seed_mythology._upsert` 有一条专门的 tenant-only 补写路径，不需要这里去猜
一个 tenant code。

可逆性
------
`backwards` 只删本迁移可能建过的那 26 个 code，且**只删没有被判决引用过的**。引用是
一个案子当时依据了什么的证据；一条被引用过的条文即使是回滚也不能消失，
`JudgmentCitation.statute` 是 PROTECT，硬删要么被数据库拒绝要么把已记录的依据变成
悬空外键。跳过的行会打印出来。正反向都可重复执行。

全部行访问走 `_base_manager`：`Statute.objects` 是租户过滤 + 软删过滤的，迁移里没有
租户上下文，它会在一张没被碰过的表上报告静默成功。
"""
from django.db import migrations, models

CORPUS = "INFERNO"
CIVILIZATION = "EUROPEAN"

#: 狄斯城墙。第 6-9 圈在城内，5 圈及以上在城外，城门在 Inf. VIII.67-IX.105 由天使
#: 打开。这条线同时是 incontinenza 与 malizia 的分界，也就是但丁**唯一**真正的分层
#: 依据。这里是它的第二份手写副本（第一份在
#: apps/actors/mythology/statutes_inferno.py 的 DIS_WALL，第三份在
#: tests/test_inferno_circles.py），三份必须一致。
WITHIN_DIS = (6, 7, 8, 9)

#: (圈号, 细分种类, 细分条数)。细分条数是本迁移刻意重复的第二个事实。
#: 种类为 None 的圈没有细分条文，只有圈本身一条。
CIRCLES = [
    (1, None, 0),
    (2, None, 0),
    (3, None, 0),
    (4, None, 0),
    (5, None, 0),
    (6, None, 0),
    (7, "girone", 3),
    (8, "bolgia", 10),
    (9, "zona", 4),
]

#: 细分种类 -> 引用键里的字母，以及序号的位数。囊有十个，所以补零到两位；环与带
#: 各不到十个，一位。位数写死而不是按数量算：一个 EU-INF-C8-B1 与 EU-INF-C8-B01
#: 并存的库，是两条谁也发现不了的重复条文。
SEGMENT = {"girone": ("R", 1), "bolgia": ("B", 2), "zona": ("Z", 1)}


def _skeleton():
    """(code, ordinal, payload) for all 26, in the poem's order of descent."""
    rows = []
    ordinal = 0
    for circle, kind, count in CIRCLES:
        ordinal += 1
        rows.append((
            f"EU-INF-C{circle}",
            ordinal,
            {
                "circle": circle,
                "subdivision_kind": None,
                "subdivision_index": None,
                "parent_code": None,
                "within_dis": circle in WITHIN_DIS,
            },
        ))
        letter, width = SEGMENT[kind] if kind else ("", 0)
        for index in range(1, count + 1):
            ordinal += 1
            rows.append((
                f"EU-INF-C{circle}-{letter}{index:0{width}d}",
                ordinal,
                {
                    "circle": circle,
                    "subdivision_kind": kind,
                    "subdivision_index": index,
                    "parent_code": f"EU-INF-C{circle}",
                    "within_dis": circle in WITHIN_DIS,
                },
            ))
    return rows


def forwards(apps, schema_editor):
    Statute = apps.get_model("judgment", "Statute")

    # 空库：什么都不写。见模块 docstring 的「空库守卫」。
    if not Statute._base_manager.exists():
        return

    # 租户从欧洲侧任意一行既有条文取，包括 0012 软删掉的 EU-DS-0*。猜一个
    # tenant code 会把这些行挂到一个没人指定过的所有者名下。
    sibling = (
        Statute._base_manager.filter(civilization=CIVILIZATION)
        .exclude(tenant__isnull=True)
        .first()
    )
    tenant_id = sibling.tenant_id if sibling else None

    for code, ordinal, payload in _skeleton():
        Statute._base_manager.get_or_create(
            code=code,
            defaults={
                "civilization": CIVILIZATION,
                "corpus": CORPUS,
                "ordinal": ordinal,
                # 全部 OFFENCE，包括第一圈。灵薄狱不指控任何行为——过错是未受洗，
                # 不是做过什么——但模型没有「无罪而受罚」这个 polarity，为一行发明
                # 一个第四取值是在陈述模型而不是陈述但丁。条文正文说明这一点。
                "polarity": "OFFENCE",
                # 标识列以外一律留空：正文、出处、守卫者与校勘注记由
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
            "\n  [judgment.0015] KEPT — these Inferno articles have been cited by "
            "real judgments and were NOT removed by the rollback:\n"
            f"    {', '.join(sorted(code for pk, code in rows if pk in cited))}\n"
            "  A citation is the recorded basis of a decided case."
        )

    removable = [pk for pk, _ in rows if pk not in cited]
    if removable:
        Statute._base_manager.filter(pk__in=removable).delete()


class Migration(migrations.Migration):

    dependencies = [
        ("judgment", "0014_alter_judgment_civilization_and_more"),
    ]

    operations = [
        migrations.AlterField(
            model_name="statute",
            name="code",
            field=models.CharField(
                help_text=(
                    "Stable citation key, e.g. CN-GGG-F-JJ-01 / EG-NC-07 / EU-DS-T3 / "
                    "EU-INF-C8-B02. CN-HL-* and EU-DS-01..07 are withdrawn keys and "
                    "are not reused."
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
                    ("INFERNO", "Inferno — the Circles of Dante's Hell (European)"),
                ],
                max_length=30,
            ),
        ),
        migrations.RunPython(forwards, backwards),
    ]
