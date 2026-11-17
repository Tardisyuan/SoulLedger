"""A business transaction in a write-cut hall holds on control too (sharding stage 4; VERIFY-stage4 must-fix 2;
apps/core/shard_reads.py `_install_atomic`, apps/tenants/shard_saga.py `on_master`).

Before: in one civilization's context `transaction.atomic()` opened the shard's transaction only, so control stayed in
autocommit. On PostgreSQL a control row lock there (`User.objects.select_for_update()`) raised
TransactionManagementError -- a 500 -- and a control write committed at once and outlived the shard's rollback.

  sites        every `select_for_update` on a CONTROL model in the product, derived by grep (`control_lock_sites`),
               each either driven here through its real entry point or named with the reason it never runs in one
               civilization's context. A new site fails the inventory until it is one or the other.
  entry points the sites in one hall's context, over HTTP where the URLconf has the route: not a 500, the lock taken
               inside a code transaction on control, and -- the shard's commit failing -- control's writes rolled back.
  relay        a saga handler (apply and done) runs inside a transaction open on its master and on control.
  real locks   (PostgreSQL) a second connection holding the row makes the request wait for it.

Every test is `transaction=True`: a TestCase wraps each alias in a transaction and would hide the autocommit this is
about. SQLite has no row locks and Django skips its "outside a transaction" check there (`has_select_for_update`);
the `locks` fixture applies Django's own check on SQLite, so the entry points fail the same way on both engines.

    cd backend && ... python -m pytest --ds=config.settings_sharded -m sharded tests/test_control_locks_in_a_write_cut_hall.py
"""
import re
import threading
from pathlib import Path
from unittest import mock

import pytest
from django.db import DatabaseError, connection, connections, transaction
from django.db.transaction import TransactionManagementError

from tests.test_shard_sync import CIVS, sharded
from tests.test_sharded_writes import _assign, _halls, _in_hall, cut

SQLITE = connection.vendor == "sqlite"
NEEDS_ROW_LOCKS = pytest.mark.skipif(SQLITE, reason="SQLite has no row lock to wait on. Run on PostgreSQL.")
BACKEND = Path(__file__).resolve().parents[1]
GREEK, EGYPT = "civ_greek", "civ_egyptian"


# ---- the inventory --------------------------------------------------------------------------------------------------

_MANAGER = re.compile(r"\b([A-Z]\w*)\.(?:objects|_base_manager|all_objects|_default_manager)\b")
#: Receivers the grep cannot name: a helper's queryset, a model passed in. Read by hand; a new one fails below.
INDIRECT = {
    ("apps/perm/members.py", "_users(request).select_for_update"): "authentication.User",
    ("apps/authentication/views.py", "self._batch_targets(user_ids).select_for_update"): "authentication.User",
    ("apps/authentication/mfa.py", "type(mfa)._default_manager.select_for_update"): "authentication.OfficerMfa",
    ("apps/disposition/expiry.py", "running.filter("): "SHARD",
    ("apps/sentence_plan/services.py", "qs = qs.select_for_update"): "SHARD",
    ("apps/judgment/handover.py", "_letters(source, tenant_id).select_for_update"): "SHARD",
    ("apps/judgment/appeals.py", "open_appeals.select_for_update"): "SHARD",
    ("apps/dispatch/services.py", "here.select_for_update"): "SHARD",
    ("apps/death_sync/management/commands/rotate_encryption_key.py", "rows.select_for_update"): "ANY (a command: MASTER)",
    ("apps/tenants/shard_saga.py", "outbox._base_manager.using(alias).select_for_update"): "SHARD",
    ("apps/tenants/shard_saga.py", "model._base_manager.select_for_update"): "SHARD",
    ("apps/social/moderation.py", "queryset.select_for_update"): "SHARD",
    ("apps/social/moderation.py", "model.objects.select_for_update"): "SHARD",
    ("apps/souls/models.py", "cls.all_objects.select_for_update"): "SHARD",
    ("apps/workflow/segments.py", "segment.nodes.select_for_update"): "SHARD",
    ("apps/workflow/segments.py", "workflow.segments.select_for_update"): "SHARD",
}

