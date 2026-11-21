"""Global uniqueness with rows written to civilization shards (sharding stage 4: PLAN.md "全局唯一", gap 4b;
apps/tenants/global_codes.py). Runs in the `sharded` group:

    cd backend && SECRET_KEY=ci-test-key-not-for-production-32-bytes-min DEBUG=true \\
      DATABASE_URL=sqlite:///:memory: REDIS_URL=redis://127.0.0.1:6399/0 .venv/bin/python -m pytest \\
      --ds=config.settings_sharded -m sharded --no-cov tests/test_global_codes_across_shards.py

Written before the sharded router existed, a "shard write" here is an explicit
`save(using=<alias>)`: the call sites pick their alias the way `Model.save` does (`global_codes.row_alias`),
so the router changes nothing in them.
"""
import threading

import pytest
from django.core.management import CommandError, call_command
from django.db import IntegrityError, connection, connections, transaction
from django.db.models.signals import post_save

from apps.core.shard_reads import CONTROL_ALIAS, read_context
from apps.tenants import global_codes
from tests.test_shard_sync import HAS_SHARDS

GREEK, EGYPTIAN = "civ_greek", "civ_egyptian"
SQLITE = connection.vendor == "sqlite"
NEEDS_ROW_LOCKS = pytest.mark.skipif(
    SQLITE, reason="SQLite serializes writers; two threads cannot both wait at the counter. Run on PostgreSQL.")

pytestmark = [pytest.mark.sharded, pytest.mark.django_db(databases="__all__"),
              pytest.mark.skipif(not HAS_SHARDS, reason="needs --ds=config.settings_sharded")]


class _BoomError(Exception):
    pass


def _copy(row, *aliases):
    model = type(row)
    for alias in aliases:
        model._base_manager.using(alias).bulk_create([model(**{f.attname: getattr(row, f.attname)
                                                               for f in model._meta.concrete_fields})])


def _hall(code, civ):
    from apps.core.sharding import civilization_aliases
    from apps.tenants.models import Tenant

    hall = Tenant.objects.get_or_create(code=code, defaults={"display_name": code, "declared_civilization": civ})[0]
    _copy(hall, *civilization_aliases())  # D4: every shard holds every hall
    return hall


@pytest.fixture
def halls():
    with read_context(CONTROL_ALIAS):
        yield {"GREEK": _hall("GR_GCODE", "GREEK"), "EGYPTIAN": _hall("EG_GCODE", "EGYPTIAN")}


def _org(code, hall, alias):
    from apps.org.models import Organization

    org = Organization(name=code, code=code, category=hall.civilization, tenant=hall)
    org.save(using=alias)
    return org


def _claimed(kind, value):
    from apps.tenants.models import GlobalCode

    return GlobalCode.objects.using(CONTROL_ALIAS).filter(kind=kind, value=value).exists()


# ---- REGISTRY codes ---------------------------------------------------------------------------------------

def test_an_org_code_is_claimed_in_control_before_its_shard_row_is_written(halls):
    from apps.org.models import Organization

    seen = []

    def at_write(sender, instance, using, **kwargs):
        seen.append((using, _claimed(global_codes.ORG_CODE, instance.code)))

    post_save.connect(at_write, sender=Organization, dispatch_uid="test.at_write")
    try:
        _org("GC_SHARD_1", halls["GREEK"], GREEK)
    finally:
        post_save.disconnect(dispatch_uid="test.at_write", sender=Organization)
    assert seen == [(GREEK, True)]
    assert not Organization._base_manager.using(CONTROL_ALIAS).filter(code="GC_SHARD_1").exists()


def test_a_failed_shard_transaction_leaves_the_code_claimed_and_it_is_not_given_out_again(halls):
    from apps.org.models import Organization

    with pytest.raises(_BoomError), transaction.atomic(using=GREEK):
        _org("GC_GAP_1", halls["GREEK"], GREEK)
        raise _BoomError
    assert not Organization._base_manager.using(GREEK).filter(code="GC_GAP_1").exists()
    assert _claimed(global_codes.ORG_CODE, "GC_GAP_1")
    # Another civilization's shard asks the same registry: the code is not free there either.
    with pytest.raises(IntegrityError):
        _org("GC_GAP_1", halls["EGYPTIAN"], EGYPTIAN)
    assert not Organization._base_manager.using(EGYPTIAN).filter(code="GC_GAP_1").exists()
    out = __import__("io").StringIO()
    call_command("check_global_codes", stdout=out)  # a gap is listed, not a failure
    assert "'GC_GAP_1': claimed, no row holds it" in out.getvalue()


