"""The safeguards tour's four overreach answers (`frontend/demo/OverreachProbe.tsx`), asked the way the recorder asks them
(`scripts/demo-record.mjs`). The tour names this file as the test that guards its lateral and anonymous cards; the
vertical card is `test_perm_prefix_discloses_only_the_catalogue.py`, the wrong door `test_soul_auth_boundary.py`.
"""
import uuid

import pytest
from rest_framework.test import APIClient
from rest_framework_simplejwt.tokens import RefreshToken

from apps.core.problems import without_instance
from apps.souls.models import Soul
from tests.soul_account_support import ready_soul

pytestmark = pytest.mark.django_db


def _officer(user):
    token = RefreshToken.for_user(user)
    token["tenant_code"] = user.tenant.code
    client = APIClient()
    client.credentials(HTTP_AUTHORIZATION=f"Bearer {token.access_token}")
    return client


def test_another_halls_soul_by_id_is_404_and_reads_like_no_soul_at_all(judge_user, cn_tenant, eu_tenant):
    """Lateral: `SoulViewSet.get_queryset` scopes to the caller's hall (`scope_to_tenant`), so the EU soul is not
    there to be refused. Positive control first: the judge reads its own hall's soul, so this is not a 404 for everyone."""
    mine = Soul.objects.create(name="CN Soul", tenant=cn_tenant)
    theirs = Soul.objects.create(name="EU Soul", tenant=eu_tenant)
    client = _officer(judge_user)
    assert client.get(f"/api/v1/souls/{mine.pk}/").status_code == 200
    lateral = client.get(f"/api/v1/souls/{theirs.pk}/")
    assert lateral.status_code == 404, lateral.content[:200]
    # Not 403: a refusal would say the soul exists. Byte for byte the answer for an id nobody has.
    nobody = client.get(f"/api/v1/souls/{uuid.uuid4()}/")
    assert without_instance(lateral) == without_instance(nobody)


def test_a_soul_token_at_the_souls_list_is_403(cn_tenant):
    """Wrong door: `OfficerJWTAuthentication.get_validated_token` recognises a soul token and answers 403, not 401."""
    _, client = ready_soul(cn_tenant)
    assert client.get("/api/v1/souls/").status_code == 403


def test_no_token_at_the_souls_list_is_401():
    """Anonymous: `TenantPermission.has_permission` refuses an unauthenticated request, and DRF answers 401."""
    response = APIClient().get("/api/v1/souls/")
    assert response.status_code == 401, response.content[:200]
    assert response["WWW-Authenticate"].startswith("Bearer")
