"""
There is one way to seed this system, and these tests are what keeps it one.

The realm and actor reference data used to exist twice: in
``manage.py seed_mythology`` and in a standalone
``backend/scripts/seed_chinese_data.py``. Nothing connected the two. Every
change to the canon — the DY_COURT_NN restructure in ``realms/0012`` most
recently — had to be applied by hand in both places, and the copy the deploy
path actually ran (``docker-compose.yml``'s backend boot command) was the copy
no test covered. The script's own header even claimed it was superseded and
that "changes made here will not reach CI or a fresh clone", which was true of
CI and false of docker.

Three failure modes came out of that split, all of them silent until
production:

* **Drift.** Fix a court number in one table, forget the other, and a docker
  deploy writes the stale spelling over the correct one.
* **Half-seeded rows.** The script never called its own tenant helper, so it
  wrote every realm and actor with ``tenant=NULL`` and ``title=""`` — rows that
  exist in the database and are invisible to every tenant-scoped viewset.
* **A tombstone collision.** The script looked realms up through
  ``Realm.objects``, which filters ``is_deleted=False``, and then inserted on a
  miss. ``realms/0012`` soft-deletes DY_07_JIAN / DY_08_HAN / DY_09_YANG, and
  the unique constraint on ``realm_code`` does not exclude soft-deleted rows.
  So naming a retired code meant: lookup misses, insert fires, IntegrityError,
  container dies on boot. ``seed_mythology`` matches on ``all_objects`` and
  reports-and-skips instead, which is why it is the survivor.

The script is deleted and the compose file calls the command. These tests hold
that shape:

1. the boot command seeds through ``manage.py``, and every command it names is
   a real one (so a typo is red here rather than at ``docker compose up``);
2. no service boots by running a loose ``scripts/*.py``;
3. anything still living under ``backend/scripts/`` may only name realm codes
   that a seeded database actually has *alive* — the generalised form of the
   tombstone collision above;
4. everything the deleted script used to seed is still seeded by the command,
   so replacing the entry point did not quietly drop rows.

The inventory in (4) is spelled out below rather than imported from
``seed_mythology``. Importing it would make the check a tautology: delete
判官 from the command and the expectation would vanish with it. This copy is
frozen history — the exact contents of ``seed_chinese_data.py`` at the commit
that removed it — and is not meant to grow.
"""
import ast
import io
import re
from pathlib import Path

import pytest
import yaml
from django.core.management import call_command, get_commands

from apps.actors.models import Actor
from apps.realms.models import Realm

REPO_ROOT = Path(__file__).resolve().parents[2]
COMPOSE_PATH = REPO_ROOT / "docker-compose.yml"
SCRIPTS_DIR = REPO_ROOT / "backend" / "scripts"

# The seeding step docker runs on boot.
SEED_COMMAND = "seed_mythology"

# Codes shaped like realm codes. Tenant codes share the prefix vocabulary
# (CN_DIYU, EU_HEAVEN_HELL, EG_DUAT) and are not realms, so they are excluded
# by name rather than by pattern.
REALM_CODE_RE = re.compile(r"^(?:DY|EU|EG)_[A-Z0-9_]+$")
TENANT_CODES = {"CN_DIYU", "EU_HEAVEN_HELL", "EG_DUAT"}


# --------------------------------------------------------------------------
# What backend/scripts/seed_chinese_data.py wrote, as of its deletion.
# Frozen. See the module docstring.
# --------------------------------------------------------------------------
RETIRED_SCRIPT_REALMS = [
    "DY_01_HEAVEN", "DY_02_YANGLIU", "DY_00_PURGATORY",
    "DY_COURT_01_QINGUANG", "DY_COURT_02_CHUJIANG", "DY_COURT_03_SONGDI",
    "DY_COURT_04_WUGUAN", "DY_COURT_05_YANLUO", "DY_COURT_06_BIANCHENG",
    "DY_COURT_07_TAISHAN", "DY_COURT_08_DUSHI", "DY_COURT_09_PINGDENG",
    "DY_COURT_10_ZHUANLUN",
    "EU_HEAVEN", "EU_PURGATORY", "EU_HELL_1ST", "EU_HELL_2ND", "EU_HELL_3RD",
    "EU_HELL_4TH", "EU_HELL_5TH", "EU_HELL_6TH", "EU_HELL_7TH", "EU_HELL_8TH",
    "EU_HELL_9TH",
    "EG_DUAT_ENTRY", "EG_HALL_TWO_TRUTHS", "EG_AARU", "EG_AM_TYAT", "EG_ANNIHILATION",
]

