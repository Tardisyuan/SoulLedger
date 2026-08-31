"""散文里写的数字,与它描述的那份数据一致。

**这是这个仓库反复复发的形状,而且账本自己也栽了进去。** M36 列了 15 处陈旧数字,
逐条核对之后发现**它自己的两个计数也是错的**:

    gongguoge_entries.py:5 「三个常量」  M36 说实为 4  —— 实测 **5**
    __init__.py:52 「FOUR CORPORA」      M36 说实为 6  —— 实测 6(这条对)

一份专门记录「数字漂了」的清单,自己又漂了一次。所以修数字不够 ——
**必须有一个从数据本身算出来、会红的东西**,否则下一次照样漂。

这个文件的每一条都是:从代码/数据里**算**出真值,再从散文里**抽**出被断言的数字,
两者比对。抽不到就红 —— 一个找不到目标的检查,和一个通过的检查,输出一模一样,
而这正是本仓库记了六次的那个形状。
"""
import re
from pathlib import Path

import pytest

MYTH = Path(__file__).resolve().parents[1] / "apps" / "actors" / "mythology"
JUDGMENT = Path(__file__).resolve().parents[1] / "apps" / "judgment"
COMMANDS = (
    Path(__file__).resolve().parents[1]
    / "apps" / "actors" / "management" / "commands"
)

CN_NUM = {
    "one": 1, "two": 2, "three": 3, "four": 4, "five": 5, "six": 6, "seven": 7,
    "eight": 8, "nine": 9, "ten": 10,
    "ONE": 1, "TWO": 2, "THREE": 3, "FOUR": 4, "FIVE": 5, "SIX": 6, "SEVEN": 7,
    "Twenty-one": 21, "Twenty-two": 22, "Twenty-three": 23,
    "twenty-one": 21, "twenty-two": 22, "twenty-three": 23,
}


def measured():
    """真值,全部从数据算,不写死。"""
    import django
    from django.conf import settings  # noqa: F401

    from apps.actors.mythology import (
        CIVILIZATION_DATA,
        CIVILIZATION_STATUTES,
        CORPUS_PROVENANCE,
    )
    from apps.actors.mythology.statutes_chinese import CHINESE_STATUTES
    from apps.judgment.models import StatuteCorpus

    del django, CIVILIZATION_STATUTES
    from apps.actors.mythology.statutes_gorgias import GORGIAS_STATUTES
    from apps.actors.mythology.statutes_republic import REPUBLIC_ER_STATUTES

    return {
        "greek_articles": len(GORGIAS_STATUTES) + len(REPUBLIC_ER_STATUTES),
        "gorgias_rows": len(GORGIAS_STATUTES),
        "republic_er_rows": len(REPUBLIC_ER_STATUTES),
        "civilizations": len(CIVILIZATION_DATA),
        "declared_corpora": len(StatuteCorpus.values),
        "provenance_entries": len(CORPUS_PROVENANCE),
        "gongguoge_rows": len(CHINESE_STATUTES),
        # 21 = 23 - (一条 MERIT) - (一条 OFFENCE)。写成减法而不是常数,
        # 是为了让它跟着上面那两个数走。
        "greek_procedural": len(GORGIAS_STATUTES) + len(REPUBLIC_ER_STATUTES) - 2,
    }


