"""Stage 5 deletes control's copy of every write-cut civilization's SHARD rows (docs/audit/2026-11-15-sharding/
PREP-stage5.md section 2, "仍从控制库读 SHARD 行的代码"). Each case here drives one code path that read that copy, through
its real entry point, with the rows it needs on their shard and NOT on control -- what a purge leaves, and what a row
written in the last minute before the shard-to-control sync already looks like on 115.

Every civilization writes to its shard (as on 115 since 2026-11-17); nothing is synced after the halls, so each row
made here exists on its master only. Each case first asserts that (the precondition), then the answer -- what must be
there and what must not.

    M1  a soul request reads its primary shard, found without control's copy of the soul
    M2  a soul's row in another civilization's shard is seen on a page that shows such rows
    M4  the soul circle's feed, search and the mute list find souls by id, not through control's copy
    M5  a push is recorded for a soul whose row control does not have
    M6  a soul found by its code for a letter across civilizations
    M7  a phone turns its face / fingerprint sign-in off
    M8  the role members list names each officer's organization
    M9  the pending-credentials list after its sweeps changed a row
    M12 a city god's and a tudi god's officers (a many-to-many through a SHARD table)
    S1  (stage 4) SYSTEM_ADMIN exports and leaves its audit row; S2 the credential sweeps write each row on its master

    cd backend && ... python -m pytest --ds=config.settings_sharded -m sharded \\
      tests/test_reads_do_not_lean_on_controls_mirror.py
"""
# ruff: noqa: F811 -- `world` and `enqueued` are fixtures imported from their modules
import uuid
from datetime import timedelta

import pytest
from django.db import connections, transaction
from django.utils import timezone

from tests.soul_push_support import enqueued  # noqa: F401
from tests.test_control_locks_in_a_write_cut_hall import _admin, _client, _soul_account, world  # noqa: F401
from tests.test_shard_sync import CIVS, sharded
from tests.test_sharded_writes import _in_hall

SHARDS = {f"civ_{c.lower()}" for c in CIVS}


def _only_on_its_master(model, pk):
    from apps.core.shard_reads import write_alias_of

    row = next(r for alias in SHARDS for r in model._base_manager.using(alias).filter(pk=pk))
    master = write_alias_of(row)
    assert master in SHARDS, (model._meta.label, master)
    assert not model._base_manager.using("default").filter(pk=pk).exists(), f"{model._meta.label} {pk} on control"
    return row


def _ready(hall, name, **soul_fields):
    """A soul account that may use /me (password changed), its soul on its master only."""
    from apps.soul_accounts.models import SoulAccount
    from apps.souls.models import Soul
    from tests.soul_account_support import soul_client

    account = _soul_account(hall, name, mirror=False, **soul_fields)
    SoulAccount.objects.filter(pk=account.pk).update(must_change_password=False, initial_password_expires_at=None)
    account = SoulAccount.objects.get(pk=account.pk)
    _only_on_its_master(Soul, account.soul_id)
    return account, soul_client(account)


def _soul_row(account):
    from apps.souls.models import Soul

    return _only_on_its_master(Soul, account.soul_id)


# ---- M1 / M2: where a soul account reads -------------------------------------------------------------------------

def _shards_touched(client, url):
    """Shards a GET ran statements on, transaction statements left out. Until 2026-11-21 the saga's open-move check
    (`shard_saga.arriving`, every master's outbox) was left out too; a soul's lookup asks control now
    (`soul_directory`), so nothing is."""
    from contextlib import ExitStack

    touched = set()

    def record(alias):
        def wrapper(execute, sql, params, many, context):
            if not sql.lstrip().upper().startswith(("SAVEPOINT", "RELEASE", "ROLLBACK", "BEGIN", "COMMIT")):
                touched.add(alias)
            return execute(sql, params, many, context)
        return wrapper

    with ExitStack() as stack:
        for alias in connections:
            stack.enter_context(connections[alias].execute_wrapper(record(alias)))
        r = client.get(url)
    assert r.status_code == 200, r.content[:300]
    return touched & SHARDS


@sharded
def test_m1_a_soul_request_reads_its_primary_shard_without_controls_copy_of_the_soul(world):
    from apps.core.sharding import alias_for_civilization

    for civ in CIVS:
        _, client = _ready(world[civ], f"一魂{civ}")
        assert _shards_touched(client, "/api/v1/me/sessions/") == {alias_for_civilization(civ)}, civ


