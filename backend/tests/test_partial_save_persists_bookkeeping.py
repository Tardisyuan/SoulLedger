"""`AuditUserFields.save(update_fields=...)` writes `version`, `update_user` and `update_time` too (2026-10-30).

Before, a partial save bumped `version` and set `update_user` in memory only and never touched `update_time`:
the role relabel in `perm/export.py` left the optimistic-lock version where it was (so a matrix edit made against
the old labels was not refused), and every caller that cared listed the three by hand (judgment had three copies).
"""
import datetime

import pytest
from django.utils import timezone

from apps.authentication.models import User
from apps.core.request_local import clear_current_user, set_current_user
from apps.perm.export import import_permissions
from apps.perm.models import Role

pytestmark = pytest.mark.django_db


def _row(role):
    return Role.objects.filter(pk=role.pk).values("version", "update_user_id", "update_time", "description").get()


@pytest.fixture
def role():
    r = Role.objects.create(name="PS_ROLE", display_name="PS", description="old")
    long_ago = timezone.now() - datetime.timedelta(days=3)
    Role.objects.filter(pk=r.pk).update(update_time=long_ago)
    return Role.objects.get(pk=r.pk)


def test_a_partial_save_writes_the_three_bookkeeping_fields(role):
    editor = User.objects.create_user(username="ps_editor", password="x", role="ADMIN")
    before = _row(role)
    role.description = "new"
    set_current_user(editor)
    try:
        role.save(update_fields=["description"])
    finally:
        clear_current_user()
    after = _row(role)
    assert after["description"] == "new"
    assert after["version"] == before["version"] + 1
    assert after["update_user_id"] == editor.pk
    assert after["update_time"] > before["update_time"]


def test_an_empty_update_fields_still_writes_nothing(role):
    before = _row(role)
    role.description = "not written"
    role.save(update_fields=[])
    assert _row(role) == before


def test_the_role_relabel_in_an_overwrite_import_advances_the_version(role, settings):
    settings.PERM_IMPORT_OVERWRITE_ENABLED = True
    before = _row(role)["version"]
    import_permissions({"roles": [{"name": "PS_ROLE", "display_name": "PS", "description": "relabelled"}]},
                       overwrite=True)
    after = _row(role)
    assert after["description"] == "relabelled"
    assert after["version"] == before + 1, "a stale expected_version would still match the relabelled role"