#: Control-lock sites driven below through their entry point in one hall's context.
DRIVEN = {
    ("apps/authentication/views.py", "User.objects.select_for_update().get(pk=user.pk"): "deactivate",
    ("apps/authentication/views.py", "self._batch_targets(user_ids).select_for_update"): "batch_deactivate",
    ("apps/perm/members.py", "_users(request).select_for_update"): "role_members",
    ("apps/soul_accounts/services.py", "SoulAccount.objects.select_for_update(of=(\"self\",)).select_related(\"soul__tenant\", \"user\")"): "reset_credential",
    ("apps/soul_accounts/services.py", "SoulAccount.objects.select_for_update(of=(\"self\",)).select_related(\"user\")"): "annihilation",
    ("apps/soul_accounts/rebirth.py", "SoulAccount.objects.select_for_update"): "rebirth_submit",
    ("apps/officer_app/push.py", "OfficerPushDevice.objects.select_for_update"): "officer push registration",
    ("apps/authentication/mfa.py", "type(mfa)._default_manager.select_for_update"): "officer two-step setup",
    ("apps/soul_assist/usage.py", "AssistConfig.objects.select_for_update().get(pk=1)"): "assistant monthly cap",
}
#: Control-lock sites that never run in one civilization's context: there `atomic()` was always control's
#: (MASTER: a soul account, SYSTEM_ADMIN, a global task) -- or the role tables, which only a hall-less ADMIN edits.
MASTER_ONLY = {
    ("apps/perm/matrix.py", "Role.objects.select_for_update"): "the permission matrix: hall-less ADMIN / SYSTEM_ADMIN",
    ("apps/perm/views.py", "Role.objects.select_for_update"): "role permissions: hall-less ADMIN / SYSTEM_ADMIN",
    ("apps/social/moderation.py", "SoulAccount.objects.select_for_update"): "a soul's report: soul account (MASTER)",
    ("apps/soul_assist/eval_identities.py", "AssistConfig.objects.select_for_update"): "assistant config: SYSTEM_ADMIN",
    ("apps/soul_assist/admin_views.py", "AssistConfig.objects.select_for_update"): "assistant config: SYSTEM_ADMIN",
    ("apps/soul_assist/usage.py", "AssistConfig.objects.select_for_update().filter(pk=1)"):
        "maybe_reopen: a soul's question (MASTER) and the SYSTEM_ADMIN config page",
    ("apps/soul_push/services.py", "PushDevice.objects.select_for_update"): "soul push registration: soul account (MASTER)",
    ("apps/soul_push/services.py", "PushDelivery.objects.select_for_update"): "push sweep: a global Celery task (MASTER)",
    ("apps/soul_accounts/mfa.py", "SoulAccount.objects.select_for_update"): "soul two-step: soul account (MASTER)",
    ("apps/soul_accounts/me_views.py", "SoulAccount.objects.select_for_update"): "/me/: soul account (MASTER)",
    ("apps/soul_accounts/data_export.py", "SoulAccount.objects.select_for_update"): "soul data export: soul account (MASTER)",
}


def control_lock_sites():
    """{(file, the matched line's text)} of every `select_for_update(` in non-test product code whose model is CONTROL
    (named before `.objects` / `._base_manager` / ... on the line, or by INDIRECT), and every line it cannot place."""
    from django.apps import apps

    from apps.core.sharding import CONTROL, placement

    by_name = {}
    for m in apps.get_models(include_auto_created=True):
        by_name.setdefault(m.__name__, []).append(m)
    control, unplaced = set(), set()
    for path in sorted((BACKEND / "apps").rglob("*.py")):
        rel = path.relative_to(BACKEND).as_posix()
        if "/tests/" in rel or "/migrations/" in rel or path.name.startswith("test"):
            continue
        for line in path.read_text(encoding="utf-8").splitlines():
            code = line.split("#", 1)[0]
            if ("select_for_update(" not in code or code.strip().startswith(('"', "`", "'"))
                    or re.search(r"`[^`]*select_for_update\(", code)):  # prose: a docstring naming the call
                continue
            hand = next((v for (f, k), v in INDIRECT.items() if f == rel and k in code), None)
            if hand is not None:
                if "." in hand and placement(apps.get_model(hand)) == CONTROL:
                    control.add((rel, code.strip()))
                continue
            models = [m for n in _MANAGER.findall(code) for m in by_name.get(n, [])]
            if not models:
                unplaced.add((rel, code.strip()))
            elif any(placement(m) == CONTROL for m in models):
                control.add((rel, code.strip()))
    return control, unplaced


