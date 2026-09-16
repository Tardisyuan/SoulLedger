"""Smoke test for `manage.py create_api_key` (DB-07).

Nothing in the suite exercised this command before this file. Unlike
`seed_tenants` / `setup_ledger_tasks` / `setup_token_flush_task`, this
command is not idempotent by design — it has no `get_or_create` and every
invocation provisions one more key (that is the intended behavior: an
operator runs it once per external system that needs a credential). So this
asserts the actual effect (an `ExternalApiKey` row scoped to the right
tenant, whose stored hash matches the one-time raw key printed to stdout)
plus the failure path (unknown tenant code refuses without creating a row),
rather than a false idempotency claim the command never made.
"""
import hashlib
from io import StringIO

import pytest
from django.core.management import call_command

from apps.death_sync.models import ExternalApiKey


@pytest.mark.django_db
def test_create_api_key_creates_a_key_scoped_to_the_tenant_and_prints_it_once(cn_tenant):
    out = StringIO()
    call_command(
        "create_api_key",
        "Municipal Hospital",
        "--tenant", cn_tenant.code,
        "--system-type", "HOSPITAL",
        stdout=out,
    )

    key = ExternalApiKey.objects.get(name="Municipal Hospital")
    assert key.tenant_id == cn_tenant.pk
    assert key.system_type == "HOSPITAL"
    assert key.expires_at is None

    printed = out.getvalue()
    raw_key_lines = [line.strip() for line in printed.splitlines() if line.strip().startswith("slk_")]
    assert raw_key_lines, printed
    raw_key = raw_key_lines[0]

    # The raw key is shown exactly once (here); the stored hash must match it.
    assert raw_key.startswith(key.key_prefix)
    assert hashlib.sha256(raw_key.encode()).hexdigest() == key.key_hash


@pytest.mark.django_db
def test_create_api_key_refuses_an_unknown_tenant_without_creating_a_row():
    out, err = StringIO(), StringIO()
    call_command("create_api_key", "Ghost System", "--tenant", "NO_SUCH_TENANT", stdout=out, stderr=err)

    # Absence check: the failure path must not leave a half-created key behind.
    assert ExternalApiKey.objects.count() == 0
    assert "not found" in err.getvalue()
