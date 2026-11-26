"""Sharded, after stage 5's purge (VERIFY-stage5 3; 115's state): control holds none of the halls' SHARD rows.

  websocket          an officer of each hall connects (`connected`, its data scope resolved over its hall's units, which
                     live only on the shard); a soul's token is refused at the handshake (4001), as before the cut.
  commands           every read-only management command (or dry run) that reads SHARD rows runs without raising, and the
                     ones that count souls count the shards' souls (control has none of them).

The world is built after `cut()`, and what the one-database form synced to control first (each hall's root unit) is
deleted the way stage 5 did (`shard_sync.purge_plan`, `_raw_delete`): control is as empty as on 115.

    cd backend && ... python -m pytest --ds=config.settings_sharded -m sharded tests/test_s5_tooling_and_sockets_after_the_purge.py
"""
import io

import pytest
from asgiref.sync import async_to_sync
from django.core.management import call_command
from django.core.management.base import CommandError

from tests.shard_support import CIVS, sharded
from tests.test_sharded_writes import _assign, _halls, _in_hall, cut


def purge_control():
    """Delete control's copy of every civilization's SHARD rows, as stage 5's purge did on 115 (per model, raw;
    the tool is retired); inside `cut()`."""
    from apps.core.shard_reads import control_mirror_writes
    from apps.core.shard_sync import purge_plan

    plan = [(m, pks) for civ in CIVS for m, qs in purge_plan(civ).items() if (pks := list(qs.values_list("pk", flat=True)))]
    with control_mirror_writes():
        for model, pks in plan:
            model._base_manager.using("default").filter(pk__in=pks)._raw_delete("default")
    return plan


def _world():
    from apps.authentication.models import UserRole
    from tests import sentence_plan_support as sp
    from tests.data_scope_support import org, scope
    from tests.test_control_locks_in_a_write_cut_hall import _soul_account

    halls = _halls()
    _assign(*CIVS)
    officers, accounts, units, below = {}, {}, {}, {}
    with cut():
        for civ, hall in halls.items():
            with _in_hall(hall):
                units[civ] = org(hall, "本司")
                below[civ] = org(hall, "下司", parent=units[civ])
                officers[civ] = sp.officer(f"s5ws-{civ}", UserRole.JUDGE, hall, organization=units[civ])
            accounts[civ] = _soul_account(hall, f"s5ws-{civ}", mirror=False)
        scope("JUDGE", "ORG_CHILD")  # a non-ADMIN officer's data scope walks its hall's units (ADMIN returns early)
        scope("JUDGE", "DEFINE", resource="soul", orgs=list(units.values()))
        assert purge_control(), "nothing to purge: the world did not reach control"
    return {"halls": halls, "officers": officers, "accounts": accounts, "units": units, "below": below}


def _souls_on(alias):
    from apps.souls.models import Soul

    return Soul._base_manager.using(alias).count()


# ---- websocket -------------------------------------------------------------------------------------------------------

@pytest.fixture
def same_thread_db(monkeypatch):
    """The consumer's `database_sync_to_async` calls run on this thread (async_to_sync from a sync test), inside the
    test's transaction; channels closes "old" connections around each call, which inside a transaction means this
    one: off here, the request cycle's own rule (the test client does the same)."""
    import channels.db

    monkeypatch.setattr(channels.db, "close_old_connections", lambda: None)


async def _ws(token):
    from channels.testing import WebsocketCommunicator

    from config.asgi import application

    comm = WebsocketCommunicator(application, f"/ws/notifications/?token={token}")
    await comm.send_input({"type": "websocket.connect"})
    first = await comm.receive_output(10)
    if first["type"] == "websocket.accept":
        frame = await comm.receive_json_from(timeout=10)
        await comm.disconnect()
        return True, None, frame
    # A refusal (`JWTAuthMiddleware._reject`): an error frame, then the close -- never an accept.
    out = [first]
    while out[-1]["type"] != "websocket.close":
        out.append(await comm.receive_output(10))
    return False, out[-1].get("code"), out[0]


