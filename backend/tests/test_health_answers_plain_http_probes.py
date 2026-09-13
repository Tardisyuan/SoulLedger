"""`/health/` answers a plain-http probe; `/health/detailed/` still redirects.

Load balancers and uptime monitors probe port 80 over plain http, and most of
them read a 301 as "down". With `SECURE_SSL_REDIRECT` on in production and no
certificate mounted yet, `/health/` through nginx answered 301 — the stack
looked dead to anything watching it (measured 2026-09-13, docker).

`/health/` returns only `{"status": "ok"}`, so exempting it leaks nothing.
`/health/detailed/` needs an authenticated ADMIN session, and a session over
plain http is exactly what the redirect exists to prevent — it must stay
redirected. The exempt pattern is read from the production settings (DEBUG
off) in a subprocess, because the test process runs with DEBUG on and the
production block never executes here.
"""
import json
import os
import subprocess
import sys
from pathlib import Path

import pytest
from cryptography.fernet import Fernet
from django.test import override_settings

BACKEND = Path(__file__).resolve().parents[1]


def _production_setting(name):
    env = {
        **os.environ,
        "DEBUG": "False",
        "SECRET_KEY": "test-only-" + "x" * 50,
        "ALLOWED_HOSTS": "testserver",
        "ENCRYPTION_KEY": Fernet.generate_key().decode(),
        # settings refuses SQLite when DEBUG is off; only parsed at import, never connected.
        "DATABASE_URL": "postgres://unused:unused@127.0.0.1:1/unused",
    }
    code = (
        "import json, os; os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'config.settings'); "
        "from django.conf import settings; "
        f"print(json.dumps(list(getattr(settings, '{name}', []))))"
    )
    out = subprocess.run(
        [sys.executable, "-c", code], env=env, cwd=BACKEND, capture_output=True, text=True, check=True
    )
    return json.loads(out.stdout.strip().splitlines()[-1])


@pytest.mark.django_db
def test_health_answers_plain_http_while_detailed_still_redirects(client):
    exempt = _production_setting("SECURE_REDIRECT_EXEMPT")
    with override_settings(
        SECURE_SSL_REDIRECT=True,
        SECURE_REDIRECT_EXEMPT=exempt,
        SECURE_PROXY_SSL_HEADER=("HTTP_X_FORWARDED_PROTO", "https"),
    ):
        assert client.get("/health/").status_code == 200
        assert client.get("/health/detailed/").status_code == 301
