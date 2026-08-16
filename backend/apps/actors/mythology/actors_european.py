"""The European cast — the Christian figures and the Greek ones.

Moved verbatim out of ``seed_mythology.py``. The tuple columns are the ones
documented at the top of ``actors_chinese.py``.

Cross-references in the comments below ("above", "below", "this file") were
written when every table in this package was one module; see the package
docstring in ``apps/actors/mythology/__init__.py``. Every table they name is
importable from that package.
"""
from apps.actors.models import ActorRole

# CHRISTIANITY HAS NO NAMED BENCH, AND THAT IS A FINDING, NOT A GAP.
#
# The other two civilizations in this file each supply a roster: ten kings for
# Diyu, forty-two assessors for the Hall of Two Truths. Europe has no such list
# and cannot be made to produce one. The last judgment in this theology has a
# single judge — Christ — with no jury, no division of labour and no assigned
# seats: John 5:22 ("the Father judgeth no man, but hath committed all judgment
# unto the Son"), the Nicene Creed's 「他将在荣耀中再来，审判活人死人」, and CCC
# 1021-1022 (particular judgment) and 1038-1041 (last judgment), which describe
# Christ coming in glory and separating the nations and introduce no second
# judging person. Angels appear at the judgment as gatherers and executors
# (Matt 13:41-42, 24:31, 25:31), never as adjudicators. The two passages that
# sound like a bench are not one: Matt 19:28 / Luke 22:30 seats the twelve
# apostles, but assigns them no dockets and no names, and 1 Cor 6:2-3 makes the
# subject "the saints" — everyone, not a closed list.
#
# So this slot is deliberately empty, and the emptiness is asserted by
# tests/test_seed_mythology.py::test_the_christian_side_seats_one_judge_and_no_bench
# rather than left to be noticed. That test is the point of this comment: an
# empty slot with nothing watching it is indistinguishable from an oversight,
# and the next person to notice the asymmetry will fill it.
#
# WHY IT MATTERS THAT NOBODY FILLS IT. This repo has already run the
# experiment. The forty-two assessors were, for a long time, thirty-five names
# that were not assessors — assembled because the template said a bench went
# there. Europe has been under the same pressure and answered it differently
# but not better: of eleven European actors seven are Greek and three of those
# were cast as judges, so Europe's bench was filled entirely by Greeks. Adding
# a Christian tribunal, or promoting Michael, or counting Minos as European, are
# all the same move. The correct answer to "who else judges" is that nobody
# does.
EUROPEAN_ACTORS = [
    ("God", "上帝", "God (YHWH)", "God", ActorRole.OVERSEER, "EU_HEAVEN",
     "全能者", "全能者", "The Almighty", "God",
     "Supreme deity. OVERSEER and not JUDGE: the row used to be cast as "
     "overseer while its own description called it the final judge of souls, "
     "and the judgment is committed to the Son (John 5:22). Whether the Trinity "
     "should be one row or three is a modelling question this seed does not "
     "answer; what it does answer is that the JUDGE slot points at Christ"),
    # THE JUDGE THE CREED NAMES WAS NOT IN THE DATABASE. Before this row,
    # `grep -i 'christ\|jesus\|基督\|耶稣'` matched nothing anywhere in the repo,
    # while John 5:22, Acts 10:42, Rom 14:10 / 2 Cor 5:10 (βῆμα τοῦ Χριστοῦ),
    # Matt 25:31-46, the Nicene Creed and CCC 1021-1041 all name Christ as the
    # one who judges the living and the dead. The European side had a judgment
    # system with its judge missing, and the JUDGE role handed instead to
    # Michael and to Satan, neither of whom judges anybody.
    ("Christ", "基督", "Christ", "Christos", ActorRole.JUDGE, "EU_HEAVEN",
     "审判活人死人者", "审判活人死人者", "Judge of the Living and the Dead", "Christos",
     "The judge of the last judgment, and the only one this theology has. "
     "John 5:22: the Father judges no one but has given all judgment to the "
     "Son. Nicene Creed: he will come again in glory to judge the living and "
     "the dead. CCC 1021-1022 makes even the particular judgment a referral of "
     "a life to Christ; CCC 1038-1041 has him separate the nations at the last. "
     "Catholic, Orthodox and Protestant readings agree on this point without "
     "reservation"),
    # Michael's role was JUDGE on the strength of "weighs souls at the heavenly
    # throne". Soul-weighing (psychostasis) is a medieval iconographic motif
    # that entered Christian art around the 4th century from Greek psychostasia,
    # itself from the Egyptian weighing of the heart that this same file seeds
    # on the Egyptian side — so the repo had Michael performing Anubis' job,
    # borrowed twice over. Neither scripture nor doctrine connects him to a
    # balance. What does have a text is leading: the Offertory of the Roman
    # Requiem, *sed signifer sanctus Michael repraesentet eas in lucem sanctam*
    # — "let the standard-bearer Saint Michael bring them into the holy light".
    # A standard-bearer who brings souls in is CONDUIT.
    ("Michael", "米迦勒", "Archangel Michael", "Mikael", ActorRole.CONDUIT, "EU_HEAVEN",
     "掌旗者圣米迦勒", "掌旗者圣米迦勒", "Michael the Standard-Bearer", "Mikael",
     "Leads souls into the light: *signifer sanctus Michael repraesentet eas in "
     "lucem sanctam*, Offertory of the Roman Requiem. Captain of the heavenly "
     "host (Rev 12:7; Dan 10:13, 12:1; Jude 9). He does NOT weigh souls — that "
     "image is medieval iconography borrowed from Egyptian psychostasia, not "
     "scripture and not doctrine, and it is why this row used to be a JUDGE"),
    ("Gabriel", "加百列", "Archangel Gabriel", "Gabrielle", ActorRole.CONDUIT, "EU_HEAVEN",
     "加百列", "加百列", "Archangel Gabriel", "Gabrielle",
     "Messenger angel - carries announcements to the living (Dan 8:16, 9:21; "
     "Luke 1:11-20, 1:26-38). CONDUIT in the sense of bearing word, not of "
     "escorting the dead: 'guides souls to judgment and heaven' was Michael's "
     "office (see above) written onto Gabriel, and the last-trumpet image "
     "attached to him is Islamic and later folk tradition, not biblical"),
    # Satan was cast as JUDGE, which neither tradition supports. In theology he
    # is the accuser — ὁ κατήγωρ, "the accuser of our brethren" (Rev 12:10), the
    # prosecuting figure of Job 1-2 — and he is himself judged (Rev 20:10). In
    # Dante he is not an agent at all: Inferno XXXIV has him frozen to the chest
    # in Cocytus chewing Judas, Brutus and Cassius, an instrument of punishment
    # rather than anyone who decides anything. EXECUTOR is the closest of the
    # five roles to both readings; ActorRole has no ACCUSER and adding one for a
    # single row would be a migration this correction does not need.
    ("Satan", "撒旦", "Satan", "Satan", ActorRole.EXECUTOR, "EU_HELL_9TH",
     "堕落者撒旦", "堕落者撒旦", "Satan - Adversary", "Satan",
     "The adversary. Accuser rather than judge in theology (Rev 12:10 ὁ "
     "κατήγωρ; Job 1-2), and himself the object of judgment (Rev 20:10). In "
     "Dante he is the punishment itself, frozen in Cocytus at the bottom of the "
     "ninth circle with three mouths (Inferno XXXIV) - he sentences nobody"),
    # Charon was in Purgatory, which is wrong in both traditions at once. The
    # Greek Charon works the entrance to the underworld; Dante's Charon works
    # Acheron at the gate of hell (Inferno III), and Dante's *purgatorial*
    # boatman is an angel (Purgatorio II), so there is no reading in which the
    # ferryman of the dead belongs on the mountain of penance. The title also
    # said Styx, which is the Roman poets' river and contradicts this repo's own
    # docs/04; Virgil, Aeneid 6.295-297 and Dante both put him on Acheron.
    ("Charon", "卡戎", "Charon", "Kharos", ActorRole.CONDUIT, "EU_ACHERON",
     "冥河渡神卡戎", "冥河渡神卡戎", "Charon - Ferryman of Acheron", "Kharos",
     "Ferryman of Acheron - takes the dead across at the threshold of the "
     "underworld (Virgil, Aeneid 6.295-297; Dante, Inferno III; Euripides, "
     "Alcestis 252-256 has the same crossing as a lake). Roman poets often "
     "write Styx for the river, which is where this row's old title came from"),
    # Minos was in the ninth circle with a description of second-circle work:
    # "judge in the ninth circle, assigns souls to their hell-circle". Assigning
    # the circle is exactly what Dante's Minos does, and he does it at the
    # entrance to the second, where the sinner confesses and he coils his tail
    # the number of times equal to the circle it belongs in (Inferno V.4-15). A
    # judge who allots circles cannot be sitting in the last one.
    ("Minos", "米诺斯", "Minos", "Mino", ActorRole.JUDGE, "EU_HELL_2ND",
     "米诺斯", "米诺斯", "Judge Minos", "Mino",
     "King Minos - stands at the entrance to the second circle, hears each "
     "soul's confession and allots it the circle it belongs to by the coils of "
     "his tail (Dante, Inferno V.4-15). THIS ROW IS DANTE'S MINOS. Plato's "
     "Minos, Gorgias 524a, is the final arbiter at the fork when the other two "
     "judges are in doubt, and Homer's, Odyssey 11.568-571, gives judgment "
     "sceptre in hand; those are different offices in different underworlds"),
    ("Cerberus", "刻耳柏洛斯", "Cerberus", "Kerberos", ActorRole.GUARDIAN, "EU_HELL_3RD",
     "冥界三头犬刻耳柏洛斯", "冥界三头犬刻耳柏洛斯", "Cerberus - Three-headed Hound", "Kerberos",
     "Three-headed hound - Dante sets him over the gluttons in the third "
     "circle, barking with his three gullets over the souls in the freezing "
     "rain (Inferno VI); in the Greek tradition he keeps the gate of the "
     "underworld itself (Apollodorus 2.5.12). He was seeded in the first "
     "circle, which is neither. Hesiod's earliest description gives him fifty "
     "heads (Theogony 311-312); the three are Apollodorus, Virgil and Dante"),
    # Greco-Roman side. `consolidate_eu_pantheon` audits exactly this cast —
    # Hades sole OVERSEER, Minos/Aeacus/Rhadamanthus JUDGE, Charon CONDUIT,
    # Cerberus GUARDIAN — so it has to be seeded, or that audit reports every
    # name MISSING on a fresh database.
    #
    # Hades, not Pluto: same god, and `consolidate_eu_pantheon` merges the pair
    # into Hades. Pluto is therefore deliberately NOT seeded — it only exists in
    # databases predating that command, which is exactly the case the merge step
    # is there to clean up. Seeding both would manufacture on every fresh
    # database the duplicate the merge exists to remove.
    #
    # The reason recorded for that merge used to be "Pluto is Hades' Roman
    # name", which is a simplification that gets the direction wrong. Πλούτων
    # (Plouton) is a GREEK cult title, absent from Homer and Hesiod and current
    # from the 5th century BCE through the Eleusinian mysteries, from πλοῦτος,
    # wealth — Plato, Cratylus 403a has people avoid the name Hades and say
    # Plouton instead, because wealth comes up out of the earth. Pluto is the
    # Latin transcription of that Greek title. Rome's own underworld gods are
    # Dis Pater and Orcus; Cicero equates Dis with Plouton. So the merge folds
    # two cult aspects of one Greek god, not a Greek name and a Roman one.
    #
    # WHERE HADES SITS IS AN ENGINEERING PLACEMENT AND IS LABELLED AS ONE. He
    # was in EU_HELL_1ST, Limbo, which has no basis at all — Dante has no
    # "Hades' level", and the Dis of the Commedia is the walled city of the
    # sixth circle and Lucifer himself. This system models no house of Hades, so
    # he is seated as overseer of the Greek judgment ground below, the only
    # Greek place here that is his. That is a compromise, exactly like the one
    # recorded above for 地藏王菩萨, and not a claim from a text.
    ("Hades", "哈迪斯", "Hades", "Aides", ActorRole.OVERSEER, "EU_PLATO_MEADOW",
     "冥王哈迪斯", "冥王哈迪斯", "Hades - Lord of the Underworld", "Aides",
     "Greek god of the underworld - sole overseer of the Greco-Roman infernal "
     "realm. Also Plouton (Πλούτων), a Greek cult title from πλοῦτος 'wealth' "
     "(Plato, Cratylus 403a), of which Latin Pluto is the transcription; Rome's "
     "native underworld gods are Dis Pater and Orcus. PLACEMENT IS AN "
     "ENGINEERING CHOICE: no house of Hades is modelled here, so he oversees "
     "the judgment ground rather than being given one of Dante's circles"),
    # AEACUS AND RHADAMANTHUS ARE NOT IN THE COMMEDIA, WHICH IS WHY THEY HAVE
    # THEIR OWN PLACE NOW. Both used to sit in EU_HELL_9TH — Dante's frozen
    # Cocytus, where this file also seeds Satan — and they are wrong there twice
    # over. Dante borrows one Greek judge, Minos, and neither of these two
    # appears in the poem at all; and Plato, who is where the three-judge
    # division of labour comes from, sets the judgment at a fork in a meadow
    # with one road to the Isles of the Blessed and one to Tartarus. That is a
    # sorting point *before* punishment. A ninth circle is not a place Plato's
    # cosmology contains — the layering is Dante's.
    #
    # The division of labour is Gorgias 524a (Rhadamanthus tries those from
    # Asia, Aeacus those from Europe, Minos decides when they are in doubt).
    # Note 524a, not 523e: 523e is Zeus announcing the reform, and the
    # assignment of the three is the passage after it.
    #
    # Their two destinations are still not modelled and are deliberately not
    # invented. EU_PLATO_MEADOW is the ground they judge on and nothing more.
    ("Aeacus", "艾亚哥斯", "Aeacus", "Aiakos", ActorRole.JUDGE, "EU_PLATO_MEADOW",
     "冥界判官艾亚哥斯", "冥界判官艾亚哥斯", "Judge Aeacus", "Aiakos",
     "One of the three judges of the dead - tries those who come from Europe "
     "(Plato, Gorgias 524a) and holds the keys of the underworld (Pindar, "
     "Isthmian 7.47; Apollodorus 3.12.6). Son of Zeus and the nymph Aegina, and "
     "grandfather of Achilles. He does not appear in Dante"),
    ("Rhadamanthus", "拉达曼提斯", "Rhadamanthus", "Rhadamanthys", ActorRole.JUDGE,
     "EU_PLATO_MEADOW",
     "冥界判官拉达曼提斯", "冥界判官拉达曼提斯", "Judge Rhadamanthus", "Rhadamanthys",
     "One of the three judges of the dead - tries those who come from Asia "
     "(Plato, Gorgias 524a). Homer instead has him living in Elysium rather "
     "than judging (Odyssey 4.563-565) and Virgil has him ruling and punishing "
     "in Tartarus (Aeneid 6.566); the brotherhood with Minos is usually cited "
     "to Iliad 14.321-322, which has not been checked line by line here. He "
     "does not appear in Dante"),
    # THE TWO STREAMS OF THE EARTHLY PARADISE, AND WHY THEY ARE BOTH HERE.
    #
    # `79dee57` corrected what Lethe *means*: the row used to say souls drink to
    # forget their past lives, which is Virgil's Lethe (Aen. 6.703ff), drunk
    # before rebirth by souls who are going round again — and Dante's Purgatory
    # has no rebirth in it at all. His Lethe takes away the memory of sin and
    # nothing else. That fix left two things undone, and this is them.
    #
    # FIRST, THE REALM. Lethe used to stand on `EU_PURGATORY`, the whole
    # mountain, which is Dante's placement only if you read "Mount Purgatory" as
    # a point rather than a climb: the water is at the *summit*, in the Earthly
    # Paradise above the seventh terrace, and a soul reaches it after the
    # penance rather than during it. Both rows stand on `EU_EARTHLY_PARADISE`.
    #
    # SECOND, EUNOE. Dante's two streams are a pair and the pairing is the
    # point — Matelda describes them together in Purg. XXVIII, one
    # taking away the memory of sin and the other giving back the memory of good
    # done, and Dante is put through both (Lethe in XXXI, Eunoè last of all in
    # XXXIII) before he can rise. Seeding Lethe alone left the system asserting
    # the classical river under a Dantean address, because Eunoè is exactly the
    # thing the classical corpus does not have: Dante invented her, and the name
    # (Gk. εὖ νόος, "good mind") is his coinage. Half the pair reads as the
    # Greek Lethe; the pair reads as Dante's.
    #
    # BOTH ARE CONDUIT, and deliberately the same role. `ActorRole.CONDUIT` is
    # "Soul Conduit / Guide" — the thing a soul is carried through on its way
    # somewhere — which is what each of these is: neither weighs anything
    # (JUDGE), bars anything (GUARDIAN), inflicts anything (EXECUTOR) or
    # administers anything (OVERSEER), and the crossing is one passage with two
    # halves rather than two unrelated events. That their *effects* run opposite
    # ways — one erases, one restores — is not a role distinction, because
    # `ActorRole` names an actor's function in a soul's transit and has no
    # vocabulary for the direction of an effect. Giving Eunoè a different role
    # to express "restores rather than erases" would encode that difference in
    # the one column that does not mean it, and would split a pair the source
    # states in a single sentence.
    ("Lethe", "忘川", "River Lethe", "Lethe", ActorRole.CONDUIT,
     "EU_EARTHLY_PARADISE",
     "忘川河神", "忘川河神", "Lethe - River of Forgetfulness", "Lethe",
     "Spirit of the river Lethe - at the summit of Mount Purgatory the souls "
     "who have finished their penance are drawn through it and lose the memory "
     "of their sins (Dante, Purgatorio XXVIII, XXXI). Not Virgil's Lethe, drunk "
     "before rebirth to forget a whole past life (Aeneid 6.703ff): that one "
     "belongs to a cosmology with reincarnation in it, and this one does not. "
     "Dante pairs it with Eunoe, which stands in the same realm"),
    # `name_zh` is a transliteration and is labelled as one. 忘川 is a received
    # Chinese term with its own history; Eunoè has no counterpart because the
    # river is Dante's invention, so 「欧诺埃河」 is this repository writing the
    # Greek down in Chinese characters and not a rendering with a source behind
    # it. Whoever knows what the standard 神曲 translations use should replace it
    # and say which translation.
    ("Eunoe", "欧诺埃河", "River Eunoe", "Eunoe", ActorRole.CONDUIT,
     "EU_EARTHLY_PARADISE",
     "欧诺埃河神", "欧诺埃河神", "Eunoe - River of Good Remembrance", "Eunoe",
     "Spirit of the river Eunoe, the second of the two streams of the Earthly "
     "Paradise: a soul drinks from it after Lethe and the memory of the good it "
     "did is given back, after which it is 'pure and ready to rise to the "
     "stars' (Dante, Purgatorio XXVIII, XXXIII). Dante's own "
     "invention — no classical source has this river, and the name is his, from "
     "Gk. eu-noos, 'good mind'. It is seeded because Lethe without it reads as "
     "the Greek river of forgetting under a Christian address; the pair is what "
     "makes the placement Dante's"),
]

