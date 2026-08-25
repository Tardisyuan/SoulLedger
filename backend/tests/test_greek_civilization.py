"""GREEK as the fourth civilization: what moved, what did not, and both ways.

Why this file exists
--------------------
The Greek cosmology was filed under ``EUROPEAN`` because ``Civilization`` had
three members and that was the only slot. Nothing in the data looked wrong —
Hades, Aeacus and Rhadamanthus stood in ``EU_PLATO_MEADOW``, which is Plato's
fork in the road and exactly where Gorgias 524a puts them — and that is the
whole difficulty: the defect lived in one column, on rows that were otherwise
correct, and every check in the repository was green over it.

What the column decides is not taxonomy:

* ``Soul.civilization`` is derived from the soul's tenant through
  ``TENANT_CIVILIZATION``, so a Greek row under ``EU_HEAVEN_HELL`` belongs to
  the tenant whose other rows are the Nicene Creed's judgment and Dante's nine
  circles.
* the ledger reading follows the civilization, so a Greek soul read as European
  is handed *culpa* and *poena* — guilt and the penalty remaining after
  absolution — when Plato's instrument is a term served (Republic X, 615a-b).

So the assertions here are about a column, and they are written to fail if the
change is half-applied in either direction: seed tables moved without
``realms/0018``, or the migration applied against seed tables that still say
EUROPEAN.

The rules
---------
1. **The expectations are hand-written.** Nothing here imports the seed tables;
   importing them would make every assertion a tautology that survives the data
   being moved back.
2. **Absence is asserted as well as presence.** "Hades is GREEK" stays green
   while a second Hades sits in EUROPEAN, and "the meadow is GREEK" stays green
   while Charon's crossing is dragged along with it — so both negatives are
   checked by name.
3. **The migrations are compared as data, not as exit status.** See
   ``tests/migration_roundtrip.py`` for why: ``realms/0012``'s reverse ran
   cleanly and destroyed five rows.
"""
import io

import pytest
from django.core.management import call_command

from apps.actors.models import Actor
from apps.org.models import Organization
from apps.realms.models import Realm
from apps.souls.models import Civilization, Soul, SoulState
from apps.tenants.models import Tenant

GREEK_TENANT_CODE = "GR_HADES"
EUROPEAN_TENANT_CODE = "EU_HEAVEN_HELL"

MEADOW = "EU_PLATO_MEADOW"
ISLES = "GR_ISLES_OF_THE_BLESSED"
TARTARUS = "GR_TARTARUS"
#: The crossing, added when the basis became Gorgias plus Aeneid 6. Not a move:
#: `EU_ACHERON` and Dante's Charon stay EUROPEAN exactly as realms/0018 argues,
#: and this is a second row for the same figure under the other poem — the move
#: that migration already made for Minos.
ACHERON = "GR_ACHERON"

#: The three rows that moved out of EUROPEAN, and the two that were added.
#: Written out rather than derived, per rule 1.
MOVED_ACTORS = ["Aeacus", "Hades", "Rhadamanthus"]
#: Plato's Minos, added by the split. The Greek Charon, added by the basis
#: change — both are second rows beside a EUROPEAN one holding Dante's reading
#: of the same name, and neither took anything away from it.
ADDED_ACTORS = ["Minos", "Charon"]

#: The three the split deliberately left behind, because every anchor their
#: rows cite is Dante's rather than a Greek author's.
DANTE_BORROWED = ["Cerberus", "Charon", "Minos"]


@pytest.fixture
def seeded(db):
    out = io.StringIO()
    call_command("seed_mythology", stdout=out, stderr=out)
    return out.getvalue()


# --------------------------------------------------------------------------
# 1. The tenant, without which the enum member is unreachable
# --------------------------------------------------------------------------


@pytest.mark.django_db
def test_the_greek_tenant_exists_and_a_soul_in_it_reads_greek(seeded):
    """The load-bearing half of "GREEK is a civilization" rather than a label.

    `Soul.civilization` is a property derived from the tenant code and from
    nothing else. Without a `GR_HADES` row in `TENANT_CIVILIZATION` and in the
    database, no soul could ever read GREEK — the enum member, its ledger
    reading, its case types and its realm rows would all be unreachable code
    that no test could tell apart from working code.
    """
    tenant = Tenant.objects.filter(code=GREEK_TENANT_CODE).first()
    assert tenant is not None, (
        f"seed_mythology did not create the {GREEK_TENANT_CODE} tenant. Every "
        f"Greek row would then be owned by nobody, and no soul could read GREEK."
    )

    soul = Soul.objects.create(
        name="岔路口的亡魂", current_state=SoulState.JUDGING,
        death_year=2000, tenant=tenant,
    )
    assert soul.civilization == Civilization.GREEK, (
        f"a soul in {GREEK_TENANT_CODE} reads civilization "
        f"{soul.civilization!r}. TENANT_CIVILIZATION is the only thing that "
        f"decides this, so GREEK is not wired to a tenant."
    )


