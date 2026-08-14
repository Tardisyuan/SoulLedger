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
    "EG_DUAT_ENTRY", "EG_HALL_TWO_TRUTHS", "EG_AARU", "EG_AM_TYAT", "EG_DEVOURER",
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
def test_pluto_stays_unseeded():
    """Guards the one deliberate omission, so it is not "restored" by mistake."""
    call_command(SEED_COMMAND, stdout=io.StringIO())

    resurrected = sorted(
        Actor.all_objects.filter(name__in=DELIBERATELY_NOT_CARRIED_OVER)
        .values_list("name", flat=True)
    )

    assert not resurrected, (
        f"{resurrected} is seeded again. Pluto is Hades under his Roman name; "
        f"`seed_mythology` seeds Hades and `consolidate_eu_pantheon` merges any "
        f"Pluto row into him. Seeding both manufactures on every fresh database "
        f"the duplicate that merge exists to remove."
    )


def test_the_second_copy_of_the_seed_tables_has_not_come_back():
    """No module under backend/scripts/ may redeclare the seed tables.

    The whole failure was two hand-maintained copies of the same rows. This is
    the shape check for a third: a module-level ``*_REALMS`` / ``*_ACTORS``
    table under scripts/ is a copy of what ``seed_mythology`` owns, wherever it
    came from.
    """
    copies = {}
    for path in sorted(SCRIPTS_DIR.glob("*.py")):
        tree = ast.parse(path.read_text(encoding="utf-8"))
        names = sorted({
            target.id
            for node in tree.body
            if isinstance(node, ast.Assign)
            for target in node.targets
            if isinstance(target, ast.Name)
            and target.id.endswith(("_REALMS", "_ACTORS"))
        })
        if names:
            copies[str(path.relative_to(REPO_ROOT))] = names

    assert not copies, (
        f"Seed tables have reappeared under backend/scripts/: {copies}. The realm "
        f"and actor canon lives in apps/actors/management/commands/seed_mythology.py "
        f"and nowhere else — a second copy has to be edited in step by hand, and "
        f"the copy that gets forgotten is the one that silently overwrites the "
        f"other on the next deploy."
    )
