"""The Greek cast — Plato's three judges and the lord of the underworld.

Split out of ``actors_european.py``, which used to hold both the Christian
figures and the Greek ones under a single ``EUROPEAN`` civilization. The tuple
columns are the ones documented at the top of ``actors_chinese.py``.

WHAT MOVED AND WHAT DID NOT, AND WHY THE LINE FALLS WHERE IT DOES.

Three rows moved here unchanged except for their civilization and tenant —
Hades, Aeacus and Rhadamanthus. All three already stood in ``EU_PLATO_MEADOW``,
Plato's fork in the road, and two of them carry a sentence in their own
descriptions that decides the question: *He does not appear in Dante.* A row
whose text says it is not in the European corpus was only ever EUROPEAN because
there was nowhere else to file it.

Three rows deliberately stayed behind in ``actors_european.py`` — Minos,
Cerberus and Charon — because every anchor their rows actually cite is Dante's.
Minos allots the circle from the entrance to the second (Inf. V.4-15), Cerberus
stands over the gluttons in the third (Inf. VI), Charon works Acheron at the
gate of hell (Inf. III). They are Greek figures Dante borrowed, and what this
system holds of them is the borrowing. Moving them would have emptied the
European hell of everything except Satan on the argument that the names sound
Greek — which is the same "count by ethnicity" move that produced the finding
in the first place.

WHY THERE ARE TWO MINOSES, AND WHY THAT IS NOT A DUPLICATE ROW.

``actors_european.py``'s Minos comment has said this all along: Dante's Minos,
Plato's Minos (Gorgias 524a) and Homer's Minos (Odyssey 11.568-571) are
"different offices in different underworlds". Dante's coils his tail to name a
circle in a nine-level hell; Plato's is the final arbiter at a two-way fork,
consulted when the other two judges are in doubt, in a cosmology that has no
levels at all. Two offices, two texts, two rows — matched on
``(name, civilization)`` by the seeder and by
``unique_actor_tenant_civ_name``, so they are distinct rows by construction
rather than by luck.

THIS IS THE ONLY NEW NAME, AND THE BAR IT HAD TO CLEAR. Nothing else was added
while writing this table, and the gaps are real: Plato's fork needs no fourth
judge, Persephone is not seeded, the five rivers are not seeded, and Thanatos
and Hypnos are not seeded. The rule this repository learned from the forty-two
assessors — thirty-five of whom were names assembled because the template said
a bench went there — is that a slot does not justify a row. Plato's Minos
qualifies because a sourced passage names him doing a specific job that the
existing Minos row explicitly disclaims, not because the Greek bench looked
short by one.
"""
from apps.actors.models import ActorRole

