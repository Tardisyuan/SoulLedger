"""`CORPUS_PROVENANCE["…"]["source"]` 声明的区间,与语料实际覆盖的一致。

**这个字段有前科,而前科就写在它自己的 `known_gap` 段落里。** 上一次
`GR-GRG-12`(《高尔吉亚》526c-d,弥诺斯持金杖监临)就是这么出来的:声明区间
覆盖 523a-526d,而 526c-d 既没转录、也不在 known_gap 里 —— 与此同时
`actors_greek.py` 正断言「他不是监临者」。

而这个字段**当时没有任何守卫**。`tests/test_greek_corpora.py:52` 的
`GORGIAS_RANGE = (523, 526)` 是**测试自己的常量**,不与声明比对 —— 把 source 里的
`"Gorgias 523a-526d"` 改成 `"523a-525d"`,三个相关文件**全绿**(变异已确认写进文件)。

这个文件做三件事:

  1. 从 `source` 里解析出声明区间(解析不出来就红 —— 一个读不懂声明的守卫,
     和一个通过的守卫,输出一模一样)
  2. 每一条语料的开篇出处必须落在区间内
  3. 区间的**两个端点**都必须被某条语料覆盖,否则必须在 `known_gap` 里被点名 ——
     这一条当场抓出 REPUBLIC_ER 的 614b(厄尔阵亡与十二日还魂的框架叙事),
     与 GR-GRG-12 同形
"""
import re

import pytest

from apps.actors.mythology import CORPUS_PROVENANCE
from apps.actors.mythology.statutes_gorgias_entries import GORGIAS_STATUTES
from apps.actors.mythology.statutes_republic_entries import REPUBLIC_ER_STATUTES

#: 每条语料开篇的出处,**连同它的跨度**。四种写法都要吃下:
#:   《高尔吉亚》523a       单节
#:   《高尔吉亚》523a-b     同一节内跨小节
#:   《理想国》卷十 615d-616a  跨节
#:   《理想国》卷十 614c-d  带「卷十」
#: 第一版只取起点,于是 `GR-ER-11` 的 `621a-b` 被读成只覆盖 621a,守卫报出
#: 「终点 621b 没有条文覆盖」—— **一条因为解析太浅而误报的规则,和一条真的
#: 发现了缺口的规则,输出一模一样**,而误报的那种最终会被人关掉。
_OPENING = re.compile(
    r"^《[^》]+》\s*(?:卷[一二三四五六七八九十]+\s*)?"
    r"(\d{3})([a-e])(?:-(?:(\d{3}))?([a-e]))?"
)
#: `source` 里的声明区间,例如 "Gorgias 523a-526d" / "Republic X 614b-621b"。
_DECLARED = re.compile(r"(\d{3})([a-e])-(\d{3})([a-e])")

CORPORA = {
    "GORGIAS": GORGIAS_STATUTES,
    "REPUBLIC_ER": REPUBLIC_ER_STATUTES,
}


def locus(section, letter):
    """把 `526c` 变成一个可比较的数,letter 用 a..e 的序。"""
    return (int(section), "abcde".index(letter))


def declared_range(corpus):
    source = CORPUS_PROVENANCE[corpus]["source"]
    m = _DECLARED.search(source)
    assert m, (
        f"{corpus} 的 source 里读不出 `NNNx-NNNx` 形式的声明区间:{source!r}。"
        f"**一个读不懂声明的守卫,和一个通过的守卫,输出一模一样。**"
    )
    return locus(m.group(1), m.group(2)), locus(m.group(3), m.group(4))


def openings(rows):
    """每条的 (code, 起点, 终点)。单节条文的起点与终点相同。"""
    out = []
    for entry in rows:
        m = _OPENING.match(entry["text_zh"])
        assert m, f"{entry['code']} 的正文不以出处开头:{entry['text_zh'][:40]!r}"
        start = locus(m.group(1), m.group(2))
        end_section = m.group(3) or m.group(1)
        end_letter = m.group(4) or m.group(2)
        out.append((entry["code"], start, locus(end_section, end_letter)))
    return out


@pytest.mark.parametrize("corpus", sorted(CORPORA))
def test_every_article_falls_inside_the_declared_range(corpus):
    lo, hi = declared_range(corpus)
    outside = [
        f"{code} @ {start}-{end}"
        for code, start, end in openings(CORPORA[corpus])
        if not (lo <= start <= hi and lo <= end <= hi)
    ]
    assert outside == [], (
        f"{corpus}:这些条文的出处落在声明区间 {lo}-{hi} 之外 —— {outside}。"
        f"要么区间写窄了,要么这些条文不属于这个语料。"
    )


@pytest.mark.parametrize("corpus", sorted(CORPORA))
def test_the_range_is_not_wider_than_what_was_transcribed(corpus):
    """反方向。上一条只防「转了区间外的东西」;这一条防「声明得比实际转的宽」——
    而那正是 GR-GRG-12 的形状:区间画到 526d,而 526c-d 没人碰。"""
    lo, hi = declared_range(corpus)
    spans = openings(CORPORA[corpus])
    earliest = min(start for _, start, _ in spans)
    latest = max(end for _, _, end in spans)
    gap_text = CORPUS_PROVENANCE[corpus].get("known_gap", "")

    def declared_as_gap(loc):
        return f"{loc[0]}{'abcde'[loc[1]]}" in gap_text

    problems = []
    if earliest > lo and not declared_as_gap(lo):
        problems.append(f"区间起点 {lo} 没有条文覆盖,也不在 known_gap 里")
    if latest < hi and not declared_as_gap(hi):
        problems.append(f"区间终点 {hi} 没有条文覆盖,也不在 known_gap 里")
    assert problems == [], (
        f"{corpus}:{problems}。**声明区间内的未申报缺口正是 GR-GRG-12 的形状** ——"
        f"要么补转录,要么在 known_gap 里点名说它为什么不转。"
    )


@pytest.mark.parametrize("corpus", sorted(CORPORA))
def test_the_declared_article_count_matches_the_rows(corpus):
    """`article_count` 与实际行数。与上面两条同一个理由:声明与事实要能对上。"""
    assert CORPUS_PROVENANCE[corpus]["article_count"] == len(CORPORA[corpus])
