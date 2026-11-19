"""The control registry of global codes on ONE database (apps/tenants/global_codes.py; sharding stage 4).
With no shard configured (SHARD_WRITE_CIVS = [], production today) every row is written to control, so the
claim / bump is part of the row's own transaction and behaves exactly as the UNIQUE index alone did: a failed
write keeps nothing, a renamed or hard-deleted unit gives its code back. The WF number's no-gap rule on one
database is tests/test_workflow_number.py::test_a_create_that_fails_gives_its_number_back.
Across shards: tests/test_global_codes_across_shards.py.
"""
import pytest
from django.core.management import CommandError, call_command
from django.db import IntegrityError, transaction

from apps.org.models import Organization
from apps.tenants import global_codes
from apps.tenants.models import GlobalCode, Tenant


class _BoomError(Exception):
    pass


def _root(tenant):
    from apps.org.ownership import tenant_root

    return tenant_root(tenant)


def _claims(kind=global_codes.ORG_CODE):
    return set(GlobalCode.objects.filter(kind=kind).values_list("value", flat=True))


@pytest.mark.django_db
def test_no_shard_settings_means_one_database(settings):
    assert settings.SHARD_WRITE_CIVS == [] and not [a for a in settings.DATABASES if a.startswith("civ_")]


@pytest.mark.django_db
def test_on_one_database_an_org_code_is_claimed_with_its_row_and_only_then(cn_tenant):
    org = Organization.objects.create(name="a", code="GC_ONE", category="CHINESE", tenant=cn_tenant, parent=_root(cn_tenant))
    assert GlobalCode.objects.get(kind=global_codes.ORG_CODE, value="GC_ONE").tenant_id == cn_tenant.pk

    # A save that fails after the insert, in the caller's transaction: row and claim go together.
    with pytest.raises(_BoomError), transaction.atomic():
        Organization.objects.create(name="b", code="GC_TWO", category="CHINESE", tenant=cn_tenant, parent=_root(cn_tenant))
        raise _BoomError
    assert "GC_TWO" not in _claims() and not Organization.all_objects.filter(code="GC_TWO").exists()
    Organization.objects.create(name="b", code="GC_TWO", category="CHINESE", tenant=cn_tenant, parent=_root(cn_tenant))  # free again

    # Taken is still taken, and refused before anything is written.
    with pytest.raises(IntegrityError), transaction.atomic():
        Organization.objects.create(name="c", code="GC_ONE", category="CHINESE", tenant=cn_tenant, parent=_root(cn_tenant))
    assert Organization.all_objects.filter(code="GC_ONE").count() == 1

    # A rename gives the old code back; a soft delete keeps it; a hard delete gives it back.
    org.code = "GC_ONE_RENAMED"
    org.save()
    assert {"GC_ONE_RENAMED", "GC_TWO"} == _claims() & {"GC_ONE", "GC_ONE_RENAMED", "GC_TWO"}
    other = Organization.objects.create(name="d", code="GC_ONE", category="CHINESE", tenant=cn_tenant, parent=_root(cn_tenant))
    other.delete()  # soft
    assert "GC_ONE" in _claims()
    Organization.all_objects.filter(pk=other.pk).delete()  # hard
    assert "GC_ONE" not in _claims()
    Organization.objects.create(name="e", code="GC_ONE", category="CHINESE", tenant=cn_tenant, parent=_root(cn_tenant))


@pytest.mark.django_db
def test_a_save_that_does_not_touch_the_code_claims_nothing(cn_tenant):
    org = Organization.objects.create(name="a", code="GC_KEEP", category="CHINESE", tenant=cn_tenant, parent=_root(cn_tenant))
    before = GlobalCode.objects.count()
    org.name = "renamed"
    org.save()
    org.save(update_fields=["name"])
    assert GlobalCode.objects.count() == before


@pytest.mark.django_db
def test_a_soul_code_is_claimed_when_it_is_assigned(cn_tenant):
    from apps.soul_accounts.services import _ensure_soul_code
    from apps.souls.models import Soul

    soul = Soul.objects.create(name="编号", tenant=cn_tenant)
    code = _ensure_soul_code(soul)
    assert GlobalCode.objects.get(kind=global_codes.SOUL_CODE, value=code).tenant_id == cn_tenant.pk
    assert _ensure_soul_code(soul) == code and GlobalCode.objects.filter(kind=global_codes.SOUL_CODE).count() == 1


@pytest.mark.django_db
def test_a_claimed_soul_code_is_never_drawn_again(cn_tenant, monkeypatch):
    """The generator retries on the registry, not only on the soul table: a code claimed by a row on another
    database (no soul here holds it) is skipped."""
    from apps.soul_accounts import services
    from apps.souls.models import Soul

    GlobalCode.objects.create(kind=global_codes.SOUL_CODE, value="AAAAAAAAAA")
    draws = iter(["AAAAAAAAAA", "BBBBBBBBBB"])
    monkeypatch.setattr(services, "_new_soul_code", lambda: next(draws))
    assert services._ensure_soul_code(Soul.objects.create(name="撞号", tenant=cn_tenant)) == "BBBBBBBBBB"


def test_the_registry_keys_of_the_inventory_are_the_ones_global_codes_serves():
    from tests.tenancy_global_uniqueness import STRATEGY

    registry = {k for k, (s, _) in STRATEGY.items() if s == "REGISTRY"}
    assert registry == set(global_codes.SERVED_KEYS)
    assert {f"{label}:{column}" for label, column, _ in global_codes.KINDS.values()} < registry


