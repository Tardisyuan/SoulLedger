"""Smoke test for `manage.py seed_tenants` (DB-07).

The command's own docstring claims it is "Idempotent — uses get_or_create so
it's safe to run multiple times." Nothing in the suite exercised the command
at all before this file, so that claim was unverified. This asserts the
actual effect (four tenant rows with the expected codes/flags) and that a
second run does not duplicate rows or replace the ones already there.
"""
import pytest
from django.core.management import call_command

from apps.tenants.models import Tenant

EXPECTED_CODES = {"CN_DIYU", "EU_HEAVEN_HELL", "EG_DUAT", "GR_HADES"}


@pytest.mark.django_db
def test_seed_tenants_creates_the_four_tenants_and_stays_idempotent():
    call_command("seed_tenants")

    assert set(Tenant.objects.values_list("code", flat=True)) == EXPECTED_CODES
    assert Tenant.objects.filter(dispatch_enabled=True).count() == 4

    before_pk = Tenant.objects.get(code="CN_DIYU").pk

    call_command("seed_tenants")

    # Absence check: a second run must not add rows or replace existing ones.
    assert Tenant.objects.count() == 4
    assert Tenant.objects.get(code="CN_DIYU").pk == before_pk
