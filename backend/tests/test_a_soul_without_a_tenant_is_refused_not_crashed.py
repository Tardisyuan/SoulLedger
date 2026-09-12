"""Creating a soul with no tenant to give it is a 400, not a 500.

BD-07, 2026-09-12. `Soul.save` resolves the tenant from the request (token
claim, then the user's own column) and, finding neither, raises Django's
`ValidationError`. DRF converts only its own `serializers.ValidationError`
into a response; Django's propagates out of `perform_create` as an unhandled
exception. The caller that hits this is an ADMIN with `tenant = NULL` — the
one role allowed to exist without a tenant — posting without a `tenant_code`
claim. They got a 500 and a traceback for what is a request problem.
"""
import pytest
from django.contrib.auth import get_user_model
from rest_framework.test import APIClient

from apps.souls.models import Soul

User = get_user_model()
URL = "/api/v1/souls/"


@pytest.mark.django_db
def test_an_admin_with_no_tenant_gets_a_400_and_no_row(db):
    admin = User.objects.create_user(username="untenanted_admin", password="x", role="ADMIN", tenant=None)
    client = APIClient()
    # Surface a 500 as a response instead of re-raising it into the test, so
    # the assertion below can name the status the client would have seen.
    client.raise_request_exception = False
    from rest_framework_simplejwt.tokens import RefreshToken

    token = RefreshToken.for_user(admin)  # no tenant_code claim: nothing sets request.tenant
    client.credentials(HTTP_AUTHORIZATION=f"Bearer {token.access_token}")

    resp = client.post(URL, {"name": "Nobody's", "birth_date": "1990-01-15"}, format="json")

    assert resp.status_code == 400, f"got {resp.status_code}: {getattr(resp, 'data', resp.content)!r}"
    assert "tenant" in resp.data
    assert not Soul.all_objects.filter(name="Nobody's").exists()
