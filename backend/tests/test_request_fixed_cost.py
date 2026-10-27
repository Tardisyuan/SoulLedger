"""What every authenticated request pays before its view runs (perf review 2026-10-27 #4).

The JWT is decoded once — by `TenantMiddleware` — and DRF's authenticator reuses that token instead of
decoding it again. The hall is read from a short in-process cache (`apps/tenants/middleware.py`), dropped
whenever any Tenant row is saved or deleted.
"""
import pytest
from django.db import connection
from django.test.utils import CaptureQueriesContext
from rest_framework_simplejwt import tokens

from tests.soul_account_support import officer_client

URL = "/api/v1/notifications/"


@pytest.fixture
def judge(db, django_user_model):
    from apps.tenants.models import Tenant

    hall, _ = Tenant.objects.get_or_create(code="CN_FIXED_COST", defaults={"display_name": "fixed cost"})
    return django_user_model.objects.create_user(username="fixed_cost_judge", password="x", role="JUDGE", tenant=hall)


def _tenant_queries(ctx):
    return [q["sql"] for q in ctx.captured_queries if '"tenants_tenant"' in q["sql"] and "FROM" in q["sql"]
            and q["sql"].split("FROM", 1)[1].lstrip().startswith('"tenants_tenant"')]


def test_the_token_is_decoded_once_per_request(judge, monkeypatch):
    client = officer_client(judge)
    calls = []
    original = tokens.Token.__init__

    def counting(self, token=None, verify=True):
        if token is not None:
            calls.append(type(self).__name__)
        return original(self, token, verify)

    monkeypatch.setattr(tokens.Token, "__init__", counting)
    assert client.get(URL).status_code == 200
    assert calls == ["AccessToken"], calls


def test_a_warm_request_does_not_read_the_hall_row(judge):
    client = officer_client(judge)
    assert client.get(URL).status_code == 200
    with CaptureQueriesContext(connection) as ctx:
        assert client.get(URL).status_code == 200
    assert _tenant_queries(ctx) == []


def test_saving_the_hall_drops_the_cached_copy(judge):
    from apps.tenants.middleware import cached_tenant

    client = officer_client(judge)
    assert client.get(URL).status_code == 200
    assert cached_tenant("CN_FIXED_COST").display_name == "fixed cost"
    hall = judge.tenant
    hall.display_name = "renamed"
    hall.save(update_fields=["display_name"])
    assert cached_tenant("CN_FIXED_COST").display_name == "renamed"


def test_the_cached_hall_is_a_copy_per_request(judge):
    """A view that mutates `request.tenant` in memory must not change what the next request sees."""
    from apps.tenants.middleware import cached_tenant

    first = cached_tenant("CN_FIXED_COST")
    first.display_name = "scribbled"
    assert cached_tenant("CN_FIXED_COST").display_name == "fixed cost"
