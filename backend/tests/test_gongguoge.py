"""《太微仙君功過格》 — the Chinese corpus, and the ways it could go wrong.

Why this file exists
--------------------
The Chinese side has been through this once. Thirteen ``HELL_LAW`` articles were
seeded in 6017f04 with article numbers and minimum sentences in years, and
withdrawn in 8308204: there is no codified 冥律, 《玉历宝钞》 has no articles to
number, and 《太上老君律》 — cited as a source — is a book that does not exist.
Nothing caught it because nothing compared the articles to a document.

There is a document now, and these tests are that comparison. They follow the
three rules ``tests/test_seed_mythology.py`` and ``test_purgatorio_terraces.py``
state, plus one this corpus adds:

1. **The expectations are a second, hand-written copy.** Nothing here imports
   ``seed_mythology``'s tables. Importing them would make every assertion a
   tautology that survives somebody changing 救人一命 from 百功 to 五十功 —
   which is exactly the edit these tests exist to catch.

2. **Failures name the row.**

3. **Absence is asserted too.** A corpus that carries its appropriation note is
   not enough if it also carries a hell it does not name.

4. **THE GAPS ARE ASSERTED AS GAPS.** 救濟門 is titled 十二條 and transcribes as
   11; 不軌門 is titled 六條 and transcribes as 5. A test that demanded 12 and 6
   would be a standing instruction to fabricate two articles. These tests demand
   11 and 5 AND demand that the discrepancy is still recorded — so filling the
   hole fails here, and quietly forgetting the hole fails here too.

Deliberately separate from ``tests/test_ledger_fungibility.py``: that file tests
the ledger's arithmetic and never touches a Statute; this one tests the data and
never computes a balance. A red run should say which of the two broke.
"""
import io
import re

import pytest
from django.core.management import call_command

from apps.judgment.models import Statute, StatuteCorpus, StatutePolarity

# --------------------------------------------------------------------------
# The document. 功格三十六條 in four 門, 過律三十九條 in four 門 — as TITLED.
# `transcribed` is what the two independent digital transcriptions actually
# segment into, and it is what this database is allowed to contain.
# docs/lore-verification/gongguoge.md §2, §3, §10.
# --------------------------------------------------------------------------
GATES = {
    "F-JJ": {"gate": "救濟門", "polarity": "MERIT", "titled": "十二條", "transcribed": 11},
    "F-JD": {"gate": "教典門", "polarity": "MERIT", "titled": "七條", "transcribed": 7},
    "F-FX": {"gate": "焚修門", "polarity": "MERIT", "titled": "五條", "transcribed": 5},
    "F-YS": {"gate": "用事門", "polarity": "MERIT", "titled": "十二條", "transcribed": 12},
    "G-BR": {"gate": "不仁門", "polarity": "OFFENCE", "titled": "十五條", "transcribed": 15},
    "G-BS": {"gate": "不善門", "polarity": "OFFENCE", "titled": "八條", "transcribed": 8},
    "G-BY": {"gate": "不義門", "polarity": "OFFENCE", "titled": "十條", "transcribed": 10},
    "G-BG": {"gate": "不軌門", "polarity": "OFFENCE", "titled": "六條", "transcribed": 6},
}

TOTAL = 74          # 35 功 + 39 過
TITLED_TOTAL = 75   # what the 門 headings add up to
#: The 門 whose heading and segmentation disagree, and by how much. 不軌門 was
#: the second entry here until 2026-08-27, on the stated ground that both
#: transcriptions gave 5 against a titled 六條. ctext gives 6, and its
#: page-image view shows the break in the woodblock's own column layout — so
#: the gate was never short and 過律 always did add up to its 三十九條. See
#: judgment/0018 and the 不軌門 header in gongguoge_entries.py.
SHORT_GATES = {"F-JJ": 1}

#: The withdrawn Chinese citation keys. judgment/0012 deliberately left any
#: cited article live, so re-using one of these would rewrite the recorded
#: grounds of a decided case.
WITHDRAWN_CODES = (
    [f"CN-HL-O{n:02d}" for n in range(1, 7)] + [f"CN-HL-M{n:02d}" for n in range(1, 8)]
)

#: Spot values, copied off the 1171 text by hand. Not a full re-transcription —
#: these are the anchors that would move if somebody "tidied" the numbers, plus
#: every value in the corpus that is not an integer.
#: {code: {condition fragment: points}}
ANCHOR_POINTS = {
    # 救濟門#4 — 救人一命百功. Stable across 553 years: 《文昌帝君功過格》(1724)
    # still gives 救人一命一百功.
    "CN-GGG-F-JJ-04": {"救一人刑死性命": 100, "免死刑性命一人": 100,
                       "減死刑性命一人": 50, "救人徒刑": 40, "減人笞刑": 3},
    # 救濟門#7 — 賑貧百錢一功, the other 553-year anchor.
    "CN-GGG-F-JJ-07": {"賑濟窮民百錢": 1, "賑濟窮民貫錢": 10},
    # 救濟門#1 — 救重疾十功／小疾五功, copied verbatim into 雲棲袾宏《自知錄》.
    "CN-GGG-F-JJ-01": {"救重疾一人": 10, "救小疾一人": 5},
    # 焚修門#1 — 半功. 0.5, not 0 and not 1.
    "CN-GGG-F-FX-01": {"施與人錢物修置百錢": 0.5, "自修費百錢": 1},
    # 用事門#12 — the other 半功.
    "CN-GGG-F-YS-12": {"素食中味": 0.5, "有而不食": 3},
    # 不仁門#7 — 故傷殺人性命百過.
    "CN-GGG-G-BR-07": {"故傷殺人性命": -100, "誤傷殺性命": -80},
    # 不善門#1 — 半過, the negative half-point.
    "CN-GGG-G-BS-01": {"以巧言說人毀壞百錢之直": -0.5},
    # 不義門#5 — 反叛師長五十過.
    "CN-GGG-G-BY-05": {"反叛師長": -50},
}

#: The one explicit per-act ceiling in the whole text: 用事門#2,
#: 「人數雖多，止五十功」. Every other article has none.
CAPPED = {"CN-GGG-F-YS-02": 50}

