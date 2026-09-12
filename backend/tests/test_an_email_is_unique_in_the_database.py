"""An address can be held by one live user, and the database says so.

BP-04, second half. The serializer check landed on 2026-09-12 (`a6a0c49`) and
closed the path where a PATCH to `/auth/profile/` claimed the victim's address
and broke their password reset. What it could not close is the race: two
concurrent requests both read "no such address", both pass `validate_email`,
and both write. A check in application code is not a uniqueness guarantee; the
index is.

Scope, measured on the shared box 2026-09-12 before adding the constraint:
100 users, **97 with no address at all**, zero case-insensitive duplicates. So
`""` has to stay outside the index (97 rows would collide on day one) and no
data migration is needed.

Soft-deleted rows are outside it too: deactivating a user should free their
address for a new account, and `is_deleted` rows are invisible to `objects`
anyway.
"""
import pytest
from django.contrib.auth import get_user_model
from django.db import IntegrityError, transaction

User = get_user_model()


@pytest.mark.django_db
def test_two_live_users_cannot_hold_the_same_address():
    User.objects.create_user(username="meng", password="x", email="meng@diyu.test")
    with pytest.raises(IntegrityError), transaction.atomic():
        User.objects.create_user(username="impostor", password="x", email="meng@diyu.test")


@pytest.mark.django_db
def test_case_alone_does_not_make_a_different_address():
    """`Lower(email)` — the reset lookup is case-insensitive, so the index must be too.

    Without `Lower`, `Meng@` and `meng@` are two rows, the reset query matches
    two users, and the "which account is this" question has no answer.
    """
    User.objects.create_user(username="meng", password="x", email="Meng@Diyu.test")
    with pytest.raises(IntegrityError), transaction.atomic():
        User.objects.create_user(username="impostor", password="x", email="meng@diyu.test")


@pytest.mark.django_db
def test_the_empty_address_is_not_a_duplicate():
    """97 of 100 rows on the shared box have no address; they must all be legal."""
    User.objects.create_user(username="a", password="x", email="")
    User.objects.create_user(username="b", password="x", email="")
    User.objects.create_user(username="c", password="x")
    assert User.objects.filter(email="").count() == 3


@pytest.mark.django_db
def test_a_soft_deleted_row_frees_its_address():
    gone = User.objects.create_user(username="gone", password="x", email="seat@diyu.test")
    gone.is_deleted = True
    gone.save(update_fields=["is_deleted"])

    User.objects.create_user(username="heir", password="x", email="seat@diyu.test")

    # And the live one is the only one `objects` will hand back — the reset
    # lookup must not become ambiguous because a deleted row shares the address.
    assert User.objects.filter(email="seat@diyu.test").count() == 1
    assert User.all_objects.filter(email="seat@diyu.test").count() == 2
