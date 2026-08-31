"""clause 守卫的主体清单不能按 corpus 名字挑。

`tests/test_gongguoge.py` 的两条 clause 守卫此前用
`Statute.objects.filter(corpus=GONGGUOGE)` 做 fixture。全部 172 行普查:
`為X功/過` 出现在 74 行里,而这 74 行**恰好全是 GONGGUOGE**。

**所以它今天覆盖了每一条可能失败的法条 —— 但那是数据的性质,不是检查的性质。**
`HELL_LAW` 是一个刻意留空的中文 corpus 成员;往里加一条带标价而无 clauses 的
条文,按 corpus 名字挑主体的守卫看不见它。

这个文件种一条那样的法条,要求守卫报红。**「今天完整」与「这条规则完整」是两件事,
而只有后者在下一次数据变动时还成立。**
"""
import io

import pytest
from django.core.management import call_command

from apps.judgment.models import (
    Civilization,
    Statute,
    StatuteCorpus,
    StatutePolarity,
)


@pytest.fixture
def seeded(db):
    out = io.StringIO()
    call_command("seed_mythology", stdout=out, stderr=out)
    return out.getvalue()


def _plant_a_priced_article_without_clauses():
    """一条正文标了价、而 `clauses` 是空的中文法条,放在 HELL_LAW 下。"""
    return Statute.all_objects.create(
        code="CN-HL-99",
        corpus=StatuteCorpus.HELL_LAW,
        civilization=Civilization.CHINESE,
        ordinal=99,
        polarity=StatutePolarity.OFFENCE,
        title_zh="试验条",
        text_zh="妄取人财物,為十過。",
        source="test",
        payload_json={"clauses": []},
    )


@pytest.mark.django_db
def test_the_census_that_makes_this_matter_still_holds(seeded):
    """守卫的守卫。

    这个文件的论证建立在「标价只出现在 GONGGUOGE 里」上。如果哪天别的 corpus
    也开始标价,那么 corpus 过滤就**已经**在漏东西了,而不是「将来可能漏」——
    那时该看到的是这一条红,而不是下面那条继续绿。
    """
    priced_corpora = {
        statute.corpus
        for statute in Statute.objects.all()
        if "為" in (statute.text_zh or "")
    }
    assert priced_corpora <= {StatuteCorpus.GONGGUOGE}, (
        f"这些 corpus 的正文里也出现了标价:{sorted(priced_corpora)}。"
        f"按 corpus 名字挑主体的守卫此刻就已经在漏了。"
    )


@pytest.mark.django_db
def test_a_priced_article_in_another_corpus_is_caught(seeded):
    """种一条缺陷,要求守卫报红 —— 而不是只信它在干净数据上通过。"""
    planted = _plant_a_priced_article_without_clauses()
    every = {statute.code: statute for statute in Statute.objects.all()}
    assert planted.code in every, (
        "全表 fixture 都看不到这一行 —— 那么 clause 守卫也看不到"
    )

    narrow = {
        statute.code
        for statute in Statute.objects.filter(corpus=StatuteCorpus.GONGGUOGE)
    }
    assert planted.code not in narrow, (
        "按 corpus 过滤的老 fixture 竟然看到了它 —— 那这个文件的论证就不成立了"
    )


@pytest.mark.django_db
def test_the_widened_guard_actually_fails_on_it(seeded):
    """把真正那条守卫拿过来跑一遍,对着种下去的行。

    不是复述它的逻辑 —— 复述出来的检查和被复述的检查会各自漂移。这里 import
    它,喂给它一个坏行,要求它抛。
    """
    from tests.test_gongguoge import (
        test_every_priced_act_in_the_text_is_a_clause as guard,
    )

    _plant_a_priced_article_without_clauses()
    every = {statute.code: statute for statute in Statute.objects.all()}
    with pytest.raises(AssertionError, match="CN-HL-99"):
        guard(every)


@pytest.mark.django_db
def test_the_widened_guard_still_passes_on_clean_data(seeded):
    """**断存在。** 一条对什么都抛的守卫会让上面那条绿。"""
    from tests.test_gongguoge import (
        test_every_priced_act_in_the_text_is_a_clause as guard,
    )

    guard({statute.code: statute for statute in Statute.objects.all()})