#: The one derived value: 不仁門#9, 「見殺不救，隨本人之過減半」.
DERIVED = "CN-GGG-G-BR-09"

#: 「則無功」/「無過」 — motive cancels the score. Articles that carry at least
#: one, by code. A count, not the wording, so improving a condition's phrasing
#: is free and deleting the mechanism is not.
NULLIFIER_ARTICLES = {
    "CN-GGG-F-JJ-01": 1,   # 受病家賄賂則無功
    "CN-GGG-F-JJ-02": 2,   # 受賄而傳／令人受賄
    "CN-GGG-F-JJ-04": 1,   # 依法定罪則無功
    "CN-GGG-F-JJ-10": 1,   # 令出備租課則無功
    "CN-GGG-F-JJ-11": 1,   # 求賄賂
    "CN-GGG-F-JD-05": 1,   # 詠無教化者則無功
    "CN-GGG-F-FX-03": 1,   # 受法信則無功
    "CN-GGG-F-FX-04": 1,
    "CN-GGG-F-FX-05": 1,
    "CN-GGG-F-YS-11": 1,   # 著紈帛者無功
    "CN-GGG-F-YS-12": 1,   # 素食上味為無功
    "CN-GGG-G-BS-03": 1,   # 因公務不及無過
    "CN-GGG-G-BG-04": 4,   # 為和合事理／祭酒／待賓／服藥，皆不坐
}

#: The three substantive variants between the two transcriptions, and the
#: reading each article was seeded with. §1.1 of the report.
VARIANTS = {
    # 滅 (Wikisource) vs 減 (ctext) — 救／免／減 is a descending ladder.
    "CN-GGG-F-JJ-04": {"present": "減死刑性命一人為五十功", "absent": "滅死刑"},
    # 勸謙 vs 勸諫 — 勸諫 is a word; 勸謙 is not.
    "CN-GGG-F-YS-06": {"present": "勸諫人鬪爭", "absent": "勸謙"},
    "CN-GGG-F-YS-10": {"present": "勸諫人令不為非", "absent": "勸謙"},
}
#: The variant that was NOT resolved, and must stay marked open.
UNRESOLVED_VARIANT = "CN-GGG-G-BR-04"  # 妄入〔鬼神〕罪

#: Sanctions the text actually prescribes. None of them is a hell.
NATIVE_SANCTIONS = 3
#: Words that would mean this corpus had been quietly re-filed as infernal law.
#: 太微 uses none of them.
HELL_WORDS = ("地獄", "地狱", "冥府", "冥司", "閻羅", "阎罗", "阿鼻", "十殿", "枉死城")

#: Fungibility pools. MONEY and LIFE are 《文昌帝君功過格·凡例》's 財 and 性命;
#: the rest is this system's own partition and every row says so.
KNOWN_CLASSES = {"LIFE", "MONEY", "RITUAL", "SPEECH", "CONDUCT"}


@pytest.fixture
def seeded(db):
    out = io.StringIO()
    call_command("seed_mythology", stdout=out, stderr=out)
    return out.getvalue()


@pytest.fixture
def articles(seeded):
    """The GONGGUOGE articles — the subject of every count in this file."""
    return {
        statute.code: statute
        for statute in Statute.objects.filter(corpus=StatuteCorpus.GONGGUOGE)
    }


@pytest.fixture
def every_article(seeded):
    """**Every** statute, whatever its corpus.

    The two clause guards below use this instead of `articles`.

    Their subject list was `corpus=GONGGUOGE`, and today that happens to cover
    every article that could fail: a census of all 172 rows found 為X功/過 in
    74 of them and all 74 are GONGGUOGE. **But that is a property of the data,
    not of the check.** `HELL_LAW` is a deliberately empty Chinese corpus
    member; an article added there with a price and no clause would be
    invisible to a guard that filters by corpus name.

    Costs nothing to widen: the regex selects its own subjects and the other
    98 rows contribute zero matches. The counting tests keep the narrow
    fixture, because a count of 74 is a fact about GONGGUOGE and not about the
    table.
    """
    return {statute.code: statute for statute in Statute.objects.all()}


def _expected_codes():
    return [
        f"CN-GGG-{segment}-{n:02d}"
        for segment, gate in GATES.items()
        for n in range(1, gate["transcribed"] + 1)
    ]


@pytest.fixture
def registry_apps():
    """The live app registry, standing in for the historical one a migration
    is handed. Both migration test classes use it."""
    from django.apps import apps as django_apps

    return django_apps


def _migration_0013_codes():
    """The codes judgment/0013 creates — read off the migration, not the corpus.

    These two lists were the same thing until 不軌門 was split into six
    articles; 0013 still writes the five it was authored with, because a
    migration is a record of what happened and not a view of the present. A
    test that asks "did 0013 create the corpus?" and builds its expectation
    from the LIVE corpus is asking a question about today's data of a function
    frozen in 2026-08. It went red on the split, correctly, and the repair is
    to point it at the right list rather than to loosen the assertion.
    """
    from importlib import import_module

    module = import_module("apps.judgment.migrations.0013_gongguoge_corpus")
    return [row[0] for row in module._skeleton()]


def _clause_points(statute):
    return {
        clause["condition_zh"]: clause["points"]
        for clause in (statute.payload_json or {}).get("clauses", [])
    }


# --------------------------------------------------------------------------
# The corpus exists, and is exactly this big
# --------------------------------------------------------------------------


@pytest.mark.django_db
def test_the_corpus_is_seeded_whole(articles):
    expected = set(_expected_codes())
    found = set(articles)
    assert found - expected == set(), (
        f"Articles this file does not know about: {sorted(found - expected)}. "
        f"A 74th article is either a duplicate or a claim about the 1171 text "
        f"that nobody checked."
    )
    assert expected - found == set(), (
        f"seed_mythology left out: {sorted(expected - found)}"
    )
    assert len(articles) == TOTAL


