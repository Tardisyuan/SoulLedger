"""A soul account is control's row; its soul is its shard's (sharding stage 4). Control holds only a mirror of a
write-cut civilization's souls, which the shard-to-control sync refreshes every minute on 115. A query of accounts
that joined `soul` on control (`select_related("soul")`, `soul__home_tenant`, `soul__is_deleted`) found no account
for a soul written in that minute: 404 to the officer, `DoesNotExist` or a silent `None` elsewhere. The accounts are
now read alone and the soul where it is (`apps/soul_accounts/views.py` `scoped_accounts`, the lazy `account.soul`).

Each case drives one such site through its real entry point for a soul that is on its shard and NOT on control.

    cd backend && ... python -m pytest --ds=config.settings_sharded -m sharded \\
      tests/test_soul_account_reads_skip_controls_soul_mirror.py
"""
import random
import uuid
from unittest import mock

import pytest

from tests.test_control_locks_in_a_write_cut_hall import _admin, _client, _soul_account, world  # noqa: F401
from tests.test_shard_sync import CIVS, sharded
from tests.test_sharded_writes import _in_hall

PASSWORD = "Fresh-soul-9!pw"


@pytest.fixture
def fresh(world):  # noqa: F811
    """(hall, admin, account) -- the account's soul on its shard only -- and the seed that chose the hall."""
    from apps.souls.models import Soul
    from apps.tenants.shard_saga import master_of

    seed = random.randrange(10**6)
    hall = world[random.Random(seed).choice(CIVS)]
    print(f"mirror-join seed {seed} ({hall.civilization})")
    account = _soul_account(hall, f"新魂{seed}", mirror=False)
    assert not Soul._base_manager.using("default").filter(pk=account.soul_id).exists(), "mirrored already"
    assert Soul._base_manager.using(master_of(hall)).filter(pk=account.soul_id).exists()
    return hall, _admin(hall, f"mj_admin_{seed}"), account


def _soul_code(account):
    from apps.souls.models import Soul
    from apps.tenants.shard_saga import master_of

    for alias in ("civ_chinese", "civ_european", "civ_egyptian", "civ_greek"):
        row = Soul._base_manager.using(alias).filter(pk=account.soul_id).first()
        if row is not None and master_of(row.tenant) == alias:
            return row.soul_code
    raise AssertionError("no primary")


def _signs_in_by_password(account):
    from apps.soul_accounts.models import SoulAccount

    user = account.user
    user.set_password(PASSWORD)
    user.email, user.email_verified_address = f"{account.pk.hex[:10]}@example.com", f"{account.pk.hex[:10]}@example.com"
    user.save()
    SoulAccount.objects.filter(pk=account.pk).update(must_change_password=False, initial_password_expires_at=None)
    return user.email


# ---- the sites --------------------------------------------------------------------------------------------------

def list_accounts(hall, admin, account):
    """SoulAccountViewSet.get_queryset (`soul__home_tenant`, `soul__is_deleted`): the account chain of one soul."""
    r = _client(admin).get(f"/api/v1/soul-accounts/accounts/?soul={account.soul_id}")
    assert r.status_code == 200, r.content[:300]
    assert [a["id"] for a in r.json()["results"]] == [str(account.pk)], r.json()
    assert r.json()["results"][0]["soul_code"] == _soul_code(account)


def retrieve_account(hall, admin, account):
    r = _client(admin).get(f"/api/v1/soul-accounts/accounts/{account.pk}/")
    assert r.status_code == 200, r.content[:300]
    assert r.json()["soul_code"] == _soul_code(account)


def provision_read_back(hall, admin, account):
    """`provision`'s read-back of the account it just made (`self.get_queryset().get(pk=...)`)."""
    from apps.souls.models import Soul

    with _in_hall(hall):
        soul = Soul.objects.create(name="未开号", tenant=hall, current_state="JUDGING")
    r = _client(admin).post("/api/v1/soul-accounts/accounts/provision/", {"soul_id": str(soul.pk)}, format="json")
    assert r.status_code == 201, r.content[:300]
    assert r.json()["soul"] == str(soul.pk)


def reset_mfa(hall, admin, account):
    """SoulAccountMfaResetView (`soul__home_tenant`) and `mfa._lock` (`select_related("soul")`): reached the account
    -- it has no two-step sign-in to turn off -- instead of 404 / a 500."""
    r = _client(admin).post(f"/api/v1/soul-accounts/accounts/{account.pk}/reset-mfa/", {"reason": "丢了手机"},
                            format="json")
    assert r.status_code == 409 and r.json()["code"] == "not_enabled", r.content[:300]


