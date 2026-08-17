"""One being, several written names — recorded, not inferred.

What this is about
------------------
`apps/workflow/services.py`'s heart-weighing template calls its final node
「欧西里斯 · 终审」 and calls itself 「欧西里斯称重流程」. `seed_mythology`
spells the same god 「奥西里斯」. One Wsir, two current Chinese renderings, one
in each of two files.

`7fe9a28`'s backfill migration resolved that node to the Osiris row anyway — but
its own docstring said, in as many words, that the pairing was an inference from
the template's title and not something recorded anywhere, and asked the owner to
decide. The owner decided: keep both renderings, and make the correspondence
data.

So it is data now — `EGYPTIAN_ACTOR_ALIASES` -> `Actor.powers_json["aliases"]` —
and these tests are what stops it being decorative data that nothing reads.
They assert three separate things, because a green run on any one of them alone
would still leave the mapping resting on luck:

1. the alias reaches the database (`seed_mythology` writes it),
2. the live lookup reads it (`resolve_actor_by_any_name`, via
   `WorkflowService._resolve_approver`) and so does the frozen one
   (`workflow/0011::_find_actor`),
3. a node label naming a person resolves to the actor that node designates —
   which is the inference `workflow/0011` wrote in a comment, turned into an
   assertion that can go red.

And one guard the feature earns: aliases widen a namespace, so two rows could
now answer to one string. `test_no_two_actors_answer_to_the_same_written_name`
is the check that this has not happened, over the whole seeded cast rather than
over the two rows that have aliases today.
"""
import io

import pytest
from django.core.management import call_command

from apps.actors.models import ALIASES_KEY, Actor, resolve_actor_by_any_name
from apps.actors.mythology import CIVILIZATION_ACTOR_ALIASES, CIVILIZATION_DATA

# Hand-written, deliberately not imported from the seed table: importing it
# would make this a tautology that stays green after somebody deletes the
# alias. Same rule tests/test_seed_mythology.py states for the cast itself.
EXPECTED_ALIASES = {
    "EGYPTIAN": {
        # 「欧」 vs 「奥」 — the case this feature was built for.
        "Osiris": ["欧西里斯"],
        # ḥr transliterated two ways: `name_egy` is "Hor", and
        # scripts/populate_egyptian_actors.py writes "Heru".
        "Horus": ["Heru"],
    },
    "GREEK": {
        # `consolidate_eu_pantheon` merges a Pluto row into Hades and records
        # why (Plouton is a Greek cult title of Hades; Latin Pluto transcribes
        # it). That conclusion is now data rather than a tuple in a command.
        #
        # GREEK, not EUROPEAN. Hades moved when GREEK became its own
        # civilization, and the alias had to move with him: `_seed_actors` warns
        # and drops any alias naming an actor the cast it is seeding does not
        # contain, so an entry left behind in a European table would have
        # stopped reaching the database — silently, in the sense that the
        # resolver would simply go back to not knowing the name.
        "Hades": ["Pluto"],
    },
}


@pytest.fixture
def seeded(db):
    call_command("seed_mythology", stdout=io.StringIO())


def _egyptian():
    return Actor.all_objects.filter(civilization="EGYPTIAN")


def test_the_recorded_aliases_reach_the_database(seeded):
    """`seed_mythology` writes the alias table, not merely holds it.

    An alias that exists only as a Python literal resolves nothing: both
    readers below query the database.
    """
    for civilization, rows in EXPECTED_ALIASES.items():
        for name, expected in rows.items():
            actor = Actor.all_objects.get(civilization=civilization, name=name)
            assert actor.powers_json.get(ALIASES_KEY) == expected, (
                f"{civilization} {name}'s recorded aliases are "
                f"{actor.powers_json.get(ALIASES_KEY)!r}, expected {expected!r}"
            )
            assert actor.aliases() == expected


def test_an_actor_with_no_recorded_alias_has_none(seeded):
    """Absence is asserted too. `powers_json` defaults to `{}`, so a seeder
    that wrote aliases onto every row would still satisfy the test above."""
    anubis = Actor.all_objects.get(civilization="EGYPTIAN", name="Anubis")
    assert anubis.aliases() == [], (
        f"Anubis has aliases {anubis.aliases()!r} — nothing records a second "
        f"spelling for Inpw, and 阿努比斯 is already his name_zh"
    )