@pytest.mark.django_db
def test_thirty_five_merits_and_thirty_nine_faults(articles):
    """過律 is titled 三十九條 and now holds thirty-nine. It held thirty-eight
    while 不軌門 was seeded five articles against its own 六條; splitting that
    gate closed the shortfall, so the 過 side matches its heading exactly and
    only 功格 is still one short of its 三十六條."""
    counts = {"MERIT": 0, "OFFENCE": 0}
    for statute in articles.values():
        counts[statute.polarity] = counts.get(statute.polarity, 0) + 1
    assert counts == {"MERIT": 35, "OFFENCE": 39}, (
        f"{counts} — 功格 and 過律 are two halves of one fascicle and the split "
        f"between them is not a rounding."
    )


@pytest.mark.django_db
def test_each_gate_holds_its_own_articles_and_its_own_polarity(articles):
    faults = []
    for segment, expected in GATES.items():
        rows = [s for code, s in articles.items() if code.startswith(f"CN-GGG-{segment}-")]
        if len(rows) != expected["transcribed"]:
            faults.append(
                f"{expected['gate']}: {len(rows)} articles, expected "
                f"{expected['transcribed']}"
            )
        for statute in rows:
            payload = statute.payload_json or {}
            if payload.get("gate") != expected["gate"]:
                faults.append(
                    f"{statute.code}: payload gate={payload.get('gate')!r}, "
                    f"expected {expected['gate']!r}"
                )
            if statute.polarity != expected["polarity"]:
                faults.append(
                    f"{statute.code}: polarity={statute.polarity}, expected "
                    f"{expected['polarity']} — 功 and 過 are the two columns of "
                    f"the ledger and a 過 filed as MERIT credits the soul for it"
                )
    assert not faults, "Gates are wrong:\n  " + "\n  ".join(faults)


@pytest.mark.django_db
def test_the_articles_read_in_document_order(articles):
    """`ordinal` is continuous 1..74, 功格 then 過律.

    `Statute.Meta.ordering` sorts on it, so a per-gate numbering would put
    救濟門一 next to 不仁門一 and print the corpus in an order the fascicle does
    not have.
    """
    in_order = [
        statute.code
        for statute in sorted(articles.values(), key=lambda s: s.ordinal)
    ]
    assert in_order == _expected_codes(), (
        "The corpus does not read in document order. First divergence at "
        f"index {next(i for i, (a, b) in enumerate(zip(in_order, _expected_codes(), strict=False)) if a != b)}"
    )
    assert sorted(s.ordinal for s in articles.values()) == list(range(1, TOTAL + 1))


# --------------------------------------------------------------------------
# The gaps — recorded, not filled
# --------------------------------------------------------------------------


@pytest.mark.django_db
def test_the_short_gate_is_short_and_says_why(articles):
    """門題 vs transcription: 十二條 against 11.

    Both directions matter. Seeding 12 would mean an article nobody has a
    source for — the exact repair that must not be made, and the one the
    withdrawn CN-HL-* corpus was built out of. Dropping the note would leave a
    74-article corpus that silently claims to be complete.

    THE OTHER DIRECTION HAS NOW BEEN EXERCISED TOO, which is why this test no
    longer says "two gates". 不軌門 sat here for the same reason 救濟門 does,
    and its reason was false: both transcriptions did NOT give 5. Refusing to
    split was the cautious move and it was still wrong, because the caution was
    resting on a claim about the sources that nobody had checked. A gap
    declared is not a gap verified.
    """
    faults = []
    for segment, short_by in SHORT_GATES.items():
        gate = GATES[segment]
        titled_digits = {"十二條": 12, "六條": 6}[gate["titled"]]
        assert titled_digits - gate["transcribed"] == short_by

        marked = [
            statute for code, statute in articles.items()
            if code.startswith(f"CN-GGG-{segment}-")
            and "transcription_gap" in (statute.payload_json or {})
        ]
        if len(marked) != 1:
            faults.append(
                f"{gate['gate']}: {len(marked)} articles carry a "
                f"`transcription_gap`, expected exactly 1 (the conjectured "
                f"split point). Codes: {[s.code for s in marked]}"
            )
            continue
        gap = marked[0].payload_json["transcription_gap"]
        if gap.get("gate_titled") != gate["titled"]:
            faults.append(f"{marked[0].code}: gate_titled={gap.get('gate_titled')!r}")
        if gap.get("gate_transcribed") != gate["transcribed"]:
            faults.append(
                f"{marked[0].code}: gate_transcribed={gap.get('gate_transcribed')!r}"
            )
        if not gap.get("conjecture"):
            faults.append(
                f"{marked[0].code}: the split point is recorded without saying "
                f"it is a conjecture. It is one — the report says so explicitly "
                f"and no 影印本 was consulted."
            )
    assert not faults, "\n  ".join(["Transcription gaps are mis-recorded:", *faults])


@pytest.mark.django_db
def test_the_gaps_are_not_quietly_reconciled(articles):
    """74 seeded against 75 titled, and nothing pretends otherwise."""
    assert len(articles) == TOTAL
    assert TITLED_TOTAL - TOTAL == sum(SHORT_GATES.values()) == 1
    gapped = sorted(
        code for code, statute in articles.items()
        if "transcription_gap" in (statute.payload_json or {})
    )
    assert gapped == ["CN-GGG-F-JJ-07"], (
        f"Conjectured split points recorded: {gapped}. Exactly one 門 is short "
        f"and exactly one article should carry the marker. CN-GGG-G-BG-01 "
        f"carried the second one until 不軌門 turned out not to be short."
    )


# --------------------------------------------------------------------------
# The text
# --------------------------------------------------------------------------


@pytest.mark.django_db
def test_the_three_substantive_variants_were_resolved_the_way_the_report_says(articles):
    faults = []
    for code, expected in VARIANTS.items():
        text = articles[code].text_zh
        if expected["present"] not in text:
            faults.append(f"{code}: expected reading {expected['present']!r} is absent")
        if expected["absent"] in text:
            faults.append(
                f"{code}: carries the rejected reading {expected['absent']!r}"
            )
        notes = " ".join(articles[code].source_notes or [])
        if "校勘" not in notes:
            faults.append(
                f"{code}: the emendation is applied but not recorded. A silent "
                f"emendation is indistinguishable from a transcription error."
            )
    assert not faults, "\n  ".join(["Collation is wrong:", *faults])


