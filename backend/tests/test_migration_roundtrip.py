"""Round-trip coverage for the reversible data migrations.

Each test builds the world the migration expects to find, migrates forward,
migrates back, and compares the *rows* — see ``tests/migration_roundtrip.py``
for why "the reverse ran without error" is not the assertion that matters.

The seeds are derived from the migrations' own constant tables (``ACTOR_MOVES``
and friends) rather than restating them. That is deliberate and it is the
opposite of the usual advice: a hand-written fixture would go stale the moment
somebody adds a fourteenth actor to ``ACTOR_MOVES``, and the round trip would
keep passing while covering less and less. Deriving the fixture cannot verify
*what* the migration moves — so each test also pins a handful of placements by
hand in ``check_forward``, where a wrong or reversed mapping does show up.
"""
import importlib
import uuid

import pytest
from django.utils import timezone

from tests.migration_roundtrip import snapshot_rows

REALMS_0012 = importlib.import_module("apps.realms.migrations.0012_ten_courts")
REALMS_0013 = importlib.import_module(
    "apps.realms.migrations.0013_correct_mythological_positions"
)
JUDGMENT_0012 = importlib.import_module(
    "apps.judgment.migrations.0012_withdraw_fabricated_statutes"
)

CIV_BY_PREFIX = {"DY_": "CHINESE", "EU_": "EUROPEAN", "EG_": "EGYPTIAN"}
TENANT_BY_CIV = {
    "CHINESE": "CN_DIYU",
    "EUROPEAN": "EU_HEAVEN_HELL",
    "EGYPTIAN": "EG_DUAT",
}


def _civ(realm_code):
    for prefix, civ in CIV_BY_PREFIX.items():
        if realm_code.startswith(prefix):
            return civ
    raise AssertionError(f"no civilization for realm_code {realm_code!r}")


def _tenants(state):
    """One tenant per civilization, keyed by civilization."""
    tenant = state.get_model("tenants", "Tenant")
    return {
        civ: tenant._base_manager.create(code=code, display_name=code)
        for civ, code in TENANT_BY_CIV.items()
    }


def _make_realm(state, realm_code, tenant, **overrides):
    realm = state.get_model("realms", "Realm")
    civ = _civ(realm_code)
    fields = {
        "civilization": civ,
        "realm_type": "HELL",
        "tier": 1,
        "name_local": realm_code,
        "name_zh": realm_code,
        "name_en": realm_code,
        "name_egy": realm_code,
        "memory_reset_mechanism": "NONE",
        "is_eternal": False,
        "is_judgment_required": True,
        "tenant": tenant,
    }
    fields.update(overrides)
    return realm._base_manager.create(realm_code=realm_code, **fields)


def _snapshot_realms(state):
    realm = state.get_model("realms", "Realm")
    return snapshot_rows(
        realm._base_manager.all(),
        key="realm_code",
        fields={
            "civilization": "civilization",
            "tier": "tier",
            "name_zh": "name_zh",
            "is_deleted": "is_deleted",
            "delete_reason": "delete_reason",
            "tenant": lambda r: r.tenant.code if r.tenant_id else None,
        },
        prefix="realm:",
    )


def _snapshot_actors(state):
    actor = state.get_model("actors", "Actor")
    return snapshot_rows(
        actor._base_manager.select_related("realm"),
        key="name",
        fields={
            "civilization": "civilization",
            "role": "role",
            "realm": lambda a: a.realm.realm_code if a.realm_id else None,
        },
        prefix="actor:",
    )


def _assert_no_orphaned_actors(state, expected):
    """Name the actors whose realm went to None. The realms/0012 failure mode.

    ``_diff`` would report these too, but buried among every other field. A
    posting silently becoming NULL is the specific thing these migrations get
    wrong, so it gets its own sentence.
    """
    actors = _snapshot_actors(state)
    orphaned = sorted(
        name
        for name, row in expected.items()
        if name.startswith("actor:")
        and row["realm"] is not None
        and actors.get(name, {}).get("realm") is None
    )
    assert not orphaned, (
        "reverse migration left these actors with no realm at all "
        "(realm = None), i.e. their posting was destroyed rather than "
        f"restored: {', '.join(n.removeprefix('actor:') for n in orphaned)}"
    )


# --------------------------------------------------------------------------
# realms/0013 — the misplaced gods
# --------------------------------------------------------------------------

