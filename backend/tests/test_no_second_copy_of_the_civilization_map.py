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
DELIBERATE_HAND_COPIES = {BACKEND / "apps" / "souls" / "tests.py"}

TENANT_CODES = set(TENANT_CIVILIZATION)
CIVILIZATIONS = set(CIVILIZATION_TENANT)


def _python_files():
    for path in (BACKEND / "apps").rglob("*.py"):
        if "/migrations/" in str(path):
            continue
        yield path


def _name_of(node):
    if isinstance(node, ast.Constant):
        return node.value
    if isinstance(node, ast.Attribute):
        return node.attr
    return None


def _dict_literals(path):
    """Every dict literal in the file, as (keys, values) of *string* constants.

    AST, so a comment or a docstring that spells the mapping out in prose —
    and `CIVILIZATION_TENANT`'s own comment does — is not a match.
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
        keys = [_name_of(k) for k in node.keys]
        values = [_name_of(v) for v in node.values]
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
