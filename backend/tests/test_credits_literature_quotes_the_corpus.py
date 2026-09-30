"""致谢页「文献出处」一节只写语料自己写着的东西(2026-10-01)。

`packages/core/src/config/creditsLiterature.json` 是手写的 —— 语料的出处字段是一段散文
(书名、版本、校勘说明混在一起),拆成书名 / 作者 / 版本只能人来拆。所以这里断:

- 每条的书名与每个细节都**逐字**出现在它所属语料的出处串里(拆错、凭印象补一个译本 → 红);
- 链接里的编号(Gutenberg 书号、ctext chapter)也在出处串里;
- 反过来,种子命令写入的每个语料都至少有一条(新增一个语料而致谢页没跟上 → 红)。
"""
import json
import re
from pathlib import Path

from apps.actors.mythology import CIVILIZATION_STATUTES
from apps.actors.mythology.actors_egyptian import ASSESSOR_PAPYRUS, ASSESSOR_SOURCE_EDITION

CREDITS = Path(__file__).resolve().parents[2] / "packages/core/src/config/creditsLiterature.json"


def _sources():
    """语料代码 → (文明, 出处串)。埃及的律条从四十二判官行派生,出处在判官行上(seeding.py)。"""
    out = {"ASSESSORS": ("EGYPTIAN", f"Papyrus of {ASSESSOR_PAPYRUS}. {ASSESSOR_SOURCE_EDITION}")}
    for label, corpora in CIVILIZATION_STATUTES.items():
        for code, source, _rows in corpora:
            out[code] = (label.upper(), source)
    return out


def test_every_field_is_quoted_from_its_corpus():
    sources = _sources()
    for entry in json.loads(CREDITS.read_text()):
        civ, source = sources[entry["corpus"]]
        assert entry["civilization"] == civ, entry
        for text in [entry["title"], *entry["details"]]:
            assert text in source, f"{text!r} is not in the {entry['corpus']} source"
        if "url" in entry:
            number = re.findall(r"\d+", entry["url"])[-1]
            assert re.search(rf"(#|=){number}\b", source), entry["url"]


def test_every_seeded_corpus_is_credited():
    credited = {e["corpus"] for e in json.loads(CREDITS.read_text())}
    assert set(_sources()) - credited == set()