def test_the_lookup_resolves_every_recorded_name_to_one_row(seeded):
    """The live resolver, over the whole set of strings that denote a god.

    「奥西里斯」 (name_zh) and `Wsir` (name_egy) were reachable before, through
    a column. 「欧西里斯」 was not reachable at all — the reason the template
    worked was that the `actor` key beside the label happened to say `Osiris`.
    """
    for probe, expected in [
        ("Osiris", "Osiris"),        # name
        ("奥西里斯", "Osiris"),        # name_zh
        ("Wsir", "Osiris"),          # name_egy
        ("欧西里斯", "Osiris"),        # alias — the one this feature adds
        ("Horus", "Horus"),
        ("Hor", "Horus"),            # name_egy
        ("Heru", "Horus"),           # alias
    ]:
        found = resolve_actor_by_any_name(_egyptian(), probe)
        assert found is not None and found.name == expected, (
            f"{probe!r} resolved to {found.name if found else None!r}, "
            f"expected {expected!r}"
        )

    greek = Actor.all_objects.filter(civilization="GREEK")
    found = resolve_actor_by_any_name(greek, "Pluto")
    assert found is not None and found.name == "Hades", (
        f"'Pluto' resolved to {found.name if found else None!r}. No Pluto row "
        f"is seeded — consolidate_eu_pantheon merges it away — so the alias on "
        f"Hades is the only thing that can answer this."
    )
    # And absence on the other side of the split: every caller scopes the
    # resolver to one civilization, so an alias filed under the wrong one
    # answers nobody. Asserting only the positive above would stay green with
    # the entry duplicated into a European table nothing seeds from.
    european = Actor.all_objects.filter(civilization="EUROPEAN")
    assert resolve_actor_by_any_name(european, "Pluto") is None, (
        "'Pluto' resolved inside the EUROPEAN cast. Hades is GREEK; a European "
        "row answering to his cult title means the split left a duplicate "
        "behind."
    )


def test_an_unrecorded_spelling_still_resolves_to_nobody(seeded):
    """The resolver widened by exactly the recorded set and no further.

    Without this, "it found Osiris" would be satisfied by a lookup that
    fuzzy-matched, or that fell back to the only row of its role.
    """
    for probe in ("奧西里斯", "Ausar", "Usir", "Wsjr", ""):
        assert resolve_actor_by_any_name(_egyptian(), probe) is None, (
            f"{probe!r} is not a recorded name of anyone in this cast, but the "
            f"lookup resolved it"
        )


def test_no_two_actors_answer_to_the_same_written_name(seeded):
    """Aliases widen a namespace; this is the check that nothing collided.

    Scoped per civilization, which is how every caller scopes the lookup. A
    collision here would make `resolve_actor_by_any_name` return whichever row
    sorts first by `name` — a silent, stable, wrong answer.
    """
    collisions = []
    for civilization, _, _ in CIVILIZATION_DATA.values():
        owners: dict[str, set[str]] = {}
        for actor in Actor.all_objects.filter(civilization=civilization):
            for written in actor.written_names():
                owners.setdefault(written, set()).add(actor.name)
        collisions += [
            (civilization, written, sorted(names))
            for written, names in owners.items()
            if len(names) > 1
        ]
    assert collisions == [], (
        f"two actors answer to one written name: {collisions}. "
        f"resolve_actor_by_any_name would silently pick the first by `name`."
    )


def test_a_column_beats_an_alias(seeded):
    """Somebody's canonical name can never be captured by another row's alias.

    The resolver runs the four name columns first and the alias pass second.
    Without that ordering, an alias added to one row could quietly take over
    lookups for a god who is actually called that.
    """
    thoth = Actor.all_objects.get(civilization="EGYPTIAN", name="Thoth")
    ra = Actor.all_objects.get(civilization="EGYPTIAN", name="Ra")
    ra.powers_json = {ALIASES_KEY: ["Thoth"]}
    ra.save(update_fields=["powers_json"])

    found = resolve_actor_by_any_name(_egyptian(), "Thoth")
    assert found is not None and found.pk == thoth.pk, (
        f"'Thoth' resolved to {found.name if found else None!r} — an alias on "
        f"another row shadowed a canonical name"
    )