def _named(site, table):
    return next((v for (f, k), v in table.items() if f == site[0] and k in site[1]), None)


@sharded
def test_every_control_lock_site_is_driven_or_never_runs_in_one_civilization():
    """The inventory is derived, not listed: a new `select_for_update` on a CONTROL model -- or one the grep cannot
    place -- fails here until it is driven below or named in MASTER_ONLY with its reason."""
    control, unplaced = control_lock_sites()
    assert len(control) >= 20, f"only {len(control)} control lock sites found: the scan is broken, not the code"
    assert unplaced == set(), f"select_for_update the scan cannot place (add to INDIRECT): {sorted(unplaced)}"
    loose = sorted(s for s in control if _named(s, DRIVEN) is None and _named(s, MASTER_ONLY) is None)
    assert loose == [], f"control lock sites neither driven nor MASTER_ONLY: {loose}"
    for table in (DRIVEN, MASTER_ONLY):  # no stale entry
        for (f, k) in table:
            assert any(s[0] == f and k in s[1] for s in control), f"{f}: {k!r} is not a control lock site any more"


# ---- the world -------------------------------------------------------------------------------------------------------

@pytest.fixture
def locks(monkeypatch):
    """Every row lock compiled during the test: (model label, alias, a code transaction open on that alias). On
    SQLite also Django's own refusal of a lock outside a transaction (compiler.py, skipped there for want of FOR UPDATE)."""
    from django.db.models.sql.compiler import SQLCompiler

    seen = []
    original = SQLCompiler.as_sql

    def as_sql(self, *args, **kwargs):
        if self.query.select_for_update:
            conn = self.connection
            seen.append((self.query.model._meta.label, conn.alias, not conn.get_autocommit()))
            if conn.vendor == "sqlite" and conn.get_autocommit():
                raise TransactionManagementError("select_for_update cannot be used outside of a transaction.")
        return original(self, *args, **kwargs)

    monkeypatch.setattr(SQLCompiler, "as_sql", as_sql)
    return seen


@pytest.fixture
def world():
    halls = _halls()
    _assign(*CIVS)
    with cut(*CIVS):  # as on 115 since 2026-11-17: every civilization writes to its shard
        yield halls


def _client(user, *, raising=True):
    from rest_framework.test import APIClient

    from tests.conftest import sign_in

    client = sign_in(APIClient(), user)
    client.raise_request_exception = raising
    return client


def _admin(hall, name):
    from apps.authentication.models import User

    return User.objects.create_user(username=name, password="x", role="ADMIN", tenant=hall)


def _officer(hall, name, **fields):
    from apps.authentication.models import User

    return User.objects.create_user(username=name, password="x", role="JUDGE", tenant=hall, **fields)


class _ShardCommitFails:
    """The hall's shard's next commit fails (and only that one): the shards commit before control, so control must
    roll back. A mutation committing control first leaves its write behind."""

    def __init__(self, alias):
        self.alias, self.calls = alias, 0

    def __enter__(self):
        conn = connections[self.alias]
        real = conn.commit

        def commit():
            self.calls += 1
            if self.calls == 1:
                raise DatabaseError(f"{self.alias}: commit failed")
            return real()

        self.patch = mock.patch.object(conn, "commit", side_effect=commit)
        self.patch.__enter__()
        return self

    def __exit__(self, *exc):
        self.patch.__exit__(*exc)

    def failed(self, response=None):
        """The shard's commit was reached and failed (a 500), not some earlier refusal."""
        detail = getattr(response, "content", b"")[:300]
        assert self.calls, f"{self.alias} never committed: {getattr(response, 'status_code', None)} {detail}"
        assert response is None or response.status_code == 500, detail
        return True


def _locked_inside(locks, label, alias="default"):
    hits = [held for (m, a, held) in locks if m == label and a == alias]
    assert hits, f"no lock on {label} ({alias}) was taken: {locks}"
    assert all(hits), f"a lock on {label} ({alias}) was taken in autocommit: {locks}"


