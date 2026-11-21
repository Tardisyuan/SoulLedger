"""Every scheduled job runs sharded (115's state since stage 5: every civilization on its shard and control holding
none of their SHARD rows -- the world is built sharded, and what was built on control before `cut()` is deleted
from control as the purge did).

On 115 one run of each job raised: `chat.cleanup_unsent_images`, `soul_accounts.prune_data_exports` and
`soul_assist.purge_history` NoShardContext ("a write naming no row and no single civilization"), and
`chat.sync_all_rooms` ProgrammingError (a SoulAccount JOIN on a shard, which has no such table). Called directly the
first three had no shard context at all; through Celery `purge_history` still joined User on a shard, and the
retention jobs' `purge_in_batches` asked `queryset.db`, which a global job cannot answer (NoShardContext).

  per job   the job does its work on every master: each civilization's shard, and control for the hall-less rows
            (D2) -- rows it should touch changed or gone, rows it should leave exactly as they were. Both ways a job
            runs: through Celery (`apply`, what beat's worker does) and called directly (an operator's shell).
  registry  every job in `registry._BY_KEY` runs once (TENANT jobs once per hall) without raising, over a world
            that has rows for the jobs above. Synapse is the one external service, replaced by `_Synapse`.

    cd backend && ... python -m pytest --ds=config.settings_sharded -m sharded tests/test_scheduled_jobs_under_write_cut.py
"""
from datetime import timedelta
from unittest import mock

import pytest
from django.core.cache import cache
from django.utils import timezone

from tests.test_control_locks_in_a_write_cut_hall import _soul_account
from tests.test_s5_tooling_and_sockets_after_the_purge import purge_control
from tests.test_shard_sync import CIVS, sharded
from tests.test_sharded_writes import _assign, _halls, _in_hall, cut

OLD = timedelta(days=1000)  # past every window here (assistant usage: 730 days)
SHARD = {civ: f"civ_{civ.lower()}" for civ in CIVS}
ALIASES = ("default", *SHARD.values())


class _Synapse:
    """The two Synapse calls the chat jobs make (`set_user_levels`, `recent_messages`), recorded. Synapse is the
    one external service a scheduled job talks to; this test is about where the rows are, not about Synapse."""

    service_user = "@soulledger:test"

    def __init__(self):
        self.levels = {}

    def set_user_levels(self, room_id, levels):
        self.levels[room_id] = levels

    def recent_messages(self, room_id, limit):
        return [{"sender": "@a-soul:test", "timestamp": int(timezone.now().timestamp() * 1000)}]


@pytest.fixture
def synapse(settings):
    settings.MATRIX_ENABLED = True
    fake = _Synapse()
    with mock.patch("apps.chat.matrix.get_client", return_value=fake):
        yield fake


def _run(name, how, **kwargs):
    """Run the registered task `name` the way beat's worker does (`apply`: a Celery request) or directly."""
    from config.celery import app

    app.loader.import_default_modules()  # autodiscovery: the tasks modules of every app
    cache.clear()  # the single-flight locks of an earlier run
    task = app.tasks[name]
    if how == "direct":
        return task(**kwargs)
    result = task.apply(kwargs=kwargs, throw=False)
    assert result.successful(), f"{name}: {result.result!r}\n{result.traceback}"
    return result.result


def _where(model, pk):
    return sorted(a for a in ALIASES if model._base_manager.using(a).filter(pk=pk).exists())


def _age(model, pk, civ, **fields):
    """Back-date an auto_now_add column on the row's master (the job compares it with now)."""
    model._base_manager.using(SHARD[civ]).filter(pk=pk).update(**fields)


class World:
    """One soul with an account per hall, and for each job a row it must change and a row it must leave."""

    def __init__(self):
        self.halls = _halls()
        _assign(*CIVS)
        self.accounts, self.souls = {}, {}
        with cut():
            for civ, hall in self.halls.items():
                account = _soul_account(hall, f"job-{civ}", mirror=False)
                self.accounts[civ], self.souls[civ] = account, account.soul_id
            purge_control()  # what stage 3 synced to control (each hall's root unit) gone, as on 115