# Rows from the inventory above that the command deliberately no longer seeds.
# Subtracted from the expectation rather than deleted from it, so the inventory
# stays the frozen record of what the script wrote and every departure from it
# has to be written down here with its reason.
#
# EG_AM_TYAT ("Path of Amtyat"): retired by realms/0013 as unattested. Searched
# for and not found in Budge's Book of the Dead glossary, in Budge's Egyptian
# Heaven and Hell vol. II, in UCL Digital Egypt, in museum records, or in
# general search. The likeliest origins are Am-Tuat — Imy-Dwꜣt, the *title of a
# book*, the Amduat — and Amentet (Imntt, "the West", which is the entire west
# and not a frontier); either way a book or a direction was turned into a
# "border realm before the final judgment", which is not a thing the Egyptian
# afterlife corpus contains. tests/test_seed_mythology.py asserts it stays
# unseeded.
DELIBERATELY_RETIRED_REALMS = ["EG_AM_TYAT"]

RETIRED_SCRIPT_ACTORS = [
    "阎罗王", "秦广王", "楚江王", "宋帝王", "五官王", "卞城王", "泰山王", "都市王",
    "平等王", "转轮王", "孟婆", "牛头", "马面", "白无常", "黑无常", "判官", "钟馗",
    "God", "Michael", "Gabriel", "Satan", "Charon", "Minos", "Cerberus", "Lethe",
    "Osiris", "Anubis", "Thoth", "Ma'at", "Ammit", "Horus", "Isis", "Nephthys", "Ra",
]

# The one row the command deliberately does not carry over. Pluto is the Roman
# name of Hades, `seed_mythology` seeds Hades, and `consolidate_eu_pantheon`
# merges any Pluto row into it. Re-seeding Pluto would manufacture on every
# fresh database exactly the duplicate that command exists to remove — so its
# absence is the fix, not a regression, and it is listed here so nobody
# "restores" it by reading the inventory above as incomplete.
DELIBERATELY_NOT_CARRIED_OVER = ["Pluto"]


def _compose():
    return yaml.safe_load(COMPOSE_PATH.read_text(encoding="utf-8"))


def _service_commands():
    """{service name: command string} for every service that declares one."""
    commands = {}
    for name, service in _compose()["services"].items():
        command = service.get("command")
        if command is None:
            continue
        if isinstance(command, list):
            command = " ".join(str(part) for part in command)
        commands[name] = command
    return commands


def _manage_py_commands(text):
    """Command names invoked as `manage.py <name>` in a shell string."""
    return set(re.findall(r"manage\.py\s+([a-z_][a-z0-9_]*)", text))


# --------------------------------------------------------------------------
# 1. The boot command seeds through manage.py, and names real commands.
# --------------------------------------------------------------------------
def test_backend_boot_seeds_through_the_management_command():
    command = _service_commands()["backend"]
    invoked = _manage_py_commands(command)

    assert "migrate" in invoked, (
        f"docker-compose.yml's backend service no longer runs `manage.py migrate` "
        f"on boot. Command was:\n{command}"
    )
    assert SEED_COMMAND in invoked, (
        f"docker-compose.yml's backend service must seed with "
        f"`manage.py {SEED_COMMAND}` — the entry point that is idempotent, "
        f"assigns tenants, skips soft-deleted rows and is covered by "
        f"tests/test_seed_mythology.py. Command was:\n{command}"
    )


def test_every_management_command_the_compose_file_names_exists():
    """A typo in the compose file should be red here, not at `docker compose up`."""
    known = set(get_commands())
    unknown = {}
    for service, command in _service_commands().items():
        missing = _manage_py_commands(command) - known
        if missing:
            unknown[service] = sorted(missing)

    assert not unknown, (
        f"docker-compose.yml invokes management commands that do not exist: "
        f"{unknown}. A container that boots into `Unknown command` is a deploy "
        f"failure, not a startup warning."
    )


# --------------------------------------------------------------------------
# 2. No service boots by running a loose script.
# --------------------------------------------------------------------------
def test_no_service_boots_by_running_a_standalone_script():
    offenders = {
        service: command
        for service, command in _service_commands().items()
        if re.search(r"\bscripts/\S+\.py\b", command)
    }

    assert not offenders, (
        f"These docker-compose services boot by running a script under "
        f"backend/scripts/: {sorted(offenders)}. Seeding and migration belong in "
        f"management commands — a script is a second copy of the data that "
        f"nothing keeps in step with the command, and the deploy path is the "
        f"worst place to run the untested copy. Offending commands:\n"
        + "\n".join(f"  {svc}: {cmd}" for svc, cmd in sorted(offenders.items()))
    )


