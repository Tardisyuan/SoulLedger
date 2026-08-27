"""不軌門 becomes six articles, and the four that move keep their own rows.

《太微仙君功過格》's 不軌門 is titled 六條 and this corpus seeded five, merging
「傳教法，隱真出偽…」 and 「注撰煙粉傳記…」 into one article. The stated ground
was that both available transcriptions gave five segments. That was wrong about
ctext, and — as ctext's page-24 view shows — wrong about the woodblock:

    　　　不軌門〈六條〉          gate heading, indented, 六條 as 小字
    傳教法隱真出偽欺罔弟子一事為五過如     17 chars, flush at the top
    　受法信百錢為一過得人不傳為一過傳非   18, LEADING BLANK = continuation
    其人為十過                            5 chars — the column stops short
    注撰煙粉傳記詩詞歌行一篇為二過傳與     17, flush at the top
    　一人為二過簡編一篇為一過傳與一人為   18, leading blank = continuation
    　一過自己記念一篇為一過               12 — stops short
    食肉故殺性命食之為六過買肉食之為三     17, flush at the top

A new article starts flush at the head of a fresh column, a continuation column
carries a leading blank, and the column before a new article stops short. 食肉
is the control: nobody has ever doubted it is its own article, and it behaves
exactly as 注撰煙粉 does. gongguoge_entries.py carries the argument in full.

WHY THIS MIGRATION EXISTS AT ALL, WHEN SEEDING IS IDEMPOTENT. Because the codes
are positional and `_upsert` matches on `code`. Inserting an article at BG-02
pushes 食肉/飲酒/五辛/受觸 from BG-02..05 to BG-03..06, and reseeding alone would
have rewritten the CONTENT of each existing row in place: the row that has
always been 食肉 would come back reading 注撰煙粉. `JudgmentCitation.statute` is
a ForeignKey to that row, so every recorded citation of 食肉 would silently come
to cite 注撰煙粉 — with the surrounding prose still reading perfectly well,
which is the whole reason tests/test_gongguoge.py writes the BG codes out by
hand instead of generating them.

So the rows are renamed FIRST, descending so no two codes collide mid-flight,
and each article keeps the row it has always had. Seeding afterwards fills in
the one genuinely new row, BG-02.

REVERSING restores the five old codes and deletes the inserted BG-02 if it is
uncited. If it has been cited, the reverse refuses rather than orphaning a
citation — withdraw the row deliberately, the way judgment/0012 retired the
fabricated 冥律 articles, instead of letting a rollback do it silently.

The gate is now complete: 15 + 8 + 10 + 6 = 39 過, which is what 過律三十九條
says. Only 救濟門 is still short, and it stays short — 十二條 against eleven
segments, with no candidate split point that either transcription supports.
"""

from django.db import migrations

#: (old code, new code), descending so a rename never lands on a live code.
RENAMES = [
    ("CN-GGG-G-BG-05", "CN-GGG-G-BG-06"),
    ("CN-GGG-G-BG-04", "CN-GGG-G-BG-05"),
    ("CN-GGG-G-BG-03", "CN-GGG-G-BG-04"),
    ("CN-GGG-G-BG-02", "CN-GGG-G-BG-03"),
]

INSERTED = "CN-GGG-G-BG-02"


def _shift(statute_model, pairs, ordinal_delta):
    """Rename `pairs` and move each row's ordinal, on every row `_base_manager`
    can see — soft-deleted ones included, because a soft-deleted article still
    owns its citations and must not be left behind under a code that somebody
    else now answers to.
    """
    moved = 0
    for old_code, new_code in pairs:
        for row in statute_model._base_manager.filter(code=old_code):
            row.code = new_code
            row.ordinal = (row.ordinal or 0) + ordinal_delta
            payload = row.payload_json or {}
            gate_ordinal = payload.get("gate_ordinal")
            if isinstance(gate_ordinal, int):
                payload["gate_ordinal"] = gate_ordinal + ordinal_delta
                row.payload_json = payload
            row.save(update_fields=["code", "ordinal", "payload_json"])
            moved += 1
    return moved


def forwards(apps, schema_editor):
    Statute = apps.get_model("judgment", "Statute")
    # Empty database: nothing seeded yet, so there is nothing to renumber and
    # seed_mythology will write the six articles directly. Same guard as 0013.
    if not Statute._base_manager.filter(code__startswith="CN-GGG-G-BG-").exists():
        return
    _shift(Statute, RENAMES, +1)


def backwards(apps, schema_editor):
    Statute = apps.get_model("judgment", "Statute")
    JudgmentCitation = apps.get_model("judgment", "JudgmentCitation")

    inserted = list(
        Statute._base_manager.filter(code=INSERTED).values_list("pk", flat=True)
    )
    if JudgmentCitation._base_manager.filter(statute_id__in=inserted).exists():
        raise RuntimeError(
            f"{INSERTED} (注撰煙粉) is cited by a recorded judgment. "
            f"Reversing this migration would either orphan that citation "
            f"or repoint it at 食肉. Withdraw the article deliberately in "
            f"its own data migration first — see judgment/0012."
        )
    # `_base_manager.filter(...).delete()` and NOT `row.delete()`: Statute
    # soft-deletes on the instance method, which would leave the row — and its
    # unique (tenant, code) — sitting on CN-GGG-G-BG-02 while the rename below
    # tries to move 食肉 back onto it. judgment/0013's reverse deletes the same
    # way for the same reason.
    Statute._base_manager.filter(pk__in=inserted).delete()
    _shift(Statute, [(new, old) for old, new in reversed(RENAMES)], -1)


class Migration(migrations.Migration):
    dependencies = [("judgment", "0017_greek_corpora_and_procedure_polarity")]
    operations = [migrations.RunPython(forwards, backwards)]
