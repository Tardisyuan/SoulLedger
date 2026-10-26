"""Public self-registration was removed (user decision 2026-10-27, security review #2).

It created a tenantless VIEWER for anyone and answered "already registered" for known
emails / usernames. Accounts are made by admin, invite or CSV import.
"""
import pytest
from django.urls import NoReverseMatch, reverse

from apps.authentication.models import User


@pytest.mark.django_db
def test_post_to_register_is_not_found_and_creates_nobody(api_client):
    before = User.objects.count()
    response = api_client.post(
        "/api/v1/auth/register/",
        {"username": "walkin", "email": "walkin@example.com", "password": "StrongPass1!x"},
        format="json",
    )
    assert response.status_code in (404, 405), response.status_code
    assert User.objects.count() == before
    assert not User.objects.filter(username="walkin").exists()


def test_the_route_name_is_gone():
    with pytest.raises(NoReverseMatch):
        reverse("register")