@sharded
def test_m2_a_judgment_a_residence_court_wrote_shows_on_the_souls_life(world):
    from apps.judgment.models import Judgment

    account, client = _ready(world["GREEK"], "暂居过的魂")
    soul = _soul_row(account)
    with _in_hall(world["EGYPTIAN"]), transaction.atomic():
        abroad = Judgment.objects.create(soul=soul, tenant=world["EGYPTIAN"])
    _only_on_its_master(Judgment, abroad.pk)
    _, other_client = _ready(world["GREEK"], "没出过门的魂")
    r = client.get("/api/v1/me/life/")
    assert r.status_code == 200, r.content[:300]
    assert [j["id"] for j in r.json()["judgments"]] == [str(abroad.pk)], r.json()
    r = other_client.get("/api/v1/me/life/")
    assert r.status_code == 200 and r.json()["judgments"] == [], r.json()


# ---- M4: the soul circle ---------------------------------------------------------------------------------------

def _named(account, name):
    from apps.authentication.models import User

    User.objects.filter(pk=account.user_id).update(display_name=name)


@sharded
def test_m4_the_feed_and_search_find_souls_of_the_hall_by_id(world):
    from apps.social.models import ModerationStatus, Post, Visibility

    hall = world["EUROPEAN"]
    author, _ = _ready(hall, "作者")
    reader, client = _ready(hall, "读者")
    stranger, _ = _ready(world["GREEK"], "外人")
    _named(author, "Orpheus")
    _named(stranger, "Orpheus the stranger")
    with _in_hall(hall):
        post = Post.objects.create(author_id=author.user_id, tenant=hall, content="hello",
                                   visibility=Visibility.PUBLIC, moderation_status=ModerationStatus.PUBLISHED)
    r = client.get("/api/v1/me/social/feed/")
    assert r.status_code == 200, r.content[:300]
    assert [p["id"] for p in r.json()["results"]] == [str(post.pk)], r.json()
    r = client.get("/api/v1/me/social/search/", {"q": "Orpheus"})
    assert r.status_code == 200 and [s["user_id"] for s in r.json()] == [author.user_id], r.json()
    r = client.get("/api/v1/me/social/search/", {"q": _soul_row(author).soul_code})
    assert r.status_code == 200 and [s["user_id"] for s in r.json()] == [author.user_id], r.json()
    r = client.get("/api/v1/me/social/search/", {"q": _soul_row(stranger).soul_code})
    assert r.status_code == 200 and r.json() == [], r.json()


@sharded
def test_m4_the_mute_list_and_its_picker_find_the_halls_souls(world):
    from apps.social.models import SocialMute

    hall = world["EGYPTIAN"]
    muted, _ = _ready(hall, "被禁言的魂")
    elsewhere, _ = _ready(world["CHINESE"], "别处的魂")
    admin = _admin(hall, f"mute_admin_{uuid.uuid4().hex[:6]}")
    with _in_hall(hall):
        mute = SocialMute.objects.create(tenant=hall, user_id=muted.user_id, until=timezone.now() + timedelta(days=3),
                                         created_by=admin)
    with _in_hall(world["CHINESE"]):
        SocialMute.objects.create(tenant=world["CHINESE"], user_id=elsewhere.user_id,
                                  until=timezone.now() + timedelta(days=3))
    r = _client(admin).get("/api/v1/social-moderation/mutes/")
    assert r.status_code == 200, r.content[:300]
    assert [m["id"] for m in r.json()["results"]] == [str(mute.pk)], r.json()
    r = _client(admin).get("/api/v1/social-moderation/mutes/souls/")
    assert r.status_code == 200, r.content[:300]
    assert [s["user_id"] for s in r.json()] == [muted.user_id], r.json()


# ---- M5: push ----------------------------------------------------------------------------------------------------

@sharded
def test_m5_a_judgment_result_is_recorded_for_push(world, enqueued):
    from apps.events.services import EventService
    from apps.soul_push.models import PushDelivery
    from tests.soul_push_support import register

    hall = world["CHINESE"]
    account, client = _ready(hall, "等结果的魂")
    assert register(client, f"ExponentPushToken[{uuid.uuid4().hex[:20]}]").status_code == 201
    with _in_hall(hall), transaction.atomic():
        EventService.log(_soul_row(account), "JUDGMENT_CONCLUDED", {"judgment_id": str(uuid.uuid4())})
    assert list(PushDelivery.objects.values_list("account_id", "kind")) == [(account.pk, "judgment_result")]


# ---- M6: a letter across civilizations -------------------------------------------------------------------------