def _route(viewset, action, method="post"):
    from django.urls import get_resolver

    from tests.test_cross_civilization_saga import _walk

    for callback, name in _walk(get_resolver().url_patterns):
        if getattr(callback, "cls", None) is viewset and (getattr(callback, "actions", None) or {}).get(method) == action:
            return name
    raise AssertionError(f"no route for {viewset.__name__}.{action}")


# ---- the entry points --------------------------------------------------------------------------------------------------

@sharded
@pytest.mark.django_db(databases="__all__", transaction=True)
def test_deactivating_an_officer_locks_the_user_and_rolls_back_with_the_shard(world, locks):
    """`POST /users/{id}/deactivate/` (authentication/views.py, `User.objects.select_for_update()`) by a Greek hall's
    ADMIN. Before the fix: TransactionManagementError on PostgreSQL, a 500."""
    from django.urls import reverse

    from apps.authentication.models import User
    from apps.authentication.views import UserViewSet

    hall = world["GREEK"]
    admin, target = _admin(hall, "lk_admin"), _officer(hall, "lk_target")
    url = reverse(_route(UserViewSet, "deactivate"), kwargs={"pk": target.pk})
    with _ShardCommitFails(GREEK) as fails:
        r = _client(admin, raising=False).post(url, {}, format="json")
    fails.failed(r)
    assert User.objects.get(pk=target.pk).is_active, "control's write outlived the shard's failed commit"
    locks.clear()
    r = _client(admin).post(url, {}, format="json")
    assert r.status_code == 200, r.content
    _locked_inside(locks, "authentication.User")
    assert not User.objects.get(pk=target.pk).is_active


@sharded
@pytest.mark.django_db(databases="__all__", transaction=True)
def test_deactivating_officers_in_a_batch_locks_them_and_rolls_back_with_the_shard(world, locks):
    """`POST /users/batch_deactivate/` (`self._batch_targets(...).select_for_update()`)."""
    from django.urls import reverse

    from apps.authentication.models import User
    from apps.authentication.views import UserViewSet

    hall = world["GREEK"]
    admin = _admin(hall, "lk_admin")
    targets = [_officer(hall, f"lk_t{i}") for i in range(2)]
    url = reverse(_route(UserViewSet, "batch_deactivate"))
    body = {"user_ids": [str(t.pk) for t in targets]}
    with _ShardCommitFails(GREEK) as fails:
        r = _client(admin, raising=False).post(url, body, format="json")
    fails.failed(r)
    assert User.objects.filter(pk__in=[t.pk for t in targets], is_active=True).count() == 2
    locks.clear()
    r = _client(admin).post(url, body, format="json")
    assert r.status_code == 200, r.content
    _locked_inside(locks, "authentication.User")
    assert not User.objects.filter(pk__in=[t.pk for t in targets], is_active=True).exists()


@sharded
@pytest.mark.django_db(databases="__all__", transaction=True)
def test_changing_a_roles_members_locks_the_users_and_rolls_back_with_the_shard(world, locks):
    """`POST /perm/roles/{id}/members/` (perm/members.py, `_users(request).select_for_update()`)."""
    from apps.authentication.models import User
    from apps.perm.models import Role

    hall = world["GREEK"]
    admin, judge = _admin(hall, "lk_admin"), _officer(hall, "lk_judge")
    role = Role.objects.get_or_create(name="SCRIBE", defaults={"display_name": "Scribe"})[0]
    url = f"/api/v1/perm/roles/{role.pk}/members/"
    body = {"action": "add", "kind": "extra", "user_ids": [judge.pk]}
    with _ShardCommitFails(GREEK) as fails:
        r = _client(admin, raising=False).post(url, body, format="json")
    fails.failed(r)
    assert "SCRIBE" not in (User.objects.get(pk=judge.pk).extra_roles or [])
    locks.clear()
    r = _client(admin).post(url, body, format="json")
    assert r.status_code == 200, r.content
    _locked_inside(locks, "authentication.User")
    assert "SCRIBE" in User.objects.get(pk=judge.pk).extra_roles


