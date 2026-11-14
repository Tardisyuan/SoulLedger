"""Civilization branches outside the cosmology registry may only go down (2026-11-14, expert design wave 3).

`apps.realms.cosmology.COSMOLOGY` is where a civilization's rules are registered. Every comparison against a
civilization literal elsewhere — `civ == Civilization.CHINESE`, `civilization != "EGYPTIAN"`,
`civ in ("EUROPEAN", "GREEK")`, `civ == "cn"` — is a rule that has not moved there yet. The ones that exist
today are listed below per file, and the list only shrinks (the shape of
`test_core_domains_do_not_reach_into_chat_and_social.py`):

  - a new comparison (a new file, or one more in a listed file) fails, and says where;
  - one that disappeared also fails, until its count is lowered here — a list that is allowed to be
    higher than the code would let the next branch in silently.

Counted with `ast`: a `Compare` with `==` / `!=` / `in` / `not in` one of whose operands is
`Civilization.<member>`, a civilization string (the enum values and the dossier's short codes cn / eu / eg /
gr), or a tuple / list / set holding one. Dict keys and `match` arms are not counted: a dict keyed by
civilization is the registry's own shape. Tests, migrations and `apps/realms/cosmology.py` are not read.

Measured 2026-11-14 on `d8faa436`: 63 comparisons in 26 files; after `route` and `outcome` moved into the
registry, 57 in 25 (`disposition/services.py` 4 → 0, `judgment/models.py` 3 → 1).
"""
import ast
from collections import Counter
from pathlib import Path

BACKEND = Path(__file__).resolve().parents[1]
REGISTRY = Path("apps/realms/cosmology.py")
MEMBERS = {"CHINESE", "EUROPEAN", "EGYPTIAN", "GREEK"}
LITERALS = MEMBERS | {"cn", "eu", "eg", "gr"}
OPS = (ast.Eq, ast.NotEq, ast.In, ast.NotIn)

# "<file under backend/>": comparisons against a civilization literal. Measured 2026-11-14.
BASELINE = {
    "apps/death_sync/tudi_views.py": 1,
    "apps/dispatch/capture.py": 3,
    "apps/disposition/destination.py": 2,
    "apps/disposition/expiry.py": 1,
    "apps/disposition/serializers.py": 1,
    "apps/judgment/appeals.py": 1,
    "apps/judgment/city_god_views.py": 1,
    "apps/judgment/city_gods.py": 1,
    "apps/judgment/claims.py": 1,
    "apps/judgment/dossier.py": 4,
    "apps/judgment/fail_reasons.py": 7,
    "apps/judgment/models.py": 1,
    "apps/judgment/serializers.py": 3,
    "apps/judgment/services.py": 2,
    "apps/judgment/weighing.py": 1,
    "apps/realms/path.py": 1,
    "apps/reincarnation/services.py": 3,
    "apps/sentence_plan/requests.py": 1,
    "apps/sentence_plan/soul_view.py": 1,
    "apps/soul_accounts/rebirth.py": 1,
    "apps/soul_push/services.py": 1,
    "apps/souls/models.py": 8,
    "apps/souls/serializers.py": 5,
    "apps/souls/stations.py": 2,
    "apps/workflow/services.py": 4,
}


def _is_civilization(node) -> bool:
    if isinstance(node, ast.Attribute) and node.attr in MEMBERS:
        owner = node.value
        return (isinstance(owner, ast.Name) and owner.id == "Civilization") or \
            (isinstance(owner, ast.Attribute) and owner.attr == "Civilization")
    if isinstance(node, ast.Constant) and isinstance(node.value, str):
        return node.value in LITERALS
    if isinstance(node, (ast.Tuple, ast.List, ast.Set)):
        return any(_is_civilization(e) for e in node.elts)
    return False


def count_branches(tree: ast.AST) -> int:
    return sum(
        1 for node in ast.walk(tree)
        if isinstance(node, ast.Compare) and any(isinstance(op, OPS) for op in node.ops)
        and any(_is_civilization(operand) for operand in (node.left, *node.comparators))
    )


def _runtime_files():
    for path in sorted((BACKEND / "apps").rglob("*.py")):
        rel = path.relative_to(BACKEND)
        if {"migrations", "tests"} & set(rel.parts) or path.name.startswith("test_") \
                or path.name in ("tests.py", "conftest.py") or rel == REGISTRY:
            continue
        yield rel, path


def _branches() -> Counter:
    found = Counter()
    for rel, path in _runtime_files():
        n = count_branches(ast.parse(path.read_text(encoding="utf-8"), filename=str(rel)))
        if n:
            found[rel.as_posix()] = n
    return found


def test_civilization_branches_only_go_down():
    found = _branches()
    grew = {f: (BASELINE.get(f, 0), n) for f, n in found.items() if n > BASELINE.get(f, 0)}
    assert not grew, (
        "New civilization branches (file: baseline -> now). Register the rule in "
        f"apps/realms/cosmology.py instead of comparing civilizations: {grew}"
    )
    shrank = {f: (n, found.get(f, 0)) for f, n in BASELINE.items() if found.get(f, 0) < n}
    assert not shrank, f"Fewer civilization branches than the baseline — lower BASELINE to match: {shrank}"


def test_the_counter_sees_every_form_it_claims_to():
    """The counter is the guard; a counter that matches nothing keeps any baseline green."""
    counted = [
        'civ == Civilization.CHINESE',
        'soul.civilization != models.Civilization.GREEK',
        'civ in ("EUROPEAN", "GREEK")',
        'civ not in [Civilization.EGYPTIAN]',
        'civ == "cn"',
        '"EGYPTIAN" == civ',
    ]
    for source in counted:
        assert count_branches(ast.parse(source)) == 1, source
    # Absence: what is not a branch on a civilization is not counted.
    not_counted = [
        'x = {Civilization.CHINESE: 1}',
        'verdict == "PURGATORY"',
        'civ == other_civ',
        'civ is Civilization.CHINESE',
        'f(Civilization.GREEK)',
    ]
    for source in not_counted:
        assert count_branches(ast.parse(source)) == 0, source


def test_the_registry_itself_is_not_read():
    assert (BACKEND / REGISTRY).is_file()
    assert REGISTRY.as_posix() not in {rel.as_posix() for rel, _ in _runtime_files()}