@sharded
def test_m6_a_soul_of_another_civilization_is_found_by_its_code(world):
    writer, client = _ready(world["GREEK"], "写信的魂")
    reader, _ = _ready(world["EGYPTIAN"], "收信的魂")
    r = client.post("/api/v1/me/chat/lookup/", {"soul_code": _soul_row(reader).soul_code}, format="json")
    assert r.status_code == 200, r.content[:300]
    assert r.json()["user_id"] == reader.user_id
    r = client.post("/api/v1/me/chat/lookup/", {"soul_code": _soul_row(writer).soul_code}, format="json")
    assert r.status_code == 404, r.content[:300]  # oneself: the same 404 as nobody


# ---- M7: face / fingerprint sign-in -------------------------------------------------------------------------------

@sharded
def test_m7_a_phone_turns_its_device_sign_in_off(world):
    from rest_framework.test import APIClient

    from apps.soul_accounts import device_login
    from apps.soul_accounts.models import SoulDeviceLogin

    hall = world["GREEK"]
    account, _ = _ready(hall, "换手机的魂")
    with _in_hall(hall), transaction.atomic():
        raw = device_login.issue(account)
    kept, _ = _ready(hall, "另一部手机的魂")
    with _in_hall(hall), transaction.atomic():
        device_login.issue(kept)
    r = APIClient().post("/api/v1/soul-auth/device-login/revoke/", {"credential": raw}, format="json")
    assert r.status_code == 204, r.content[:300]
    assert SoulDeviceLogin.objects.get(account=account).revoked_at is not None
    assert SoulDeviceLogin.objects.get(account=kept).revoked_at is None


# ---- M8: role members -----------------------------------------------------------------------------------------

@sharded
def test_m8_the_role_members_list_names_each_officers_organization(world):
    from apps.authentication.models import User
    from apps.org.models import Organization
    from apps.org.ownership import tenant_root
    from apps.perm.models import Role

    hall = world["EUROPEAN"]
    with _in_hall(hall), transaction.atomic():
        unit = Organization.objects.create(name="新设的司", code=f"NEW_{uuid.uuid4().hex[:6]}", tenant=hall,
                                           parent=tenant_root(hall))
    _only_on_its_master(Organization, unit.pk)
    judge = User.objects.create_user(username=f"m8_{uuid.uuid4().hex[:6]}", password="x", role="JUDGE", tenant=hall,
                                     organization=unit)
    admin = _admin(hall, f"m8_admin_{uuid.uuid4().hex[:6]}")
    role = Role.objects.get(name="JUDGE")
    r = _client(admin).get(f"/api/v1/perm/roles/{role.pk}/members/")
    assert r.status_code == 200, r.content[:300]
    rows = {u["id"]: u for u in r.json()["results"]}
    assert rows[judge.pk]["organization"] == {"id": unit.pk, "code": unit.code, "name": "新设的司",
                                              "name_en": unit.name_en}, rows[judge.pk]


# ---- M9: pending credentials --------------------------------------------------------------------------------------

@sharded
def test_m9_the_credentials_list_reads_the_rows_its_sweep_just_changed(world):
    from apps.soul_accounts.models import CredentialStatus, InitialCredential

    hall = world["EGYPTIAN"]
    due, _ = _ready(hall, "过期的魂")
    fresh, _ = _ready(hall, "刚开号的魂")
    with _in_hall(hall):
        InitialCredential.objects.filter(account=due).update(expires_at=timezone.now() - timedelta(minutes=1))
        fresh_pk = InitialCredential.objects.get(account=fresh).pk
    _only_on_its_master(InitialCredential, fresh_pk)
    r = _client(_admin(hall, f"m9_admin_{uuid.uuid4().hex[:6]}")).get("/api/v1/soul-accounts/credentials/")
    assert r.status_code == 200, r.content[:300]
    status = {row["account"]: row["status"] for row in r.json()["results"]}
    assert status == {str(due.pk): CredentialStatus.VOID, str(fresh.pk): CredentialStatus.PENDING}, status


# ---- M12: officers of a city god / a tudi god ------------------------------------------------------------------