# --------------------------------------------------------------------------
# 2. The rows that moved, and the rows that did not
# --------------------------------------------------------------------------


@pytest.mark.django_db
def test_the_greek_actors_are_greek_and_are_not_also_european(seeded):
    """Both directions, because a copy left behind is invisible from one side.

    `seed_mythology` matches on `(name, civilization)`, so a table that listed
    Hades under both civilizations would create *two* Hades rows and every
    "Hades is GREEK" assertion would still pass — while
    `consolidate_eu_pantheon` found two OVERSEERs and the resolver had two rows
    answering to one name.
    """
    greek = sorted(
        Actor.objects.filter(civilization="GREEK").values_list("name", flat=True)
    )
    assert greek == sorted([*MOVED_ACTORS, *ADDED_ACTORS]), (
        f"the GREEK cast is {greek}. Expected Hades, Aeacus, Rhadamanthus — "
        f"who moved out of EUROPEAN, two of them carrying 'He does not appear "
        f"in Dante' in their own descriptions — plus Plato's Minos, added by "
        f"the split, and the Greek Charon, added when the basis became Gorgias "
        f"plus Aeneid 6. Anyone else was invented; anyone missing means the "
        f"move did not reach the database. Note what the two additions have in "
        f"common: each is a SECOND row beside a EUROPEAN one holding Dante's "
        f"reading of the same name. Neither is a move, and 'resolving the "
        f"duplicate' by emptying the EUROPEAN row would delete the borrowing "
        f"this database keeps deliberately distinct from the original."
    )

    strays = sorted(
        Actor.all_objects.filter(
            civilization="EUROPEAN", name__in=MOVED_ACTORS
        ).values_list("name", flat=True)
    )
    assert strays == [], (
        f"these names still have a EUROPEAN row: {strays}. The seed table moved "
        f"but a copy was left behind, so the database now holds two of each — "
        f"and `resolve_actor_by_any_name` answers with whichever sorts first."
    )


@pytest.mark.django_db
def test_the_three_dante_borrowed_stay_european(seeded):
    """The half of the split that is a decision rather than a correction.

    Minos, Cerberus and Charon are Greek figures, and moving them would have
    been the obvious sweep — it would also have emptied Dante's hell of
    everything but Satan on the strength of where the names come from. What
    this repository holds of those three is the *borrowing*: Minos allots the
    circle at the entrance to the second (Inf. V.4-15), Cerberus stands over
    the gluttons in the third (Inf. VI), Charon works Acheron at the gate (Inf.
    III). A row's civilization follows the text it is written from.
    """
    european = set(
        Actor.objects.filter(civilization="EUROPEAN").values_list("name", flat=True)
    )
    absent = [name for name in DANTE_BORROWED if name not in european]
    assert absent == [], (
        f"{absent} left the EUROPEAN cast. Every anchor those rows cite is the "
        f"Commedia's; moving them files Dante's own characters under an author "
        f"who did not write them."
    )