@pytest.fixture
def world():
    return World()


# ---- chat.cleanup_unsent_images -------------------------------------------------------------------------------------

def _images(world):
    from apps.chat.models import ChatImage, Conversation, ConversationKind
    from apps.souls.models import Soul

    made = {}
    for civ, hall in world.halls.items():
        with _in_hall(hall):
            soul = Soul.all_objects.get(pk=world.souls[civ])
            room = Conversation.objects.create(kind=ConversationKind.OFFICER_INBOX, room_id=f"!img-{civ}:x",
                                               soul_a=soul, tenant=hall, account_a=world.accounts[civ],
                                               closed_at=timezone.now(), silenced_at=timezone.now())  # beside `_rooms`

            def image(tag, room=room, civ=civ):
                return ChatImage.objects.create(conversation=room, uploader=world.accounts[civ], file=f"chat/{tag}.png",
                                                width=1, height=1, byte_size=1, content_type="image/png")

            stale, sent, fresh = image(f"stale-{civ}"), image(f"sent-{civ}"), image(f"fresh-{civ}")
        _age(ChatImage, stale.pk, civ, created_at=timezone.now() - OLD)
        _age(ChatImage, sent.pk, civ, created_at=timezone.now() - OLD, sent_at=timezone.now() - OLD)
        made[civ] = (stale, sent, fresh)
    return made


@sharded
@pytest.mark.parametrize("how", ["worker", "direct"])
def test_unsent_images_are_cleared_on_every_shard(world, how):
    from apps.chat.models import ChatImage

    with cut():
        made = _images(world)
        assert _run("chat.cleanup_unsent_images", how) == {"deleted": len(CIVS)}
    for civ, (stale, sent, fresh) in made.items():
        assert _where(ChatImage, stale.pk) == [], civ
        assert _where(ChatImage, sent.pk) == [SHARD[civ]], civ  # sent: never touched
        assert _where(ChatImage, fresh.pk) == [SHARD[civ]], civ  # under 24 hours


# ---- soul_accounts.prune_data_exports -------------------------------------------------------------------------------

def _exports(world):
    from apps.soul_accounts.models import DataExportStatus, SoulDataExport

    now, made = timezone.now(), {}
    for civ, hall in world.halls.items():
        with _in_hall(hall):
            def export(status, civ=civ, **fields):
                return SoulDataExport.objects.create(account=world.accounts[civ], soul_id=world.souls[civ],
                                                     status=status, **fields)

            expired = export(DataExportStatus.READY, expires_at=now - timedelta(days=1), file_path=f"x/{civ}-old.zip")
            ready = export(DataExportStatus.READY, expires_at=now + timedelta(days=3), file_path=f"x/{civ}-new.zip")
            stuck = export(DataExportStatus.RUNNING)
        _age(SoulDataExport, stuck.pk, civ, requested_at=now - timedelta(hours=3))
        made[civ] = (expired, ready, stuck)
    return made


@sharded
@pytest.mark.parametrize("how", ["worker", "direct"])
def test_expired_and_stuck_exports_are_settled_on_every_shard(world, how):
    from apps.soul_accounts.models import DataExportStatus, SoulDataExport

    with cut(), mock.patch("apps.soul_accounts.data_export.enqueue"):
        made = _exports(world)
        assert _run("soul_accounts.prune_data_exports", how) == {"expired": 4, "requeued": 0, "failed": 4}
    for civ, (expired, ready, stuck) in made.items():
        rows = SoulDataExport._base_manager.using(SHARD[civ])
        assert rows.filter(pk=expired.pk, status=DataExportStatus.EXPIRED, file_path="").exists(), civ
        assert rows.filter(pk=ready.pk, status=DataExportStatus.READY, file_path=ready.file_path).exists(), civ
        assert rows.filter(pk=stuck.pk, status=DataExportStatus.FAILED, error="StuckWorker").exists(), civ
        for row in (expired, ready, stuck):
            assert _where(SoulDataExport, row.pk) == [SHARD[civ]], civ


