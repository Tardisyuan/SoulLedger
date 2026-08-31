"""CHINESE — GONGGUOGE. TRANSCRIBED here, from 《太微仙君功過格》 (1171).

The other transcribed corpus. The 74 articles themselves are in
``gongguoge_entries.py``; this module holds the provenance, the notes every
row carries, the gate table and the builder that expands the entries into
seed rows.

Moved verbatim out of ``seed_mythology.py``.

Cross-references in the comments below ("above", "below", "this file") were
written when every table in this package was one module; see the package
docstring in ``apps/actors/mythology/__init__.py``. Every table they name is
importable from that package.
"""
from apps.actors.mythology.gongguoge_entries import GONGGUOGE_ENTRIES

# --------------------------------------------------------------------------
# CHINESE — 《太微仙君功過格》 (corpus GONGGUOGE)
#
# The Chinese side comes back, and it comes back as something else. 冥律 is
# still not a document (see the withdrawal note above, which stands unamended);
# what exists is a merit ledger, and this is the earliest surviving one.
#
# WHAT THIS TEXT IS. 又玄子, 序署「西山會真堂無憂軒又玄子」, dates his preface
# to 大定辛卯 — 金世宗大定十一年, 1171 — and says he received the格 in a dream
# at 紫府 before 太微仙君. It is in the 正統道藏 at 洞真部戒律類雨字號, one
# fascicle, 「二篇同卷」: 功格三十六條 in four 門 and 過律三十九條 in four 門.
# Brokaw (1991) independently identifies it as the earliest extant 功過格, with
# 36 approved and 39 proscribed acts.
#
# WHAT IT IS NOT, AND WHY EVERY ROW SAYS SO. It is not a penal code and it does
# not judge the dead. Its sanctions run entirely in this life: 奪紀奪算 (a 紀
# is 300 days and an 算 3 days, per 抱朴子·微旨 — the later 「紀＝12年」 gloss
# has no source we could verify and is NOT used), the 三百善/一千三百善
# thresholds for 地仙/天仙 (太上感應篇), and 餘慶餘殃 landing on one's
# descendants (太微's preface opens by quoting 《易》 on exactly that). The word
# for any hell appears nowhere in the text. Using it as a basis for judging the
# dead is this system's APPROPRIATION, it is deliberate, and APPROPRIATION_NOTE
# below is carried by all 74 rows so it can never be quietly forgotten — which
# is precisely how the withdrawn HELL_LAW corpus began.
#
# There is one primary sentence that licenses the appropriation, and it is the
# text's own core religious claim rather than an apologetic we constructed: the
# preface says a self-kept tally and heaven's audit agree exactly —
# 「與上天真司考校之數，昭然相契，悉無異焉」.
#
# 74 ROWS, NOT 75, AND THE REMAINING GAP IS NOT FILLED. 救濟門 is titled 十二條
# and both independent digital transcriptions segment it into 11, so the
# transcribed total is 35 + 39 = 74 against a claimed 75. The verification
# report marks the likeliest split point and marks it as CONJECTURE. It is
# recorded in `source_notes` and in `payload["transcription_gap"]`, and NOT
# acted on. Inventing the missing article — or splitting a paragraph to make
# the arithmetic come out — is the identical move that produced the fabricated
# 冥律: a more convincing forgery.
#
# 不軌門 USED TO BE THE SECOND GAP, AND IT WAS NOT A GAP. It is titled 六條 and
# this corpus seeded 5 because, it said, both transcriptions gave 5. ctext
# gives 6, and ctext's page-image view — which lays the block out column by
# column — shows 「注撰煙粉傳記…」 beginning flush at the head of a fresh column
# after a short one, exactly as the uncontested 「食肉…」 does. The split was
# real and the arithmetic was never short: see gongguoge_entries.py's 不軌門
# header and judgment/0018. Note which way the correction ran. Refusing to
# split was the cautious move and it was still wrong, because the caution was
# resting on a claim about the sources that nobody had checked.
#
# THE DECAY QUESTION IS ALREADY ANSWERED AND IS NOT REOPENED HERE. 功過格 has
# no decay of any kind; the monthly settlement carries the balance forward at
# face value (「折除之外者…當書總記訖，再書後月」). apps/ledger/services.py
# already says this in CIVILIZATION_DECAY_RATE and labels its decay a product
# choice. Nothing in this corpus is wired to that arithmetic, and no periodic
# settlement is implemented — running 一月一小比 as extra arithmetic on top of
# a continuous decay would count the same deeds twice.
# --------------------------------------------------------------------------

GONGGUOGE_SOURCE = (
    "《太微仙君功過格》，金大定十一年（1171）又玄子序，《正統道藏》洞真部戒律類雨字號，一卷。"
    "底本：維基文庫轉錄（標注 from=正統道藏）；異文校以中國哲學書電子化計劃 ctext.org "
    "chapter=199527。兩個轉錄本逐字比對後，實質性異文三處已按文義取捨並在 source_notes 標明。"
    "未核道藏影印本。條目與分值全部為原文，無一為本系統自定。"
    "docs/lore-verification/gongguoge.md §1-§4。"
)

#: Carried by all 74. The one note that must never fall off a row.
APPROPRIATION_NOTE = (
    "挪用聲明：《太微仙君功過格》是在世修道者每日自記的道德賬簿，不是冥府判案的法典。"
    "其原生賞罰為在世奪紀奪算（紀＝三百日、算＝三日，據《抱朴子·微旨》）、"
    "成仙閾值（三百善地仙／一千三百善天仙，據《太上感應篇》）與子孫餘慶餘殃；"
    "全文不出現任何地獄名，也沒有任何一條說分數會被冥官用來判入某殿某獄。"
    "本系統拿它作審判計分依據，是一次有意的挪用。其唯一一手文本依據是本書序文的主張——"
    "自記之數「與上天真司考校之數，昭然相契，悉無異焉」，即賬簿被視為天曹底賬的鏡像。"
    "清《十戒功過格》序進一步把功過格掛靠於「陰律」，但同樣未提供任何編號條文。"
)