def _soul_account(hall, name, **soul_fields):
    from apps.soul_accounts.models import AccountOrigin
    from apps.soul_accounts.services import provision_account
    from apps.souls.models import Soul

    with _in_hall(hall):
        soul = Soul.objects.create(name=name, tenant=hall, current_state="JUDGING", **soul_fields)
        account, _ = provision_account(soul, AccountOrigin.OFFICER)
    _mirror(soul)
    return account


def _mirror(soul):
    """What the shard-to-control sync (every minute on 115) leaves: control's mirror of the soul, which the account
    locks join on control (`select_related("soul__tenant")`). Only the soul's row: a whole sync here copies shard-range
    ids into control and the next test's control sequences start in a shard's range."""
    from apps.core.shard_reads import control_mirror_writes
    from apps.souls.models import Soul
    from apps.tenants.shard_saga import master_of

    row = Soul._base_manager.using(master_of(soul.tenant)).get(pk=soul.pk)
    with control_mirror_writes():
        Soul._base_manager.using("default").bulk_create([row])


@sharded
@pytest.mark.django_db(databases="__all__", transaction=True)
def test_resetting_a_soul_accounts_credential_locks_it_and_rolls_back_with_the_shard(world, locks):
    """`POST /soul-accounts/accounts/{id}/reset-credential/` (soul_accounts/services.py `reset_credential`)."""
    from apps.soul_accounts.models import InitialCredential, SoulAccount

    hall = world["GREEK"]
    admin = _admin(hall, "lk_admin")
    account = _soul_account(hall, "重置")
    url = f"/api/v1/soul-accounts/accounts/{account.pk}/reset-credential/"

    def state():
        with _in_hall(hall):
            return (SoulAccount.objects.get(pk=account.pk).user.password,
                    InitialCredential.objects.filter(account=account).count())

    before = state()
    with _ShardCommitFails(GREEK) as fails:
        r = _client(admin, raising=False).post(url, {}, format="json")
    fails.failed(r)
    assert state() == before, "control's writes outlived the shard's failed commit"
    locks.clear()
    r = _client(admin).post(url, {}, format="json")
    assert r.status_code == 200, r.content
    _locked_inside(locks, "soul_accounts.SoulAccount")
    assert SoulAccount.objects.get(pk=account.pk).user.password != before[0]


@sharded
@pytest.mark.django_db(databases="__all__", transaction=True)
def test_an_annihilation_retires_the_account_under_its_lock_and_rolls_back_with_the_shard(world, locks):
    """`DispositionService.execute` to EG_ANNIHILATION in an Egyptian hall's context (what `POST /disposition/{id}/
    execute/` runs): `_retire_account` (soul_accounts/services.py) locks the account and deactivates its user in the
    execution's transaction."""
    from apps.disposition.models import Disposition
    from apps.disposition.services import DispositionService
    from apps.realms.models import Realm
    from apps.soul_accounts.models import SoulAccount
    from apps.souls.models import Soul

    hall = world["EGYPTIAN"]
    with _in_hall(hall):
        realm = Realm.objects.create(realm_code="EG_ANNIHILATION", civilization="EGYPTIAN", tenant=hall,
                                     name_local="x", name_zh="x", name_en="Second Death", realm_type="HELL",
                                     tier=10, is_eternal=True)
    account = _soul_account(hall, "吞噬")
    with _in_hall(hall):
        Soul.all_objects.filter(pk=account.soul_id).update(current_state="DISPOSED")
        made = Disposition.objects.create(soul_id=account.soul_id, tenant=hall, destination_realm=realm)
        with pytest.raises(DatabaseError), _ShardCommitFails(EGYPT) as fails:
            DispositionService.execute(Disposition.objects.get(pk=made.pk))
        fails.failed()
        kept = SoulAccount.objects.select_related("user").get(pk=account.pk)
        assert kept.retired_at is None and kept.user.is_active, "control's writes outlived the shard's failed commit"
        locks.clear()
        assert DispositionService.execute(Disposition.objects.get(pk=made.pk))
        gone = SoulAccount.objects.select_related("user").get(pk=account.pk)
    _locked_inside(locks, "soul_accounts.SoulAccount")
    assert gone.retired_at is not None and not gone.user.is_active