def _officer_token(user):
    from rest_framework_simplejwt.tokens import RefreshToken

    refresh = RefreshToken.for_user(user)
    refresh["tenant_code"] = user.tenant.code
    return str(refresh.access_token)


def _soul_token(account):
    from apps.soul_accounts.authentication import SoulAccessToken

    token = SoulAccessToken.for_user(account.user)
    token["soul_account_id"] = str(account.pk)
    token["cycle"] = account.cycle
    token["sv"] = getattr(account.user, "session_version", 0)
    return str(token)


@sharded
def test_an_officer_connects_with_its_data_scope_and_a_soul_is_refused_after_the_purge(same_thread_db):
    from apps.notifications.consumers import NotificationConsumer

    w = _world()
    resolve = NotificationConsumer.__dict__["_resolve_data_scope"].func  # the sync body the consumer awaits
    with cut():
        for civ, user in w["officers"].items():
            connected, _, frame = async_to_sync(_ws)(_officer_token(user))
            assert connected and frame["type"] == "connected", (civ, frame)
            assert (frame["user_id"], frame["tenant_code"]) == (user.pk, w["halls"][civ].code), (civ, frame)
            assert "soul.read" in frame["permissions"], (civ, frame["permissions"])

            class Probe:
                pass

            probe = Probe()
            probe.user = user
            scopes = resolve(probe)
            # Its unit and the one below it (ORG_CHILD: the hall's tree, read from its shard -- control has none of
            # it), and for `soul` the four DEFINE units.
            assert {w["units"][civ].pk, w["below"][civ].pk} <= scopes["judgment"], (civ, scopes)
            assert {u.pk for u in w["units"].values()} <= scopes["soul"], (civ, scopes["soul"])
        for civ, account in w["accounts"].items():
            connected, code, _ = async_to_sync(_ws)(_soul_token(account))
            assert not connected and code == 4001, (civ, connected, code)


# ---- management commands ---------------------------------------------------------------------------------------------

#: Every read-only command (or dry run) that reads SHARD rows. Not here: the writers (seeders, backfills without a dry
#: run, purge_soul, relay_outbox, setup_* ...), and commands that read no SHARD model
#: (sync_permissions, seed_field_permissions, migrate_shards).
READ_ONLY = [
    ("check_bare_ids",),
    ("check_global_codes",),
    ("check_soul_ownership", "--all"),
    ("reconcile_shards", "--all", "--assert-control-empty"),
    ("assign_shard_id_ranges", "--all", "--check"),
    ("count_open_case_overlaps", "--list", "5"),
    ("check_soul_dates",),
    ("backfill_soul_accounts", "--dry-run"),
    ("cleanup_orphan_post_media", "--dry-run"),
    ("rotate_encryption_key", "--dry-run"),
    ("seed_mythology", "--dry-run"),
    ("post_deploy", "--dry-run"),
]


@sharded
@pytest.mark.parametrize("args", READ_ONLY, ids=lambda a: a[0])
def test_a_read_only_command_runs_over_the_purged_world(args):
    _world()
    out, err = io.StringIO(), io.StringIO()
    with cut():
        on_shards = sum(_souls_on(f"civ_{c.lower()}") for c in CIVS)
        try:
            call_command(*args, stdout=out, stderr=err)
        except CommandError as e:
            pytest.fail(f"{args}: {e}\n{out.getvalue()[-3000:]}\n{err.getvalue()[-2000:]}")
    text = out.getvalue()
    # The two that count souls count the shards' (control holds none of these): a read of control's mirror says 0.
    if args[0] == "check_soul_dates":
        assert f"{on_shards} soul(s)" in text, (on_shards, text[-1500:])
    if args[0] == "backfill_soul_accounts":  # four souls with an account each, every other soul without
        assert "已有账号跳过 4 个" in text, text