@pytest.mark.django_db
def test_the_undecided_variant_stays_undecided(articles):
    """不仁門#4 「妄入〔鬼神〕罪」 — ctext has 鬼神, Wikisource does not.

    If ctext is right this is the only clause in the whole text about charging
    a spirit with an offence, which is interesting enough here that resolving it
    by preference rather than by evidence would be a real temptation.
    """
    statute = articles[UNRESOLVED_VARIANT]
    assert "妄入〔鬼神〕罪" in statute.text_zh, statute.text_zh
    notes = " ".join(statute.source_notes or [])
    assert "未定讞" in notes or "未定谳" in notes, (
        f"The open variant is no longer marked open: {statute.source_notes!r}"
    )
    assert "影印" in notes


@pytest.mark.django_db
def test_the_anchor_point_values_are_the_documents_own(articles):
    faults = []
    for code, expected in ANCHOR_POINTS.items():
        points = _clause_points(articles[code])
        for condition, value in expected.items():
            found = points.get(condition, "<no such clause>")
            if found != value:
                faults.append(f"{code} / {condition}: {found!r}, expected {value!r}")
    assert not faults, (
        "Point values do not match the 1171 text:\n  " + "\n  ".join(faults)
    )


@pytest.mark.django_db
def test_half_points_survive_as_halves(articles):
    """半功/半過 = 0.5, stored and read back as 0.5.

    A single `merit_points` integer column — the shape this corpus was expected
    to arrive in — would have rounded all three to 0 or 1 without anything
    failing. The values live in `payload_json["clauses"][].points` instead,
    where JSON holds a float natively.
    """
    halves = sorted(
        (code, clause["condition_zh"], clause["points"])
        for code, statute in articles.items()
        for clause in (statute.payload_json or {}).get("clauses", [])
        if isinstance(clause["points"], float)
    )
    assert halves == [
        ("CN-GGG-F-FX-01", "施與人錢物修置百錢", 0.5),
        ("CN-GGG-F-YS-12", "素食中味", 0.5),
        ("CN-GGG-G-BS-01", "以巧言說人毀壞百錢之直", -0.5),
    ], f"Non-integer point values found: {halves}"


@pytest.mark.django_db
def test_a_faults_points_are_negative_and_a_merits_are_positive(articles):
    faults = []
    for code, statute in articles.items():
        want_positive = statute.polarity == StatutePolarity.MERIT
        for clause in (statute.payload_json or {}).get("clauses", []):
            points = clause["points"]
            if want_positive and points <= 0:
                faults.append(f"{code}: 功 clause {clause['condition_zh']!r} = {points}")
            if not want_positive and points >= 0:
                faults.append(f"{code}: 過 clause {clause['condition_zh']!r} = {points}")
    assert not faults, "\n  ".join(["Signs disagree with polarity:", *faults])


#: 賑濟窮民 states the same rate twice — 「百錢為一功」 and then 「如一錢散施，
#: 積至百錢為一功」, which is the first clause restated for small change rather
#: than a fourth priced act. It is the ONLY article in the corpus whose text
#: prices something the clause list does not separately carry, and it is listed
#: here by code so that a second one cannot join it silently.
RESTATED_RATE = {"CN-GGG-F-JJ-07": 1}

_PRICE = re.compile("為(?:半|[一二三四五六七八九十百千]+)[功過]")
_PRICE_VALUE = re.compile("為(半|[一二三四五六七八九十百千]+)([功過])")

#: 中文数字 → 值。只覆盖这份语料实际出现的那些写法,遇到不认识的**抛异常**而不是
#: 跳过 —— 一个悄悄跳过看不懂的数字的解析器,会把「解析不了」变成「没有问题」。
_CN_DIGITS = {"一": 1, "二": 2, "三": 3, "四": 4, "五": 5,
              "六": 6, "七": 7, "八": 8, "九": 9}


def _cn_number(text):
    """把「五十」「百」「一百」「三千」这类读成整数。"""
    if text == "半":
        return 0.5
    units = {"十": 10, "百": 100, "千": 1000}
    total, current = 0, 0
    for ch in text:
        if ch in _CN_DIGITS:
            current = _CN_DIGITS[ch]
        elif ch in units:
            total += (current or 1) * units[ch]
            current = 0
        else:
            raise ValueError(f"看不懂的中文数字:{text!r}(卡在 {ch!r})")
    return total + current


@pytest.mark.django_db
def test_every_priced_act_in_the_text_is_a_clause(every_article):
    """A 「為X功／過」 in the prose with no clause behind it is a value the
    ledger cannot award, and nothing else here would notice.

    THIS TEST EXISTS BECAUSE OF WHAT IT DID NOT CATCH. Four articles were
    transcribed with a 「…」 standing in for material the transcriber had not
    reached, and two of those elisions had priced acts inside them: 不善門#5
    lost four (誤違科律格式／威儀有失／唱念不專／宣科讀狀奏對詞表差錯一字) and
    不善門#8 lost seven, together 34 過 that could never be assessed. Every
    count guard in this repository passed throughout, because they all pin the
    number of ARTICLES — 73 at the time, in FOUR independent hand-written
    copies, one of which (tests/test_ledger_granularity.py) was missed by the
    first sweep that went looking for them — and an
    article stays one article no matter how much of it is missing.

    The check is not a total. A total goes stale the moment the corpus grows
    and tells a later reader nothing about what broke. This compares each
    article against ITSELF: the source prices an act, so a clause must carry
    it. 73 of 74 hold exactly; the exception is declared in RESTATED_RATE with
    its reason.

    `〔〕` is stripped first because those are the source's own inline glosses
    — 不善門#8's 「但一過去功一分，十過去功十分」 explains the offset rule and
    prices nothing new — and 為無功／為無過 is a nullifier, which is carried in
    `nullifiers` rather than `clauses`.
    """
    faults = []
    for code, statute in sorted(every_article.items()):
        body = re.sub(r"〔[^〕]*〕", "", statute.text_zh or "")
        priced = len(_PRICE.findall(body))
        carried = len((statute.payload_json or {}).get("clauses", []))
        expected = priced - RESTATED_RATE.get(code, 0)
        if carried != expected:
            faults.append(
                f"{code}: text prices {priced} act(s), clauses carry {carried}"
                f"{' (RESTATED_RATE allows ' + str(RESTATED_RATE[code]) + ')' if code in RESTATED_RATE else ''}"
                f" — {statute.text_zh}"
            )
    assert not faults, "\n  ".join(
        ["A priced act in the prose has no clause behind it:", *faults]
    )