def test_realms_0013_round_trip(migration_round_trip):
    moves = REALMS_0013.ACTOR_MOVES
    roles = REALMS_0013.ACTOR_ROLES
    created = {row[0] for row in REALMS_0013.NEW_REALMS}
    # Every realm the migration reads, minus the two it creates: those must not
    # exist beforehand or step 1 would find nothing to do.
    pre_existing = sorted(
        {code for _, before, after in moves.values() for code in (before, after)}
        | set(REALMS_0013.RETIRED_REALMS)
    )
    pre_existing = [c for c in pre_existing if c not in created]

    baseline_actors = {}

    def seed(state):
        actor = state.get_model("actors", "Actor")
        tenants = _tenants(state)
        realms = {
            code: _make_realm(state, code, tenants[_civ(code)])
            for code in pre_existing
        }
        placed = {}
        for name, (civ, before, _after) in moves.items():
            placed[name] = (civ, realms[before])
        for name, (civ, _before_role, _after_role) in roles.items():
            # Michael, Satan and Ma'at only change role, so they have no
            # ACTOR_MOVES entry and start with no realm at all.
            placed.setdefault(name, (civ, None))
        for name, (civ, realm) in placed.items():
            role = roles[name][1] if name in roles else "JUDGE"
            actor._base_manager.create(
                name=name, civilization=civ, role=role, realm=realm
            )
        baseline_actors.update(_snapshot_actors(state))

    def snapshot(state):
        return {**_snapshot_realms(state), **_snapshot_actors(state)}

    def check_forward(state):
        realms = _snapshot_realms(state)
        actors = _snapshot_actors(state)
        # Pinned by hand: a mapping written backwards would survive the round
        # trip (it would reverse just as wrongly) but not these.
        assert actors["actor:Minos"]["realm"] == "EU_HELL_2ND"
        assert actors["actor:Charon"]["realm"] == "EU_ACHERON"
        assert actors["actor:Hades"]["realm"] == "EU_PLATO_MEADOW"
        assert actors["actor:Ammit"]["realm"] == "EG_HALL_TWO_TRUTHS"
        assert actors["actor:孟婆"]["realm"] == "DY_COURT_10_ZHUANLUN"
        assert actors["actor:Michael"]["role"] == "CONDUIT"
        assert actors["actor:Satan"]["role"] == "EXECUTOR"
        assert actors["actor:Ma'at"]["role"] == "GUARDIAN"
        assert actors["actor:Horus"]["role"] == "CONDUIT"
        # The two Greek realms exist and inherited a European tenant.
        assert realms["realm:EU_ACHERON"]["tenant"] == "EU_HEAVEN_HELL"
        assert realms["realm:EU_PLATO_MEADOW"]["civilization"] == "EUROPEAN"
        # EG_AM_TYAT is retired by soft-delete, not removed.
        assert realms["realm:EG_AM_TYAT"]["is_deleted"] is True

    def check_reverse(state):
        _assert_no_orphaned_actors(state, baseline_actors)
        realms = _snapshot_realms(state)
        assert "realm:EU_ACHERON" not in realms
        assert "realm:EU_PLATO_MEADOW" not in realms

    migration_round_trip(
        before=("realms", "0012_ten_courts"),
        after=("realms", "0013_correct_mythological_positions"),
        seed=seed,
        snapshot=snapshot,
        check_forward=check_forward,
        check_reverse=check_reverse,
    )


# --------------------------------------------------------------------------
# realms/0012 — the ten courts. This is where the reverse-order bug was.
# --------------------------------------------------------------------------

