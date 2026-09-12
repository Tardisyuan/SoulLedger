"""Every `UserRole` member has a label in all three message bundles.

MODERATOR was missing from all three, and from the role filter on
`app/users/page.tsx`, while `apps/perm/models.py::ROLE_PERMISSIONS` granted it
a strictly larger set than JUDGE and `check_permission` honoured every bit of
it. A MODERATOR's row rendered as "unrecognised value" and the filter could
not select them.

WHY THE EXISTING GUARDS COULD NOT SEE IT. The bundles are checked against each
other for key parity, and all three were missing the same key, so parity held.
`civilizationCopyCoverage.test.ts` compares against `CIVILIZATION_OPTIONS` and
does not look at roles. Nothing compared a bundle to a backend enum.

This is the shape the repository already has on record -- three tables that
agree with one another and are all wrong together -- and the answer is the
same one it reached before: compare against the authority, and say which side
the authority is. It is the backend enum.

Follows the pattern of the 17 backend tests that already read frontend source
(`test_frontend_page_size.py` and friends), which is why it lives here and not
in jest: the fact being asserted belongs to Django.
"""
import json
from pathlib import Path

import pytest

from apps.authentication.models import UserRole

BUNDLES = ("zh-Hans", "en", "egy")
REPO_ROOT = Path(__file__).resolve().parents[2]
FRONTEND = REPO_ROOT / "frontend"


def _roles_in(bundle):
    path = REPO_ROOT / "packages" / "core" / "messages" / f"{bundle}.json"
    assert path.exists(), f"{path} not found; this test is measuring nothing"
    data = json.loads(path.read_text(encoding="utf-8"))
    return data.get("users", {}).get("roles", {})


@pytest.mark.parametrize("bundle", BUNDLES)
def test_every_role_has_a_label(bundle):
    labels = _roles_in(bundle)
    assert labels, f"users.roles is empty in {bundle}.json"

    missing = [r for r in UserRole.values if r not in labels]
    assert not missing, (
        f"{bundle}.json has no label for {missing}. The UI renders an unknown "
        f"role as an unrecognised value, and users holding it cannot be "
        f"filtered for. Key parity between the three bundles cannot catch this "
        f"-- they were all missing MODERATOR together."
    )

    blank = [r for r in UserRole.values if not str(labels.get(r, "")).strip()]
    assert not blank, f"{bundle}.json has empty labels for {blank}"


@pytest.mark.parametrize("bundle", BUNDLES)
def test_no_bundle_invents_a_role(bundle):
    """The other direction: a label for a role that no longer exists.

    Harmless on screen and a reliable sign that a rename went half-done.
    """
    extra = [r for r in _roles_in(bundle) if r not in UserRole.values]
    assert not extra, (
        f"{bundle}.json labels {extra}, which are not UserRole members"
    )


@pytest.mark.parametrize(
    "rel",
    ["app/users/page.tsx", "src/components/users/UserModal.tsx"],
)
def test_the_role_selectors_read_the_role_table_not_a_restated_list(rel):
    """Neither role dropdown restates the enum any more.

    This used to assert the opposite — that `app/users/page.tsx` carried an
    `<option value="…">` for every `UserRole` member — because the dropdown was
    a hand-written fourth copy of the enum and MODERATOR had been left out of
    it. Since 2026-09-12 `User.role` is validated against the role table (a
    role created on the permissions screen can be held), so ANY list written
    into the page is wrong the moment an admin creates one. Both selectors now
    read `permApi.roles.list()`; what this pins is that no literal role option
    creeps back in beside it.
    """
    page = (FRONTEND / rel).read_text(encoding="utf-8")
    assert "permApi.roles.list()" in page, f"{rel} no longer reads the role table"
    restated = [r for r in UserRole.values if f'value="{r}"' in page or f'value: "{r}"' in page]
    assert not restated, f"{rel} restates role option(s) {restated} beside the table-driven list"