@pytest.mark.django_db
def test_every_greek_actor_stands_on_a_greek_realm(seeded):
    """The half the cast list cannot see.

    Found by mutation: moving the Greek Charon onto `EU_ACHERON` — the European
    crossing, Dante's — left every other assertion in this file green. The cast
    check counts names and the realm check counts codes; neither looks at the
    edge between them, so a Greek actor standing in another cosmology's realm
    was invisible to both.

    That placement is not a typo-shaped mistake. It is the *plausible* one: the
    two crossings have nearly the same name, one of them already existed, and
    the whole point of realms/0018 is that they are different rows for different
    poems. An actor filed across that line would put Plato's ferryman at Dante's
    gate — where the passengers are already damned — while every list in this
    file still read correctly.
    """
    placements = {
        actor.name: actor.realm
        for actor in Actor.objects.filter(civilization="GREEK").select_related("realm")
    }
    assert placements, "no GREEK actors were seeded at all"

    # BOTH HALVES, AND THE FIRST ONE IS WHAT THE MUTATION ACTUALLY PRODUCES.
    # The first version of this check read `if actor.realm is not None and
    # actor.realm.civilization != "GREEK"` and stayed green under exactly the
    # edit it was written for. Pointing a GREEK actor at `EU_ACHERON` does not
    # create a cross-cosmology placement: the seeder cannot resolve a realm
    # outside the actor's own tenant, so it writes the row with **no realm at
    # all** — and the `is not None` guard then excused the case. An actor
    # standing nowhere is the failure; standing in the wrong place is the one
    # that cannot happen.
    homeless = sorted(name for name, realm in placements.items() if realm is None)
    assert not homeless, (
        f"GREEK actors with no realm: {homeless}. A seeded actor whose "
        f"realm_code names a realm in another cosmology cannot be resolved "
        f"across the tenant boundary, so the row lands with realm=NULL rather "
        f"than failing — the actor is in the cast, reads correctly in every "
        f"name list, and stands nowhere."
    )

    misplaced = {
        name: (realm.realm_code, realm.civilization)
        for name, realm in placements.items()
        if realm.civilization != "GREEK"
    }
    assert not misplaced, (
        f"GREEK actors standing in realms of another cosmology: {misplaced}. A "
        f"realm_code's prefix records where the row was written, not what it "
        f"belongs to (EU_PLATO_MEADOW is GREEK), so the check is the realm's "
        f"own civilization and never the spelling of its code."
    )


@pytest.mark.django_db
def test_the_greek_realms_are_greek_and_the_crossing_is_not(seeded):
    """Three Greek places, and the one that stayed behind with Charon.

    EU_PLATO_MEADOW keeps its `EU_` code under GREEK, which is deliberate: a
    `realm_code` is a join key (`Reincarnation.target_realm` stores it as text,
    `consolidate_eu_pantheon` audits against it, the frontend has hard-coded one
    before) and renaming one cost realms/0012 and realms/0015 a dedicated
    migration each. The prefix records where the row was written.

    The two destinations are here because Gorgias 524a names them in the same
    sentence as the fork. Asphodel and the five rivers are not, and the last
    assertion is what keeps that a decision: Homer's asphodel meadow is where
    Achilles walks rather than a middling-souls precinct, and the tidy
    Tartarus/Asphodel/Elysium triad is a modern textbook systematisation.
    """
    greek = dict(
        Realm.objects.filter(civilization="GREEK")
        .values_list("realm_code", "realm_type")
    )
    assert sorted(greek) == sorted([MEADOW, ACHERON, ISLES, TARTARUS]), (
        f"the GREEK realms are {sorted(greek)}. Expected the fork and the two "
        f"roads out of it that Gorgias 524a names — 'the two ways leading, one "
        f"to the Isles of the Blest, and the other to Tartarus' — plus "
        f"GR_ACHERON, the crossing, from Aeneid 6.295-297 under the two-text "
        f"basis stated at the top of GREEK_REALMS: Plato supplies the "
        f"judgment, Virgil the ground it happens on. A FIFTH row still means "
        f"somebody completed the geography from a textbook, and the basis "
        f"change licenses none — Virgil's borderland sorts by manner of death, "
        f"which this system does not record, and Asphodel is in neither text "
        f"as a destination. A missing one means the seed table and "
        f"realms/0018 disagree."
    )
    # The two roads are opposite outcomes, and a row that says otherwise would
    # make a soul sent to Tartarus indistinguishable from one sent to the
    # Isles everywhere `realm_type` is read.
    assert greek[ISLES] == "BLISS", f"{ISLES} is {greek[ISLES]}, not BLISS"
    assert greek[TARTARUS] == "HELL", f"{TARTARUS} is {greek[TARTARUS]}, not HELL"

    acheron = Realm.objects.filter(realm_code="EU_ACHERON").first()
    assert acheron is not None and acheron.civilization == "EUROPEAN", (
        f"EU_ACHERON is "
        f"{acheron.civilization if acheron else 'not seeded at all'!r}. The "
        f"crossing stays EUROPEAN because Charon does: Dante puts him on "
        f"Acheron before the first circle. Sweeping it into GREEK also strands "
        f"Charon, since `_seed_actors` resolves a realm only within the "
        f"civilization it is seeding."
    )


@pytest.mark.django_db
def test_everything_greek_is_owned_by_the_greek_tenant(seeded):
    """The column and the FK say the same thing, or tenant scoping lies.

    `TenantQuerySetMixin` filters by `tenant`, not by `civilization`. A row
    correctly marked GREEK but still owned by `EU_HEAVEN_HELL` is visible to
    the European tenant and invisible to the Greek one — which is the state the
    data was in before realms/0018, wearing the right label.
    """
    misowned = sorted(
        f"{model.__name__} {identity}"
        for model, field in ((Actor, "name"), (Realm, "realm_code"))
        for identity in model.all_objects.filter(civilization="GREEK")
        .exclude(tenant__code=GREEK_TENANT_CODE)
        .values_list(field, flat=True)
    )
    assert misowned == [], (
        f"GREEK rows owned by another tenant (or by none): {misowned}. Tenant "
        f"scoping reads the FK, so these are visible to whoever owns them and "
        f"not to the Greek tenant."
    )


