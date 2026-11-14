"""The control database comes with its system administrator (stage 1A, docs/ARCHITECTURE-tenant-sharding.md §7.5).

authentication/0030 seeds `settings.SYSTEM_ADMIN_USERNAME` with no usable password; `manage.py
bootstrap_system_admin` (run after `migrate` in docker-compose) gives it one. Everything here goes through the
real sign-in (`/auth/login/`) and the real cross-hall read (`/ledger/stats/overview/`), not through the model.
"""
import re
import subprocess
from io import StringIO
from pathlib import Path

import pytest
from django.conf import settings
from django.core.management import call_command
from django.core.management.base import CommandError
from rest_framework.test import APIClient

from apps.authentication.models import User, UserRole
from apps.souls.models import Soul, SoulState
from apps.tenants.models import Tenant

pytestmark = pytest.mark.django_db

LOGIN = "/api/v1/auth/login/"
OVERVIEW = "/api/v1/ledger/stats/overview/"
STRONG = "Sufficiently-long-and-odd-9271"
REPO = Path(__file__).resolve().parents[2]


@pytest.fixture
def sysadmin():
    return User.objects.get(username=settings.SYSTEM_ADMIN_USERNAME)


@pytest.fixture
def halls():
    """Two halls of two civilizations, a soul in each: the system administrator's overview must see both."""
    out = []
    for code, civ in (("CN_DIYU", "CHINESE"), ("EG_DUAT", "EGYPTIAN")):
        hall, _ = Tenant.objects.get_or_create(code=code, defaults={"display_name": code})
        Soul.objects.create(name=f"soul-{civ}", tenant=hall, current_state=SoulState.ALIVE)
        out.append(hall)
    return out


def _login(password):
    return APIClient().post(LOGIN, {"username": settings.SYSTEM_ADMIN_USERNAME, "password": password}, format="json")


def _overview(login):
    client = APIClient()
    client.credentials(HTTP_AUTHORIZATION=f"Bearer {login.data['access']}")
    return client.get(OVERVIEW)


def _bootstrap(monkeypatch, *args, file=None, env=None):
    monkeypatch.delenv("SYSTEM_ADMIN_PASSWORD_FILE", raising=False)
    monkeypatch.delenv("SYSTEM_ADMIN_PASSWORD", raising=False)
    if file is not None:
        monkeypatch.setenv("SYSTEM_ADMIN_PASSWORD_FILE", str(file))
    if env is not None:
        monkeypatch.setenv("SYSTEM_ADMIN_PASSWORD", env)
    out, err = StringIO(), StringIO()
    call_command("bootstrap_system_admin", *args, stdout=out, stderr=err)
    return out.getvalue(), err.getvalue()


def _hash(user):
    user.refresh_from_db()
    return user.password


def test_a_fresh_database_has_the_account_and_it_cannot_sign_in(sysadmin):
    assert (sysadmin.role, sysadmin.tenant_id, sysadmin.civilization) == (UserRole.SYSTEM_ADMIN, None, None)
    assert not sysadmin.has_usable_password()
    for guess in ("sysadmin", "admin123", STRONG):
        assert _login(guess).status_code == 401


def test_a_password_file_lets_it_sign_in_and_see_every_hall(sysadmin, halls, tmp_path, monkeypatch):
    secret = tmp_path / "pw"
    secret.write_text(STRONG + "\n")  # a trailing newline, as `echo > file` writes it, is not part of it
    out, err = _bootstrap(monkeypatch, file=secret)
    assert "password set" in out and not err
    login = _login(STRONG)
    assert login.status_code == 200, login.data
    body = _overview(login)
    assert body.status_code == 200, body.content
    seen = {row["tenant_code"] for row in body.json()["tenants"]}
    assert {h.code for h in halls} <= seen
    assert body.json()["total_souls"] == Soul.objects.count()


def test_the_environment_variable_works_and_warns(sysadmin, monkeypatch):
    out, err = _bootstrap(monkeypatch, env=STRONG)
    assert "password set" in out and "prefer SYSTEM_ADMIN_PASSWORD_FILE" in err
    assert _login(STRONG).status_code == 200