def test_realms_0012_round_trip(migration_round_trip):
    moves = REALMS_0012.ACTOR_MOVES
    pre_fields = {row[0]: row[1:] for row in REALMS_0012.PRE_RENAME_FIELDS}
    pre_existing = sorted(
        {before for before, _ in moves.values()} | set(REALMS_0012.RETIRED)
    )

    baseline_actors = {}

    def seed(state):
        actor = state.get_model("actors", "Actor")
        reincarnation = state.get_model("reincarnation", "Reincarnation")
        soul = state.get_model("souls", "Soul")
        tenants = _tenants(state)
        realms = {}
        for code in pre_existing:
            tier, name_local, name_zh, name_en, name_egy = pre_fields.get(
                code, (1, code, code, code, code)
            )
            realms[code] = _make_realm(
                state,
                code,
                tenants[_civ(code)],
                tier=tier,
                name_local=name_local,
                name_zh=name_zh,
                name_en=name_en,
                name_egy=name_egy,
            )
        for name, (before, _after) in moves.items():
            actor._base_manager.create(
                name=name,
                civilization="CHINESE",
                role="JUDGE",
                realm=realms[before],
            )
        # Reincarnation.target_realm is a plain CharField holding a realm_code,
        # so it is rewritten by hand on both legs — worth a row per rename.
        dead = soul._base_manager.create(name="round-trip soul")
        for old in REALMS_0012.RENAMES:
            reincarnation._base_manager.create(
                soul=dead, target_realm=old, tenant=tenants["CHINESE"]
            )
        baseline_actors.update(_snapshot_actors(state))

    def snapshot(state):
        reincarnation = state.get_model("reincarnation", "Reincarnation")
        rebirths = snapshot_rows(
            reincarnation._base_manager.order_by("target_realm"),
            key=lambda r: str(r.id),
            fields={"target_realm": "target_realm"},
            prefix="rebirth:",
        )
        return {**_snapshot_realms(state), **_snapshot_actors(state), **rebirths}

    def check_forward(state):
        realms = _snapshot_realms(state)
        actors = _snapshot_actors(state)
        assert actors["actor:楚江王"]["realm"] == "DY_COURT_02_CHUJIANG"
        assert actors["actor:平等王"]["realm"] == "DY_COURT_09_PINGDENG"
        assert actors["actor:阎罗王"]["realm"] == "DY_COURT_05_YANLUO"
        assert actors["actor:钟馗"]["realm"] == "DY_COURT_05_YANLUO"
        assert realms["realm:DY_COURT_05_YANLUO"]["tier"] == 5
        assert realms["realm:DY_07_JIAN"]["is_deleted"] is True
        assert "realm:DY_10_YAMA" not in realms  # renamed in place

    def check_reverse(state):
        _assert_no_orphaned_actors(state, baseline_actors)

    migration_round_trip(
        before=("realms", "0011_lethe_storage_value"),
        after=("realms", "0012_ten_courts"),
        seed=seed,
        snapshot=snapshot,
        check_forward=check_forward,
        check_reverse=check_reverse,
    )


# --------------------------------------------------------------------------
# judgment/0012 — withdrawing the fabricated statute corpora
# --------------------------------------------------------------------------

MANUAL_DELETE_REASON = "retired by hand long before judgment/0012"
MANUAL_CASCADE_ID = uuid.UUID("00000000-0000-4000-8000-00000000ffff")


