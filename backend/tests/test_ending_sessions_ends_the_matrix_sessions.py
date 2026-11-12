"""结束账号会话时一并吊销书信的 Matrix 会话(流程走查 2026-11-12 F-CHAT-02)。

此前改密、官员重置凭据、退出其他设备只作废后端令牌;Matrix 的 access token 在 Synapse 里不过期,
旧设备的 `/sync` 照收每一封信,在互关房间里照样能发。替身只记调用;真 Synapse 的形状由
`SynapseClient.logout_user`(admin v2 的 devices / delete_devices)承担,CI 的 synapse job 才验得到。
"""
import pytest

from apps.chat.identity import ensure_identity
from apps.soul_accounts import services as svc
from tests.chat_support import FakeMatrix, matrix  # noqa: F401
from tests.soul_account_support import ready_soul, soul_client

pytestmark = pytest.mark.django_db
PASSWORD = "a-long-test-password-1"


@pytest.fixture
def chatting(cn_tenant, matrix):  # noqa: F811
    account, _ = ready_soul(cn_tenant)
    account.user.set_password(PASSWORD)
    account.user.save(update_fields=["password"])
    identity = ensure_identity(account)
    return account, identity.localpart


def _logouts():
    return [c for c in FakeMatrix.calls if c[0] == "logout_user"]


def test_a_password_change_logs_the_soul_out_of_matrix(chatting, django_capture_on_commit_callbacks):
    account, localpart = chatting
    with django_capture_on_commit_callbacks(execute=True):
        response = soul_client(account).post("/api/v1/me/password/",
                                             {"old_password": PASSWORD, "new_password": "another-long-password-2"},
                                             format="json")
    assert response.status_code == 200, response.data
    assert _logouts() == [("logout_user", localpart)]


def test_an_officer_reset_logs_the_soul_out_of_matrix(chatting, django_capture_on_commit_callbacks):
    account, localpart = chatting
    with django_capture_on_commit_callbacks(execute=True):
        svc.reset_credential(account, actor=None)
    assert _logouts() == [("logout_user", localpart)]


def test_a_soul_that_never_opened_chat_is_left_alone(cn_tenant, matrix, django_capture_on_commit_callbacks):  # noqa: F811
    account, _ = ready_soul(cn_tenant)
    with django_capture_on_commit_callbacks(execute=True):
        svc.reset_credential(account, actor=None)
    assert _logouts() == []
