"""A refresh token whose account no longer exists is a 401, not a 500.

simplejwt 5.5.1 looks the user up with a bare `.get()`; the officer app on the simulator
(2026-10-27) held a token for a test account that had since been removed and every refresh
was a 500, so the app showed 「没取到」 instead of going back to sign-in.
"""
import pytest
from django.core.cache import cache
from rest_framework.test import APIClient

pytestmark = pytest.mark.django_db


def test_refresh_after_the_account_is_deleted_is_401(judge_user):
    cache.clear()
    login = APIClient().post("/api/v1/auth/login/", {"username": "judge", "password": "judge123"}, format="json")
    assert login.status_code == 200
    type(judge_user).objects.filter(pk=judge_user.pk).delete()
    resp = APIClient().post("/api/v1/auth/refresh/", {"refresh": login.data["refresh"]}, format="json")
    assert resp.status_code == 401