@sharded
@pytest.mark.django_db(databases="__all__", transaction=True)
def test_a_soul_submitting_a_rebirth_application_locks_its_account(world, locks):
    """`POST /me/rebirth-applications/` (soul_accounts/rebirth.py `_lock_account`). A soul account's request is
    MASTER -- control's transaction was always open there -- so this is the site's real entry point, not a change:
    the lock is taken in a transaction and the refusal (no sentence served) is a 409, not a 500."""
    from tests.soul_account_support import soul_client

    account = _soul_account(world["GREEK"], "转生")
    from apps.soul_accounts.models import SoulAccount

    SoulAccount.objects.filter(pk=account.pk).update(must_change_password=False, initial_password_expires_at=None)
    r = soul_client(SoulAccount.objects.get(pk=account.pk)).post("/api/v1/me/rebirth-applications/", {}, format="json")
    assert r.status_code == 409, r.content
    _locked_inside(locks, "soul_accounts.SoulAccount")


@sharded
@pytest.mark.django_db(databases="__all__", transaction=True)
def test_an_officer_registering_a_push_token_locks_the_device_row(world, locks):
    """`POST /officer-app/push-tokens/` by a Greek hall's officer (officer_app/push.py `_register`). It writes no
    shard row; the lock must still be inside a transaction (the hall's `atomic()` is control's too)."""
    from django.urls import reverse

    from apps.officer_app.models import OfficerPushDevice

    officer = _officer(world["GREEK"], "lk_push")
    url = reverse("officer-app-push-tokens")
    body = {"token": "ExponentPushToken[lkpush0001]", "platform": "IOS"}
    for expect in (201, 200):  # the second registration takes the existing row under its lock
        r = _client(officer).post(url, body, format="json")
        assert r.status_code == expect, r.content
    _locked_inside(locks, "officer_app.OfficerPushDevice")
    assert OfficerPushDevice.objects.filter(user=officer).count() == 1


@sharded
@pytest.mark.django_db(databases="__all__", transaction=True)
def test_an_officer_confirming_two_step_setup_in_a_halls_context_locks_it(world, locks):
    """`mfa.confirm_setup` (authentication/mfa.py `_lock`), as the setup view calls it for a signed-in officer, in
    the hall's context: a wrong code is answered `wrong` under the lock, not a 500."""
    from apps.authentication import mfa

    officer = _officer(world["GREEK"], "lk_mfa")
    with _in_hall(world["GREEK"]):
        pending = mfa.begin_setup(officer)
        assert mfa.confirm_setup(pending, "000000")[0] == "wrong"
    _locked_inside(locks, "authentication.OfficerMfa")


@sharded
@pytest.mark.django_db(databases="__all__", transaction=True)
def test_the_assistant_cap_alert_is_recorded_under_its_lock_in_a_halls_context_and_rolls_back_with_the_shard(world, locks,
                                                                                                  monkeypatch):
    """`usage.enforce_cap` (soul_assist/usage.py) after an officer feature's answer, in the hall's context. Its caller
    swallows every error (`features._enforce_cap`), so before the fix the cap check failed on PostgreSQL in silence."""
    from types import SimpleNamespace

    from apps.soul_assist import config, usage
    from apps.soul_assist.models import AssistConfig

    cfg = SimpleNamespace(enabled=True, monthly_cap=1, prices={}, backup_prices={}, env_enabled=True)
    monkeypatch.setattr(config, "effective", lambda *a, **k: cfg)
    monkeypatch.setattr(usage, "month_spend", lambda prices, month=None: {"cost": 0.9})  # past 80%: the alert
    monkeypatch.setattr(usage, "_notify_admins", lambda *a, **k: None)
    with _in_hall(world["GREEK"]):
        with pytest.raises(DatabaseError), _ShardCommitFails(GREEK) as fails:
            usage.enforce_cap()
        fails.failed()
        assert not AssistConfig.objects.exclude(cap_alert_sent_for="").exists(), \
            "control's write outlived the shard's failed commit"
        locks.clear()
        usage.enforce_cap()
        assert AssistConfig.objects.exclude(cap_alert_sent_for="").exists()
    _locked_inside(locks, "soul_assist.AssistConfig")