def test_judgment_0012_round_trip(migration_round_trip):
    def seed(state):
        statute = state.get_model("judgment", "Statute")
        judgment = state.get_model("judgment", "Judgment")
        citation = state.get_model("judgment", "JudgmentCitation")
        soul = state.get_model("souls", "Soul")
        tenants = _tenants(state)

        def make(code, corpus, civ, **extra):
            return statute._base_manager.create(
                code=code,
                corpus=corpus,
                civilization=civ,
                ordinal=1,
                polarity="OFFENCE",
                title_zh=code,
                tenant=tenants[civ],
                **extra,
            )

        make("CN-HL-O01", "HELL_LAW", "CHINESE")
        make("CN-HL-O02", "HELL_LAW", "CHINESE")
        make("EU-DS-03", "DEADLY_SIN", "EUROPEAN")
        # Untouched corpus: the migration deliberately leaves it alone.
        make("EG-NC-07", "NEGATIVE_CONFESSION", "EGYPTIAN")
        # Soft-deleted for an unrelated reason before this migration ever ran.
        # backward() keys on its own reason + cascade id, so this must stay
        # deleted across the whole round trip.
        make(
            "EU-DS-07",
            "DEADLY_SIN",
            "EUROPEAN",
            is_deleted=True,
            delete_reason=MANUAL_DELETE_REASON,
            delete_cascade_id=MANUAL_CASCADE_ID,
        )
        # Cited by a real judgment: must survive the forward pass untouched.
        cited = make("CN-HL-O09", "HELL_LAW", "CHINESE")
        dead = soul._base_manager.create(name="cited soul")
        case = judgment._base_manager.create(
            soul=dead, civilization="CHINESE", tenant=tenants["CHINESE"]
        )
        citation._base_manager.create(
            judgment=case, statute=cited, tenant=tenants["CHINESE"]
        )

    def snapshot(state):
        statute = state.get_model("judgment", "Statute")
        return snapshot_rows(
            statute._base_manager.all(),
            key="code",
            fields={
                "corpus": "corpus",
                "is_deleted": "is_deleted",
                "delete_reason": "delete_reason",
                "delete_cascade_id": "delete_cascade_id",
            },
            prefix="statute:",
        )

    def check_forward(state):
        rows = snapshot(state)
        for code in ("CN-HL-O01", "CN-HL-O02", "EU-DS-03"):
            assert rows[f"statute:{code}"]["is_deleted"] is True
            assert rows[f"statute:{code}"]["delete_reason"] == (
                JUDGMENT_0012.DELETE_REASON
            )
            assert rows[f"statute:{code}"]["delete_cascade_id"] == (
                JUDGMENT_0012.CASCADE_ID
            )
        # Cited article kept; other corpus untouched; hand-deleted row unchanged.
        assert rows["statute:CN-HL-O09"]["is_deleted"] is False
        assert rows["statute:EG-NC-07"]["is_deleted"] is False
        assert rows["statute:EU-DS-07"]["delete_reason"] == MANUAL_DELETE_REASON

    def check_reverse(state):
        rows = snapshot(state)
        assert rows["statute:EU-DS-07"]["is_deleted"] is True, (
            "backward() resurrected a statute this migration never retired"
        )

    migration_round_trip(
        before=("judgment", "0011_statute_judgmentcitation_and_more"),
        after=("judgment", "0012_withdraw_fabricated_statutes"),
        seed=seed,
        snapshot=snapshot,
        check_forward=check_forward,
        check_reverse=check_reverse,
    )


# --------------------------------------------------------------------------
# disposition/0009 — the LETIES -> LETHE storage-value fix
# --------------------------------------------------------------------------

def test_disposition_0009_round_trip(migration_round_trip):
    def seed(state):
        disposition = state.get_model("disposition", "Disposition")
        soul = state.get_model("souls", "Soul")
        tenants = _tenants(state)
        _make_realm(state, "EU_PURGATORY", tenants["EUROPEAN"],
                    memory_reset_mechanism="LETIES")
        _make_realm(state, "DY_00_PURGATORY", tenants["CHINESE"],
                    memory_reset_mechanism="MENGPO")
        dead = soul._base_manager.create(name="lethe soul")
        for name, value in (("a", "LETIES"), ("b", "MENGPO"), ("c", "NONE")):
            disposition._base_manager.create(
                soul=dead, memory_reset=value, notes=name,
                tenant=tenants["CHINESE"],
            )

    def snapshot(state):
        realm = state.get_model("realms", "Realm")
        disposition = state.get_model("disposition", "Disposition")
        realms = snapshot_rows(
            realm._base_manager.all(),
            key="realm_code",
            fields={"memory_reset_mechanism": "memory_reset_mechanism"},
            prefix="realm:",
        )
        dispositions = snapshot_rows(
            disposition._base_manager.order_by("notes"),
            key="notes",
            fields={"memory_reset": "memory_reset"},
            prefix="disposition:",
        )
        return {**realms, **dispositions}

    def check_forward(state):
        rows = snapshot(state)
        # Both tables, in one migration, so a rollback cannot strand one of
        # them on the old spelling — the reason this migration exists.
        assert rows["realm:EU_PURGATORY"]["memory_reset_mechanism"] == "LETHE"
        assert rows["disposition:a"]["memory_reset"] == "LETHE"
        # Untouched values stay untouched.
        assert rows["realm:DY_00_PURGATORY"]["memory_reset_mechanism"] == "MENGPO"
        assert rows["disposition:b"]["memory_reset"] == "MENGPO"
        assert rows["disposition:c"]["memory_reset"] == "NONE"

    migration_round_trip(
        before=(
            "disposition",
            "0008_disposition_archive_reason_disposition_archived_at_and_more",
        ),
        after=("disposition", "0009_lethe_storage_value"),
        seed=seed,
        snapshot=snapshot,
        check_forward=check_forward,
    )


# --------------------------------------------------------------------------
# disposition/0011 — the term-start columns, and the backfill that is nothing
# --------------------------------------------------------------------------