@pytest.mark.django_db
def test_the_hades_org_subtree_is_greek(seeded):
    """`Organization.category` is the same fact in a column called something else.

    org/0004 backfills `Organization.tenant` from `category`, and non-ADMIN
    roles are scoped to their own tenant's org tree — so 冥界/希腊冥界 filed as
    EUROPEAN means a Greek administrator sees no org tree and the European one
    sees a subtree that is not theirs. `init_organizations` uses
    `get_or_create` defaults, which never touch an existing row, so the
    correction has to be org/0007's.
    """
    call_command("init_organizations", stdout=io.StringIO())

    categories = dict(
        Organization.all_objects.filter(code__in=["HADES", "HADES_GREEK", "HELL", "HEAVEN"])
        .values_list("code", "category")
    )
    assert categories.get("HADES") == "GREEK", (
        f"HADES is category {categories.get('HADES')!r}"
    )
    assert categories.get("HADES_GREEK") == "GREEK", (
        f"HADES_GREEK is category {categories.get('HADES_GREEK')!r} — the node "
        f"says what it is in its own name"
    )
    # Absence: the Christian and Dantean roots must not have come along.
    assert categories.get("HEAVEN") == "EUROPEAN", "HEAVEN was swept into GREEK"
    assert categories.get("HELL") == "EUROPEAN", (
        "HELL was swept into GREEK. Dante's hell is where Minos, Cerberus, "
        "Charon and Satan stand; it is not part of the Greek underworld."
    )


# --------------------------------------------------------------------------
# 3. The migrations, forward -> reverse -> forward, compared as data
# --------------------------------------------------------------------------