@pytest.mark.django_db
def test_every_priced_act_carries_the_value_the_text_gives_it(every_article):
    """条数对上了,**值**也要对上。

    上面那条只比条数。`ANCHOR_POINTS` 只钉了 8 篇约 17 个条款,而全语料约 200 个 ——
    **锚点之外任何一个值改错(只要符号不翻)都是静默的**,而这些值直接进功过相抵的账。

    实证:把 BG-6 的 `("受觸極親", -50)` 改成 `-49` —— 与它自己正文「為五十過」
    直接矛盾 —— **68 passed,0 红**。

    这条把「為X功/過」里的中文数字解析出来,与条款的 points 逐个比对,顺序对顺序。
    与上面那条同一个原则:比的是**每一条与它自己的正文**,不是一个会随语料增长而
    过期的总数。
    """
    faults = []
    for code, statute in sorted(every_article.items()):
        body = re.sub(r"〔[^〕]*〕", "", statute.text_zh or "")
        priced = [
            (_cn_number(num), 1 if kind == "功" else -1)
            for num, kind in _PRICE_VALUE.findall(body)
        ]
        clauses = (statute.payload_json or {}).get("clauses", [])
        if len(priced) != len(clauses) + RESTATED_RATE.get(code, 0):
            continue  # 条数不符由上面那条报告,这里不重复
        for (value, sign), clause in zip(priced, clauses, strict=False):
            expected = value * sign
            actual = clause.get("points")
            if actual != expected:
                faults.append(
                    f"{code} 「{clause.get('condition_zh')}」: 正文写 "
                    f"{'為' + str(value) + ('功' if sign > 0 else '過')},"
                    f"条款记 {actual}(应为 {expected})"
                )
    assert not faults, "\n  ".join(
        ["条款的分值与它自己的正文不符:", *faults]
    )


@pytest.mark.django_db
def test_no_article_is_still_abridged(articles):
    """The four 「…」 elisions are closed. This keeps them closed.

    A transcription that stops mid-article is not wrong, it is short — and
    short is exactly what `assert not faults` cannot see. The ellipsis is the
    one mark that says so out loud, so it is the one thing worth pinning.
    """
    elided = sorted(
        code for code, statute in articles.items() if "…" in (statute.text_zh or "")
    )
    assert elided == [], (
        f"Articles still carrying an elision: {elided}. If a transcription gap "
        f"is genuinely reopened, say so in payload rather than in the prose — "
        f"a 「…」 in text_zh is invisible to every other check in this file."
    )
    flagged = sorted(
        code
        for code, statute in articles.items()
        if (statute.payload_json or {}).get("text_abridged_in_transcription")
    )
    assert flagged == [], f"Articles still flagged abridged: {flagged}"


@pytest.mark.django_db
def test_the_articles_that_hold_more_than_one_value_hold_all_of_them(articles):
    """救濟門#4 and 不仁門#4 are single articles carrying twelve graded values
    each — 死/徒/杖/笞 crossed with 救/免/減 and with 成/不成/舉意. Collapsing
    either to one number is the thing `clauses` exists to prevent."""
    for code in ("CN-GGG-F-JJ-04", "CN-GGG-G-BR-04"):
        clauses = (articles[code].payload_json or {}).get("clauses", [])
        assert len(clauses) == 12, f"{code}: {len(clauses)} clauses, expected 12"


@pytest.mark.django_db
def test_the_only_cap_and_the_only_derived_value(articles):
    capped = {
        code: statute.payload_json["cap"]
        for code, statute in articles.items()
        if (statute.payload_json or {}).get("cap") is not None
    }
    assert capped == CAPPED, (
        f"Per-act ceilings found: {capped}. 「人數雖多，止五十功」 (用事門#2) is "
        f"the only one in the text; an invented second one is a house rule "
        f"wearing a citation."
    )
    derived = sorted(
        code for code, statute in articles.items()
        if (statute.payload_json or {}).get("derived") is not None
    )
    assert derived == [DERIVED], f"Derived values found: {derived}"
    rule = articles[DERIVED].payload_json["derived"]
    assert rule["factor"] == 0.5 and rule["of"] == "actor_offence"


@pytest.mark.django_db
def test_the_motive_cancelling_clauses_are_all_carried(articles):
    """「則無功」 — a bribe taken cancels the merit outright. It is the most
    characteristic mechanism in the text and this system had no notion of it."""
    found = {
        code: len(statute.payload_json["nullifiers"])
        for code, statute in articles.items()
        if (statute.payload_json or {}).get("nullifiers")
    }
    assert found == NULLIFIER_ARTICLES, (
        f"Nullifier articles differ.\n  seeded:   {sorted(found.items())}\n"
        f"  expected: {sorted(NULLIFIER_ARTICLES.items())}"
    )
    effects = {
        clause["effect"]
        for statute in articles.values()
        for clause in (statute.payload_json or {}).get("nullifiers", [])
    }
    assert effects == {"no_merit", "no_demerit"}, (
        f"Nullifier effects: {effects}. 功格 cancels a merit; 過律 has the "
        f"mirror ('因公務不及無過', '皆不坐') and it is not the same effect."
    )


# --------------------------------------------------------------------------
# What the text is, and what this system does with it
# --------------------------------------------------------------------------