# ---- soul_assist.purge_history --------------------------------------------------------------------------------------

def _assist(world):
    """Per hall a soul's conversation with an old and a recent message, and a soul's deleted conversation; on control
    (D2: no hall) a deactivated officer's conversation and an active officer's."""
    from apps.authentication.models import User
    from apps.soul_assist.models import SCREENS, AssistConversation, AssistMessage

    made = {}
    for civ, hall in world.halls.items():
        with _in_hall(hall):
            kept = AssistConversation.objects.create(account=world.accounts[civ], screen=SCREENS[0])
            old = AssistMessage.objects.create(conversation=kept, role="user", content="old")
            new = AssistMessage.objects.create(conversation=kept, role="user", content="new")
            gone = AssistConversation.all_objects.create(account=world.accounts[civ], screen=SCREENS[1], is_deleted=True)
            AssistMessage.objects.create(conversation=gone, role="user", content="deleted with it")
        _age(AssistMessage, old.pk, civ, created_at=timezone.now() - OLD)
        made[civ] = (kept, old, new, gone)
    officers = {active: User.objects.create_user(username=f"assist-{active}", password="x", role="JUDGE",
                                                 tenant=world.halls["CHINESE"], is_active=active)
                for active in (True, False)}
    on_control = {}
    for active, officer in officers.items():
        with _in_hall(world.halls["CHINESE"]):  # an officer's question is asked in his hall's request
            conv = AssistConversation.objects.create(user=officer, screen="other")
            AssistMessage.objects.create(conversation=conv, role="user", content="officer")
        on_control[active] = conv
    return made, on_control


@sharded
@pytest.mark.parametrize("how", ["worker", "direct"])
def test_assistant_history_is_purged_on_every_shard_and_on_control(world, how):
    from apps.soul_assist.models import AssistConversation, AssistMessage

    with cut():
        made, on_control = _assist(world)
        assert _where(AssistConversation, on_control[False].pk) == ["default"]  # hall-less: control's (D2)
        result = _run("soul_assist.purge_history", how)
    assert result == {"messages": len(CIVS), "conversations": len(CIVS) + 1}, result
    for civ, (kept, old, new, gone) in made.items():
        assert _where(AssistMessage, old.pk) == [], civ
        assert _where(AssistMessage, new.pk) == [SHARD[civ]], civ
        assert _where(AssistConversation, kept.pk) == [SHARD[civ]], civ
        assert _where(AssistConversation, gone.pk) == [], civ
    assert _where(AssistConversation, on_control[False].pk) == []  # its officer is deactivated
    assert _where(AssistConversation, on_control[True].pk) == ["default"]


# ---- chat.sync_all_rooms ----------------------------------------------------------------------------------------------

def _rooms(world):
    """Per hall an open inbox and a closed one still owing its silencing, each with the soul's live chat identity."""
    from apps.chat.models import ChatIdentity, Conversation, ConversationKind
    from apps.souls.models import Soul

    made = {}
    for civ, hall in world.halls.items():
        with _in_hall(hall):
            soul = Soul.all_objects.get(pk=world.souls[civ])
            identity = ChatIdentity.objects.create(account=world.accounts[civ], soul=soul, localpart=f"lp-{civ}",
                                                   matrix_user_id=f"@lp-{civ}:test")

            def room(tag, civ=civ, hall=hall, soul=soul, **fields):
                return Conversation.objects.create(kind=ConversationKind.OFFICER_INBOX, room_id=f"!{tag}-{civ}:x",
                                                   soul_a=soul, tenant=hall, account_a=world.accounts[civ], **fields)

            made[civ] = (room("open"), room("closed", closed_at=timezone.now()), identity)
    return made