#: (文件, 抽取正则, 真值的键)。正则必须**恰好**匹配一次 —— 匹配零次或多次都红,
#: 因为那意味着这条规则指着的句子被改写或复制了,而它自己不知道。
CLAIMS = [
    (COMMANDS / "seed_mythology.py",
     r"Idempotent seeder for the (\w+) civilizations", "civilizations"),
    (COMMANDS / "seed_mythology.py",
     r"contract for the (\w+) declared statute corpora", "declared_corpora"),
    (COMMANDS / "seed_mythology.py",
     r"Seed the (\w+) civilizations' mythology", "civilizations"),
    (MYTH / "statutes_chinese.py",
     r"The other transcribed corpus\. The (\d+) articles", "gongguoge_rows"),
    (MYTH / "statutes_chinese.py",
     r"Carried by all (\d+)\. The one note", "gongguoge_rows"),
    (MYTH / "statutes_chinese.py",
     r"Carried by all (\d+) as well", "gongguoge_rows"),
    (MYTH / "statutes_chinese.py",
     r"the parts that repeat (\d+) times", "gongguoge_rows"),
    (MYTH / "statutes_chinese.py",
     r"`ordinal` is continuous 1\.\.(\d+)", "gongguoge_rows"),
    # M16:同一个文件相隔 94 行的两句话对希腊语料的条数不一致 —— `:223` 说
    # 二十二,`:317` 说二十三。2026-08-27 加 GR-GRG-12 时只改了其中一句,而
    # `test_corpus_provenance.py` 的 marker 只钉 `mythology.__doc__`,**没有任何
    # 东西钉 `apps/judgment/models.py`**。两句现在都在这份清单里。
    (JUDGMENT / "models.py",
     r"the unit\.\s+([\w-]+) articles under GR-GRG-\*", "greek_articles"),
    (JUDGMENT / "models.py",
     r"\(GORGIAS (\d+),\s+REPUBLIC_ER \d+\)", "gorgias_rows"),
    (JUDGMENT / "models.py",
     r"\(GORGIAS \d+,\s+REPUBLIC_ER (\d+)\)", "republic_er_rows"),
    (JUDGMENT / "models.py",
     r"([\w-]+) of the twenty-three Greek\s+articles are procedural", "greek_procedural"),
]


@pytest.mark.django_db
@pytest.mark.parametrize(
    ("path", "pattern", "key"),
    CLAIMS,
    ids=[f"{p.name}:{k}" for p, _, k in CLAIMS],
)
def test_a_number_written_in_prose_matches_the_data(path, pattern, key):
    # 折叠换行与缩进再匹配。docstring 里的一句话会被 79 列换行切开,
    # 而一条只在「这句话恰好没换行」时才命中的规则,会在下一次重排注释时
    # 静默失效 —— 那正是这个文件要防的东西。
    source = re.sub(r"\n\s*", " ", path.read_text(encoding="utf-8"))
    found = re.findall(pattern, source)
    assert len(found) == 1, (
        f"{path.name}: 这条规则的正则匹配了 {len(found)} 次(期望恰好 1)。\n"
        f"零次意味着它指着的句子被改写了 —— **一个找不到目标的检查,和一个通过的"
        f"检查,输出一模一样**;多于一次意味着那句话被复制了,而副本会各自漂。\n"
        f"正则:{pattern}"
    )
    raw = found[0]
    stated = CN_NUM.get(raw)
    if stated is None:
        stated = int(raw)
    truth = measured()[key]
    assert stated == truth, (
        f"{path.name} 写着 {raw!r},而实测 {key} = {truth}"
    )


@pytest.mark.django_db
def test_the_constant_count_in_gongguoge_entries_is_right():
    """单独一条,因为它数的是这个文件自己的模块级常量。

    M36 说这里「实为四个」,而实测是 **5** —— 一份专门记录数字漂移的清单,自己也
    数错了。这条从 AST 数,不从人手数。
    """
    import ast

    path = MYTH / "gongguoge_entries.py"
    tree = ast.parse(path.read_text(encoding="utf-8"))
    constants = [
        t.id
        for node in tree.body
        if isinstance(node, ast.Assign)
        for t in node.targets
        if isinstance(t, ast.Name) and t.id.isupper()
    ]
    stated = re.search(r"The (\w+) constants below", path.read_text(encoding="utf-8"))
    assert stated, "「The N constants below」那句话不见了"
    assert CN_NUM[stated.group(1)] == len(constants), (
        f"docstring 说 {stated.group(1)},而模块级常量实际有 {len(constants)} 个:"
        f"{constants}"
    )


@pytest.mark.django_db
def test_no_transcription_ordinals_remain_in_the_corpus_headers():
    """「第 N 个转录的语料」这类序数一律不许回来。

    它们携带的信息,语料清单本身就有;而它们**每加一个语料就全体失效一次**,
    却没有任何东西会因此报红。GORGIAS 说自己是「第五个」、INFERNO 说「第三个」,
    两句都写在同一个包里,而当时转录的是六个。
    """
    offenders = []
    for path in MYTH.glob("statutes_*.py"):
        head = path.read_text(encoding="utf-8")[:2000]
        for m in re.finditer(r"the (\w+) transcribed one", head):
            offenders.append(f"{path.name}: {m.group(0)!r}")
    assert offenders == [], (
        "转录序数回来了:" + "; ".join(offenders) + "。它们每加一个语料就失效一次。"
    )