# ---- the relay ---------------------------------------------------------------------------------------------------------

@sharded
@pytest.mark.django_db(databases="__all__", transaction=True)
def test_every_saga_step_runs_inside_a_transaction_on_its_master_and_on_control(world):
    """A dispatch across civilizations and the way home, relayed: each handler's apply (on the target's master) and
    done (on the source's) runs with a code transaction open on that master and on control -- so a handler's control
    lock works and its control writes go with the step. Mutation: `_deliver` runs a handler outside `on_master` ->
    red here (and its writes autocommit one by one)."""
    from django.db import connections as conns

    from apps.dispatch.services import DispatchService
    from apps.souls.models import Soul
    from apps.tenants import shard_saga
    from tests.test_cross_civilization_saga import _approved

    seen = []

    def open_on(alias):
        return any(not b._from_testcase for b in conns[alias].atomic_blocks)

    def watching(fn, where):
        from apps.tenants.managers import get_current_tenant

        def run(payload):
            hall = get_current_tenant()
            alias = shard_saga.master_of(hall)
            seen.append((where, alias, open_on(alias), open_on("default")))
            return fn(payload)
        return run

    handlers = {k: (watching(a, f"{k}:apply"), d and watching(d, f"{k}:done"), r)
                for k, (a, d, r) in shard_saga._HANDLERS.items()}
    with mock.patch.dict(shard_saga._HANDLERS, handlers):
        soul, record = _approved({"seed": 7, "src": "GREEK", "tgt": "EGYPTIAN", "realm": True}, world)
        with _in_hall(world["GREEK"]):
            DispatchService.execute(record, None)
        shard_saga.relay_until_quiet()
        with _in_hall(world["GREEK"]):
            DispatchService.end_residence(Soul.all_objects.get(pk=soul.pk), actor=None,
                                          trigger=DispatchService.RETURN_MANUAL, reason="home")
        shard_saga.relay_until_quiet()
    assert {w.split(":")[0] for w, *_ in seen} >= {"dispatch.execute", "dispatch.return"}, seen
    outside = [s for s in seen if not (s[2] and s[3])]
    assert outside == [], f"saga steps outside their master's or control's transaction: {outside}"


# ---- real row locks (PostgreSQL) ----------------------------------------------------------------------------------------

@sharded
@NEEDS_ROW_LOCKS
@pytest.mark.django_db(databases="__all__", transaction=True)
def test_deactivating_an_officer_waits_for_a_lock_another_transaction_holds_on_the_user(world):
    """Real PostgreSQL: a second connection holds the officer's row (FOR UPDATE); the Greek hall ADMIN's deactivate
    waits for it, then deactivates. The lock is the user row on control, inside the hall's transaction."""
    import time

    from django.urls import reverse

    from apps.authentication.models import User
    from apps.authentication.views import UserViewSet

    hall = world["GREEK"]
    admin, target = _admin(hall, "lk_admin"), _officer(hall, "lk_target")
    url = reverse(_route(UserViewSet, "deactivate"), kwargs={"pk": target.pk})
    held, release, done, errors = threading.Event(), threading.Event(), {}, []

    def holder():
        try:
            with transaction.atomic(using="default"):
                list(User.objects.using("default").select_for_update().filter(pk=target.pk))
                held.set()
                release.wait(30)
        except Exception as e:  # noqa: BLE001 -- reported below
            errors.append(repr(e))
        finally:
            connections.close_all()

    def caller():
        try:
            done["status"] = _client(admin).post(url, {}, format="json").status_code
            done["at"] = time.monotonic()
        except Exception as e:  # noqa: BLE001
            errors.append(repr(e))
        finally:
            connections.close_all()

    h = threading.Thread(target=holder)
    h.start()
    assert held.wait(30), errors
    c = threading.Thread(target=caller)
    c.start()
    c.join(2)
    assert c.is_alive() and "status" not in done, f"deactivate did not wait for the row lock: {done} {errors}"
    released = time.monotonic()
    release.set()
    h.join(30)
    c.join(30)
    assert not c.is_alive() and errors == [], errors
    assert done["status"] == 200 and done["at"] >= released
    assert not User.objects.get(pk=target.pk).is_active
