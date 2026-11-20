"""Stage 5 rehearsal (docs/audit/2026-11-15-sharding/PREP-stage5.md G7): with control's mirror of every write-cut
civilization's SHARD rows gone, every request answers what it answered before the purge.

The world is the stage-3 differential's (`tests/test_sharded_reads_equal_single_db.py::_build`, same seed variable):
every civilization, crossing keys pointed across, a soul in residence and one back home, synced. Each case:

  before     all four read- and write-cut (stage 4, as on 115), step 0c applied (`backfill_disposition_halls --apply`),
             control still a full mirror
  purged     the same, and control's rows of their halls deleted the way stage 5 will
             (`purge_cut_over_tenant_rows.purge_plan`, `_raw_delete` inside `control_mirror_writes()`)

Stage 4 against the single database is not this test's question (tests/test_sharded_reads_equal_single_db.py and
tests/test_sharded_writes_equal_single_db.py hold stages 3 and 4): a difference here is the purge's alone.

each inside a savepoint on every database, rolled back. What stays on control is what stage 5 keeps: D2 rows (no
hall, a hall of UNKNOWN civilization), the control-mastered models (CONTROL_READS), REFERENCE and CONTROL.

* every GET route asked by every caller of the stage-3 world: equal status and body;
* every write route of the Greek hall's ADMIN (create / partial_update): equal status and body;
* the purge itself: no row of a cut civilization's hall left on control's purged models, every shard still full.

    cd backend && ... python -m pytest --ds=config.settings_sharded -m sharded \\
      tests/test_sharded_reads_survive_the_mirror_purge.py
"""
# ruff: noqa: F811 -- `world` is the stage-3 differential's module fixture, imported
import io
from contextlib import contextmanager

import pytest
from django.core.management import call_command
from django.test import override_settings

from apps.core import shadow_reads as shadow
from tests import test_sharded_reads_equal_single_db as reads
from tests import test_sharded_writes_equal_single_db as writes
from tests.test_shard_sync import CIVS, sharded
from tests.test_sharded_reads_equal_single_db import _chat_on, _seed_in_report, _small_pages, world  # noqa: F401
from tests.test_sharded_writes_equal_single_db import _Savepoint, _Seeded

SEED = reads.SEED

#: Cases the purge still changes, each with its reason: stage 5 must not run until this is empty (an xfail names the
#: difference; a case off this list that differs fails). Empty since every run applies step 0c first (`stage`): the
#: world's hall-less disposition (`_what_115_had` (e), G4) moves to its judgment's hall before the purge, as on 115.
PENDING = {}


def _held(case, mismatches, seed_line):
    if case in PENDING:
        if not mismatches:  # this seed's world may give it nothing the purge changes
            pytest.skip(f"{case}: alike on this seed, still pending ({PENDING[case]})")
        pytest.xfail(f"{PENDING[case]}; e.g. {mismatches[0][:200]}")
    assert not mismatches, seed_line + "\n" + "\n".join(mismatches[:6])


def _plan(world):
    """[(model, pks on control)] stage 5 would delete, for all four civilizations. Read once per world, before any
    purge (the world is the same in every case: each case's writes are rolled back)."""
    from apps.tenants.management.commands.purge_cut_over_tenant_rows import purge_plan

    if "purge_plan" not in world:
        world["purge_plan"] = [(m, pks) for civ in CIVS for m, qs in purge_plan(civ).items()
                               if (pks := list(qs.values_list("pk", flat=True)))]
    return world["purge_plan"]


def purge_control_mirrors(world):
    """Delete control's copy of every write-cut civilization's SHARD rows (G6: per model, raw, no collector)."""
    from apps.core.shard_reads import control_mirror_writes

    with control_mirror_writes():
        for model, pks in _plan(world):
            for i in range(0, len(pks), 500):
                qs = model._base_manager.using("default").filter(pk__in=pks[i:i + 500])
                qs._raw_delete("default")


@contextmanager
def stage(world, purge):
    """One run: a savepoint on every database, all four civilizations read- and write-cut, step 0c applied, and --
    `purge` -- control's mirror gone."""
    from apps.audit.models import AuditLog
    from apps.core.shard_ids import assign
    from apps.core.sharding import alias_for_civilization

    with _Savepoint(), override_settings(SHARD_READ_CIVS=list(CIVS), SHARD_WRITE_CIVS=list(CIVS)):
        for civ in CIVS:
            assign(alias_for_civilization(civ))
        call_command("backfill_disposition_halls", "--apply", stdout=io.StringIO())  # step 0c, as on 115 (L7)
        for alias in ("default", *map(alias_for_civilization, CIVS)):  # its audit rows carry this run's clock and ids:
            AuditLog._base_manager.using(alias).filter(  # the two runs would differ by them alone
                description__startswith="backfill_disposition_halls")._raw_delete(alias)
        _plan(world)  # before any purge
        if purge:
            purge_control_mirrors(world)
        yield


