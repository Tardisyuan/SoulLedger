"""BP-12: the reset code reaches the mailbox, and only the mailbox.

`reset_password_request` wrote the code to the cache and stopped; the
`send_mail` line was a comment. Nobody could complete a reset, because nobody
could learn the code. pytest-django swaps in the locmem backend, so
`mail.outbox` is the mailbox here.
"""
import pytest
from django.core import mail
from django.core.cache import cache

URL = "/api/v1/auth/reset-password/"
EMAIL = "forgot@example.com"


@pytest.fixture
def user(django_user_model, cn_tenant):
    cache.clear()
    return django_user_model.objects.create_user(
        username="forgot", email=EMAIL, password="OldPass!123", role="VIEWER", tenant=cn_tenant,
    )


@pytest.mark.django_db
def test_the_code_is_mailed_to_the_address_and_not_returned(api_client, user):
    resp = api_client.post(URL, {"email": EMAIL}, format="json")
    assert resp.status_code == 200

    code = cache.get(f"pwd_reset:{EMAIL}")
    assert code, "no code was generated; the probe proves nothing"
    assert len(mail.outbox) == 1, "the code was stored but never sent"
    message = mail.outbox[0]
    assert message.to == [EMAIL]
    assert code in message.body
    assert code not in resp.content.decode(), "the code leaked into the HTTP response"


@pytest.mark.django_db
def test_an_unknown_address_gets_no_mail_and_the_same_answer(api_client, user):
    known = api_client.post(URL, {"email": EMAIL}, format="json")
    cache.clear()
    mail.outbox.clear()
    unknown = api_client.post(URL, {"email": "nobody@example.com"}, format="json")
    assert unknown.status_code == known.status_code == 200
    assert unknown.data == known.data
    assert mail.outbox == []


@pytest.mark.django_db
def test_a_mail_failure_does_not_become_a_registration_oracle(api_client, user, caplog):
    """A 500 only for registered addresses would disclose registration."""
    from unittest.mock import patch

    with patch("apps.authentication.views.send_mail", side_effect=OSError("smtp down")):
        resp = api_client.post(URL, {"email": EMAIL}, format="json")
    assert resp.status_code == 200
    code = cache.get(f"pwd_reset:{EMAIL}")
    assert code and code not in caplog.text, "the code was written to the log"