@sharded
@pytest.mark.parametrize("how", ["worker", "direct"])
def test_every_room_of_every_shard_gets_its_speaking_levels(world, synapse, how):
    from apps.chat.models import Conversation
    from apps.chat.services import SILENT, SPEAK

    with cut():
        made = _rooms(world)
        assert _run("chat.sync_all_rooms", how) == {"synced": 2 * len(CIVS)}
    for civ, (open_room, closed_room, identity) in made.items():
        assert synapse.levels[open_room.room_id] == {identity.matrix_user_id: SPEAK}, civ
        assert synapse.levels[closed_room.room_id] == {identity.matrix_user_id: SILENT}, civ
        rows = Conversation._base_manager.using(SHARD[civ])
        assert rows.filter(pk=closed_room.pk, silenced_at__isnull=False).exists(), civ
        assert rows.filter(pk=open_room.pk, silenced_at__isnull=True).exists(), civ  # open: not silenced
        assert _where(Conversation, open_room.pk) == [SHARD[civ]], civ


# ---- audit.prune_retained_data / audit.prune_untenanted_logs (`purge_in_batches`) ------------------------------------

def _retained(world):
    """Per hall an old and a recent assistant usage row (each on its shard), and the same pair with no hall (control,
    D2); an old hall-less audit row (control) and an old audit row of each hall, which the GLOBAL job leaves alone."""
    from apps.audit.models import AuditAction, AuditLog
    from apps.soul_assist.models import AssistUsage

    old = timezone.now() - OLD
    usage, audit = {}, {}
    for civ, hall in [*world.halls.items(), (None, None)]:
        with _in_hall(hall) if hall else _in_hall(world.halls["CHINESE"]):
            pair = [AssistUsage.objects.create(side="soul", tenant=hall, status="ok") for _ in range(2)]
            log = AuditLog.objects.create(tenant=hall, action=AuditAction.READ, resource="soul", resource_id=f"r-{civ}")
        alias = SHARD[civ] if civ else "default"
        AssistUsage._base_manager.using(alias).filter(pk=pair[0].pk).update(created_at=old)
        AuditLog._base_manager.using(alias).filter(pk=log.pk).update(timestamp=old)
        usage[civ], audit[civ] = pair, log
    return usage, audit


@sharded
@pytest.mark.parametrize("how", ["worker", "direct"])
def test_retention_purges_every_master_in_batches(world, how):
    from apps.audit.models import AuditLog
    from apps.soul_assist.models import AssistUsage

    with cut():
        usage, audit = _retained(world)
        assert _run("audit.prune_retained_data", how)["assist_usage"] == len(CIVS) + 1
        assert _run("audit.prune_untenanted_logs", how)["audit_deleted"] == 1
    for civ, (old, recent) in usage.items():
        alias = SHARD[civ] if civ else "default"
        assert _where(AssistUsage, old.pk) == [], civ
        assert _where(AssistUsage, recent.pk) == [alias], civ
    assert _where(AuditLog, audit[None].pk) == []
    for civ in CIVS:
        assert _where(AuditLog, audit[civ].pk) == [SHARD[civ]], civ  # a hall's: its TENANT job's, not this one's


# ---- the registry -----------------------------------------------------------------------------------------------------

@sharded
def test_every_registered_job_runs_under_an_all_civilization_write_cut(world, synapse):
    """Each job once (a TENANT job once per hall), through Celery as beat runs it, over a world with rows for the
    jobs above. Synapse is `_Synapse`; a data export's re-enqueue is not sent (it would publish to the broker)."""
    from apps.scheduler.registry import _BY_KEY, TENANT

    failed = {}
    with cut(), mock.patch("apps.soul_accounts.data_export.enqueue"):
        _images(world), _exports(world), _assist(world), _rooms(world), _retained(world)
        for key, spec in sorted(_BY_KEY.items()):
            for hall in (world.halls.values() if spec.scope == TENANT else [None]):
                try:
                    _run(key, "worker", **spec.task_kwargs(hall))
                except AssertionError as exc:
                    failed[f"{key}@{hall.code if hall else '-'}"] = str(exc)
    assert not failed, "\n\n".join(f"{k}: {v}" for k, v in failed.items())