@sharded
@pytest.mark.parametrize("which", ["city-god", "tudi-god"])
def test_m12_a_gods_officers_are_read_where_their_through_rows_are(world, which):
    from apps.authentication.models import User
    from apps.death_sync.models import TudiGod
    from apps.judgment.models import CityGod

    hall = world["CHINESE"]
    officer = User.objects.create_user(username=f"m12_{uuid.uuid4().hex[:6]}", password="x", role="JUDGE",
                                       tenant=hall)
    User.objects.create_user(username=f"m12_not_{uuid.uuid4().hex[:6]}", password="x", role="JUDGE", tenant=hall)
    model, url = (CityGod, "/api/v1/judgment/city-gods/") if which == "city-god" else (
        TudiGod, "/api/v1/death-sync/tudi-gods/")
    with _in_hall(hall), transaction.atomic():
        god = model.objects.create(tenant=hall, name=f"m12-{which}")
        god.officers.add(officer)
    _only_on_its_master(model, god.pk)
    through = model.officers.through
    assert not through._base_manager.using("default").filter(user_id=officer.pk).exists(), "through row on control"
    client = _client(_admin(hall, f"m12_admin_{uuid.uuid4().hex[:6]}"))
    for path in (url, f"{url}{god.pk}/"):
        r = client.get(path)
        assert r.status_code == 200, r.content[:300]
        body = r.json()
        row = body if "officers" in body else next(g for g in body["results"] if g["id"] == str(god.pk))
        assert [o["id"] for o in row["officers"]] == [officer.pk], (path, row)


# ---- S1 / S2: stage-4 writes the purge rehearsal found --------------------------------------------------------

@sharded
@pytest.mark.parametrize("url", ["/api/v1/souls/export/", "/api/v1/judgment/export/", "/api/v1/users/export_csv/"])
def test_s1_system_admin_exports_under_write_cut_and_leaves_one_audit_row(world, url):
    """record_export wrote `AuditLog.objects.create(user=...)`: the User assignment asked the router with no single
    civilization (SYSTEM_ADMIN), NoShardContext, a 500. Now the audit signals' own write (`_write_row`)."""
    from apps.audit.models import AuditLog
    from apps.authentication.models import User

    admin = User.objects.create_user(username=f"s1_{uuid.uuid4().hex[:6]}", password="x", role="SYSTEM_ADMIN")
    exports = {a: AuditLog._base_manager.using(a).filter(action="EXPORT", user_id=admin.pk).count()
               for a in ("default", *SHARDS)}
    assert sum(exports.values()) == 0
    r = _client(admin).get(url)
    assert r.status_code == 200, r.content[:300]
    after = {a: AuditLog._base_manager.using(a).filter(action="EXPORT", user_id=admin.pk).count()
             for a in ("default", *SHARDS)}
    assert after == {**exports, "default": 1}, after  # one row, hall-less: control's (D2), on no shard


@sharded
def test_s2_the_credential_sweeps_of_a_hall_of_no_known_civilization_write_each_row_on_its_master(world):
    """A hall of UNKNOWN civilization reads and writes control. Its list's sweeps (`expire_due_credentials`) are not
    scoped to it: in its context they updated control's mirror of a write-cut civilization's credential, and the
    guard refused it (ControlMirrorWrite, a 500). Now the sweep is split per master: the due credential is voided on
    its master, control's mirror is not written."""
    from apps.core.shard_reads import control_mirror_writes
    from apps.soul_accounts.models import CredentialStatus, InitialCredential
    from apps.tenants.models import Tenant

    hall = world["GREEK"]
    due, _ = _ready(hall, "过期的希腊魂")
    with _in_hall(hall):
        InitialCredential.objects.filter(account=due).update(expires_at=timezone.now() - timedelta(minutes=1))
        row = InitialCredential.objects.get(account=due)
    from tests.test_control_locks_in_a_write_cut_hall import _mirror

    _mirror(_soul_row(due))  # what the shard-to-control sync leaves before stage 5: the soul, then its credential
    with control_mirror_writes():
        InitialCredential._base_manager.using("default").bulk_create([row])
    unknown = Tenant.objects.create(code=f"S2_{uuid.uuid4().hex[:4]}", display_name="?", declared_civilization="")
    r = _client(_admin(unknown, f"s2_admin_{uuid.uuid4().hex[:6]}")).get("/api/v1/soul-accounts/credentials/")
    assert r.status_code == 200, r.content[:300]
    assert r.json()["results"] == [], r.json()  # another civilization's credential is not this hall's
    master = _only_on_its_master_or_mirrored(InitialCredential, row.pk)
    assert InitialCredential._base_manager.using(master).get(pk=row.pk).status == CredentialStatus.VOID
    mirror = InitialCredential._base_manager.using("default").get(pk=row.pk)
    assert mirror.status == row.status and mirror.secret == row.secret, "control's mirror was written"


def _only_on_its_master_or_mirrored(model, pk):
    from apps.core.shard_reads import write_alias_of

    row = next(r for alias in SHARDS for r in model._base_manager.using(alias).filter(pk=pk))
    return write_alias_of(row)
