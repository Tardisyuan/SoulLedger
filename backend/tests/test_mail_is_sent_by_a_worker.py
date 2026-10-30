"""The request enqueues; the worker sends (perf-audit A4, 2026-10-30).

User decision: a message on the broker carries an id only (a user / account / credential id, or the random token of
a cache entry); the worker reads the code from the cache or the database. And a forgot-password request does the
same work for a registered address as for an unregistered one — the SMTP time used to answer that question.

`tests/conftest.py::_mail_tasks_run_in_place` makes `.delay` run the task; each test here patches `.delay` again
with a recorder, so the request's own share is all that runs.
"""
from unittest import mock

import pytest
from django.core import mail
from django.core.cache import cache
from django.db import connection
from django.test.utils import CaptureQueriesContext

from apps.authentication import tasks as auth_tasks
from apps.soul_accounts import tasks as soul_tasks
from tests.soul_account_support import ready_soul

pytestmark = pytest.mark.django_db

RESET = "/api/v1/auth/reset-password/"


@pytest.fixture(autouse=True)
def _clean_cache():
    cache.clear()
    yield
    cache.clear()


def _reset(api_client, address):
    with (
        mock.patch.object(auth_tasks.send_reset_code_mail, "delay") as delay,
        CaptureQueriesContext(connection) as queries,
    ):
        response = api_client.post(RESET, {"email": address}, format="json")
    assert response.status_code == 200
    return delay, len(queries), response


def test_forgot_password_enqueues_a_token_and_never_the_code(api_client, django_user_model, cn_tenant):
    django_user_model.objects.create_user(username="w_soul", email="w@example.com", password="x", role="SOUL",
                                          tenant=cn_tenant)
    delay, _, response = _reset(api_client, "w@example.com")
    code = cache.get("pwd_reset:w@example.com")
    assert code
    [call] = delay.call_args_list
    assert len(call.args) == 1 and not call.kwargs
    token = call.args[0]
    assert code not in token and code not in response.content.decode()
    assert mail.outbox == [], "the request sent the mail itself"
    # The worker's half: reads the code from the cache and sends it.
    assert auth_tasks.send_reset_code_mail.run(token) is True
    assert [m.to for m in mail.outbox] == [["w@example.com"]] and code in mail.outbox[0].body


def test_a_registered_and_an_unregistered_address_cost_the_request_the_same(api_client, django_user_model, cn_tenant):
    django_user_model.objects.create_user(username="w_soul2", email="known@example.com", password="x", role="SOUL",
                                          tenant=cn_tenant)
    known_delay, known_queries, known = _reset(api_client, "known@example.com")
    unknown_delay, unknown_queries, unknown = _reset(api_client, "nobody@example.com")
    assert known.data == unknown.data
    assert known_delay.call_count == unknown_delay.call_count == 1
    assert known_queries == unknown_queries, "the request did extra work for the registered address"
    # And the unregistered entry sends nothing when the worker gets it.
    assert auth_tasks.send_reset_code_mail.run(unknown_delay.call_args.args[0]) is False
    assert mail.outbox == []


def test_contact_email_code_enqueues_the_account_id_only(cn_tenant):
    account, client = ready_soul(cn_tenant, contact_email="old@example.org")
    account.user.set_password("Ledger-test-pass-2026")
    account.user.save(update_fields=["password"])
    assert client.post("/api/v1/me/contact-email/verify/", {"password": "Ledger-test-pass-2026"},
                       format="json").status_code == 204
    mail.outbox.clear()
    with mock.patch.object(soul_tasks.send_contact_email_code, "delay") as delay:
        assert client.post("/api/v1/me/contact-email/", {"email": "new@example.org"},
                           format="json").status_code == 202
    delay.assert_called_once_with(account.pk)
    assert mail.outbox == []
    assert soul_tasks.send_contact_email_code.run(account.pk) is True
    assert mail.outbox[-1].to == ["new@example.org"]


def test_an_initial_password_is_enqueued_by_credential_id_after_commit(cn_tenant, django_capture_on_commit_callbacks):
    from apps.soul_accounts import services as svc
    from apps.soul_accounts.models import AccountOrigin, InitialCredential
    from apps.souls.models import Soul

    soul = Soul.objects.create(name="入队之魂", tenant=cn_tenant, contact_email="cred@example.org", current_state="JUDGING")
    with (
        mock.patch.object(soul_tasks.send_credential, "delay") as delay,
        django_capture_on_commit_callbacks(execute=False) as callbacks,
    ):
        svc.provision_account(soul, AccountOrigin.DEATH_SYNC)
        assert delay.call_count == 0, "enqueued before the transaction committed"
        for callback in callbacks:
            callback()
    credential = InitialCredential.objects.get(soul=soul)
    delay.assert_called_once_with(credential.pk)
    assert mail.outbox == []