def test_two_civilizations_cannot_both_get_one_soul_code(halls, monkeypatch):
    """Forced collision (only the random source is patched): a soul on the Greek shard draws a code, then a
    soul on the Egyptian shard draws the same one first and must take the next."""
    from apps.soul_accounts import services
    from apps.souls.models import Soul

    souls = {}
    for civ, alias in (("GREEK", GREEK), ("EGYPTIAN", EGYPTIAN)):
        soul = Soul(name=f"撞号-{civ}", tenant=halls[civ], home_tenant=halls[civ])
        Soul._base_manager.using(alias).bulk_create([soul])
        souls[civ] = Soul._base_manager.using(alias).get(pk=soul.pk)
    draws = iter(["SAMECODE01", "SAMECODE01", "OTHERCODE1"])
    monkeypatch.setattr(services, "_new_soul_code", lambda: next(draws))
    assert services._ensure_soul_code(souls["GREEK"]) == "SAMECODE01"
    assert services._ensure_soul_code(souls["EGYPTIAN"]) == "OTHERCODE1"
    assert Soul._base_manager.using(GREEK).get(pk=souls["GREEK"].pk).soul_code == "SAMECODE01"
    assert Soul._base_manager.using(EGYPTIAN).get(pk=souls["EGYPTIAN"].pk).soul_code == "OTHERCODE1"
    assert not Soul._base_manager.using(CONTROL_ALIAS).filter(soul_code__isnull=False).exists()
    call_command("check_global_codes")


# ---- the check, on every alias ---------------------------------------------------------------------------

def _all_aliases():
    from apps.core.sharding import civilization_aliases

    return [CONTROL_ALIAS, *civilization_aliases()]


@pytest.mark.parametrize("alias", _all_aliases())
def test_the_check_sees_an_unregistered_code_on_every_alias(halls, alias):
    from apps.org.models import Organization

    Organization._base_manager.using(alias).bulk_create(
        [Organization(name="x", code="GC_UNREG", category="GREEK", tenant=halls["GREEK"])])
    out = __import__("io").StringIO()
    with pytest.raises(CommandError, match="1 global code problem"):
        call_command("check_global_codes", stdout=out)
    assert "org_code 'GC_UNREG': on a row, not in the registry" in out.getvalue()


@pytest.mark.parametrize("alias", [a for a in _all_aliases() if a != GREEK])
def test_the_check_sees_one_code_on_two_rows_in_two_databases(halls, alias):
    from apps.org.models import Organization

    _org("GC_TWICE", halls["GREEK"], GREEK)
    Organization._base_manager.using(alias).bulk_create(
        [Organization(name="x", code="GC_TWICE", category="EGYPTIAN", tenant=halls["EGYPTIAN"])])
    with pytest.raises(CommandError, match="1 global code problem"):
        call_command("check_global_codes")


# ---- WF numbers (gap 4b) -----------------------------------------------------------------------------------

def _workflow_on(alias, hall, name="wf"):
    from apps.souls.models import Soul
    from apps.workflow.models import ApprovalWorkflow

    soul = Soul(name=f"{name}-soul", tenant=hall, home_tenant=hall)
    Soul._base_manager.using(alias).bulk_create([soul])
    flow = ApprovalWorkflow(soul_id=soul.pk, tenant=hall, workflow_name=name)
    flow.save(using=alias)
    return flow


def _wf_last():
    from apps.judgment.models import JudgmentCaseCounter

    row = JudgmentCaseCounter.objects.using(CONTROL_ALIAS).filter(key="WF").first()
    return row.last if row else 0


def test_a_shard_workflow_takes_its_number_from_the_control_counter_and_a_rollback_does_not_reuse_it(halls):
    from apps.workflow.models import ApprovalWorkflow, format_workflow_number

    start = _wf_last()
    first = _workflow_on(GREEK, halls["GREEK"], "first")
    assert first.number == format_workflow_number(start + 1) and _wf_last() == start + 1
    assert not ApprovalWorkflow._base_manager.using(CONTROL_ALIAS).filter(pk=first.pk).exists()

    with pytest.raises(_BoomError), transaction.atomic(using=GREEK):
        _workflow_on(GREEK, halls["GREEK"], "rolled back")
        raise _BoomError
    assert _wf_last() == start + 2  # spent in control, though the shard row is gone
    other = _workflow_on(EGYPTIAN, halls["EGYPTIAN"], "next")
    assert other.number == format_workflow_number(start + 3)
    numbers = [*ApprovalWorkflow._base_manager.using(GREEK).values_list("number", flat=True),
               *ApprovalWorkflow._base_manager.using(EGYPTIAN).values_list("number", flat=True)]
    assert sorted(numbers) == [format_workflow_number(start + 1), format_workflow_number(start + 3)]


