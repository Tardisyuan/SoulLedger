"""帮助语料的防漂移(docs/ARCHITECTURE-soul-assist.md §5.3)。

「App 里每个有『问一问』的页面至少对应一个条目」不在这里:页面清单在 mobile/,
那条放在 mobile 的 jest 里(阶段 2)。
"""
import re

import pytest

from apps.soul_accounts.rebirth import REFUSALS
from apps.soul_assist import corpus
from apps.soul_assist.models import SCREENS
from apps.soul_assist.service import RETENTION_DAYS
from apps.souls.models import Civilization

#: 写死的规则数字:天数、次数、年数(配置在工具里,不在语料里)。`assistant` 条目的留存天数除外,
#: 它由下面那条测试钉在 RETENTION_DAYS 上。
HARD_CODED = re.compile(r"\d+\s*(天|日|次|年|days?|times?|years?)", re.IGNORECASE)


@pytest.fixture(params=corpus.LOCALES)
def locale(request):
    return request.param


def test_every_entry_parses_and_ids_match_across_locales():
    ids = {loc: sorted(e["id"] for e in corpus.entries(loc)) for loc in corpus.LOCALES}
    assert ids["zh-Hans"] == ids["en"]
    assert len(ids["en"]) >= 10


def test_metadata_is_the_same_across_locales():
    """语言之间只有正文与 questions 不同;screens / civilizations / codes 必须一致。"""
    def meta(loc):
        return {e["id"]: (e["screens"], e["civilizations"], e["codes"]) for e in corpus.entries(loc)}
    assert meta("zh-Hans") == meta("en")


def test_values_are_known(locale):
    for e in corpus.entries(locale):
        assert set(e["screens"]) <= set(SCREENS), e["id"]
        assert set(e["civilizations"]) <= set(Civilization.values), e["id"]
        assert set(e["codes"]) <= set(REFUSALS), e["id"]
        assert e["questions"], e["id"]


def test_every_reason_code_is_explained(locale):
    """后端新增一个拒绝码而语料没解释 → 红。变异:从 REFUSALS 加一个 `new_code` → 红。"""
    codes_entry = next(e for e in corpus.entries(locale) if e["id"] == "codes")
    assert set(codes_entry["codes"]) == set(REFUSALS)
    for code in REFUSALS:
        # zh-Hans 用全角冒号(Design 语气审第 7 条),en 用半角。
        colon = "：" if locale == "zh-Hans" else ":"
        assert f"{code}{colon}" in codes_entry["body"], (locale, code)


def test_no_hard_coded_rule_numbers(locale):
    offenders = [(e["id"], m.group()) for e in corpus.entries(locale) if e["id"] != "assistant"
                 for m in HARD_CODED.finditer(e["body"])]
    assert offenders == []


def test_the_retention_stated_to_the_soul_is_the_retention_enforced(locale):
    body = next(e for e in corpus.entries(locale) if e["id"] == "assistant")["body"]
    numbers = [int(re.match(r"\d+", m.group()).group()) for m in HARD_CODED.finditer(body)]
    assert numbers == [RETENTION_DAYS]


def test_rebirth_entries_are_scoped_to_the_civilizations_the_code_says(locale):
    """语料里写死的文明范围与 `REBIRTH_CAPABLE_CIVILIZATIONS` 对齐,不静默漂移(审查 9)。"""
    from apps.ledger.constants import REBIRTH_CAPABLE_CIVILIZATIONS

    by_id = {e["id"]: set(e["civilizations"]) for e in corpus.entries(locale)}
    capable = set(REBIRTH_CAPABLE_CIVILIZATIONS)
    for entry in ("rebirth-apply", "rebirth-review", "rebirth-appeal"):
        assert by_id[entry] == capable, entry
    assert by_id["no-rebirth"] == set(Civilization.values) - capable


@pytest.mark.parametrize("given, expected", [("zh-Hans", "zh-Hans"), ("zh", "zh-Hans"), ("en", "en"),
                                             ("egy", "en"), ("", "en"), ("fr-FR", "en")])
def test_corpus_locale(given, expected):
    assert corpus.corpus_locale(given) == expected


def test_a_malformed_entry_is_refused(tmp_path):
    bad = tmp_path / "x.md"
    bad.write_text("---\nid: y\n---\nbody\n", encoding="utf-8")
    with pytest.raises(corpus.CorpusError):
        corpus.parse_entry(bad)