def set_new_password(hall, admin, account):
    """authentication/views.py `set_new_password`: the soul code goes back with the success, and the reset goes
    through the account (not the bare-user branch)."""
    from django.core.cache import cache
    from rest_framework.test import APIClient

    from apps.soul_accounts.models import SoulAccount

    email = _signs_in_by_password(account)
    SoulAccount.objects.filter(pk=account.pk).update(must_change_password=True)
    cache.set(f"pwd_reset:{email}", "424242", timeout=300)
    r = APIClient().post("/api/v1/auth/set-new-password/",
                         {"email": email, "code": "424242", "new_password": "Another-fresh-9!pw"}, format="json")
    assert r.status_code == 200, r.content[:300]
    assert r.json().get("soul_code") == _soul_code(account), r.json()
    assert SoulAccount.objects.get(pk=account.pk).must_change_password is False


def reset_code_mail(hall, admin, account, mailoutbox):
    """authentication/tasks.py `send_reset_code_mail`: the soul code rides along."""
    from django.core.cache import cache

    from apps.authentication.tasks import reset_outbox_key, send_reset_code_mail

    email = _signs_in_by_password(account)
    token = uuid.uuid4().hex
    cache.set(reset_outbox_key(token), {"user_id": account.user_id, "email": email}, timeout=300)
    cache.set(f"pwd_reset:{email}", "424242", timeout=300)
    assert send_reset_code_mail.apply(args=[token]).get() is True
    assert _soul_code(account) in mailoutbox[-1].body


def deactivate_matrix(hall, admin, account):
    """chat/tasks.py `deactivate_matrix_task`: the retired account's Matrix side is stopped, not skipped."""
    from apps.chat import services
    from apps.chat.tasks import deactivate_matrix_task

    seen = []
    with mock.patch.object(services, "deactivate_matrix_side", lambda a, ids: seen.append(a.soul.soul_code)):
        deactivate_matrix_task.apply(args=[str(account.pk), []]).get()
    assert seen == [_soul_code(account)]


def mfa_pending(hall, admin, account):
    """soul_accounts/mfa.py `account_from_pending`: the second step of a sign-in finds its account."""
    from apps.soul_accounts import mfa

    found = mfa.account_from_pending(mfa.issue_pending(account))
    assert found is not None and found.pk == account.pk


def contact_email_code(hall, admin, account, mailoutbox):
    """soul_accounts/contact_email.py `_account` (task `send_contact_email_code`): the code is sent."""
    from django.core.cache import cache

    from apps.soul_accounts.contact_email import _keys
    from apps.soul_accounts.tasks import send_contact_email_code

    cache.set(_keys(account)["code"], {"email": "new@example.com", "code": "135791"}, timeout=300)
    assert send_contact_email_code.apply(args=[str(account.pk)]).get() is True
    assert "135791" in mailoutbox[-1].body


def push_token_moved(hall, admin, account):
    """soul_push/services.py `_tell_previous_owner`: a token moving to another account leaves the audit row."""
    from apps.audit.models import AuditLog
    from apps.soul_accounts.models import SoulAccount
    from tests.soul_account_support import soul_client

    other = _soul_account(hall, "另一魂", mirror=False)
    token = f"ExponentPushToken[{uuid.uuid4().hex[:20]}]"
    for owner in (account, other):
        SoulAccount.objects.filter(pk=owner.pk).update(must_change_password=False, initial_password_expires_at=None)
        r = soul_client(SoulAccount.objects.get(pk=owner.pk)).post("/api/v1/me/push-tokens/",
                                                                   {"token": token, "platform": "IOS"}, format="json")
        assert r.status_code in (200, 201), r.content[:300]
    rows = [row for alias in ("default", "civ_chinese", "civ_european", "civ_egyptian", "civ_greek")
            for row in AuditLog._base_manager.using(alias).filter(resource="soul_push_device")]
    assert len(rows) == 1 and rows[0].changes["account"] == [str(account.pk), str(other.pk)], rows


def sign_in_by_email(hall, admin, account):
    """soul_accounts/services.py `soul_code_for_email`: a soul signs in with its verified login address."""
    from rest_framework.test import APIClient

    email = _signs_in_by_password(account)
    r = APIClient().post("/api/v1/soul-auth/login/", {"soul_code": email, "password": PASSWORD}, format="json")
    assert r.status_code == 200, r.content[:300]


SITES = [list_accounts, retrieve_account, provision_read_back, reset_mfa, set_new_password, reset_code_mail,
         deactivate_matrix, mfa_pending, contact_email_code, push_token_moved, sign_in_by_email]


@sharded
@pytest.mark.parametrize("site", SITES, ids=[s.__name__ for s in SITES])
def test_a_soul_not_yet_on_controls_mirror_is_found_through_its_account(site, fresh, mailoutbox):
    import inspect

    hall, admin, account = fresh
    if "mailoutbox" in inspect.signature(site).parameters:
        site(hall, admin, account, mailoutbox)
    else:
        site(hall, admin, account)
