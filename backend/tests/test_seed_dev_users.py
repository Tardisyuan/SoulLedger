"""`manage.py seed_dev_users`: six dev sign-ins, DEBUG only, idempotent, fresh random passwords."""
import re
from io import StringIO

import pytest
from django.core.management import call_command
from django.core.management.base import CommandError

from apps.authentication.models import User
from apps.soul_accounts.models import SoulAccount

pytestmark = pytest.mark.django_db

ROLES = {"dev_admin": "ADMIN", "dev_judge": "JUDGE", "dev_guardian": "GUARDIAN",
         "dev_moderator": "MODERATOR", "dev_viewer": "VIEWER"}


def run():
    out = StringIO()
    call_command("seed_dev_users", stdout=out)
    # "  ROLE  login  password" rows
    return {m[0]: (m[1], m[2]) for m in re.findall(r"^\s+([A-Z]+)\s+(\S+)\s+(\S+)$", out.getvalue(), re.M)}


def test_refuses_without_debug(settings, cn_tenant):
    settings.DEBUG = False
    with pytest.raises(CommandError, match="DEBUG"):
        call_command("seed_dev_users", stdout=StringIO())
    assert not User.objects.filter(username__startswith="dev_").exists()
    assert not SoulAccount.objects.exists()


def test_six_accounts_one_per_role_in_one_tenant(settings, cn_tenant):
    settings.DEBUG = True
    rows = run()
    assert sorted(rows) == sorted([*ROLES.values(), "SOUL"])
    for username, role in ROLES.items():
        user = User.objects.get(username=username)
        assert (user.role, user.tenant_id, user.must_change_password) == (role, cn_tenant.pk, False)
        assert user.check_password(rows[role][1])
    account = SoulAccount.objects.get()
    assert account.user.role == "SOUL" and account.user.tenant_id == cn_tenant.pk
    assert account.soul.soul_code == rows["SOUL"][0]
    assert account.user.check_password(rows["SOUL"][1]) and not account.must_change_password


def test_rerun_adds_nothing_and_rotates_passwords(settings, cn_tenant):
    settings.DEBUG = True
    first = run()
    users = User.objects.count()
    second = run()
    assert User.objects.count() == users and SoulAccount.objects.count() == 1
    assert {r: login for r, (login, _) in first.items()} == {r: login for r, (login, _) in second.items()}
    assert all(first[r][1] != second[r][1] for r in first)
    assert User.objects.get(username="dev_judge").check_password(second["JUDGE"][1])