# --------------------------------------------------------------------------
# OTHER RENDERINGS OF THESE NAMES THAT THIS REPOSITORY ACTUALLY USES.
#
# Same table and same rules as EGYPTIAN_ACTOR_ALIASES — read its header for what
# qualifies and why this is not a fifth name column.
EUROPEAN_ACTOR_ALIASES = {
    # `Πλούτων`/`Pluto` and `Hades` are one god, and this repository had already
    # concluded so before this table existed: `consolidate_eu_pantheon` merges a
    # `Pluto` row into `Hades`, and the Hades row above records the reasoning
    # (Plouton is a Greek cult title from πλοῦτος, wealth — Plato, Cratylus
    # 403a — of which Latin Pluto is a transcription; Rome's own underworld gods
    # are Dis Pater and Orcus). What that conclusion did not have was anywhere
    # to live except a management command's `MERGE_NAMES` tuple and a comment.
    # It lives here now, so a lookup handed "Pluto" finds Hades on the strength
    # of recorded data rather than because somebody remembered to run a merge.
    #
    # Recording the alias does NOT resurrect Pluto and does not change what
    # `consolidate_eu_pantheon` does: that command matches on `name` exactly, no
    # Pluto row is seeded, and on a legacy database that still has one the
    # resolver's column pass finds it before this alias is ever consulted.
    "Hades": ["Pluto"],
}
