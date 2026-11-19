"""A cross-civilization dispatch and its return home lose no audit row and no event, and claim nothing false.

115, 2026-11-19 (every civilization write-cut, 39571fc4f): a GREEK soul dispatched to an EGYPTIAN hall and brought home
logged `Failed to create audit log: a write to civ_greek inside a transaction that is not open there`, and the row
was gone. The return's step 3 (`transfer._left_residence`, on the residence's master) retires the soul's row there:
rewritten to name the home hall (gap 4d), then deleted. That delete's post_delete signal queued a generic
"soul DELETE" audit row naming the HOME hall, routed to the home's master, and its on-commit write opened the
context's transaction -- the residence's -- so the shard write guard refused it and `_swallow_or_log` dropped it.
Where home and residence share a master the row was written: an audit row saying a living soul was deleted.

Through the real services (propose, approve, execute, relay, end_residence, relay), for the source's write cut, the
target's, both, and one world drawn per run (seed printed; `SAGA_SEED=<n>` replays it). `transaction=True`: the
audit rows are on-commit writes, which a TestCase never runs.

    cd backend && SECRET_KEY=ci-test-key-not-for-production-32-bytes-min DEBUG=true DATABASE_URL=sqlite:///:memory: \\
      REDIS_URL=redis://127.0.0.1:6399/0 .venv/bin/python -m pytest --ds=config.settings_sharded -m sharded \\
      --no-cov tests/test_saga_audit_rows.py
"""
import logging
from collections import Counter

import pytest
from django.conf import settings

from tests.test_cross_civilization_saga import RUN, _ownership, _world, seed_of
from tests.test_shard_sync import CIVS, HAS_SHARDS
from tests.test_sharded_writes import _assign, _halls, _in_hall, cut

#: (seed, forced write cut): one drawn per run, only the target's civilization cut, only the source's, both.
SEEDS = [(RUN, None), (3, "tgt"), (29, "src"), (64, "both")]


def _where_rows(model, **filters):
    """[(alias, row)] of `model`'s rows matching `filters` on every database."""
    return [(alias, row) for alias in settings.DATABASES for row in model._base_manager.using(alias).filter(**filters)]


