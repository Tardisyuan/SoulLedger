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

# `permissions="x"`, `permissions={"x"}`, `permissions={["x", "y"]}`
_PROP = re.compile(r'permissions=\{?\[?((?:\s*["\'][^"\']+["\']\s*,?)+)\]?\}?')
_STRING = re.compile(r'["\']([^"\']+)["\']')


def _sources():
    for root in ("app", "src"):
        for path in (FRONTEND / root).rglob("*.tsx"):
            # Test files may name a codename that does not exist on purpose.
            if "__tests__" in path.parts:
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


def _usages():
    found = {}
    for path in _sources():
        text = _strip_comments(path.read_text(encoding="utf-8"))
        for match in _PROP.finditer(text):
            for name in _STRING.findall(match.group(1)):
                found.setdefault(name, set()).add(
                    str(path.relative_to(FRONTEND))
                )
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
        f"gated on codename(s) no role holds: "
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
