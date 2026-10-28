"""The assistant's provider / embedding addresses may not point into the private network.

An admin-entered `base_url` or `embedding_url` is fetched by the server ("test connection",
model lists, embeddings), so without a check a stolen admin session can probe the LAN. Same
`is_global` rule as webhooks; hosts listed in ASSISTANT_PRIVATE_HOSTS_ALLOWED (and the hosts of
the two env addresses) are let through for a local Ollama.
"""
import pytest
from cryptography.fernet import Fernet

from apps.authentication.models import User
from tests.soul_account_support import officer_client

pytestmark = pytest.mark.django_db

BASE = "/api/v1/assist-admin/"


@pytest.fixture
def api(settings, cn_tenant):
    settings.ASSISTANT_ENABLED = True
    settings.ASSISTANT_PROVIDER = "apps.soul_assist.providers.FakeProvider"
    settings.ENCRYPTION_KEY = Fernet.generate_key().decode()
    settings.ASSISTANT_BASE_URL = ""
    settings.ASSISTANT_EMBEDDING_URL = "http://127.0.0.2:9"  # nothing listens: a probe fails fast
    settings.ASSISTANT_PRIVATE_HOSTS_ALLOWED = []
    return officer_client(User.objects.create_user(username="ep_admin", password="x", role="ADMIN", tenant=None))


@pytest.mark.parametrize("url", ["http://127.0.0.1:11434/v1", "http://169.254.169.254/latest", "http://[::1]:8000/v1"])
def test_a_private_base_url_is_refused(api, url):
    res = api.post(f"{BASE}config/test/", {"platform": "custom", "provider": "openai_compatible", "base_url": url},
                   format="json")
    assert res.status_code == 400 and "base_url" in res.data, res.data


def test_a_private_embedding_url_is_refused(api):
    res = api.post(f"{BASE}embedding/test/", {"embedding_url": "http://10.0.0.5:11434"}, format="json")
    assert res.status_code == 400 and "embedding_url" in res.data, res.data


def test_the_allowlist_and_the_env_hosts_are_let_through(api, settings):
    settings.ASSISTANT_PRIVATE_HOSTS_ALLOWED = ["127.0.0.1"]
    res = api.post(f"{BASE}config/test/", {"platform": "custom", "provider": "openai_compatible",
                                           "base_url": "http://127.0.0.1:11434/v1"}, format="json")
    assert "base_url" not in (res.data if res.status_code == 400 else {}), res.data
    # The env's own embedding host (a LAN Ollama) is configured by the operator, not the page.
    res = api.post(f"{BASE}embedding/test/", {"embedding_url": "http://127.0.0.2:9"}, format="json")
    assert "embedding_url" not in (res.data if res.status_code == 400 else {}), res.data