@pytest.mark.skipif(not HAS_SHARDS, reason="needs the four civ_* aliases (--ds=config.settings_sharded)")
@pytest.mark.sharded
@pytest.mark.django_db(databases="__all__", transaction=True)
@pytest.mark.parametrize("param", SEEDS, ids=["run", "tgt", "src", "both"])
def test_a_dispatch_abroad_and_home_again_loses_no_audit_row(param, caplog):
    from apps.audit.models import AuditLog
    from apps.authentication.models import User
    from apps.core.shard_reads import CONTROL_ALIAS, read_context
    from apps.dispatch.models import DispatchRecord, DispatchStatus
    from apps.dispatch.services import DispatchService
    from apps.events.models import SoulEvent
    from apps.souls.models import Soul
    from apps.tenants.shard_saga import master_of, relay_until_quiet

    w = _world(seed_of(param[0]), param[1])
    halls = _halls()
    _assign(*CIVS)
    src, tgt = halls[w["src"]], halls[w["tgt"]]
    where = f"seed {w['seed']} {w['src']}->{w['tgt']} cut {w['cut']}"
    print(where)
    officer = User.objects.create_user(username=f"officer_{w['seed']}", password="x", role="ADMIN")
    caplog.set_level(logging.ERROR)
    with cut(*w["cut"]), read_context(CONTROL_ALIAS):  # reads every master, as a command does; writes as each hall
        with _in_hall(src):
            soul = Soul.objects.create(name=f"审计{w['seed']}", tenant=src, current_state="DISPOSED")
            record = DispatchService.propose(src, tgt, soul, officer, "audit")
        # As the 115 smoke did it: a script, no hall of its own (every master's transaction). In the target hall's
        # own context a cross-civilization approve raises Soul.DoesNotExist (reported, not this test's subject).
        DispatchService.approve(DispatchRecord.all_objects.get(pk=record.pk), officer)
        with _in_hall(src):
            DispatchService.execute(DispatchRecord.all_objects.get(pk=record.pk), officer)
        relay_until_quiet()
        with _in_hall(src):
            DispatchService.end_residence(Soul.all_objects.get(pk=soul.pk), actor=officer,
                                          trigger=DispatchService.RETURN_MANUAL, reason="home")
        relay_until_quiet()
        _ownership()
        assert DispatchRecord.all_objects.get(pk=record.pk).status == DispatchStatus.RETURNED, where
        assert Soul.all_objects.get(pk=soul.pk).tenant_id == src.pk, where

        # Checked inside the cut, which `master_of` answers by. Nothing failed quietly: no swallowed audit write, no relay failure, no error of any kind.
        errors = [f"{r.name}: {r.getMessage()}" for r in caplog.records if r.levelno >= logging.ERROR]
        assert errors == [], f"{where}: {errors}"

        home = master_of(src)
        audits = _where_rows(AuditLog, resource_id__in=[str(record.pk), str(soul.pk)])
        # Every row on the master of the hall it names -- the home hall: the record is the source's, the soul's own.
        assert {(alias, row.tenant_id) for alias, row in audits} == {(home, src.pk)}, \
            f"{where}: {[(a, r.resource, r.action, r.tenant_id) for a, r in audits]}"
        got = Counter((row.resource, row.action) for _, row in audits)
        assert got == Counter({
            ("soul", "CREATE"): 1,
            ("dispatchrecord", "CREATE"): 1,  # propose
            ("dispatchrecord", "UPDATE"): 3,  # approve; EXECUTED (execute's step 3); RETURNED (the return settled)
            ("dispatch_record", "UPDATE"): 1,  # `audit_return`: the soul home, from where to where
        }), f"{where}: {got}"
        # Absence: the copy the soul left in the residence's shard was retired, not a soul deleted.
        assert not [r for _, r in audits if r.action == "DELETE"], where

        # The event log of the move (CLAUDE.md: in the business transaction, on the hall's master).
        events = {(r.payload.get("action"), alias, r.tenant_id) for alias, r in _where_rows(SoulEvent, soul_id=soul.pk)
                  if r.payload.get("action", "").startswith("DISPATCH_")}
        for action, hall in (("DISPATCH_APPROVED", src), ("DISPATCH_EXECUTED", tgt), ("DISPATCH_RETURNED", src)):
            assert (action, master_of(hall), hall.pk) in events, f"{where}: {action} not on {master_of(hall)}: {events}"


@pytest.mark.skipif(not HAS_SHARDS, reason="needs the four civ_* aliases (--ds=config.settings_sharded)")
@pytest.mark.sharded
@pytest.mark.django_db(databases="__all__", transaction=True)
def test_an_audit_row_naming_another_masters_hall_is_written_there(caplog):
    """The general form: a business transaction on one master writes a control row of a hall whose master is another
    (an officer created for a Greek hall while acting as a Chinese one). Its audit row names the Greek hall and goes
    to civ_greek. Its on-commit write used to open the context's transaction (the Chinese shard's): refused and
    swallowed. It opens its own, on the row's database."""
    from django.db import transaction

    from apps.audit.models import AuditLog
    from apps.authentication.models import User
    from apps.core.shard_reads import CONTROL_ALIAS, read_context

    halls = _halls()
    _assign(*CIVS)
    caplog.set_level(logging.ERROR)
    with cut(*CIVS), read_context(CONTROL_ALIAS), _in_hall(halls["CHINESE"]):
        with transaction.atomic():
            user = User.objects.create_user(username="greek_by_chinese", password="x", role="JUDGE",
                                            tenant=halls["GREEK"])
        rows = _where_rows(AuditLog, resource="user", resource_id=str(user.pk))
    assert [r.getMessage() for r in caplog.records if r.levelno >= logging.ERROR] == []
    assert [(alias, r.action, r.tenant_id) for alias, r in rows] == [("civ_greek", "CREATE", halls["GREEK"].pk)], rows
