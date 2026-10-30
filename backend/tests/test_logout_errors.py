"""Logout answers 400 only for a bad token (cq-backend 第 10 条, 2026-10-30).

It used to catch `Exception`, so a failure of ours (database, `signin_sessions.sign_out`) read "Invalid token"
to the client — a 400 that blames the caller, with nothing logged.
"""
from unittest import mock

import pytest
from rest_framework.test import APIClient
from rest_framework_simplejwt.tokens import RefreshToken

LOGOUT = "/api/v1/auth/logout/"


@pytest.fixture
def signed_in(django_user_model, cn_tenant):
    user = django_user_model.objects.create_user(username="logout_u", password="x", role="JUDGE", tenant=cn_tenant)
    client = APIClient()
    client.force_authenticate(user)
    return client, user


@pytest.mark.django_db
@pytest.mark.parametrize("refresh", ["not-a-jwt", 123, {"a": 1}])
def test_a_bad_token_is_a_400(signed_in, refresh):
    client, _ = signed_in
    response = client.post(LOGOUT, {"refresh": refresh}, format="json")
    assert response.status_code == 400
    assert response.data == {"detail": "Invalid token"}


@pytest.mark.django_db
def test_a_good_token_is_a_200(signed_in):
    client, user = signed_in
    assert client.post(LOGOUT, {"refresh": str(RefreshToken.for_user(user))}, format="json").status_code == 200


@pytest.mark.django_db
def test_our_own_failure_is_not_reported_as_an_invalid_token(signed_in):
    client, user = signed_in
    with (
        mock.patch("apps.authentication.signin_sessions.sign_out", side_effect=RuntimeError("db down")),
        pytest.raises(RuntimeError, match="db down"),
    ):
        client.post(LOGOUT, {"refresh": str(RefreshToken.for_user(user))}, format="json")