@NEEDS_ROW_LOCKS
@pytest.mark.django_db(databases="__all__", transaction=True)
def test_two_civilizations_creating_workflows_at_once_get_distinct_numbers(monkeypatch):
    """Both threads are held until both reach the control counter (only the bump is patched, to wait)."""
    from apps.workflow.models import ApprovalWorkflow

    with read_context(CONTROL_ALIAS):
        hall = {"GREEK": _hall("GR_GCRACE", "GREEK"), "EGYPTIAN": _hall("EG_GCRACE", "EGYPTIAN")}
    barrier = threading.Barrier(2, timeout=30)
    original = global_codes.next_workflow_number

    def at_once(**kwargs):
        barrier.wait()
        return original(**kwargs)

    monkeypatch.setattr(global_codes, "next_workflow_number", at_once)
    numbers, errors = {}, []

    def worker(civ, alias):
        try:
            numbers[civ] = _workflow_on(alias, hall[civ], f"race-{civ}").number
        except Exception as exc:  # pragma: no cover - reported below
            errors.append(exc)
        finally:
            connections.close_all()

    threads = [threading.Thread(target=worker, args=a) for a in (("GREEK", GREEK), ("EGYPTIAN", EGYPTIAN))]
    for t in threads:
        t.start()
    for t in threads:
        t.join()
    assert errors == []
    assert len(set(numbers.values())) == 2, numbers
    stored = {alias: list(ApprovalWorkflow._base_manager.using(alias).values_list("number", flat=True))
              for alias in (GREEK, EGYPTIAN)}
    assert sorted(n for ns in stored.values() for n in ns) == sorted(numbers.values())


# ---- soul ownership (D6) ---------------------------------------------------------------------------------

def _soul_rows(tenant, home, *aliases):
    from apps.core.shard_reads import control_mirror_writes
    from apps.souls.models import Soul

    soul = Soul(name="归属", tenant=tenant, home_tenant=home)
    with control_mirror_writes():  # control's mirror of a write-cut soul, built on purpose (stage 4 refuses it otherwise)
        for alias in aliases:
            Soul._base_manager.using(alias).bulk_create([Soul(pk=soul.pk, name=soul.name, tenant_id=tenant.pk,
                                                              home_tenant_id=home.pk)])
    return soul


def _ownership(settings):
    out = __import__("io").StringIO()
    try:
        call_command("check_soul_ownership", "--all", stdout=out)
    except CommandError:
        return out.getvalue(), False
    return out.getvalue(), True


def test_a_sharded_soul_with_a_leftover_control_copy_passes(halls, settings):
    settings.SHARDED = True
    _soul_rows(halls["GREEK"], halls["GREEK"], GREEK, CONTROL_ALIAS)
    _soul_rows(halls["EGYPTIAN"], halls["EGYPTIAN"], CONTROL_ALIAS, EGYPTIAN)  # its shard, and a copy left on control
    out, ok = _ownership(settings)
    assert ok, out


def test_a_residence_copy_in_the_home_shard_is_justified(halls, settings):
    settings.SHARDED = True
    _soul_rows(halls["EGYPTIAN"], halls["GREEK"], EGYPTIAN, GREEK, CONTROL_ALIAS)  # resides in Egypt, home Greece
    out, ok = _ownership(settings)
    assert ok, out


def test_a_copy_nothing_justifies_is_reported(halls, settings):
    settings.SHARDED = True
    soul = _soul_rows(halls["GREEK"], halls["GREEK"], GREEK, CONTROL_ALIAS, EGYPTIAN)  # never left Greece
    out, ok = _ownership(settings)
    assert not ok and f"soul {soul.pk}: a copy on {EGYPTIAN} nothing justifies (primary on {GREEK})" in out


def test_two_primary_rows_are_reported(halls, settings):
    from apps.souls.models import Soul

    settings.SHARDED = True
    soul = _soul_rows(halls["GREEK"], halls["GREEK"], GREEK)
    # A move half done: the Egyptian shard also holds it as its own, the home pointer says Greece.
    Soul._base_manager.using(EGYPTIAN).bulk_create([Soul(pk=soul.pk, name=soul.name, tenant_id=halls["EGYPTIAN"].pk,
                                                         home_tenant_id=halls["GREEK"].pk)])
    out, ok = _ownership(settings)
    assert not ok and f"soul {soul.pk}: 2 primary rows" in out


def test_a_sharded_soul_only_in_control_has_no_primary_row(halls, settings):
    settings.SHARDED = True
    soul = _soul_rows(halls["GREEK"], halls["GREEK"], CONTROL_ALIAS)
    out, ok = _ownership(settings)
    assert not ok and f"soul {soul.pk}: no primary row (its civilization's writes are on {GREEK})" in out
