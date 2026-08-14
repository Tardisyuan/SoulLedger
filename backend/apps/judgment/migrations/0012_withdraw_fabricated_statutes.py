"""
Data migration: withdraw the fabricated HELL_LAW and DEADLY_SIN articles.

背景：
- 0011 建立了 Statute / JudgmentCitation，seed_mythology 随后种进三套语料：
  中国 13 条（corpus=HELL_LAW）、欧洲 7 条（corpus=DEADLY_SIN）、埃及 42 条
  （corpus=NEGATIVE_CONFESSION）。前两套经独立核实，问题不在个别条目而在
  框架本身：《玉历宝钞》是逐殿叙述的善书，没有条款编号也没有刑期，中国侧
  的「条文号 / 最低刑期」是套在无条文文本上的现代法典外壳；但丁地狱按
  亚里士多德三分法分层（Inf. XI.79-84），七宗罪中傲慢、嫉妒、懒惰根本没有
  对应的圈，欧洲侧有一条刑罚（EU-DS-07「被铁笼囚禁」）在原诗中并不存在。
  详见 scratchpad/verify-cn-structure.md 与 verify-christian-structure.md。
  两个数据块已从 seed_mythology.py 移除；这里处理已经落库的行。
- 埃及 42 条不在本次范围内：它们由已核实的 Actor 行派生（Budge 读 Nebseni
  纸草，并与 UCL 的 Maiherperi 纸草 42/42 交叉验证），保持原样。

为什么是软删除而不是硬删除：
- JudgmentCitation.statute 是 PROTECT。一条被判决引用过的条文是「这个案子
  当时依据了什么」的证据，硬删会把已记录的依据变成悬空外键，或者直接被
  数据库拒绝。模型注释里写明「退役一条条文的方式是软删除」，这里就用那个
  方式：行还在，引用仍可读，但不再出现在选择器/列表里。

被引用的行一条都不动：
- 正向操作先查 JudgmentCitation。任何已被引用的 HELL_LAW/DEADLY_SIN 行都会
  被打印出来并跳过——引用记录是真实发生过的事，撤回语料不等于抹掉历史。
  这些行需要人来判断（改判、注销引用，还是保留），迁移不替人决定。

可逆性：
- backward 只恢复本迁移打上标记的行：delete_reason 与 delete_cascade_id 都
  必须精确匹配下面的常量。手工软删除的条文、或将来别的原因删掉的条文，
  回滚时不会被顺手复活。
- 正向/反向都可重复执行（第二次是空集），且不删行、不改条文内容。
"""
import uuid

from django.db import migrations
from django.utils import timezone

#: The two corpora withdrawn. NEGATIVE_CONFESSION is deliberately absent.
WITHDRAWN_CORPORA = ("HELL_LAW", "DEADLY_SIN")

#: Written to every row this migration retires, and the key backward() reverses
#: on. Kept verbatim rather than reconstructed, so a partially-applied rollback
#: cannot restore a row this migration never touched.
DELETE_REASON = (
    "Withdrawn by judgment.0012: the HELL_LAW and DEADLY_SIN corpora were "
    "built on a fabricated frame (no codified 冥律; Dante's circles are not "
    "the seven sins). See seed_mythology.py."
)

#: A fixed cascade id, not a fresh uuid4: every row retired here belongs to one
#: withdrawal, the recycle bin should list it as one entry, and backward() has
#: an exact key to restore by.
CASCADE_ID = uuid.UUID("f0bb1e5e-0000-4d00-9a00-5741746854dc")


def forward(apps, schema_editor):
    Statute = apps.get_model("judgment", "Statute")
    JudgmentCitation = apps.get_model("judgment", "JudgmentCitation")

    # `_base_manager`, never `objects`: the model's default manager is the
    # tenant-scoped soft-delete manager, and under a migration there is no
    # tenant in context — it would filter these rows out and report a silent
    # success over an untouched table.
    live = list(
        Statute._base_manager.filter(
            corpus__in=WITHDRAWN_CORPORA, is_deleted=False
        ).values_list("pk", "code")
    )
    if not live:
        return

    live_pks = [pk for pk, _ in live]
    cited_pks = set(
        JudgmentCitation._base_manager.filter(statute_id__in=live_pks).values_list(
            "statute_id", flat=True
        )
    )

    if cited_pks:
        cited_codes = sorted(code for pk, code in live if pk in cited_pks)
        print(
            "\n  [judgment.0012] KEPT — these withdrawn articles have been cited "
            "by real judgments and were NOT retired:\n"
            f"    {', '.join(cited_codes)}\n"
            "  A citation is the recorded basis of a decided case. Review each "
            "one by hand (re-open the judgment, or re-cite it) before removing "
            "the article."
        )

    retire_pks = [pk for pk in live_pks if pk not in cited_pks]
    if not retire_pks:
        return

    Statute._base_manager.filter(pk__in=retire_pks).update(
        is_deleted=True,
        deleted_at=timezone.now(),
        delete_reason=DELETE_REASON,
        delete_cascade_id=CASCADE_ID,
    )


def backward(apps, schema_editor):
    Statute = apps.get_model("judgment", "Statute")
    Statute._base_manager.filter(
        corpus__in=WITHDRAWN_CORPORA,
        is_deleted=True,
        delete_reason=DELETE_REASON,
        delete_cascade_id=CASCADE_ID,
    ).update(
        is_deleted=False,
        deleted_at=None,
        delete_reason="",
        delete_cascade_id=None,
    )


class Migration(migrations.Migration):

    dependencies = [
        ("judgment", "0011_statute_judgmentcitation_and_more"),
    ]

    operations = [
        migrations.RunPython(forward, backward),
    ]
