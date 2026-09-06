"""A secret's value never enters an audit row.

Why this file exists
--------------------
Measured 2026-09-07, by running it: changing a user's password wrote **both the
old and the new** `pbkdf2_sha256$…` hash into `AuditLog.changes`::

    changes["password"] = ['pbkdf2_sha256$1000000$7IHUtlqunl…',
                           'pbkdf2_sha256$1000000$…']

`_build_changes` diffed every field in `instance._meta.fields` and its
`skip_fields` set listed only bookkeeping columns — `id`, `version`,
`create_time` and so on. `AuditLogSerializer` returns `changes` verbatim
(`apps/audit/serializers.py:36`), and `audit.read` is held by ADMIN *and*
MODERATOR (`apps/perm/models.py:311,386`). So a MODERATOR could read every
password hash the system had ever re-written.

All three password paths use `set_password` then `save(update_fields=['password'])`
(`apps/authentication/views.py:196,622,724`). `_on_post_save` does not consult
`update_fields`, so a targeted single-column save was audited in full like any
other write.

Hashes rather than plaintext, but a hash is offline-crackable material and the
other two cases were worse: `EncryptedCharField.signing_secret` and
`EncryptedJSONField.source_payload` decrypt in `from_db_value`, so the diff saw
plaintext.

What this pins, and why the field name survives
-----------------------------------------------
Only the *values* are replaced; the key stays. "The signing secret was rotated,
by this user, at this time" is precisely what an audit trail is for. Dropping
the key would trade a leak for a blind spot.

What "would really fail" means here
-----------------------------------
Each assertion was checked by breaking it, before being trusted green:

* removing `'password'` from `SECRET_FIELD_NAMES` **alone leaves the suite
  green** — the first draft of this docstring claimed otherwise, and running it
  disproved the claim. `password` is covered twice: by the explicit set and by
  the `'password'` hint. Removing it from **both** reddens three tests, and the
  failure message carries a real `pbkdf2_sha256$…` hash, which is how the
  original defect was found. The redundancy is deliberate (a name set that
  someone edits and a hint rule that survives the edit), but it means neither
  half can be validated by deleting the other — a mutation test has to remove
  both, and this note exists so the next person does not repeat the mistake of
  deleting one, seeing green, and concluding the guard is fake;
* removing the `Encrypted` type test from `_is_secret_field` reddens
  `test_the_type_test_covers_a_field_no_name_rule_would`, which uses a field
  named `payload_blob` — deliberately a name that matches none of the hints, so
  it can only pass via the type branch;
* emptying `SECRET_NAME_HINTS` reddens
  `test_a_future_secret_is_covered_by_the_hint_rule`;
* returning `None` from `_build_changes` for a secret-only change (rather than
  a redacted entry) reddens
  `test_the_field_name_survives_redaction`, which is the "leak traded for a
  blind spot" case.
"""

import pytest
from django.contrib.auth.hashers import make_password

from apps.audit.models import AuditLog
from apps.audit.signals import (
    REDACTED,
    SECRET_FIELD_NAMES,
    SECRET_NAME_HINTS,
    _build_changes,
    _is_secret_field,
)
from apps.authentication.models import User


def _field(model, name):
    return model._meta.get_field(name)


def test_the_guard_has_subjects():
    """Non-vacuity: every assertion below is trivially green over empty sets."""
    assert len(SECRET_FIELD_NAMES) >= 5
    assert len(SECRET_NAME_HINTS) >= 3
    # And the field this was found on must still exist, and must still be one of
    # the fields `_build_changes` walks — it iterates `_meta.fields`.
    assert "password" in {f.name for f in User._meta.fields}


# `transaction=True` is required, not stylistic. `apps/audit/signals.py` writes
# through `transaction.on_commit`, and plain `django_db` wraps the test in an
# atomic block that is rolled back — the callbacks never run and `AuditLog` is
# empty. `apps/audit/oncommit_guard.py` exists to catch exactly this mistake,
# and caught it here: the first run of this file failed with "the password
# change produced no audit row at all".
@pytest.mark.django_db(transaction=True)
class TestSecretsNeverReachAuditRows:
    def test_a_password_change_is_recorded_without_the_hash(self, cn_tenant):
        user = User.objects.create_user(
            username="secret_probe", password="OldPass!123", role="VIEWER", tenant=cn_tenant
        )
        AuditLog.objects.all().delete()

        old_hash = user.password
        user.set_password("NewSecret!456")
        new_hash = user.password
        user.save(update_fields=["password"])

        rows = list(AuditLog.objects.all())
        assert rows, "the password change produced no audit row at all"

        for row in rows:
            blob = str(row.changes)
            assert old_hash not in blob, f"old password hash present in {row.changes}"
            assert new_hash not in blob, f"new password hash present in {row.changes}"
            assert "pbkdf2_" not in blob, f"a Django password hash is present in {row.changes}"

    def test_the_field_name_survives_redaction(self, cn_tenant):
        """A redacted entry, not a dropped one: the event must stay auditable."""
        user = User.objects.create_user(
            username="secret_probe_2", password="OldPass!123", role="VIEWER", tenant=cn_tenant
        )
        before = User.objects.get(pk=user.pk)
        user.password = make_password("Another!789")

        changes = _build_changes(user, before)
        assert changes is not None, "a secret-only change must still produce a row"
        assert changes["password"] == [REDACTED, REDACTED]


class TestTheThreeTestsAreIndependent:
    """Each branch of `_is_secret_field` is load-bearing on its own."""

    def test_the_name_rule_covers_the_field_this_was_found_on(self):
        assert _is_secret_field(_field(User, "password"))

    def test_a_future_secret_is_covered_by_the_hint_rule(self):
        class _Fake:
            name = "webhook_secret_v2"  # in no explicit set, matches a hint

        assert _is_secret_field(_Fake())

    def test_the_type_test_covers_a_field_no_name_rule_would(self):
        class EncryptedThingField:
            name = "payload_blob"  # matches no name and no hint

        assert not any(h in "payload_blob" for h in SECRET_NAME_HINTS)
        assert "payload_blob" not in SECRET_FIELD_NAMES
        assert _is_secret_field(EncryptedThingField())

    def test_an_ordinary_field_is_not_redacted(self):
        """The inverse assertion. A guard that redacts everything hides the log."""
        assert not _is_secret_field(_field(User, "username"))
        assert not _is_secret_field(_field(User, "role"))
