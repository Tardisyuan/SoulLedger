"""A password change signs the other devices out; their push registrations go with them.

`end_sessions` kills the logins, but an `OfficerPushDevice` row outlives it, so a signed-out phone
kept receiving pushes. Now: change-password with the app's own push token (`token`) keeps that one
registration and deletes the rest; without one (the web) it deletes all; the email reset (every
device is out) deletes all. A token that is not the caller's keeps nothing and is not an error.
A refused change deletes nothing.
"""
import pytest
from rest_framework.test import APIClient

from apps.officer_app.models import OfficerPushDevice
from tests import test_password_change_ends_other_sessions as base
from tests.test_password_change_ends_other_sessions import NEW, OLD, TestEmailReset, _change, _login

pytestmark = pytest.mark.django_db

officer = base.officer  # the fixture, reused by name

A = "ExponentPushToken[aaaaaaaaaaaaaaaaaaaaaa]"
B = "ExponentPushToken[bbbbbbbbbbbbbbbbbbbbbb]"
STRANGER = "ExponentPushToken[cccccccccccccccccccccc]"


@pytest.fixture
def devices(officer, django_user_model, cn_tenant):  # noqa: F811
    from django.utils import timezone

    now = timezone.now()
    mine = [OfficerPushDevice.objects.create(user=officer, token=t, platform="IOS", last_seen_at=now) for t in (A, B)]
    other = django_user_model.objects.create_user(username="elsewhere", password="x", role="JUDGE", tenant=cn_tenant)
    theirs = OfficerPushDevice.objects.create(user=other, token=STRANGER, platform="IOS", last_seen_at=now)
    return mine, theirs


def _tokens():
    return set(OfficerPushDevice.objects.values_list("token", flat=True))


def test_with_its_own_token_only_that_registration_survives(officer, devices):
    res = _change(_login(), token=A)
    assert res.status_code == 200, res.content
    assert _tokens() == {A, STRANGER}  # B is gone; somebody else's row is untouched


def test_without_a_token_the_web_change_deletes_every_registration_of_the_user(officer, devices):
    assert _change(_login()).status_code == 200
    assert _tokens() == {STRANGER}


def test_a_token_of_someone_else_keeps_nothing_and_is_not_an_error(officer, devices):
    res = _change(_login(), token=STRANGER)
    assert res.status_code == 200, res.content
    assert _tokens() == {STRANGER}  # the stranger's row is not touched, mine are all gone


def test_a_refused_change_deletes_nothing(officer, devices):
    assert _change(_login(), old="wrong-old-password", token=A).status_code == 400
    assert _change(_login(), new="12345678", token=A).status_code == 400
    assert _tokens() == {A, B, STRANGER}


class TestEmailResetDeletesThemAll:
    _link = TestEmailReset._link
    _confirm = TestEmailReset._confirm

    def test_email_reset_deletes_every_registration_of_the_user(self, officer, devices):
        uid, token = self._link(officer)
        assert self._confirm(uid, token, NEW).status_code == 200
        assert _tokens() == {STRANGER}

    def test_a_refused_reset_deletes_nothing(self, officer, devices):
        uid, token = self._link(officer)
        assert self._confirm(uid, token, "12345678").status_code == 400
        assert _tokens() == {A, B, STRANGER}


def test_the_app_sends_the_token_in_the_body_of_change_password(officer, devices):
    # the wire name, as the app and the generated client use it
    a = _login()
    c = APIClient()
    c.credentials(HTTP_AUTHORIZATION=f"Bearer {a['access']}")
    res = c.post("/api/v1/auth/change-password/",
                 {"old_password": OLD, "new_password": NEW, "refresh": a["refresh"], "token": B}, format="json")
    assert res.status_code == 200 and _tokens() == {B, STRANGER}