@pytest.mark.django_db
def test_every_article_declares_the_appropriation(articles):
    """The note that must never fall off a row.

    A 功過格 is an account book the living keep on themselves. This system uses
    it to judge the dead, which its own text nowhere authorises, and the only
    primary sentence that licenses the move is the preface's claim that the
    self-kept tally and heaven's audit agree exactly. Every row carries it,
    because a corpus that stops saying this is a corpus that has become 冥律
    again.
    """
    faults = []
    for code, statute in articles.items():
        notes = " ".join(statute.source_notes or [])
        payload = statute.payload_json or {}
        if "挪用" not in notes:
            faults.append(f"{code}: no appropriation note")
        if "昭然相契" not in notes:
            faults.append(
                f"{code}: the note no longer quotes 「與上天真司考校之數，昭然"
                f"相契，悉無異焉」 — the one primary sentence the appropriation "
                f"rests on"
            )
        if payload.get("appropriated_as_judgment_basis") is not True:
            faults.append(f"{code}: appropriated_as_judgment_basis is not set")
        if len(payload.get("native_sanctions") or []) != NATIVE_SANCTIONS:
            faults.append(
                f"{code}: native_sanctions={payload.get('native_sanctions')!r} — "
                f"奪紀奪算, the immortality thresholds and 餘慶餘殃 are what this "
                f"text actually prescribes"
            )
        if payload.get("names_any_hell") is not False:
            faults.append(f"{code}: names_any_hell is not False")
    assert not faults, "\n  ".join(["Appropriation is not declared:", *faults])


@pytest.mark.django_db
def test_no_article_names_a_hell(articles):
    """Absence, asserted. 太微 contains no hell at all, and a seeded article
    that mentions one is this corpus being rewritten into the thing it replaced."""
    offenders = sorted(
        f"{code}: {word}"
        for code, statute in articles.items()
        for word in HELL_WORDS
        if word in (statute.text_zh or "") or word in (statute.title_zh or "")
    )
    assert offenders == [], (
        f"Hell named in a 功過格 article: {offenders}. The realm structure in "
        f"this project comes from the 《玉历宝钞》 tradition and the scoring from "
        f"the 功過格 tradition; no source combines them, and the combination is "
        f"this project's own."
    )


@pytest.mark.django_db
def test_every_article_carries_provenance_and_calls_its_numbers_primary(articles):
    faults = []
    for code, statute in articles.items():
        if "太微仙君功過格" not in (statute.source or ""):
            faults.append(f"{code}: source does not name the text: {statute.source!r}")
        if "1171" not in (statute.source or ""):
            faults.append(f"{code}: source does not date the text")
        if (statute.payload_json or {}).get("attestation") != "PRIMARY":
            faults.append(
                f"{code}: attestation="
                f"{(statute.payload_json or {}).get('attestation')!r}. Every point "
                f"value in this corpus is the document's own; a self-authored one "
                f"must not be able to sit here unlabelled, which is how "
                f"「+100 孝养父母」 happened."
            )
    assert not faults, "\n  ".join(["Provenance is missing:", *faults])


@pytest.mark.django_db
def test_every_article_declares_a_fungibility_class_and_flags_the_invented_ones(articles):
    faults = []
    for code, statute in articles.items():
        payload = statute.payload_json or {}
        pool = payload.get("fungibility_class")
        if pool not in KNOWN_CLASSES:
            faults.append(f"{code}: fungibility_class={pool!r}")
        notes = " ".join(statute.source_notes or [])
        if "不可折" not in notes:
            faults.append(f"{code}: does not cite 「功過有不可折者」")
        if "自定" not in notes:
            faults.append(
                f"{code}: does not say that RITUAL/SPEECH/CONDUCT are this "
                f"system's own partition. Only 財 and 性命 are attested."
            )
    assert not faults, "\n  ".join(["Fungibility class is undeclared:", *faults])
    # The two attested pools are both actually used — a taxonomy in which the
    # sourced half is empty would be entirely invented in practice.
    used = {(s.payload_json or {}).get("fungibility_class") for s in articles.values()}
    assert {"MONEY", "LIFE"} <= used, f"pools in use: {sorted(used)}"


# --------------------------------------------------------------------------
# What this change deliberately did not do
# --------------------------------------------------------------------------


@pytest.mark.django_db
def test_hell_law_is_still_empty(seeded):
    """The finding stands. 冥律 is not a document, and the Chinese side having
    a real corpus does not make it one."""
    rows = sorted(
        Statute.all_objects.filter(corpus=StatuteCorpus.HELL_LAW).values_list(
            "code", flat=True
        )
    )
    assert rows == [], (
        f"HELL_LAW has rows again: {rows}. There is no codified 冥律 to "
        f"transcribe; 功過格 belongs under GONGGUOGE."
    )


@pytest.mark.django_db
def test_the_withdrawn_chinese_codes_are_not_reused(seeded):
    reused = sorted(
        Statute.all_objects.filter(code__in=WITHDRAWN_CODES).values_list(
            "code", flat=True
        )
    )
    assert reused == [], (
        f"seed_mythology wrote withdrawn citation keys {reused}. judgment/0012 "
        f"left cited articles live, so re-seeding under a CN-HL-* code would "
        f"rewrite the recorded grounds of a decided case. The 功過格 keys are "
        f"CN-GGG-*."
    )


@pytest.mark.django_db
def test_the_corpus_is_pinned_to_one_civilization(articles):
    from django.core.exceptions import ValidationError

    assert {s.civilization for s in articles.values()} == {"CHINESE"}
    statute = articles["CN-GGG-F-JJ-01"]
    statute.civilization = "EUROPEAN"
    with pytest.raises(ValidationError):
        statute.full_clean(exclude=["tenant"])


@pytest.mark.django_db
def test_no_periodic_settlement_or_decay_was_wired_to_this_corpus(seeded):
    """功過格 has no decay and this corpus did not give it one.

    「折除之外者…當書總記訖，再書後月」 — the monthly balance carries forward at
    face value. The decay in LedgerService stays what its own comment always
    said it was, a product choice, and 一月一小比 is deliberately NOT implemented
    as extra arithmetic on top of it: that would score the same deeds twice.
    """
    from apps.ledger import services

    assert services.CIVILIZATION_DECAY_RATE["CHINESE"] == services.DECAY_RATE
    assert not hasattr(services.LedgerService, "monthly_settlement")
    with open(services.__file__, encoding="utf-8") as handle:
        body = handle.read()
    assert "功過格 is cumulative and its entries do not\n# expire" in body, (
        "The note stating that 功過格 does not decay is gone from "
        "CIVILIZATION_DECAY_RATE. It was right before this corpus landed and "
        "independent verification agreed with it."
    )


@pytest.mark.django_db
def test_reseeding_changes_nothing(seeded):
    before = Statute.objects.count()
    out = io.StringIO()
    call_command("seed_mythology", stdout=out, stderr=out)
    output = out.getvalue()
    assert Statute.objects.count() == before
    assert "created=0" in output, f"Second run created rows:\n{output}"