GREEK_ACTORS = [
    # WHERE HADES SITS IS AN ENGINEERING PLACEMENT AND IS LABELLED AS ONE. He
    # was in EU_HELL_1ST, Limbo, which has no basis at all — Dante has no
    # "Hades' level", and the Dis of the Commedia is the walled city of the
    # sixth circle and Lucifer himself. This system models no house of Hades, so
    # he is seated as overseer of the Greek judgment ground, the only Greek
    # place here that is his. That is a compromise, exactly like the one
    # recorded for 地藏王菩萨, and not a claim from a text.
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
    ("Hades", "哈迪斯", "Hades", "Aides", ActorRole.OVERSEER, "EU_PLATO_MEADOW",
     "冥王哈迪斯", "冥王哈迪斯", "Hades - Lord of the Underworld", "Aides",
     "Greek god of the underworld - sole overseer of the Greek infernal "
     "realm. Also Plouton (Πλούτων), a Greek cult title from πλοῦτος 'wealth' "
     "(Plato, Cratylus 403a), of which Latin Pluto is the transcription; Rome's "
     "native underworld gods are Dis Pater and Orcus. PLACEMENT IS AN "
     "ENGINEERING CHOICE: no house of Hades is modelled here, so he oversees "
     "the judgment ground rather than being given one of Dante's circles"),
    # AEACUS AND RHADAMANTHUS ARE NOT IN THE COMMEDIA, WHICH IS WHY THEY HAVE
    # THEIR OWN PLACE — AND, SINCE THE SPLIT, THEIR OWN COSMOLOGY. Both used to
    # sit in EU_HELL_9TH — Dante's frozen Cocytus, where actors_european.py also
    # seeds Satan — and they were wrong there twice over. Dante borrows one
    # Greek judge, Minos, and neither of these two appears in the poem at all;
    # and Plato, who is where the three-judge division of labour comes from,
    # sets the judgment at a fork in a meadow with one road to the Isles of the
    # Blessed and one to Tartarus. That is a sorting point *before* punishment.
    # A ninth circle is not a place Plato's cosmology contains — the layering is
    # Dante's.
    #
    # The division of labour is Gorgias 524a (Rhadamanthus tries those from
    # Asia, Aeacus those from Europe, Minos decides when they are in doubt).
    # Note 524a, not 523e: 523e is Zeus announcing the reform, and the
    # assignment of the three is the passage after it.
    #
    # Their two destinations are modelled now — GR_ISLES_OF_THE_BLESSED and
    # GR_TARTARUS — because the same sentence of 524a names them. Nothing else
    # of the geography was invented to go with them; see GREEK_REALMS.
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
    # PLATO'S MINOS. The only row this table adds that did not already exist
    # somewhere, and the justification is the Dante row's own words: the two are
    # "different offices in different underworlds".
    #
    # The office here is *final arbiter*, and it is a narrow one. Gorgias 524a
    # gives Rhadamanthus and Aeacus the two standing dockets and gives Minos
    # τὴν δίκην τὴν τελευταίαν κρινεῖν — the deciding vote when the other two are
    # in doubt. He is not a first instance and he is not a supervisor: nothing in
    # the passage routes an ordinary soul past him. That is why the frontend's
    # old EUROPEAN_GREEK preset (Minos 初审 → Aeacus 复核 → Rhadamanthus 终审)
    # was recorded as wrong in docs/lore-verification/verify-greek.md §3 — it
    # inverts the one thing the passage is specific about — and why nothing here
    # promotes him to OVERSEER to express seniority. ActorRole.OVERSEER is
    # administration, Hades holds it, and a tie-breaking judge is a JUDGE.
    #
    # Homer's Minos, Odyssey 11.568-571, is a third office again — sole
    # judgment, sceptre in hand, with no moral sorting anywhere in the poem —
    # and is deliberately NOT seeded. One sourced office per row is the rule
    # this table follows; a third Minos would need a third realm to stand in,
    # and Homer's house of Hades is not modelled here.
    ("Charon", "卡戎", "Charon", "Kharon", ActorRole.CONDUIT, "GR_ACHERON",
     "冥河摆渡人卡戎", "冥河摆渡人卡戎", "Charon - Ferryman of Acheron", "Kharon",
     "THIS ROW IS THE GREEK CHARON, not Dante's. He carries the buried dead "
     "across Acheron before any judging happens, and turns back the unburied to "
     "wander the bank a hundred years (Virgil, Aeneid 6.295-330). The office is "
     "attested in Greek before Virgil fixes its place on the map: Euripides has "
     "him calling from the lake with his hand on the oar (Alcestis 252-256) and "
     "Aristophanes has him working the crossing and shouting the stops (Frogs "
     "180-270). A separate EUROPEAN row carries Dante's Charon, who ferries "
     "across Acheron at the gate of hell and whose passengers are already "
     "damned (Inferno III.82-99) — the same figure in a cosmology where the "
     "crossing comes after the sentence rather than before the trial. Homer has "
     "no ferryman at all (Odyssey 11 has the dead simply present), which is why "
     "no third row exists. CONDUIT and not GUARDIAN: he carries, he does not "
     "decide — the refusal of the unburied is a rule he applies, not a verdict "
     "he reaches"),
    ("Minos", "米诺斯", "Minos", "Mino", ActorRole.JUDGE, "EU_PLATO_MEADOW",
     "终裁判官米诺斯", "终裁判官米诺斯", "Minos - Final Arbiter", "Mino",
     "THIS ROW IS PLATO'S MINOS, not Dante's. At the fork in the meadow "
     "Rhadamanthus tries those who come from Asia and Aeacus those from Europe; "
     "Minos holds the privilege of the final decision, exercised when the other "
     "two are in doubt (Plato, Gorgias 524a). A separate EUROPEAN row carries "
     "Dante's Minos, who coils his tail at the entrance to the second circle to "
     "name the circle a soul belongs in (Inferno V.4-15) — a different office in "
     "a different underworld, in a cosmology that has levels where this one has "
     "a fork. Homer's Minos (Odyssey 11.568-571) is a third office and is not "
     "seeded"),
]

# --------------------------------------------------------------------------
# OTHER RENDERINGS OF THESE NAMES THAT THIS REPOSITORY ACTUALLY USES.
#
# Same table and same rules as EGYPTIAN_ACTOR_ALIASES — read its header for what
# qualifies and why this is not a fifth name column.
GREEK_ACTOR_ALIASES = {
    # Moved here with the Hades row it names. `Πλούτων`/`Pluto` and `Hades` are
    # one god, and this repository had already concluded so before this table
    # existed: `consolidate_eu_pantheon` merges a `Pluto` row into `Hades`, and
    # the Hades row above records the reasoning (Plouton is a Greek cult title
    # from πλοῦτος, wealth — Plato, Cratylus 403a — of which Latin Pluto is a
    # transcription; Rome's own underworld gods are Dis Pater and Orcus). What
    # that conclusion did not have was anywhere to live except a management
    # command's `MERGE_NAMES` tuple and a comment. It lives here now, so a
    # lookup handed "Pluto" finds Hades on the strength of recorded data rather
    # than because somebody remembered to run a merge.
    #
    # It had to move with the row rather than stay behind: `_seed_actors` warns
    # and drops any alias naming an actor the cast it is seeding does not
    # contain, so a `Hades` entry left in EUROPEAN_ACTOR_ALIASES would have
    # stopped being written the moment Hades became GREEK — silently, in the
    # sense that the alias simply would not exist and the lookup it serves would
    # fall through to the behaviour it was meant to replace.
    #
    # Recording the alias does NOT resurrect Pluto and does not change what
    # `consolidate_eu_pantheon` does: that command matches on `name` exactly, no
    # Pluto row is seeded, and on a legacy database that still has one the
    # resolver's column pass finds it before this alias is ever consulted.
    "Hades": ["Pluto"],
}