# ---- the backfill and the check ---------------------------------------------------------------------------

@pytest.mark.django_db
def test_the_backfill_registers_every_existing_code_and_the_check_then_passes(cn_tenant):
    import importlib

    from django.apps import apps
    from django.db import connection

    from apps.souls.models import Soul

    # Rows written before the registry existed: no save(), so no claim.
    Organization.objects.bulk_create([Organization(name="old", code="GC_OLD", category="CHINESE", tenant=cn_tenant, parent=_root(cn_tenant))])
    soul = Soul.objects.create(name="老号", tenant=cn_tenant)
    Soul.all_objects.filter(pk=soul.pk).update(soul_code="OLDCODE001")
    with pytest.raises(CommandError, match="2 global code problem"):
        call_command("check_global_codes")

    GlobalCode.objects.all().delete()
    migration = importlib.import_module("apps.tenants.migrations.0024_global_codes")

    class _Editor:
        pass

    editor = _Editor()
    editor.connection = connection
    migration.register_existing(apps, editor)
    assert ("org_code", "GC_OLD") in set(GlobalCode.objects.values_list("kind", "value"))
    assert GlobalCode.objects.get(kind="soul_code", value="OLDCODE001").tenant_id == cn_tenant.pk
    assert GlobalCode.objects.filter(kind="org_code").count() == Organization.all_objects.count()
    call_command("check_global_codes")


@pytest.mark.django_db
def test_an_unused_claim_is_listed_and_does_not_fail_the_check(capsys):
    GlobalCode.objects.create(kind=global_codes.ORG_CODE, value="GC_GAP")
    call_command("check_global_codes")
    assert "'GC_GAP': claimed, no row holds it" in capsys.readouterr().out


@pytest.mark.django_db
@pytest.mark.parametrize("writer", ["", "default:"])  # before tenants/0027; taken on SQLite
def test_an_open_case_claim_of_unknown_writer_is_listed_and_cleared_only_when_its_case_is_not_open(
        cn_tenant, capsys, writer):
    """`claim_open_case` never takes over a claim whose writer cannot be known; nothing else cleared one, so a soul
    whose case rolled back could never open another (VERIFY-stage4-r2 低). The check lists them; with
    `--clear-unknown-claims` it drops those whose case is not open -- never one whose case is (asserted absent and
    present). A claim whose writer is known (PostgreSQL, an xid) is not listed."""
    import uuid

    from apps.judgment.models import Judgment
    from apps.souls.models import Soul
    from apps.tenants.models import OpenCaseClaim

    soul_open = Soul.objects.create(name="开着", tenant=cn_tenant, current_state="JUDGING")
    case = Judgment.objects.create(soul=soul_open, civilization=soul_open.civilization, court="第一殿",
                                   tenant=cn_tenant)
    OpenCaseClaim.objects.filter(soul_id=soul_open.pk).delete()  # whatever opening it claimed: ours, below
    claims = {
        "open": OpenCaseClaim.objects.create(soul_id=soul_open.pk, judgment_id=case.pk, tenant_id=cn_tenant.pk,
                                             case_txn=writer),
        "missing": OpenCaseClaim.objects.create(soul_id=uuid.uuid4(), judgment_id=uuid.uuid4(),
                                                tenant_id=cn_tenant.pk, case_txn=writer),
        "known": OpenCaseClaim.objects.create(soul_id=uuid.uuid4(), judgment_id=uuid.uuid4(),
                                              tenant_id=cn_tenant.pk, case_txn="default:12345"),
    }
    call_command("check_global_codes")
    out = capsys.readouterr().out
    assert f"judgment {case.pk}" in out and "writer unknown, case open" in out, out
    assert f"judgment {claims['missing'].judgment_id}" in out and "case missing" in out, out
    assert str(claims["known"].judgment_id) not in out, out
    assert OpenCaseClaim.objects.count() == 3, "listing cleared a claim"
    call_command("check_global_codes", "--clear-unknown-claims")
    assert "case missing; cleared" in capsys.readouterr().out
    left = set(OpenCaseClaim.objects.values_list("pk", flat=True))
    assert left == {claims["open"].pk, claims["known"].pk}, left


# ---- case-number prefixes (Judgment.case_number is PARTITIONED) ------------------------------------------

@pytest.mark.django_db
@pytest.mark.parametrize("code, civ, refused", [
    ("CN_NEWHALL", "GREEK", True),       # CN is a Chinese prefix (CN_DIYU)
    ("CN_NEWHALL", "CHINESE", False),    # the same civilization may share it
    ("CNX_NEWHALL", "GREEK", False),     # a different first segment
    ("ZZ_NEWHALL", "GREEK", False),      # ZZ_UNKNOWN below is of no civilization (D2) and does not count
])
def test_a_new_hall_may_not_share_a_case_prefix_with_another_civilization(cn_tenant, code, civ, refused):
    from apps.tenants.serializers import TenantCreateSerializer

    assert cn_tenant.known_civilization == "CHINESE" and cn_tenant.code.startswith("CN_")
    Tenant.objects.create(code="ZZ_UNKNOWN", display_name="z")
    s = TenantCreateSerializer(data={"code": code, "display_name": "x", "civilization": civ})
    assert s.is_valid() is (not refused), s.errors
    if refused:
        assert s.errors["code"][0].code == "case_prefix_shared"
        assert cn_tenant.code in str(s.errors["code"][0])