@sharded
def test_the_purge_empties_controls_mirror_and_leaves_the_shards_and_d2(world):
    from apps.audit.models import AuditLog
    from apps.core.sharding import alias_for_civilization
    from apps.disposition.models import Disposition
    from apps.souls.models import Soul
    from apps.tenants.management.commands.purge_cut_over_tenant_rows import blockers, purge_plan

    case, _sibling = world["hall_less_disposition"]
    cn = alias_for_civilization("CHINESE")

    def backfilled():  # G4's disposition after step 0c: {alias: its hall} where it is
        rows = {a: Disposition._base_manager.using(a).filter(judgment_id=case.pk) for a in ("default", cn)}
        return {a: qs.get().tenant_id for a, qs in rows.items() if qs.exists()}

    on_shards = {civ: Soul._base_manager.using(alias_for_civilization(civ)).count() for civ in CIVS}
    with stage(world, purge=False):  # after step 0c no staying row names a row the purge deletes
        assert {key for civ in CIVS for key, _ in blockers(purge_plan(civ))} == set()
        assert backfilled() == {"default": case.tenant_id, cn: case.tenant_id}
    with stage(world, purge=True):
        assert backfilled() == {cn: case.tenant_id}  # gone from control's mirror, there on its master
        plan = _plan(world)
        assert len(plan) >= 20, [m._meta.label for m, _ in plan]
        souls = next(pks for m, pks in plan if m is Soul)
        for model, pks in plan:
            assert not model._base_manager.using("default").filter(pk__in=pks[:500]).exists(), model._meta.label
        assert {civ: Soul._base_manager.using(alias_for_civilization(civ)).count() for civ in CIVS} == on_shards
        assert all(on_shards.values()), on_shards
        assert AuditLog._base_manager.using("default").filter(tenant__isnull=True).exists(), "D2 rows went too"
    assert Soul._base_manager.using("default").filter(pk=souls[0]).exists(), "the savepoint did not roll back"


def _answers(world, asks, keep, purge):
    with stage(world, purge):
        return [shadow.drop(reads._fetch(client, url), keep) for _, client, url in asks]


@sharded
@pytest.mark.parametrize("case", sorted(reads.ENDPOINTS))
def test_every_read_answers_after_the_purge_what_it_answered_before(world, case):
    urls = reads._urls(case, world)
    if not urls:
        pytest.skip(f"{case}: needs URL kwargs no list here gives")
    keep = shadow.WRITES_ON_READ.get(case, ())
    asks = [(who, client, url) for who, client in world["callers"].items() for url in urls]
    before, after = _answers(world, asks, keep, purge=False), _answers(world, asks, keep, purge=True)
    mismatches = [f"{who} GET {url}: {shadow.diff(b, c)}"
                  for (who, _, url), b, c in zip(asks, before, after, strict=True) if b != c]
    # Alike is not enough, pending or not: a read that fails on both sides (a crossing join refused, a write with no context) is equal.
    broken = [f"{who} GET {url}: {b}"[:300] for (who, _, url), b in zip(asks, before, strict=True)
              if b[0] in ("raised", 500)]  # 503: a service off by design (Synapse, the PDF renderer)
    assert not broken, f"SHARDED_READS_SEED={SEED}\n" + "\n".join(broken[:6])
    _held(case, mismatches, f"SHARDED_READS_SEED={SEED}")
    if not any(shadow.has_data(b) for b in before):
        pytest.skip(f"{case}: no caller had data here (both sides equal)")


@sharded
@pytest.mark.parametrize("case", sorted(writes.ROUTES))
def test_every_write_answers_after_the_purge_what_it_answered_before(world, case, monkeypatch):
    hall = sorted((h for h in world["halls"] if h.civilization == "GREEK"), key=lambda h: h.code)[0]
    client = world["callers"][f"ADMIN@{hall.code}"]
    payload = writes._payload({**world, "hall": hall, "client": client}, case)
    if payload is None:
        pytest.skip(f"{case}: no row of the Greek hall to shape a request from")
    url, body = payload
    method = case.rsplit(":", 1)[1]

    def ask(purge):
        with stage(world, purge), _Seeded(monkeypatch, f"{writes.SEED}:{case}"):
            res = getattr(client, method)(url, body, format="json")
            return res.status_code, writes._canon_body(res.json()) if res.content else None

    before, after = ask(purge=False), ask(purge=True)
    _held(case, [] if before == after else [str(shadow.diff(before, after))], f"SHARDED_WRITES_SEED={writes.SEED}")
    if before[0] >= 400:
        pytest.skip(f"{case}: refused alike on both sides ({before[0]})")