def test_the_alias_table_names_only_actors_that_exist():
    """An alias keyed on a name no row carries is silently never written.

    The seeder prints a warning for this (see `_seed_actors`); this is the
    assertion, so the typo fails a run rather than scrolling past in output
    nobody reads.
    """
    unknown = []
    for label, aliases in CIVILIZATION_ACTOR_ALIASES.items():
        cast = {row[0] for row in CIVILIZATION_DATA[label][2]}
        unknown += [f"{label}:{name}" for name in sorted(set(aliases) - cast)]
    assert unknown == [], f"alias table names actors no cast has: {unknown}"


def test_no_alias_duplicates_a_column_on_its_own_row():
    """An alias is an *other* spelling. One that repeats the row's own
    `name`/`name_zh`/`name_en`/`name_egy` buys nothing and reads as if the
    columns were insufficient."""
    redundant = []
    for label, aliases in CIVILIZATION_ACTOR_ALIASES.items():
        by_name = {row[0]: row for row in CIVILIZATION_DATA[label][2]}
        for name, forms in aliases.items():
            row = by_name.get(name)
            if row is None:
                continue
            columns = set(row[:4])  # name, name_zh, name_en, name_egy
            redundant += [f"{name}:{f}" for f in forms if f in columns]
    assert redundant == [], (
        f"aliases repeating a column on their own row: {redundant}"
    )


@pytest.mark.parametrize("resolver", ["live", "migration"])
def test_a_node_label_resolves_to_the_actor_that_node_designates(seeded, resolver):
    """The inference `workflow/0011` recorded in prose, as an assertion.

    Every backfillable node in `WORKFLOW_TEMPLATES` is labelled 「<person> ·
    <step>」 and separately carries an `actor` key. The migration's docstring
    said the two agree "按神格对应" — on the deity — and that this was an
    inference rather than data for the one node where the two spellings differ.
    Now the label must resolve, through the database, to the same row the
    `actor` key resolves to.

    Parametrised over both readers: the live `_resolve_approver` path and the
    frozen `_find_actor` inside the applied migration. They are two copies of
    the same rule, deliberately (a migration records what was true when it ran),
    and two copies with no comparison between them is what this repository's
    court numbering did to itself.
    """
    from importlib import import_module

    from apps.souls.models import CIVILIZATION_TENANT
    from apps.workflow.services import WORKFLOW_TEMPLATES

    find = (
        (lambda name, civ, tenant: resolve_actor_by_any_name(
            Actor._base_manager.filter(
                civilization=civ, tenant_id=tenant, is_deleted=False
            ),
            name,
        ))
        if resolver == "live"
        else (lambda name, civ, tenant: import_module(
            "apps.workflow.migrations.0011_backfill_ten_court_approvers"
        )._find_actor(Actor, name, civ, tenant))
    )

    from apps.tenants.models import Tenant

    checked = 0
    for (civilization, _case_type), template in WORKFLOW_TEMPLATES.items():
        tenant = Tenant.objects.get(code=CIVILIZATION_TENANT[civilization])
        for node in template["nodes"]:
            actor_key = node.get("actor")
            if not actor_key:
                continue
            label_person = node["name"].split(" · ")[0]

            designated = find(actor_key, civilization, tenant.pk)
            assert designated is not None, (
                f"node {node['name']!r} designates {actor_key!r}, who is not on "
                f"the {civilization} bench at all"
            )
            from_label = find(label_person, civilization, tenant.pk)
            assert from_label is not None, (
                f"node {node['name']!r} is labelled for {label_person!r} and "
                f"nothing in the database answers to that name. If it is "
                f"another rendering of {actor_key!r}, record it in "
                f"EGYPTIAN_ACTOR_ALIASES; do not rely on the `actor` key being "
                f"right by itself."
            )
            assert from_label.pk == designated.pk, (
                f"node {node['name']!r} is labelled for {label_person!r} "
                f"({from_label.name}) but designates {actor_key!r} "
                f"({designated.name}) — two different rows"
            )
            checked += 1

    # 13 -> 18 when `(EUROPEAN, APPEAL)` and `(EGYPTIAN, APPEAL)` were added to
    # WORKFLOW_TEMPLATES: 「Michael · 引领呈上」, 「Christ · 终审」, 「Isis · 受理」,
    # 「Nephthys · 复核」 and 「Osiris · 终审」 each name an approver, and each was
    # checked by the assertions above before this number was moved — the count
    # is the guard against templates *losing* their `actor` keys, not a cap on
    # how many may have them.
    assert checked == 18, (
        f"expected the 18 nodes that name an approver, checked {checked} — the "
        f"count is asserted so a template losing its `actor` keys cannot pass "
        f"this by having nothing to check"
    )