#: What the snapshot reads when the column does not exist yet.
#:
#: `getattr(row, "term_start_year", ...)` against the *historical* model at
#: 0010 has no such attribute, and this marker is what that reads as. It is
#: what makes the round trip say anything at all here: 0011 adds three nullable
#: columns and writes no data, so a snapshot of only the pre-existing columns
#: would be identical before and after, and `run_round_trip` would (correctly)
#: refuse it as a migration whose reverse cannot be proved to do anything.
#:
#: Reading the column's *presence* as data turns the no-op backfill into the
#: assertion: absent -> NULL on every row -> absent again -> NULL again.
NO_COLUMN = "<column does not exist>"


def test_disposition_0011_round_trip(migration_round_trip):
    """The backfill decision — leave every existing row NULL — asserted.

    NULL means "no term start recorded", the convention `sentence_years` uses
    one field up. Nothing in an existing row could supply a real one:
    `executed_at` is when the paperwork moved (which is the whole reason
    `term_start` is a separate column), `created_at` is when the row was
    inserted, and the soul's `death_year` is the derivation
    `_greek_reading` rules out by name.

    So this test's job is to catch a future edit that quietly starts
    backfilling *something* — the check below is `is None` on every seeded row,
    not merely "the column exists".
    """
    def seed(state):
        disposition = state.get_model("disposition", "Disposition")
        soul = state.get_model("souls", "Soul")
        tenants = _tenants(state)
        dead = soul._base_manager.create(name="term start soul", death_year=-402)
        # Three rows that differ in every column a backfill might be tempted
        # to read: an executed one with a timestamp, an unexecuted one, and one
        # carrying a sentence length.
        disposition._base_manager.create(
            soul=dead, notes="executed", tenant=tenants["CHINESE"],
            is_executed=True, executed_at=timezone.now(),
        )
        disposition._base_manager.create(
            soul=dead, notes="pending", tenant=tenants["CHINESE"],
        )
        disposition._base_manager.create(
            soul=dead, notes="sentenced", tenant=tenants["CHINESE"],
            sentence_years=1000,
        )

    def snapshot(state):
        disposition = state.get_model("disposition", "Disposition")
        return snapshot_rows(
            disposition._base_manager.order_by("notes"),
            key="notes",
            fields={
                "term_start_year": lambda d: getattr(d, "term_start_year", NO_COLUMN),
                "term_start_month": lambda d: getattr(d, "term_start_month", NO_COLUMN),
                "term_start_day": lambda d: getattr(d, "term_start_day", NO_COLUMN),
                # Carried so that a reverse which dropped the columns *and*
                # damaged something else would still be caught.
                "is_executed": "is_executed",
                "sentence_years": "sentence_years",
            },
            prefix="disposition:",
        )

    def check_forward(state):
        rows = snapshot(state)
        assert set(rows) == {
            "disposition:executed", "disposition:pending", "disposition:sentenced",
        }
        for key, row in rows.items():
            assert row["term_start_year"] is None, key
            assert row["term_start_month"] is None, key
            assert row["term_start_day"] is None, key

    def check_reverse(state):
        rows = snapshot(state)
        for key, row in rows.items():
            assert row["term_start_year"] == NO_COLUMN, key

    migration_round_trip(
        before=("disposition", "0010_sentence_years_help_text"),
        after=("disposition", "0011_disposition_term_start"),
        seed=seed,
        snapshot=snapshot,
        check_forward=check_forward,
        check_reverse=check_reverse,
    )


# --------------------------------------------------------------------------
# The harness's own guard rails
# --------------------------------------------------------------------------

def test_round_trip_rejects_an_empty_baseline(migration_round_trip):
    """An empty snapshot compares equal to any other empty snapshot.

    Without this guard a seed that writes nothing the snapshot can see — the
    usual cause being `objects` instead of `_base_manager` on a tenant-scoped
    model — would produce four identical empty dicts and a green test that
    covers nothing.
    """
    with pytest.raises(AssertionError, match="baseline snapshot is empty"):
        migration_round_trip(
            before=("judgment", "0011_statute_judgmentcitation_and_more"),
            after=("judgment", "0012_withdraw_fabricated_statutes"),
            seed=lambda state: None,
            snapshot=lambda state: {},
        )