# --------------------------------------------------------------------------
# 3. Scripts may only name realm codes a seeded database has alive.
# --------------------------------------------------------------------------
def _realm_codes_named_in_scripts():
    """{path: {code}} for realm-code-shaped string literals under backend/scripts/.

    String literals only, via `ast` — a code mentioned in a comment or a
    docstring is prose about history, not a lookup that will be executed.
    """
    found = {}
    for path in sorted(SCRIPTS_DIR.glob("*.py")):
        tree = ast.parse(path.read_text(encoding="utf-8"))
        codes = {
            node.value
            for node in ast.walk(tree)
            if isinstance(node, ast.Constant)
            and isinstance(node.value, str)
            and REALM_CODE_RE.match(node.value)
            and node.value not in TENANT_CODES
        }
        if codes:
            found[path.relative_to(REPO_ROOT)] = codes
    return found


@pytest.mark.django_db
def test_scripts_only_name_realm_codes_that_are_alive_after_seeding():
    """The generalised tombstone collision.

    ``realms/0012`` soft-deletes 剑树狱 / 寒冰狱 / 烊铜狱. `Realm.objects` hides
    soft-deleted rows while the unique constraint on ``realm_code`` still counts
    them, so a script naming a retired code gets a lookup miss followed by an
    insert that dies on the constraint. Rather than blacklisting today's three
    tombstones, this asserts the invariant they violate: every realm code a
    script names must resolve through the same soft-delete-filtered manager the
    scripts use.
    """
    call_command(SEED_COMMAND, stdout=io.StringIO())
    alive = set(Realm.objects.values_list("realm_code", flat=True))

    unresolvable = {
        str(path): sorted(codes - alive)
        for path, codes in _realm_codes_named_in_scripts().items()
        if codes - alive
    }

    assert not unresolvable, (
        f"Scripts name realm codes that a freshly seeded database does not have "
        f"alive: {unresolvable}. Either the realm was retired by a migration "
        f"(`Realm.objects` hides it, the unique constraint does not — the script "
        f"will insert over the tombstone and die on IntegrityError), or the code "
        f"is a typo. Neither is safe to leave in place."
    )


# --------------------------------------------------------------------------
# 4. Retiring the script did not quietly drop rows.
# --------------------------------------------------------------------------
@pytest.mark.django_db
def test_seed_mythology_still_seeds_everything_the_retired_script_seeded():
    call_command(SEED_COMMAND, stdout=io.StringIO())

    missing_realms = sorted(
        set(RETIRED_SCRIPT_REALMS)
        - set(DELIBERATELY_RETIRED_REALMS)
        - set(Realm.objects.values_list("realm_code", flat=True))
    )
    missing_actors = sorted(
        set(RETIRED_SCRIPT_ACTORS) - set(Actor.objects.values_list("name", flat=True))
    )

    assert not missing_realms, (
        f"`manage.py {SEED_COMMAND}` no longer seeds realms that "
        f"scripts/seed_chinese_data.py used to seed: {missing_realms}. The "
        f"script was deleted on the promise that the command covers it; docker "
        f"now boots on the command alone."
    )
    assert not missing_actors, (
        f"`manage.py {SEED_COMMAND}` no longer seeds actors that "
        f"scripts/seed_chinese_data.py used to seed: {missing_actors}. Same "
        f"promise, same consequence."
    )


@pytest.mark.django_db
def test_dantes_pluto_is_seeded_under_european_only():
    """The inverse of what this test asserted until 2026-08-31.

    It used to be `test_pluto_stays_unseeded`, guarding "the one deliberate
    omission" on the reading that Pluto is Hades under a Roman name. The
    etymology behind that reading is right — Πλούτων is a Greek cult title from
    πλοῦτος, wealth (Plato, Cratylus 403a) — but **this cast is not the Greek
    cast**: Dante's Pluto bars the fourth circle (Inf. VII.2, "cominciò Pluto
    con la voce chioccia"), the European corpus already recorded him as circle
    4's guardian, and Charon / Minos / Cerberus are seeded here as exactly that
    kind of warden.

    The assertion is two-sided on purpose. One `Pluto` row is the fix; two —
    one per civilization — would be the duplicate the old merge existed to
    remove, arriving by the other door.
    """
    call_command(SEED_COMMAND, stdout=io.StringIO())

    plutos = sorted(
        Actor.all_objects.filter(name="Pluto").values_list("civilization", flat=True)
    )
    assert plutos == ["EUROPEAN"], (
        f"Pluto rows seeded under {plutos}. Exactly one is wanted, under "
        f"EUROPEAN: Dante's warden of the fourth circle. A GREEK one would be "
        f"the duplicate of Hades that the retired merge step existed to remove."
    )
    hades = Actor.all_objects.filter(name="Hades")
    assert [h.civilization for h in hades] == ["GREEK"], (
        "Hades must stay exactly one GREEK row — the two figures are distinct, "
        "not renamed."
    )