def test_with_no_source_it_prints_a_password_once_that_must_be_changed(sysadmin, halls, monkeypatch):
    out, _ = _bootstrap(monkeypatch)
    printed = re.search(r"generated password .*: (\S+)$", out.strip()).group(1)
    assert len(printed) >= 24
    login = _login(printed)
    assert login.status_code == 200, login.data
    refused = _overview(login)
    assert refused.status_code == 403 and refused.json()["code"] == "password_change_required"
    again, _ = _bootstrap(monkeypatch)
    assert printed not in again and "already set" in again  # printed once: a second start shows nothing


def test_a_usable_password_is_kept_unless_reset(sysadmin, monkeypatch):
    _bootstrap(monkeypatch, env=STRONG)
    before = _hash(sysadmin)
    out, _ = _bootstrap(monkeypatch, env=STRONG + "-other")
    assert "already set" in out and _hash(sysadmin) == before
    _bootstrap(monkeypatch, "--reset", env=STRONG + "-other")
    assert _hash(sysadmin) != before
    assert _login(STRONG + "-other").status_code == 200
    assert _login(STRONG).status_code == 401


@pytest.mark.parametrize("weak", ["short", "password1234", "12345678901234"])
def test_a_weak_password_is_refused_and_changes_nothing(sysadmin, monkeypatch, weak):
    before = _hash(sysadmin)
    with pytest.raises(CommandError, match="password rejected"):
        _bootstrap(monkeypatch, env=weak)
    assert _hash(sysadmin) == before
    assert not sysadmin.has_usable_password()


def test_no_tracked_file_sets_the_password_to_a_value():
    """The variable names are documented (`.env.example`, docker-compose); a value must never be committed."""
    files = subprocess.run(["git", "ls-files", "-z"], cwd=REPO, capture_output=True, check=True).stdout.split(b"\0")
    # `NAME=value` (an env file) or `NAME: value` (YAML); `${NAME:-}` interpolation and `NAME=` are names only.
    pattern = re.compile(rb"SYSTEM_ADMIN_PASSWORD(=|:\s+)[^\s$\"'{}]")
    offenders = []
    for name in filter(None, files):
        path = REPO / name.decode()
        if path.is_file() and path.stat().st_size < 2_000_000 and pattern.search(path.read_bytes()):
            offenders.append(name.decode())
    assert not offenders, offenders


def test_the_seed_is_idempotent_and_refuses_to_promote_someone_else(sysadmin):
    from importlib import import_module

    from django.apps import apps as live_apps
    from django.db import connection

    seed = import_module("apps.authentication.migrations.0030_system_admin").seed_system_admin

    class Editor:
        pass

    editor = Editor()
    editor.connection = connection
    seed(live_apps, editor)
    assert User.objects.filter(username=settings.SYSTEM_ADMIN_USERNAME).count() == 1
    sysadmin.refresh_from_db()
    assert not sysadmin.has_usable_password()

    User.all_objects.filter(pk=sysadmin.pk).update(role=UserRole.JUDGE)
    with pytest.raises(RuntimeError, match="refusing"):
        seed(live_apps, editor)


def test_the_backfill_gives_a_hall_less_admin_its_actors_civilization_or_promotes_it(capsys):
    """0030's backfill: civilization from `actor.tenant`; none derivable -> SYSTEM_ADMIN, named in the output."""
    from importlib import import_module

    from django.apps import apps as live_apps
    from django.db import connection

    from apps.actors.models import Actor, ActorRole

    backfill = import_module("apps.authentication.migrations.0030_system_admin").backfill
    eg, _ = Tenant.objects.get_or_create(code="EG_DUAT", defaults={"display_name": "EG"})
    actor = Actor.objects.create(name="Osiris-bf", role=ActorRole.JUDGE, civilization="EGYPTIAN", tenant=eg)
    derived = User.objects.create_user(username="bf-eg", password="x", role=UserRole.ADMIN, actor=actor)
    orphan = User.objects.create_user(username="bf-none", password="x", role=UserRole.ADMIN)
    bound = User.objects.create_user(username="bf-bound", password="x", role=UserRole.ADMIN, tenant=eg)

    class Editor:
        pass

    editor = Editor()
    editor.connection = connection
    backfill(live_apps, editor)
    for user in (derived, orphan, bound):
        user.refresh_from_db()
    assert (derived.role, derived.civilization) == (UserRole.ADMIN, "EGYPTIAN")
    assert (orphan.role, orphan.civilization) == (UserRole.SYSTEM_ADMIN, None)
    assert (bound.role, bound.civilization) == (UserRole.ADMIN, None)  # a hall's ADMIN is not touched
    assert "bf-none" in capsys.readouterr().out
