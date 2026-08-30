"""账本重算在行锁下进行,并且读的是它自己锁住的那一行。

`recalculate_soul_ledger` 是一次跨该灵魂全部记录的读-改-写,由两处同时触发:
`apps/souls/record_models.py` 每插一条记录、以及 `LedgerRecalculateView.post`。
它此前没有 `select_for_update`、没有 `atomic()`、没有版本列 ——
`grep select_for_update apps/ledger apps/judgment` 零命中。

在 115 的 PostgreSQL 16 克隆库上实测(跑完已 drop,原库核实未动):

    baseline merit_score = 10
    records committed (weights): [10, 100, 1000]  raw sum = 1110
    STORED merit_score 两个并发写留下的: 1010
    TRUTH  干净重跑得到的:              1110
    >>> LOST UPDATE: True

`merit_score`/`demerit_score` 是全系统路由与排序依据的反规范化列 ——
**分数悄悄偏低会改变一个灵魂被送去哪个殿**。没有任何东西能发现它,只有后续一次
重算才会顺手修好。

**这个套件复现不了那个竞态,而且原因要说清楚:SQLite 把写者串行化了。** 所以下面
分两类,各自标明:

  能测的:锁之后读的是**数据库里那一行**,不是调用方手上那个可能已经过期的对象。
          这一半是竞态修复的实质,而它在单线程里就能证。
  只能按形状钉的:`select_for_update` 那一句在不在 —— 它的作用只在真正的并发下
          出现,这里造不出失败场景。
"""
import ast
import inspect
import textwrap

import pytest

from apps.ledger.services import LedgerService
from apps.souls.models import Soul
from apps.souls.record_models import SoulRecord


@pytest.fixture
def soul(db, cn_tenant):
    return Soul.objects.create(name="有账页的", tenant=cn_tenant, current_state="ALIVE")


@pytest.mark.django_db
def test_a_stale_soul_object_does_not_write_back_stale_scores(soul):
    """竞态修复的实质,在单线程里就能证。

    调用方手上的 `soul` 可能是在别人提交之前读到的。旧实现直接在那个对象上算、
    在那个对象上 `save()`,于是它把自己那份过期的其它字段一起写了回去。
    """
    SoulRecord.objects.create(
        soul=soul, tenant=soul.tenant, record_type="MERIT", weight=10, description="a"
    )

    # 拿一份「过期」的副本:在下一条记录写进去之前读到的。
    stale = Soul.objects.get(pk=soul.pk)

    SoulRecord.objects.create(
        soul=soul, tenant=soul.tenant, record_type="MERIT", weight=100, description="b"
    )

    result = LedgerService.recalculate_soul_ledger(stale)

    soul.refresh_from_db()
    # 两条记录都要算进去。旧实现用的是 `stale.records.all()`,而那是一个惰性
    # 查询集,所以这一半它也对 —— 真正的区别在于它 `save()` 回去的是哪一行。
    assert soul.merit_score == result["merit_score"]
    assert soul.merit_score >= 100, f"第二条记录没被算进去:{soul.merit_score}"


@pytest.mark.django_db
def test_the_returned_numbers_are_the_ones_that_were_stored(soul):
    """返回值与落库的值一致。

    没有这一条,一个「算完不保存」的实现同样满足上面那条(它返回的数是对的),
    而数据库里那两列永远停在 0。
    """
    SoulRecord.objects.create(
        soul=soul, tenant=soul.tenant, record_type="MERIT", weight=7, description="m"
    )
    SoulRecord.objects.create(
        soul=soul, tenant=soul.tenant, record_type="DEMERIT", weight=3, description="d"
    )

    result = LedgerService.recalculate_soul_ledger(soul)
    soul.refresh_from_db()

    assert result["merit_score"] == soul.merit_score
    assert result["demerit_score"] == soul.demerit_score
    assert result["karmic_balance"] == soul.merit_score - soul.demerit_score
    assert soul.merit_score > 0 and soul.demerit_score > 0, (
        "前置条件:两类记录都真的产生了非零分数,否则上面三条在全零时也成立"
    )


def test_the_recalculation_takes_a_row_lock():
    """只能按形状钉的那一件。

    `select_for_update` 的作用只在真正的并发下出现,而**SQLite 把写者串行化了** ——
    这个套件里造不出那个失败场景,所以没有行为断言可写。用 AST 确认那一句还在,
    并把「为什么只能这样测」写在这儿,免得下一个人把它当成一条懒惰的断言删掉。

    要验证它真的有效,得在 PostgreSQL 上跑两个并发写者 —— 这条缺陷当初就是那样
    被证实的,方法记在本文件头部。
    """
    tree = ast.parse(
        textwrap.dedent(inspect.getsource(LedgerService.recalculate_soul_ledger))
    )
    attrs = {
        node.attr for node in ast.walk(tree) if isinstance(node, ast.Attribute)
    }
    assert "select_for_update" in attrs, (
        "重算不再取行锁 —— PostgreSQL 上两个并发重算会丢失更新,"
        "而分数偏低会改变一个灵魂被送去哪个殿"
    )
    assert "atomic" in attrs, "select_for_update 不在事务里是空操作"
