"""致谢页「文献出处」一节只写语料自己写着的东西(2026-10-01)。

`packages/core/src/config/creditsLiterature.json` 是手写的 —— 语料的出处字段是一段散文
(书名、版本、校勘说明混在一起),拆成书名 / 作者 / 版本只能人来拆。条目分两种:

- 底本(无 `kind`):每个字段**逐字**出自该语料的出处串(`*_SOURCE`;埃及取判官行的
  纸草与版本串);
- 参照(`kind: "reference"`):语料逐条注记(rows 的 `notes`)里为对照提到的书,
  每个字段逐字出自该语料的注记原文。

所以这里断:
- 字段逐字可查(拆错、凭印象补一个作者或译本 → 红);链接里的编号也在出处串里;
- 种子命令写入的每个语料至少有一条底本;
- 注记里出现的每个《书名》都记成了底本或参照(注记新引一本书而致谢页没跟上 → 红);
- 同一文明下底本在前、参照在后。
"""
import json
import re
from pathlib import Path

from apps.actors.mythology import CIVILIZATION_STATUTES
from apps.actors.mythology.actors_egyptian import ASSESSOR_PAPYRUS, ASSESSOR_SOURCE_EDITION

CREDITS = Path(__file__).resolve().parents[2] / "packages/core/src/config/creditsLiterature.json"


def _entries():
    return json.loads(CREDITS.read_text())


def _corpora():
    """语料代码 → (文明, 出处串, 注记全文)。埃及的律条从四十二判官行派生,出处在判官行上(seeding.py)。"""
    out = {"ASSESSORS": ("EGYPTIAN", f"Papyrus of {ASSESSOR_PAPYRUS}. {ASSESSOR_SOURCE_EDITION}", "")}
    for label, corpora in CIVILIZATION_STATUTES.items():
        for code, source, rows in corpora:
            notes = "\n".join(n for row in rows for n in row.get("notes", ()))
            out[code] = (label.upper(), source, notes)
    return out


def test_every_field_is_quoted_from_its_corpus():
    corpora = _corpora()
    for entry in _entries():
        civ, source, notes = corpora[entry["corpus"]]
        assert entry["civilization"] == civ, entry
        assert entry.get("kind") in (None, "reference"), entry
        text_to_quote = notes if entry.get("kind") == "reference" else source
        for text in [entry["title"], *entry["details"]]:
            assert text in text_to_quote, f"{text!r} is not in the {entry['corpus']} {'notes' if entry.get('kind') else 'source'}"
        if "url" in entry:
            number = re.findall(r"\d+", entry["url"])[-1]
            assert re.search(rf"(#|=){number}\b", source), entry["url"]


def test_every_seeded_corpus_is_credited():
    credited = {e["corpus"] for e in _entries() if "kind" not in e}
    assert set(_corpora()) - credited == set()


def test_every_book_named_in_the_notes_is_credited():
    # 按书名比,不按语料:希腊 REPUBLIC_ER 的注记提到《太微仙君功過格》,那是本系统中国语料的
    # 底本,已经记在 CHINESE 下,不必再在希腊下记一次参照。
    credited = {e["title"] for e in _entries()}
    named = {t for _c, _s, notes in _corpora().values() for t in re.findall(r"《[^》]+》", notes)}
    assert named - credited == set()


def test_primary_texts_come_before_references_within_a_civilization():
    by_civ = {}
    for e in _entries():
        by_civ.setdefault(e["civilization"], []).append(e.get("kind") == "reference")
    for civ, flags in by_civ.items():
        assert flags == sorted(flags), civ
