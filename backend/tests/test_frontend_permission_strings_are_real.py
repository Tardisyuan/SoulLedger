"""Every `permissions="..."` in the frontend names a codename that exists.

Eleven distinct strings did not. Measured 2026-08-29 by diffing the frontend
against `DEFAULT_PERMISSIONS`:

    dispatch.create      -> the backend's create action wants dispatch.manage
    judgment.conclude    -> the conclude action wants judgment.execute
    menu.create/update/delete   -> every menu write is menu.manage
    user.create/update/delete   -> the only user codename is user.manage
    karma.export         -> never existed; perm/0016 renamed karma.* to ledger.*
    "ADMIN"              -> a role name passed to a codename check

Two of them were visibly broken. A JUDGE opening a judgment could pick a
verdict and had no submit button; GUARDIAN and MODERATOR could fill in the
whole dispatch-proposal form and were offered only "Cancel" -- all three are
roles the backend explicitly authorises for those actions.

The other nine were not visibly broken, and that is the more interesting half.
`usePermissions.hasPermission` returns `true` for ADMIN before it looks at the
string, and for anyone else asks whether the permission list contains it --
never true for a codename that does not exist. So each of those gates was
*exactly* "ADMIN only", by two accidents that cancelled. Removing the ADMIN
short-circuit is the most obvious hardening that file invites, and it would
have closed every one of those gates on **everyone, ADMIN included**, with
nothing going red.

Lives on the backend for the same reason `test_frontend_page_size.py` and its
sixteen siblings do: the catalogue is Django's, and a jest test would have to
hand-copy it to check anything.
"""
import re
from pathlib import Path

import pytest

from apps.perm.models import DEFAULT_PERMISSIONS, ROLE_PERMISSIONS

FRONTEND = Path(__file__).resolve().parents[2] / "frontend"
CATALOGUE = {codename for codename, _, _ in DEFAULT_PERMISSIONS}
GRANTED = {c for codenames in ROLE_PERMISSIONS.values() for c in codenames}

REPO = FRONTEND.parent

# `permissions="x"`, `permissions={"x"}`, `permissions={["x", "y"]}`, and the
# singular `permission=` that <RequireButton> takes.
_PROP = re.compile(r'permissions?=\{?\[?((?:\s*["\'][^"\']+["\']\s*,?)+)\]?\}?')
# `hasPermission("x")`, `hasAnyPermission(["x", "y"])`, `hasAllPermissions([...])`.
# The prop was the only spelling this guard read until 2026-09-14 (BT-07); four
# gates in pages and the judgment queue call the hook directly, and a typo in
# any of them made the gate ADMIN-only with this test green.
_CALL = re.compile(
    r'has(?:Any|All)?Permissions?\(\s*\[?((?:\s*["\'][^"\']+["\']\s*,?)+)\]?\s*\)'
)
# The officer App (`mobile-officer/`) spells its gates differently (audit 2026-11-11 G-01): `useCan("x")`
# and `permissions.includes("x")` / `held.includes("x")` on the officer's code list.
_USE_CAN = re.compile(r'useCan\(\s*((?:["\'][^"\']+["\']))\s*\)')
_HELD_INCLUDES = re.compile(r'\b(?:permissions|held)\??\.includes\(\s*((?:["\'][^"\']+["\']))\s*\)')
_STRING = re.compile(r'["\']([^"\']+)["\']')
#: A codename as the catalogue spells it — `family.action`. Used only inside the code tables below,
#: whose other strings are keys (`MODERATOR`, `approve`, a tab name).
_CODENAME_SHAPE = re.compile(r"^[a-z_]+\.[a-z_]+$")

#: Tables of codenames that are not a gate call: the officer App's tab and verdict codes, and core's rule
#: tables. Named, so a rename is red here instead of silently dropping the table from the scan. Besides
#: these, every `const <NAME>_CODENAMES` in any root is read too (the name says what it holds).
#: `*_CODES` is not swept by name: most of those are error-code lists (`CITY_GOD_CASE_ERROR_CODES` …).
CODE_TABLES = {
    "mobile-officer/src/kit.tsx": ("TAB_CODES",),
    "mobile-officer/src/rules.ts": ("VERDICT_CODES",),
}
_CODENAMES_CONST = re.compile(r"\bconst\s+([A-Z][A-Z0-9_]*_CODENAMES)\b")


