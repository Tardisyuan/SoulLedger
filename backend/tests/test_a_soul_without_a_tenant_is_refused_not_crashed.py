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


# ── `civilization` on create (user 2026-11-06) ────────────────────────────────


def _client(user, tenant=None):
    from rest_framework_simplejwt.tokens import RefreshToken

    token = RefreshToken.for_user(user)
    if tenant is not None:
        token["tenant_code"] = tenant.code
    client = APIClient()
    client.credentials(HTTP_AUTHORIZATION=f"Bearer {token.access_token}")
    return client


@pytest.fixture
def halls(db):
    from apps.tenants.models import Tenant

    return {code: Tenant.objects.get_or_create(code=code, defaults={"display_name": code})[0]
            for code in ("CN_DIYU", "GR_HADES")}


@pytest.fixture
def global_admin(db):
    return _client(User.objects.create_user(username="global_admin", password="x", role="ADMIN", tenant=None))


def test_a_global_admin_creates_in_the_hall_of_the_civilization_named(halls, global_admin):
    from apps.org.ownership import tenant_root

    resp = global_admin.post(URL, {"name": "渡河者", "civilization": "GREEK"}, format="json")
    assert resp.status_code == 201, resp.data
    soul = Soul.all_objects.get(pk=resp.data["id"])
    assert soul.tenant == halls["GR_HADES"] and soul.home_tenant == halls["GR_HADES"]
    assert resp.data["civilization"] == "GREEK"
    assert soul.owner_org == tenant_root(halls["GR_HADES"]), "the default unit is the chosen hall's, not nobody's"


def test_a_global_admins_facts_are_checked_against_the_chosen_civilization(halls, global_admin):
    ok = global_admin.post(URL, {"name": "待渡", "civilization": "GREEK", "ferry_passage": "UNBURIED"}, format="json")
    assert ok.status_code == 201, ok.data
    refused = global_admin.post(URL, {"name": "错殿", "civilization": "CHINESE", "ferry_passage": "UNBURIED"}, format="json")
    assert refused.status_code == 400 and "ferry_passage" in refused.data
    assert not Soul.all_objects.filter(name="错殿").exists()


def test_a_global_admin_cannot_name_a_unit_of_another_hall(halls, global_admin):
    from apps.org.ownership import tenant_root

    other = tenant_root(halls["CN_DIYU"])
    resp = global_admin.post(URL, {"name": "错机构", "civilization": "GREEK", "owner_org": other.pk}, format="json")
    assert resp.status_code == 400 and "owner_org" in resp.data
    own = tenant_root(halls["GR_HADES"])
    resp = global_admin.post(URL, {"name": "对机构", "civilization": "GREEK", "owner_org": own.pk}, format="json")
    assert resp.status_code == 201, resp.data


def test_an_unknown_civilization_is_refused(halls, global_admin):
    resp = global_admin.post(URL, {"name": "无处", "civilization": "ATLANTEAN"}, format="json")
    assert (resp.status_code, resp.data["code"]) == (400, "invalid_civilization")
    assert "civilization" in resp.data


def test_a_bound_caller_naming_another_civilization_is_refused(halls):
    hall = halls["GR_HADES"]
    client = _client(User.objects.create_user(username="bound_admin", password="x", role="ADMIN", tenant=hall), hall)
    resp = client.post(URL, {"name": "越殿", "civilization": "CHINESE"}, format="json")
    assert (resp.status_code, resp.data["code"]) == (400, "civilization_mismatch")
    assert "civilization" in resp.data and not Soul.all_objects.filter(name="越殿").exists()
    # Its own civilization, or none, files in its own hall.
    for name, body in (("本殿", {"civilization": "GREEK"}), ("不说", {})):
        resp = client.post(URL, {"name": name, **body}, format="json")
        assert resp.status_code == 201, resp.data
        assert Soul.all_objects.get(pk=resp.data["id"]).tenant == hall


def test_civilization_is_ignored_on_update(halls, global_admin):
    soul = Soul.objects.create(name="不搬", tenant=halls["GR_HADES"])
    resp = global_admin.patch(f"{URL}{soul.pk}/", {"civilization": "CHINESE"}, format="json")
    assert resp.status_code == 200, resp.data
    soul.refresh_from_db()
    assert soul.tenant == halls["GR_HADES"]
