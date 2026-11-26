"""问数 in the sharded world (user decision 2026-11-21, 2; docs/ARCHITECTURE-ask-data.md §4, ADR 0007): the executor
reads the hall's own shard, as the same read-only role, behind the same column grants and tenant policy, which
`manage.py ask_data_setup` builds on control and on every shard.

Two Chinese halls share civ_chinese, so "sees only its own hall" is the policy's doing, not the database's; a Greek
hall reads civ_greek. Control holds none of these rows, so an answer at all says it came from a shard.

    cd backend && ... python -m pytest --ds=config.settings_sharded -m sharded tests/test_ask_data_sharded.py
"""
import pytest
from django.db import connection, connections

from apps.core.sharding import alias_for_civilization
from apps.judgment.models import Judgment
from apps.soul_assist.ask_data import executor, service
from apps.souls.models import Soul, SoulState
from tests import ask_data_wall
from tests.shard_support import HAS_SHARDS, _sync
from tests.test_sharded_writes import _assign, _in_hall, cut

SQLITE = connection.vendor == "sqlite"

pytestmark = [
    pytest.mark.sharded,
    pytest.mark.skipif(not HAS_SHARDS, reason="needs the four civ_* aliases (--ds=config.settings_sharded)"),
    # the role's session must see committed rows, and the wall's DDL is committed on every database
    pytest.mark.django_db(transaction=True, databases="__all__"),
]


def _world():
    from apps.org.ownership import tenant_root
    from apps.tenants.models import Tenant

    halls = {code: Tenant.objects.create(code=code, display_name=code, declared_civilization=civ)
             for code, civ in (("ASK_CN_A", "CHINESE"), ("ASK_CN_B", "CHINESE"), ("ASK_GR", "GREEK"))}
    for hall in halls.values():
        tenant_root(hall)
    _sync()
    _assign("CHINESE", "GREEK")
    cases = {}
    with cut():
        for code, hall in halls.items():
            with _in_hall(hall):
                soul = Soul.objects.create(name=f"{code} soul", tenant=hall, current_state=SoulState.JUDGING)
                cases[code] = Judgment.objects.create(soul=soul, civilization=soul.civilization, tenant=hall)
    return halls, cases


@pytest.mark.skipif(SQLITE, reason="Row-level security, roles and column grants exist only on PostgreSQL.")
def test_sharded_a_hall_reads_its_shard_and_sees_only_its_own_rows():
    halls, cases = _world()
    pks = [c.pk for c in cases.values()]
    with cut(), ask_data_wall.wall(sharded=True) as (_role, alias):
        for code, hall in halls.items():
            shard = alias_for_civilization(hall.civilization)
            assert executor.alias_for(hall.pk, alias) == f"{alias}_{shard}", code
            assert executor.run("SELECT id FROM judgment_judgment", hall.pk, using=alias).rows == [[cases[code].pk]]
            got = service.run_sql("SELECT count(*) FROM souls_soul", hall.pk, using=alias)  # the gate, then the shard
            assert got["rows"] == [[1]], code
        # The rows are on the shards only; on civ_chinese both Chinese halls' cases are there for the owner, so it
        # was the policy that kept B's case out of A's answer.
        assert not Judgment._base_manager.using("default").filter(pk__in=pks).exists()
        assert Judgment._base_manager.using("civ_chinese").filter(pk__in=pks).count() == 2
        # The role really is on each shard: an unset hall reads nothing, a column it was not granted is refused.
        with pytest.raises(executor.ExecutionError) as err:
            executor.run("SELECT confession FROM judgment_judgment", halls["ASK_GR"].pk, using=alias)
        assert err.value.code == executor.PERMISSION_DENIED
        with connections[f"{alias}_civ_chinese"].cursor() as cursor:
            cursor.execute("SELECT count(*) FROM judgment_judgment")
            assert cursor.fetchone() == (0,)


def test_sharded_a_shard_with_no_ask_data_alias_is_not_configured_and_nothing_runs():
    halls, _cases = _world()
    with cut(), pytest.raises(executor.ExecutionError) as err:
        executor.run("SELECT 1", halls["ASK_GR"].pk, using="ask_data_never_configured")
    assert err.value.code == executor.NOT_CONFIGURED
    with cut():
        assert not service.configured(halls["ASK_GR"].pk, using="ask_data_never_configured")


@pytest.mark.skipif(SQLITE, reason="Row-level security, roles and column grants exist only on PostgreSQL.")
def test_sharded_the_calls_audit_row_is_on_the_halls_shard(monkeypatch):
    """Decision 3 in the sharded form: the one audit row of a call is written on the master of the hall it names."""
    from django.test import RequestFactory

    from apps.audit.models import AuditLog
    from apps.authentication.models import User

    halls, cases = _world()
    hall = halls["ASK_GR"]
    officer = User.objects.create_user(username="ask_gr_judge", password="x", role="JUDGE", tenant=hall)
    request = RequestFactory().post("/api/v1/ask-data/")
    request.user, request.tenant = officer, hall
    monkeypatch.setattr(service, "generate", lambda request, question: "SELECT id FROM judgment_judgment")
    with cut(), ask_data_wall.wall(sharded=True) as (_role, alias):
        monkeypatch.setattr(service, "ALIAS", alias)
        assert service.ask(request, "几件案子")["rows"] == [[cases["ASK_GR"].pk]]
        where = {a: list(AuditLog._base_manager.using(a).filter(resource=service.AUDIT_RESOURCE))
                 for a in ("default", "civ_chinese", "civ_european", "civ_egyptian", "civ_greek")}
    assert {a: len(rows) for a, rows in where.items()} == {"default": 0, "civ_chinese": 0, "civ_european": 0,
                                                          "civ_egyptian": 0, "civ_greek": 1}
    row = where["civ_greek"][0]
    assert (row.user_id, row.tenant_id, row.changes["outcome"], row.changes["rows"]) == (officer.pk, hall.pk, "ok", 1)
    assert str(cases["ASK_GR"].pk) not in str(row.changes)