def test_realms_0018_round_trip(migration_round_trip):
    """The mythology half, through a real `migrate`.

    The world seeded at 0017 is the one this migration claims it can restore,
    and it deliberately contains three shapes the move must treat differently:

    * rows that move and are re-owned (Hades, Aeacus, the meadow),
    * a row that moves but keeps a NULL tenant (Rhadamanthus) — an unset owner
      is a row the seeder has not reached, not a decision to overwrite, and if
      the forward filled it in the reverse could not tell "was European" from
      "was nobody's",
    * rows that must not move at all (Dante's Minos, Charon, EU_ACHERON).
    """
    from tests.migration_roundtrip import snapshot_rows

    def seed(state):
        tenant = state.get_model("tenants", "Tenant")
        realm = state.get_model("realms", "Realm")
        actor = state.get_model("actors", "Actor")

        owner = tenant._base_manager.create(
            code=EUROPEAN_TENANT_CODE, display_name="European Afterlife"
        )
        realms = {}
        for code, realm_type, tier in (
            (MEADOW, "NEUTRAL", 0),
            ("EU_ACHERON", "NEUTRAL", 0),
            ("EU_HELL_2ND", "HELL", 2),
        ):
            realms[code] = realm._base_manager.create(
                realm_code=code,
                civilization="EUROPEAN",
                realm_type=realm_type,
                tier=tier,
                name_local=code,
                name_zh=code,
                name_en=code,
                name_egy=code,
                memory_reset_mechanism="NONE",
                is_eternal=False,
                tenant=owner,
            )
        for name, role, code, owned in (
            ("Hades", "OVERSEER", MEADOW, True),
            ("Aeacus", "JUDGE", MEADOW, True),
            # The untenanted legacy row.
            ("Rhadamanthus", "JUDGE", MEADOW, False),
            # Dante's, and it stays put.
            ("Minos", "JUDGE", "EU_HELL_2ND", True),
            ("Charon", "CONDUIT", "EU_ACHERON", True),
        ):
            actor._base_manager.create(
                name=name,
                civilization="EUROPEAN",
                role=role,
                realm=realms[code],
                tenant=owner if owned else None,
            )

    def snapshot(state):
        realm = state.get_model("realms", "Realm")
        actor = state.get_model("actors", "Actor")
        realms = snapshot_rows(
            realm._base_manager.select_related("tenant"),
            key="realm_code",
            fields={
                "civilization": "civilization",
                "tenant": lambda r: r.tenant.code if r.tenant_id else None,
            },
            prefix="realm:",
        )
        actors = snapshot_rows(
            actor._base_manager.select_related("realm", "tenant"),
            # Keyed on `name` alone and NOT on (name, civilization): the
            # civilization is what this migration changes, so folding it into
            # the key would make every moved row read as one row vanishing and
            # a different one appearing, and the comparison would never see a
            # field change at all.
            key="name",
            fields={
                "civilization": "civilization",
                "realm": lambda a: a.realm.realm_code if a.realm_id else None,
                "tenant": lambda a: a.tenant.code if a.tenant_id else None,
            },
            prefix="actor:",
        )
        return {**realms, **actors}

    def check_forward(state):
        actor = state.get_model("actors", "Actor")
        realm = state.get_model("realms", "Realm")

        moved = dict(
            actor._base_manager.filter(name__in=MOVED_ACTORS)
            .values_list("name", "civilization")
        )
        assert moved == dict.fromkeys(MOVED_ACTORS, "GREEK"), (
            f"forward left actors behind: {moved}"
        )
        assert (
            actor._base_manager.get(name="Rhadamanthus").tenant_id is None
        ), "forward filled in a NULL tenant, which the reverse cannot undo"
        assert (
            actor._base_manager.get(name="Minos").civilization == "EUROPEAN"
        ), "forward moved Dante's Minos, who is not in its list"
        assert (
            realm._base_manager.get(realm_code="EU_ACHERON").civilization == "EUROPEAN"
        ), "forward moved the crossing, which stays with Charon"
        assert (
            realm._base_manager.get(realm_code=MEADOW).tenant.code == GREEK_TENANT_CODE
        ), "forward moved the meadow's civilization but not its owner"

    def check_reverse(state):
        tenant = state.get_model("tenants", "Tenant")
        actor = state.get_model("actors", "Actor")
        assert not actor._base_manager.filter(civilization="GREEK").exists(), (
            "the reverse left GREEK rows behind"
        )
        # The tenant row itself is not deleted, and that is deliberate: the
        # reverse restores what the migration changed and does not destroy what
        # it created on a database that may have acquired Greek souls since.
        # Recorded rather than asserted away.
        assert tenant._base_manager.filter(code=GREEK_TENANT_CODE).exists()

    migration_round_trip(
        before=("realms", "0017_alter_realm_civilization"),
        after=("realms", "0018_split_greek_from_european"),
        seed=seed,
        snapshot=snapshot,
        check_forward=check_forward,
        check_reverse=check_reverse,
    )


def test_org_0007_round_trip(migration_round_trip):
    """The org half, same shape: two nodes move, two do not, one keeps NULL."""
    from tests.migration_roundtrip import snapshot_rows

    def seed(state):
        tenant = state.get_model("tenants", "Tenant")
        organization = state.get_model("org", "Organization")

        owner = tenant.all_objects.create(
            code=EUROPEAN_TENANT_CODE, display_name="European Afterlife"
        )
        for name, code, owned in (
            ("冥界", "HADES", True),
            ("希腊冥界", "HADES_GREEK", False),
            ("天堂", "HEAVEN", True),
            ("地狱", "HELL", True),
        ):
            organization.all_objects.create(
                name=name, code=code, category="EUROPEAN", level=0, sort=0,
                tenant=owner if owned else None,
            )

    def snapshot(state):
        organization = state.get_model("org", "Organization")
        return snapshot_rows(
            organization.all_objects.select_related("tenant"),
            key="code",
            fields={
                "category": "category",
                "tenant": lambda o: o.tenant.code if o.tenant_id else None,
            },
            prefix="org:",
        )

    def check_forward(state):
        organization = state.get_model("org", "Organization")
        rows = dict(organization.all_objects.values_list("code", "category"))
        assert rows == {
            "HADES": "GREEK",
            "HADES_GREEK": "GREEK",
            "HEAVEN": "EUROPEAN",
            "HELL": "EUROPEAN",
        }, f"forward moved the wrong set of org nodes: {rows}"
        assert (
            organization.all_objects.get(code="HADES_GREEK").tenant_id is None
        ), "forward filled in a NULL tenant, which the reverse cannot undo"
        assert (
            organization.all_objects.get(code="HADES").tenant.code == GREEK_TENANT_CODE
        ), "forward moved HADES' category but not its owner"

    migration_round_trip(
        before=("org", "0006_alter_organization_category"),
        after=("org", "0007_hades_tree_becomes_greek"),
        seed=seed,
        snapshot=snapshot,
        check_forward=check_forward,
    )