#: Every tree that ships code calling the permission hook or the RBAC
#: components. `packages/core` is included because hooks move there
#: (six did on 2026-09-04) and a guard rooted in `frontend/` would lose them.
_ROOTS = (
    FRONTEND / "app",
    FRONTEND / "src",
    FRONTEND / "components",
    FRONTEND / "lib",
    REPO / "packages" / "core" / "src",
    # The officer App gates screens and buttons on the same catalogue (audit 2026-11-11 G-01).
    REPO / "mobile-officer" / "src",
)


def _sources():
    for root in _ROOTS:
        for path in root.rglob("*.ts*"):
            if path.suffix not in (".ts", ".tsx"):
                continue
            # Test files may name a codename that does not exist on purpose.
            if "__tests__" in path.parts or ".test." in path.name:
                continue
            yield path


_BLOCK_COMMENT = re.compile(r"/\*.*?\*/", re.S)
_LINE_COMMENT = re.compile(r"^\s*//.*$", re.M)


def _strip_comments(text):
    """Scan code, not prose.

    The first version of this guard flagged `permissions="ADMIN"` inside
    RequirePermission.tsx's own docstring, where it appears as the example of
    what not to write. A guard that reads commentary reports the documentation
    of a fixed bug as the bug.
    """
    return _LINE_COMMENT.sub("", _BLOCK_COMMENT.sub("", text))


def _literal_after(text, start):
    """The `[...]` or `{...}` literal that the declaration at `start` is assigned, brackets balanced."""
    eq = text.index("=", start)
    i = eq + 1
    while text[i] not in "[{":
        i += 1
    depth, j = 0, i
    while True:
        if text[j] in "[{":
            depth += 1
        elif text[j] in "]}":
            depth -= 1
            if depth == 0:
                return text[i: j + 1]
        j += 1


def _table_codenames(text, names):
    out = []
    for name in names:
        m = re.search(rf"\bconst\s+{name}\b", text)
        if m is None:
            raise AssertionError(f"code table {name} not found")
        out += [c for c in _STRING.findall(_literal_after(text, m.start())) if _CODENAME_SHAPE.match(c)]
    return out


def _usages():
    found = {}
    for path in _sources():
        rel = str(path.relative_to(REPO))
        text = _strip_comments(path.read_text(encoding="utf-8"))
        names = []
        for pattern in (_PROP, _CALL, _USE_CAN, _HELD_INCLUDES):
            for match in pattern.finditer(text):
                names += _STRING.findall(match.group(1))
        tables = CODE_TABLES.get(rel, ()) + tuple(_CODENAMES_CONST.findall(text))
        names += _table_codenames(text, tables)
        for name in names:
            found.setdefault(name, set()).add(rel)
    return found


def test_the_scan_finds_something():
    """A regex that matches nothing makes every assertion below vacuous.

    This repository has the shape on record: `assert not <empty set>` passes
    most cleanly when the set is empty for the wrong reason.
    """
    assert FRONTEND.is_dir(), f"{FRONTEND} not found"
    usages = _usages()
    assert len(usages) >= 20, (
        f"only {len(usages)} permission strings found across the frontend -- "
        f"the pattern has stopped matching, not the codebase stopped using them"
    )


def test_the_scan_reads_hook_calls_as_well_as_props():
    """The direct `hasPermission("...")` gates, named, so the call pattern
    cannot silently stop matching while the prop pattern keeps
    `test_the_scan_finds_something` above its floor."""
    usages = _usages()
    for name, path in (
        ("system.settings", "frontend/app/permissions/page.tsx"),
        ("audit.read", "frontend/app/audit/page.tsx"),
        ("judgment.execute", "frontend/src/components/judgment/JudgmentQueueConsole.tsx"),
    ):
        assert path in usages.get(name, set()), (
            f"hasPermission({name!r}) in {path} is not seen by the scan"
        )


