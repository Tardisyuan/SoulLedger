"""Stage 5 purge safety (docs/audit/2026-11-15-sharding/VERIFY-stage5.md H1, M1).

H1: once control's copy of a civilization is purged, stage 4's rollback (taking it off SHARD_WRITE_CIVS) turned the
sync control-to-shard and raw-deleted the whole shard. Now `--confirm` writes a record (GlobalCode SHARD_PURGED), every
sync refuses while a recorded civilization is off SHARD_WRITE_CIVS / SHARD_PURGED_CIVS, and a control-to-shard
sync never touches a recorded civilization's shard-mastered rows. `--record-purged` writes the record for a
civilization purged before it existed.
M1: `--confirm` refuses, deleting nothing, when the reconcile is not clean or the dump is missing or stale.

    cd backend && ... python -m pytest --ds=config.settings_sharded -m sharded tests/test_stage5_purge_safety.py
"""
import pytest
from django.core.exceptions import ImproperlyConfigured
from django.core.management.base import CommandError

from tests.test_shard_sync import CIVS, sharded
from tests.test_sharded_writes import cut
from tests.test_stage5_prep import CN, _manifest, _run, _stop, _world, purged


def _ready():
    """test_stage5_prep's purge world with its blockers resolved: a CHINESE `--confirm` passes every check."""
    from apps.disposition.models import Disposition

    halls, rows = _world()
    cn = halls["CHINESE"]
    case = Disposition._base_manager.using("default").get(pk=rows["stay"].pk).judgment_id
    with cut(*CIVS):
        _run("backfill_disposition_halls", "--apply", "--judgment-hall", f"{case}={cn.code}")
    Disposition._base_manager.using("default").filter(pk=rows["blocked"].pk)._raw_delete("default")
    return halls


def _rows(alias):
    from apps.core.shard_sync import purged_models

    return {m._meta.label: m._base_manager.using(alias).count() for m in purged_models()}


def _recorded():
    from apps.core.shard_sync import purge_records

    return purge_records()


def _confirm(*extra):
    return _run("purge_cut_over_tenant_rows", "--civ", "CHINESE", *extra)


def test_a_recorded_purge_must_stay_on_both_switches():
    from apps.core.sharding import check_cut_over_settings

    dbs = {"default": {}, "civ_greek": {}}
    check_cut_over_settings(["GREEK"], ["GREEK"], dbs, purged=["GREEK"], recorded=["GREEK"])
    for write, purged_ in (([], []), (["GREEK"], [])):
        with pytest.raises(ImproperlyConfigured, match=r"\['GREEK'\] were purged"):
            check_cut_over_settings(["GREEK"], write, dbs, purged=purged_, recorded=["GREEK"])


@sharded
def test_taking_a_purged_civilization_off_the_switches_never_empties_its_shard(tmp_path, monkeypatch):
    """Experiment C of VERIFY-stage5 (H1), on the real entry points: purge CHINESE, then roll stage 4 back for it."""
    from apps.core import shard_sync
    from apps.tenants.tasks import sync_shards

    _ready()
    with purged("CHINESE"):
        _confirm("--confirm", "CHINESE", "--dump", _stop(tmp_path))
    assert _recorded() == {"CHINESE"}  # (a)
    shard = _rows(CN)
    assert shard["judgment.Judgment"] == 3 and shard["souls.Soul"] == 3

    with cut(*(c for c in CIVS if c != "CHINESE")):  # SHARD_PURGED_CIVS = []
        with pytest.raises(ImproperlyConfigured, match="were purged"):  # (b): the beat's sync
            sync_shards()
        with pytest.raises(ImproperlyConfigured, match="were purged"):
            _run("reconcile_shards", "--civ", "CHINESE", "--fix")
        assert _rows(CN) == shard
        monkeypatch.setattr(shard_sync, "check_purge_records", lambda: None)  # (b) bypassed: (c) still holds
        shard_sync.sync([CN])
        assert _rows(CN) == shard


@sharded
def test_record_purged_writes_the_record_only_once_control_is_empty(tmp_path):
    from apps.core.shard_sync import PURGED
    from apps.tenants.models import GlobalCode

    _ready()
    with purged("CHINESE"):
        with pytest.raises(CommandError, match="not recorded"):  # control still holds the mirror
            _confirm("--record-purged")
        assert _recorded() == set()
        _confirm("--confirm", "CHINESE", "--dump", _stop(tmp_path))
        GlobalCode.objects.using("default").filter(kind=PURGED).delete()  # purged before the record existed (115)
        assert "recorded CHINESE as purged" in _confirm("--record-purged")
        assert _recorded() == {"CHINESE"}
        _confirm("--record-purged")  # idempotent
        assert GlobalCode.objects.using("default").filter(kind=PURGED).count() == 1


def _refused(failed, *extra):
    from apps.core.shard_sync import purge_plan

    def control():
        return {m: qs.count() for m, qs in purge_plan("CHINESE").items()}

    before, shard = control(), _rows(CN)
    assert sum(before.values())
    with pytest.raises(CommandError, match=f"purge preconditions failed: {failed} \\(nothing deleted\\)"):
        _confirm("--confirm", "CHINESE", *extra)
    assert control() == before and _rows(CN) == shard and _recorded() == set()


@sharded
def test_the_purge_refuses_a_row_only_on_control(tmp_path):
    """A Chinese case the shard lacks (gone there, raw; no row names it): control's copy is the only one."""
    from apps.disposition.models import Disposition
    from apps.judgment.models import Judgment

    halls = _ready()
    with purged("CHINESE"):
        manifest = _stop(tmp_path)
        lone = Judgment._base_manager.using(CN).filter(tenant=halls["CHINESE"]).exclude(
            pk__in=Disposition._base_manager.using(CN).values("judgment_id")).get()
        Judgment._base_manager.using(CN).filter(pk=lone.pk)._raw_delete(CN)
        _refused("reconcile shard-to-control clean", "--dump", manifest)


@sharded
def test_the_purge_refuses_without_a_fresh_dump(tmp_path):
    _ready()
    with purged("CHINESE"):
        _stop(tmp_path)
        _refused("dump under 24 h, after the sync stopped")
        _refused("dump under 24 h, after the sync stopped",
                 "--dump", _manifest(tmp_path, "control", CN, age=25 * 3600))
