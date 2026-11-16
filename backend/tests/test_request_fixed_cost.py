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


# -- with two-step enforcement ON, as in production ---------------------------------------------------------------
# The root conftest turns `MFA_SETUP_ENFORCED` off for the suite, which short-circuits `mfa.setup_required` before
# `is_required` reads anything -- so the warm-request test above stayed green while production (where the setting is
# always True) paid one Tenant query per request: `is_required` read the hall through the user's lazy foreign key
# instead of the copy the middleware had already put on `request.tenant` (sharding review 2026-11-16, 2.1 c).

def _table_queries(ctx, table):
    return [q["sql"] for q in ctx.captured_queries if f'FROM "{table}"' in q["sql"]]


def test_with_mfa_enforced_a_warm_judge_request_does_not_read_the_hall_row(judge, settings):
    settings.MFA_SETUP_ENFORCED = True
    client = officer_client(judge)
    assert client.get(URL).status_code == 200
    with CaptureQueriesContext(connection) as ctx:
        assert client.get(URL).status_code == 200
    assert _tenant_queries(ctx) == []
    assert _table_queries(ctx, "authentication_officermfa") == []  # JUDGE is not required: no MFA row read


def test_with_mfa_enforced_the_hall_rule_still_holds_a_required_role(judge, settings):
    """Absence of the stale answer: the hall now requires JUDGE, so the next request is held at setup."""
    from apps.authentication import mfa

    settings.MFA_SETUP_ENFORCED = True
    client = officer_client(judge)
    assert client.get(URL).status_code == 200
    hall = judge.tenant
    hall.settings = {**(hall.settings or {}), mfa.MFA_REQUIRED_ROLES_SETTING: ["JUDGE"]}
    hall.save(update_fields=["settings"])
    refused = client.get(URL)
    assert refused.status_code == 403 and refused.json()["code"] == "mfa_setup_required"


def test_with_mfa_enforced_a_warm_admin_request_reads_its_mfa_row_once_and_no_hall(judge, settings, django_user_model):
    """ADMIN is always required: one OfficerMfa lookup per request is the price, and it is not cached -- `mfa.disable`
    does not bump `session_version`, so a cached "enabled" would keep a just-disabled ADMIN un-gated."""
    from django.utils import timezone

    from apps.authentication import mfa
    from apps.authentication.models import OfficerMfa

    settings.MFA_SETUP_ENFORCED = True
    admin = django_user_model.objects.create_user(username="fixed_cost_admin", password="x", role="ADMIN",
                                                  tenant=judge.tenant)
    OfficerMfa.objects.create(user=admin, secret=mfa.generate_secret(), confirmed_at=timezone.now())
    client = officer_client(admin)
    assert client.get(URL).status_code == 200
    with CaptureQueriesContext(connection) as ctx:
        assert client.get(URL).status_code == 200
    assert _tenant_queries(ctx) == []
    assert len(_table_queries(ctx, "authentication_officermfa")) == 1