# Every `.py` directly under backend/scripts/, pinned.
#
# This list is the guard for the two checks below, and it is here because the
# previous version of this file needed one and did not have it. Both checks are
# `assert not <collection>` over `SCRIPTS_DIR.glob("*.py")`: with an empty or
# renamed directory they scan nothing, find nothing, and report a clean pass —
# indistinguishable at review time from a check that looked and was satisfied.
# A pinned inventory turns "there was nothing to examine" from a silent green
# into a stated fact, and makes a newly added script fail once, here, with a
# message pointing at the rule it now has to satisfy.
#
# Empty today, and that is the whole intent: the seeding entry point is
# `manage.py seed_mythology` and nothing else.
SCRIPTS_TODAY: list[str] = []

# Writing canon means calling one of these on one of those.
CANON_MODELS = {"Actor", "Realm"}
WRITE_METHODS = {"create", "get_or_create", "update_or_create", "bulk_create"}


def test_the_scripts_inventory_is_what_these_checks_believe_it_is():
    """The guard for the two checks below — see SCRIPTS_TODAY."""
    present = sorted(path.name for path in SCRIPTS_DIR.glob("*.py"))
    assert present == SCRIPTS_TODAY, (
        f"backend/scripts/ holds {present}; this file expects {SCRIPTS_TODAY}. "
        f"A script here is a second place canon can be written from, which is "
        f"the failure this whole file records. If the new one genuinely belongs, "
        f"add its name above and make sure it satisfies "
        f"test_no_script_writes_canon_rows and "
        f"test_scripts_only_name_realm_codes_that_are_alive_after_seeding."
    )


def _canon_writes_in(tree):
    """`Model.objects.<write>(...)` calls for a canon model, anywhere in the file.

    `ast.walk`, not `tree.body`. The check this replaces looked only at
    module-level assignments whose *name* ended in `_REALMS` / `_ACTORS`, and
    both halves of that were escapable — the copy that was actually sitting in
    this directory declared `actors_to_create` inside `main()`, so it matched
    neither the scope nor the naming convention and the check stayed green over
    five rows of actor canon that disagreed with the command on two of them.

    Matching the write rather than the table is the point. A table is a shape
    somebody has to have named a certain way; a call to
    `Actor.objects.get_or_create` is what a second seeder unavoidably does, and
    it does not care what the local variable holding its rows is called.
    """
    writes = set()
    for node in ast.walk(tree):
        if not isinstance(node, ast.Call):
            continue
        func = node.func
        if not isinstance(func, ast.Attribute) or func.attr not in WRITE_METHODS:
            continue
        # <Model>.objects.<write> or <Model>.all_objects.<write>
        manager = func.value
        if not isinstance(manager, ast.Attribute):
            continue
        model = manager.value
        if isinstance(model, ast.Name) and model.id in CANON_MODELS:
            writes.add(f"{model.id}.{manager.attr}.{func.attr}")
    return sorted(writes)


def test_no_script_writes_canon_rows():
    """No module under backend/scripts/ may seed realms or actors.

    The whole failure was two hand-maintained copies of the same rows, and the
    copy nothing covered was the one the deploy path ran. This is the shape
    check for a third — stated as "does it write canon" rather than "does it
    declare a table named like a seed table", because the version that asked
    the second question was passing while `populate_egyptian_actors.py` sat in
    this directory writing five actors through `Actor.objects.get_or_create`,
    two of which contradicted `apps/actors/mythology/actors_egyptian.py`
    (Horus as JUDGE against a sourced CONDUIT, Ammit in EG_ANNIHILATION against
    EG_HALL_TWO_TRUTHS).
    """
    offenders = {}
    for path in sorted(SCRIPTS_DIR.glob("*.py")):
        writes = _canon_writes_in(ast.parse(path.read_text(encoding="utf-8")))
        if writes:
            offenders[str(path.relative_to(REPO_ROOT))] = writes

    assert not offenders, (
        f"Scripts under backend/scripts/ write canon rows: {offenders}. The realm "
        f"and actor canon lives in apps/actors/mythology/ and is seeded by "
        f"apps/actors/management/commands/seed_mythology.py and nowhere else — a "
        f"second writer has to be edited in step by hand, and the copy that gets "
        f"forgotten is the one that silently overwrites the other on the next "
        f"deploy."
    )
