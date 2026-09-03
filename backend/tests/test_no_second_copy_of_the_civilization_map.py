"""文明→租户的映射只能有一份,写在 `apps/souls/models.py` 里。

`CIVILIZATION_TENANT` 那段注释说得很清楚:这份映射「曾存在于另外三处,各自可以
漂移」,所以它被导出,并写下「需要这个方向的调用方 import 它,而不是自己写一份」。

**然后 `apps/souls/querysets.py` 又写了第四份**,缺 GREEK,并且未命中时
`return self` —— 返回全集。2026-08-29 实测 `filter_by_civilization("GREEK")`
返回了包括中国灵魂在内的每一条。那份已删。

这个文件让第五份出现时报红。用 AST 走,不是字符串搜索:这个仓库被「扫描器读到
自己的注释」咬过至少六次,而上面那段注释本身就含 `CHINESE -> CN_DIYU`。

迁移不在范围内:一个迁移必须钉住它跑的那一刻的事实,import 运行时常量会让
历史跟着今天变。
"""
import ast
import pathlib

import pytest

from apps.souls.models import CIVILIZATION_TENANT, TENANT_CIVILIZATION

BACKEND = pathlib.Path(__file__).resolve().parent.parent
CANONICAL = BACKEND / "apps" / "souls" / "models.py"

#: Files whose copy is the point. A test that took its expectations from
#: `TENANT_CIVILIZATION` would follow that map wherever it went, so
#: `apps/souls/tests.py::TestTenantCivilizationMapping.KNOWN` is written out by
#: hand deliberately — and it is paired there with a test asserting the two
#: agree, which is what catches a hand-written list going short. (It had:
#: GR_HADES was missing.)
#: `apps/disposition/tests.py:273` joined this list when the value side started
#: being read recursively — its `cls.tenants` is keyed by civilization with
#: `Tenant.objects.create(code="CN_DIYU", …)` on the value side, which is the
#: shape the old top-level read could not see. It qualifies on the same terms
#: as its neighbour and not on "it is a test": the dict is paired, fifteen lines
#: below it, with `test_the_tenant_map_covers_every_civilization`, which asserts
#: `set(cls.tenants) == set(TENANT_CIVILIZATION.values())`. That assertion is
#: the thing that goes red when a fifth civilization appears, so the copy cannot
#: go short — which is the entire reason this file exists. A hand copy WITHOUT
#: such a pairing does not belong here; it belongs fixed.
DELIBERATE_HAND_COPIES = {
    BACKEND / "apps" / "souls" / "tests.py",
    BACKEND / "apps" / "disposition" / "tests.py",
}

TENANT_CODES = set(TENANT_CIVILIZATION)
CIVILIZATIONS = set(CIVILIZATION_TENANT)


def _python_files():
    for path in (BACKEND / "apps").rglob("*.py"):
        if "/migrations/" in str(path):
            continue
        yield path


def _name_of(node):
    """The name a KEY spells, from its own node only.

    Keys stay shallow on purpose. Widening them is the obvious move and it is
    wrong here: a scan for "dicts keyed by two or more civilizations" matches 75
    places in this repository, nearly all of them legitimate — migrations
    freezing the choice set as it stood, and commands that deliberately handle
    one civilization. The allowlist that would follow is longer than the rule.
    """
    if isinstance(node, ast.Constant):
        return node.value
    if isinstance(node, ast.Attribute):
        return node.attr
    return None


def _names_in(node):
    """Every string constant and attribute name **anywhere inside** a VALUE.

    Values go deep because a copy does not have to spell the tenant code as a
    bare literal to be a copy:

        {Civilization.CHINESE: Tenant.objects.get(code="CN_DIYU"), ...}
        {Civilization.CHINESE: TENANTS["CN_DIYU"], ...}

    Both are the mapping, written out by hand, drifting on their own. Reading
    only the value's top-level node sees a `Call` and a `Subscript`, finds no
    string, and passes them — measured: the first two of those samples were let
    through while the bare-literal spelling was caught.

    This does not widen what counts as a match, only where the tenant code may
    be found: the rule still needs civilizations on one side and tenant codes on
    the other, so a dict keyed by civilizations whose values never mention a
    tenant is still not a mapping and is still ignored.
    """
    names = []
    for child in ast.walk(node):
        if isinstance(child, ast.Constant) and isinstance(child.value, str):
            names.append(child.value)
        elif isinstance(child, ast.Attribute):
            names.append(child.attr)
    return names


def _dict_literals(path):
    """Every dict literal in the file, as (key names, value names).

    AST, so a comment or a docstring that spells the mapping out in prose —
    and `CIVILIZATION_TENANT`'s own comment does — is not a match.

    Keys are read from their own node; values are read recursively. See
    `_name_of` and `_names_in` for why the two sides are treated differently.
    """
    tree = ast.parse(path.read_text())
    for node in ast.walk(tree):
        if not isinstance(node, ast.Dict):
            continue
        # `Civilization.CHINESE: "CN_DIYU"` and `"CN_DIYU": Civilization.CHINESE`
        # both appear in this repo, so an attribute has to read as its own
        # name on **either** side. Reading only the constants missed the
        # canonical map entirely — which is exactly what
        # `test_the_detector_recognises_the_canonical_map_itself` caught.
        keys = [_name_of(k) for k in node.keys if k is not None]
        values = [name for v in node.values for name in _names_in(v)]
        yield node.lineno, keys, values