#: Carried by all 74 as well: the fungibility class is only half sourced.
FUNGIBILITY_CLASS_NOTE = (
    "payload.fungibility_class 的兩個值 MONEY／LIFE 有明文依據——"
    "《文昌帝君功過格·凡例》：「功過有不可折者。如用財之百功，不可折致死人之百過。"
    "零積之十功不能折一次之十過也。」其餘的值（RITUAL／SPEECH／CONDUCT）是本系統自定的細分，"
    "太微與文昌都沒有給出這樣的分類。見 apps/ledger/fungibility.py。"
)

#: (code segment, polarity, 門, English gloss, titled count, unit, default class)
GONGGUOGE_GATES = {
    "JJ": ("F-JJ", "MERIT", "救濟門", "Relief and Rescue", "十二條", "功", "LIFE"),
    "JD": ("F-JD", "MERIT", "教典門", "Scripture and Ordination", "七條", "功", "RITUAL"),
    "FX": ("F-FX", "MERIT", "焚修門", "Offering and Cultivation", "五條", "功", "RITUAL"),
    "YS": ("F-YS", "MERIT", "用事門", "Conduct of Affairs", "十二條", "功", "CONDUCT"),
    "BR": ("G-BR", "OFFENCE", "不仁門", "Inhumanity", "十五條", "過", "LIFE"),
    "BS": ("G-BS", "OFFENCE", "不善門", "Unwholesomeness", "八條", "過", "RITUAL"),
    "BY": ("G-BY", "OFFENCE", "不義門", "Unrighteousness", "十條", "過", "MONEY"),
    "BG": ("G-BG", "OFFENCE", "不軌門", "Transgression of Discipline", "六條", "過", "RITUAL"),
}


def _gongguoge_rows():
    """Expand GONGGUOGE_ENTRIES into the row shape `_seed_statutes` consumes.

    Built rather than written out, because the parts that repeat 74 times —
    the appropriation note, the gate metadata, the corpus-wide payload keys —
    are exactly the parts that must not be allowed to differ between rows. The
    parts that are per-article (the text, every point value, every caveat) are
    literal above and are never derived from anything.

    `ordinal` is continuous 1..74 in document order — 功格 then 過律 — and NOT
    the number within the 門, which is carried separately as
    `payload["gate_ordinal"]`. `Statute.Meta.ordering` sorts on `ordinal`, so a
    per-gate numbering would interleave 救濟門一 with 不仁門一 and read the
    corpus out of the order the document has.

    `text_en` is left empty on every row, on purpose. `get_localized_text`
    falls back to `text_zh`, so an English reader sees the 1171 Chinese rather
    than a translation this seeder would be the sole author of. Titles are
    glossed because a picker needs a label; the articles are not, because a
    loose English rendering of a scoring clause is a different scoring clause.
    """
    rows = []
    for ordinal, entry in enumerate(GONGGUOGE_ENTRIES, start=1):
        gate_key, gate_ordinal, title_zh, title_en, text_zh, clauses, extras = entry
        segment, polarity, gate_zh, gate_en, titled, unit, default_class = (
            GONGGUOGE_GATES[gate_key]
        )
        payload = {
            "gate": gate_zh,
            "gate_en": gate_en,
            "gate_ordinal": gate_ordinal,
            "gate_titled_count": titled,
            "unit": unit,
            "clauses": [
                {"condition_zh": condition, "points": points}
                for condition, points in clauses
            ],
            "nullifiers": [
                {"condition_zh": condition, "effect": effect}
                for condition, effect in extras.get("nullifiers", ())
            ],
            "multipliers": [
                {"condition_zh": condition, "factor": factor}
                for condition, factor in extras.get("multipliers", ())
            ],
            "cap": extras.get("cap"),
            "derived": extras.get("derived"),
            "money_rate": extras.get("money_rate"),
            "fungibility_class": extras.get("fungibility_class", default_class),
            # Every point value in this corpus is the document's own. The
            # withdrawn CN-HL-* rows are what happens when that is not tracked:
            # 「+100 孝养父母」 with nothing behind the number.
            "attestation": "PRIMARY",
            # Not the judgment basis the text itself claims — see
            # APPROPRIATION_NOTE. Kept as a queryable flag so a report can ask
            # "what in this database is used for something its source does not
            # say" without parsing prose.
            "appropriated_as_judgment_basis": True,
            "native_sanctions": ["奪紀奪算", "成仙閾值（三百善／一千三百善）", "子孫餘慶餘殃"],
            "names_any_hell": False,
        }
        if "transcription_gap" in extras:
            payload["transcription_gap"] = extras["transcription_gap"]
        if extras.get("abridged"):
            payload["text_abridged_in_transcription"] = True
        rows.append({
            "code": f"CN-GGG-{segment}-{gate_ordinal:02d}",
            "ordinal": ordinal,
            "polarity": polarity,
            "title_zh": f"{gate_zh}·{title_zh}",
            "title_en": title_en,
            "text_zh": text_zh,
            "text_en": "",
            "notes": [
                APPROPRIATION_NOTE,
                FUNGIBILITY_CLASS_NOTE,
                *extras.get("notes", ()),
            ],
            "payload": payload,
        })
    return rows


CHINESE_STATUTES = _gongguoge_rows()