# --------------------------------------------------------------------------
# The migration
# --------------------------------------------------------------------------


@pytest.mark.django_db
class TestGongguogeMigration:
    """judgment/0013 puts the 73 citation keys on a database that already has a
    corpus, and writes nothing at all to one that does not.

    73, not the corpus's current 74: 0013 predates the 不軌門 split and creates
    the five 不軌門 keys it was written with. judgment/0018 renames the four
    that moved. Expectations here come from `_migration_0013_codes()` for that
    reason — see its docstring.
    """

    @pytest.fixture
    def migration(self):
        from importlib import import_module

        return import_module("apps.judgment.migrations.0013_gongguoge_corpus")

    @pytest.fixture
    def registry(self):
        from django.apps import apps as django_apps

        return django_apps

    def test_it_writes_nothing_to_an_empty_database(self, migration, registry, db):
        """The guard realms/0012 earned. A migration that half-seeds ahead of
        `seed_mythology` hands it rows it did not create and makes `--dry-run`
        against a fresh database report a plan a real run would not take."""
        assert Statute.all_objects.count() == 0
        migration.forwards(registry, None)
        assert Statute.all_objects.count() == 0

    def test_it_creates_the_skeleton_on_a_populated_database(
        self, migration, registry, seeded
    ):
        codes = _migration_0013_codes()
        Statute.all_objects.filter(code__in=codes).delete()
        assert not Statute.all_objects.filter(code__in=codes).exists()

        migration.forwards(registry, None)

        rebuilt = dict(
            Statute.all_objects.filter(code__in=codes).values_list("code", "ordinal")
        )
        assert set(rebuilt) == set(codes)
        assert rebuilt == {code: n for n, code in enumerate(codes, start=1)}, (
            "The migration seeded the corpus out of document order."
        )

    def test_it_leaves_the_prose_to_the_seeder(self, migration, registry, seeded):
        """Identifying columns only — the division realms/0012, 0013 and 0014
        all use. A migration carrying the 73 article texts would be a second
        copy of the corpus that nothing keeps in step."""
        codes = _migration_0013_codes()
        Statute.all_objects.filter(code__in=codes).delete()
        migration.forwards(registry, None)

        row = Statute.all_objects.get(code="CN-GGG-F-JJ-04")
        assert row.text_zh == ""
        assert row.source == ""
        assert row.source_notes == []
        assert "clauses" not in (row.payload_json or {})
        # But the two facts it does repeat are there, because they are the
        # facts a second copy is worth having.
        assert row.payload_json["gate"] == "救濟門"
        assert row.payload_json["gate_titled_count"] == "十二條"

    def test_running_it_twice_creates_nothing(self, migration, registry, seeded):
        before = Statute.all_objects.count()
        migration.forwards(registry, None)
        assert Statute.all_objects.count() == before

    def test_the_reverse_keeps_a_cited_article(self, migration, registry, seeded):
        """A rollback does not erase the recorded basis of a decided case.

        `JudgmentCitation.statute` is PROTECT, so a blind delete would either be
        refused by the database or leave a dangling ground. judgment/0012 made
        the same refusal in the other direction.
        """
        from apps.judgment.models import Judgment, JudgmentCitation
        from apps.souls.models import Soul, SoulState
        from apps.tenants.models import Tenant

        tenant = Tenant.objects.get(code="CN_DIYU")
        soul = Soul.objects.create(
            name="被引用者", current_state=SoulState.JUDGING, tenant=tenant
        )
        judgment = Judgment.objects.create(
            soul=soul, civilization="CHINESE", tenant=tenant
        )
        cited = Statute.objects.get(code="CN-GGG-G-BR-07")
        JudgmentCitation.objects.create(
            judgment=judgment, statute=cited, tenant=tenant
        )

        migration.backwards(registry, None)

        assert Statute.all_objects.filter(code="CN-GGG-G-BR-07").exists(), (
            "The rollback deleted an article a judgment had cited."
        )
        survivors = Statute.all_objects.filter(
            code__in=_migration_0013_codes()
        ).count()
        assert survivors == 1, f"{survivors} articles survived, expected only the cited one"