def _looks_like_the_map(keys, values):
    keys = {k for k in keys if isinstance(k, str)}
    values = {v for v in values if isinstance(v, str)}
    if len(keys) < 2:
        return False
    forwards = keys <= CIVILIZATIONS and len(values & TENANT_CODES) >= 2
    backwards = keys <= TENANT_CODES and len(values & CIVILIZATIONS) >= 2
    return forwards or backwards


@pytest.mark.parametrize(
    "path", sorted(_python_files()), ids=lambda p: str(p.relative_to(BACKEND))
)
def test_only_the_canonical_module_writes_the_mapping_out(path):
    if path == CANONICAL or path in DELIBERATE_HAND_COPIES:
        return
    copies = [
        f"{path.relative_to(BACKEND)}:{lineno}"
        for lineno, keys, values in _dict_literals(path)
        if _looks_like_the_map(keys, values)
    ]
    assert copies == [], (
        f"这里又手写了一份文明↔租户映射:{copies}。"
        f"从 apps.souls.models import CIVILIZATION_TENANT / TENANT_CIVILIZATION —— "
        f"手抄副本正是 GREEK 在第四份里缺席、而未命中返回全集的原因。"
    )


def test_the_detector_recognises_the_canonical_map_itself():
    """守卫的守卫。

    上面那条是 `assert copies == []`。**检测器认不出任何东西时它最干净** ——
    而「一份副本都没有」和「检测器坏了」在输出里长得一样。这条要求它至少能
    认出真品。
    """
    hits = [
        lineno
        for lineno, keys, values in _dict_literals(CANONICAL)
        if _looks_like_the_map(keys, values)
    ]
    assert hits, (
        "检测器在 apps/souls/models.py 里都认不出那份映射 —— "
        "上面那条断言因此什么都没检查"
    )


# ---------------------------------------------------------------------------
# The detector's own coverage, by spelling
# ---------------------------------------------------------------------------

#: Three ways to write the mapping, and one thing that is not the mapping.
#:
#: The first was already caught. The middle two were **not**: reading only a
#: value's top-level node sees a `Call` and a `Subscript`, finds no string, and
#: lets a hand-written copy through. That is what `_names_in` fixed.
#:
#: The last is the real dict from
#: `apps/tenants/management/commands/migrate_to_multitenant.py`, deleted in
#: `d1fcb8f` and recoverable with
#: `git show d1fcb8f^:backend/apps/tenants/management/commands/migrate_to_multitenant.py`.
#: It is here as a **negative**, and deliberately so: that command's commit
#: message called it "a hand-written three-key copy of the civilization map",
#: and it is not one. It is keyed by tenant code with `Tenant` objects on the
#: value side and does not name a civilization anywhere, so it is a tenant
#: lookup table, not a mapping between the two. Its real defect — three entries
#: against a live four, hence `KeyError: 'GR_HADES'` — is a different failure
#: from the one this file guards, and widening this file to cover it was
#: measured at **75 hits across the repository**, nearly all of them migrations
#: freezing the choice set as it stood. This case pins that boundary so the
#: next person does not re-widen it.
SPELLINGS = {
    "literal string value": (
        'M = {Civilization.CHINESE: "CN_DIYU",'
        '     Civilization.EUROPEAN: "EU_HEAVEN_HELL"}',
        True,
    ),
    "tenant code inside a call": (
        'M = {Civilization.CHINESE: Tenant.objects.get(code="CN_DIYU"),'
        '     Civilization.EUROPEAN: Tenant.objects.get(code="EU_HEAVEN_HELL")}',
        True,
    ),
    "tenant code inside a subscript": (
        'M = {Civilization.CHINESE: TENANTS["CN_DIYU"],'
        '     Civilization.EUROPEAN: TENANTS["EU_HEAVEN_HELL"]}',
        True,
    ),
    "tenant lookup table, no civilization named": (
        'tenants = {"CN_DIYU": Tenant.objects.get_or_create(code="CN_DIYU")[0],'
        '           "EU_HEAVEN_HELL": Tenant.objects.get_or_create(code="EU_HEAVEN_HELL")[0]}',
        False,
    ),
}


@pytest.mark.parametrize(
    "source,expected", list(SPELLINGS.values()), ids=list(SPELLINGS)
)
def test_the_detector_sees_the_mapping_however_the_value_is_written(
    source, expected, tmp_path
):
    """A copy is a copy whether or not the tenant code is a bare literal.

    Goes through `_dict_literals` on a real file rather than calling the two
    helpers directly. The first version of this test did call them directly and
    was worthless: reverting the value side of `_dict_literals` to the
    top-level-only read — the exact regression these cases exist to catch —
    left all four green, because the test never went through the line that had
    been changed. The mutation landed on disk and the assertions did not pass
    over it.
    """
    module = tmp_path / "sample.py"
    module.write_text(source)
    verdicts = [
        _looks_like_the_map(keys, values)
        for _, keys, values in _dict_literals(module)
    ]
    assert any(verdicts) is expected, (
        f"expected {'a match' if expected else 'no match'} for this spelling, "
        f"got {verdicts}:\n{source}"
    )