def test_the_scan_reads_the_officer_app_spellings():
    """`useCan("…")`, `held.includes("…")` and the code tables, each named, so one spelling cannot stop
    matching while the others keep the floor above. Before 2026-11-11 `mobile-officer/` was not scanned at all."""
    usages = _usages()
    for name, path in (
        ("judgment.assign", "mobile-officer/src/screens/judgmentActions.tsx"),  # useCan
        ("wangsi.execute", "mobile-officer/src/kit.tsx"),  # TAB_CODES
        ("dispatch.reject", "mobile-officer/src/rules.ts"),  # VERDICT_CODES
        ("workflow.approve", "mobile-officer/src/screens/todo.tsx"),  # held.includes
        ("reincarnation.read", "mobile-officer/src/screens/soulDetail.tsx"),  # permissions.includes
        ("recycle_bin.restore", "packages/core/src/api/perm.ts"),  # ADMIN_ONLY_CODENAMES
    ):
        assert path in usages.get(name, set()), f"{name!r} in {path} is not seen by the scan"


def test_a_misspelt_officer_app_codename_is_caught(tmp_path, monkeypatch):
    """The guard of the guard: a typo in each new spelling lands in the unknown set."""
    app = tmp_path / "mobile-officer" / "src"
    app.mkdir(parents=True)
    (app / "kit.tsx").write_text('export const TAB_CODES = { todo: ["workflow.aprove"], me: null };\n', encoding="utf-8")
    (app / "rules.ts").write_text('const VERDICT_CODES = { x: { approve: "dispatch.aprove", reject: "dispatch.reject" } };\n',
                                  encoding="utf-8")
    (app / "screen.tsx").write_text(
        'const a = useCan("judgment.asign");\nconst b = held.includes("soul.raed");\n'
        '// useCan("comment.only") is prose, not a gate\n', encoding="utf-8")
    monkeypatch.setitem(globals(), "REPO", tmp_path)
    monkeypatch.setitem(globals(), "_ROOTS", (app,))
    found = _usages()
    assert {"workflow.aprove", "dispatch.aprove", "judgment.asign", "soul.raed"} <= set(found) - CATALOGUE
    assert "comment.only" not in found


def test_every_permission_string_names_a_real_codename():
    unknown = {
        name: sorted(where)
        for name, where in _usages().items()
        if name not in CATALOGUE
    }
    assert unknown == {}, (
        f"{len(unknown)} permission string(s) are not in the backend "
        f"catalogue, so `hasPermission` can never return True for them and "
        f"the gate is ADMIN-only by accident: "
        + "; ".join(f"{k} ({', '.join(v)})" for k, v in sorted(unknown.items()))
        + ". Gate on the role with <RequireAdmin> if that is what is meant."
    )


def test_every_permission_string_is_held_by_someone():
    """A codename in the catalogue that no role holds is a gate nobody opens.

    Weaker than the check above and worth keeping separate: this one can fail
    because a *grant* was removed, which is a different mistake with a
    different fix.
    """
    orphaned = {
        name: sorted(where)
        for name, where in _usages().items()
        if name in CATALOGUE and name not in GRANTED
    }
    assert orphaned == {}, (
        "gated on codename(s) no role holds: "
        + "; ".join(f"{k} ({', '.join(v)})" for k, v in sorted(orphaned.items()))
    )


@pytest.mark.parametrize(
    "path,expected",
    [
        ("app/dispatch/propose/page.tsx", "dispatch.manage"),
        ("app/judgment/[id]/page.tsx", "judgment.execute"),
    ],
)
def test_the_two_that_were_visibly_broken_now_name_the_right_thing(path, expected):
    """Named individually because these two cost a role a working screen.

    The general assertion above would also pass if someone swapped them for
    any other real codename.
    """
    text = (FRONTEND / path).read_text(encoding="utf-8")
    assert f'permissions="{expected}"' in text, (
        f"{path} no longer gates on {expected}"
    )