@pytest.mark.django_db
class TestBuguiSplitMigration:
    """judgment/0018 renames four articles so the split does not repoint them.

    The danger it exists for is not visible in the data afterwards. Codes are
    positional and `_upsert` matches on `code`, so inserting 注撰煙粉 at BG-02
    and reseeding would have rewritten the CONTENT of the row that has always
    been 食肉 — and `JudgmentCitation.statute` is a ForeignKey to that row. Every
    recorded citation of 食肉 would have come to cite 注撰煙粉, with the judgment
    prose around it still reading perfectly sensibly. That is the failure the
    tests below make visible: they follow a citation across the rename and ask
    what it points at, not whether the codes look tidy.
    """

    @pytest.fixture
    def migration(self):
        from importlib import import_module

        return import_module("apps.judgment.migrations.0018_split_bugui_gate_article")

    @pytest.fixture
    def cited_meat(self, seeded):
        """A judgment citing 食肉, which is BG-03 after the split and was BG-02
        before it. The row is what matters; the code is what moves."""
        from apps.judgment.models import Judgment, JudgmentCitation
        from apps.souls.models import Soul, SoulState
        from apps.tenants.models import Tenant

        tenant = Tenant.objects.get(code="CN_DIYU")
        soul = Soul.objects.create(
            name="食肉者", current_state=SoulState.JUDGING, tenant=tenant
        )
        judgment = Judgment.objects.create(
            soul=soul, civilization="CHINESE", tenant=tenant
        )
        meat = Statute.objects.get(code="CN-GGG-G-BG-03")
        assert meat.title_zh.endswith("食肉"), meat.title_zh
        citation = JudgmentCitation.objects.create(
            judgment=judgment, statute=meat, tenant=tenant
        )
        return citation, meat

    def test_a_citation_follows_its_article_across_the_rename(
        self, migration, registry_apps, cited_meat
    ):
        citation, meat = cited_meat

        migration.backwards(registry_apps, None)
        citation.refresh_from_db()
        assert citation.statute_id == meat.id
        assert citation.statute.code == "CN-GGG-G-BG-02", (
            "the reverse did not move 食肉 back to the code it had before the "
            "split"
        )
        assert citation.statute.title_zh.endswith("食肉"), (
            f"the citation now points at {citation.statute.title_zh} — this is "
            f"the silent repoint 0018 exists to prevent"
        )

        migration.forwards(registry_apps, None)
        citation.refresh_from_db()
        assert citation.statute_id == meat.id
        assert citation.statute.code == "CN-GGG-G-BG-03"
        assert citation.statute.title_zh.endswith("食肉")

    def test_the_reverse_drops_the_inserted_article_when_nothing_cites_it(
        self, migration, registry_apps, seeded
    ):
        assert Statute.all_objects.filter(code="CN-GGG-G-BG-02").exists()
        migration.backwards(registry_apps, None)
        remaining = sorted(
            Statute.all_objects.filter(code__startswith="CN-GGG-G-BG-").values_list(
                "code", flat=True
            )
        )
        assert remaining == [f"CN-GGG-G-BG-{n:02d}" for n in range(1, 6)], remaining
        assert Statute.all_objects.get(code="CN-GGG-G-BG-02").title_zh.endswith("食肉")

    def test_the_reverse_refuses_to_drop_a_cited_new_article(
        self, migration, registry_apps, seeded
    ):
        """Rolling back must not decide, on its own, that a recorded ground
        no longer exists. judgment/0012 made the same refusal."""
        from apps.judgment.models import Judgment, JudgmentCitation
        from apps.souls.models import Soul, SoulState
        from apps.tenants.models import Tenant

        tenant = Tenant.objects.get(code="CN_DIYU")
        soul = Soul.objects.create(
            name="注撰者", current_state=SoulState.JUDGING, tenant=tenant
        )
        judgment = Judgment.objects.create(
            soul=soul, civilization="CHINESE", tenant=tenant
        )
        JudgmentCitation.objects.create(
            judgment=judgment,
            statute=Statute.objects.get(code="CN-GGG-G-BG-02"),
            tenant=tenant,
        )

        with pytest.raises(RuntimeError, match="cited by a recorded judgment"):
            migration.backwards(registry_apps, None)

        assert Statute.all_objects.filter(code="CN-GGG-G-BG-02").exists()

    def test_it_writes_nothing_to_a_database_with_no_bugui_articles(
        self, migration, registry_apps, db
    ):
        assert Statute.all_objects.count() == 0
        migration.forwards(registry_apps, None)
        assert Statute.all_objects.count() == 0


def test_judgment_0013_round_trip(migration_round_trip):
    """forward -> reverse -> forward, compared as rows, through real `migrate`.

    The class above calls the migration's functions against the current
    registry, which says nothing about whether `manage.py migrate judgment 0012`
    works. This runs the graph. See tests/migration_roundtrip.py for why "the
    reverse ran" is not the assertion that matters.
    """
    from tests.migration_roundtrip import snapshot_rows

    codes = _migration_0013_codes()

    def seed(state):
        tenant = state.get_model("tenants", "Tenant")
        statute = state.get_model("judgment", "Statute")
        owner = tenant._base_manager.create(code="CN_DIYU", display_name="Diyu")
        # One withdrawn Chinese tombstone. It is what the migration reads the
        # tenant off — soft-deleted, so `_base_manager` is the only manager that
        # can see it, which is the whole reason the migration uses it — and its
        # survival across the round trip is the check that the reverse removes
        # only what the forward added.
        statute._base_manager.create(
            code="CN-HL-O01", civilization="CHINESE", corpus="HELL_LAW",
            ordinal=1, polarity="OFFENCE", title_zh="杀生",
            source="docs/11 §4.1", tenant=owner, is_deleted=True,
        )

    def snapshot(state):
        statute = state.get_model("judgment", "Statute")
        return snapshot_rows(
            statute._base_manager.select_related("tenant"),
            key="code",
            fields={
                "corpus": "corpus",
                "civilization": "civilization",
                "ordinal": "ordinal",
                "polarity": "polarity",
                "gate": lambda s: (s.payload_json or {}).get("gate"),
                "text_zh": "text_zh",
                "is_deleted": "is_deleted",
                "tenant": lambda s: s.tenant.code if s.tenant_id else None,
            },
            prefix="statute:",
        )

    def check_forward(state):
        rows = snapshot(state)
        missing = [code for code in codes if f"statute:{code}" not in rows]
        assert missing == [], f"the forward pass did not create {missing}"
        first = rows["statute:CN-GGG-F-JJ-01"]
        assert first["corpus"] == "GONGGUOGE"
        assert first["civilization"] == "CHINESE"
        assert first["polarity"] == "MERIT"
        assert first["ordinal"] == 1
        assert first["gate"] == "救濟門"
        assert first["tenant"] == "CN_DIYU", (
            f"the skeleton did not inherit the tenant of the Chinese sibling: {first}"
        )
        assert first["text_zh"] == "", "the migration wrote prose it does not own"
        # The 過律 half lands as OFFENCE, and the last article is the 73rd.
        assert rows["statute:CN-GGG-G-BG-05"]["polarity"] == "OFFENCE"
        assert rows["statute:CN-GGG-G-BG-05"]["ordinal"] == 73
        # HELL_LAW is not refilled, resurrected, or repointed by the forward.
        assert rows["statute:CN-HL-O01"]["corpus"] == "HELL_LAW"
        assert rows["statute:CN-HL-O01"]["is_deleted"] is True

    def check_reverse(state):
        rows = snapshot(state)
        left = sorted(code for code in codes if f"statute:{code}" in rows)
        assert left == [], f"the reverse left articles behind: {left}"
        assert "statute:CN-HL-O01" in rows, (
            "the reverse deleted the withdrawn tombstone — it removes what 0013 "
            "added, and 0012's world already had that row"
        )

    migration_round_trip(
        before=("judgment", "0012_withdraw_fabricated_statutes"),
        after=("judgment", "0013_gongguoge_corpus"),
        seed=seed,
        snapshot=snapshot,
        check_forward=check_forward,
        check_reverse=check_reverse,
    )
