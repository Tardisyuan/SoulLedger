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
FRONTEND = Path(__file__).resolve().parents[2] / "frontend"


def _roles_in(bundle):
    path = FRONTEND / "messages" / f"{bundle}.json"
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


def test_the_role_filter_offers_every_role():
    """The dropdown is a fourth copy of the enum, and it is hand-written.

    Reading the source rather than rendering it: what regresses is someone
    adding a role to the enum and not to this list, and that is visible in the
    text.
    """
    page = (FRONTEND / "app" / "users" / "page.tsx").read_text(encoding="utf-8")
    assert 'option value="ADMIN"' in page, (
        "the role filter's shape has changed; this test is reading for a "
        "pattern that no longer exists rather than checking anything"
    )
    missing = [r for r in UserRole.values if f'option value="{r}"' not in page]
    assert not missing, (
        f"app/users/page.tsx has no filter option for {missing}"
    )
