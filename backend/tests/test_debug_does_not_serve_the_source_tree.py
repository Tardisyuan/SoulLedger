"""A DEBUG server must not hand out the repository (BP-05).

`config/urls.py` ended with `+ static(settings.MEDIA_URL,
document_root=settings.MEDIA_ROOT)`, and neither setting was defined. Django's
defaults then make `MEDIA_URL` `"/"` and `MEDIA_ROOT` `""` — the process's
working directory — so under DEBUG every path that was not a route was a file
read from `backend/`: `GET /config/settings.py` answered 200, and `GET /.env`
would have answered with the database and Redis credentials. The dev
`docker-compose.yml` runs with `DEBUG=true`.

Nothing uploads a file: `User.avatar` is an `ImageField` that no serializer
accepts on write and no frontend renders. So the route is removed rather than
pointed somewhere safer.

Why a subprocess: `static()` returns `[]` unless DEBUG is true *when the
URLconf is imported*, and pytest-django forces DEBUG off before that happens.
In-process, this test would be green on the vulnerable code. The child gets
every variable that matters explicitly, so `load_dotenv` — which never
overrides a variable that is already set — cannot bring a real `.env` in.
"""
import subprocess
import sys
from pathlib import Path

BACKEND = Path(__file__).resolve().parents[1]

PROBE = """
import django, json
django.setup()
from django.test import Client
c = Client()
print(json.dumps({p: c.get(p).status_code for p in
      ["/manage.py", "/config/settings.py", "/requirements.txt", "/health/"]}))
"""


def _child_env():
    return {
        "PATH": "/usr/bin:/bin",
        "PYTHONPATH": str(BACKEND),
        "DJANGO_SETTINGS_MODULE": "config.settings",
        "SECRET_KEY": "test-only-not-a-secret",
        "DEBUG": "true",
        "ALLOWED_HOSTS": "testserver",
        "DATABASE_URL": "sqlite:///:memory:",
        # A closed port: if anything in the request path reaches for Redis it
        # fails loudly instead of touching a real one.
        "REDIS_URL": "redis://127.0.0.1:1/0",
        "CELERY_BROKER_URL": "redis://127.0.0.1:1/1",
        "CELERY_RESULT_BACKEND": "redis://127.0.0.1:1/2",
        "ENCRYPTION_KEY": "",
        "SENTRY_DSN": "",
        "TRUSTED_PROXY_COUNT": "0",
    }


def test_debug_does_not_serve_files_from_the_backend_directory():
    import json

    proc = subprocess.run(
        [sys.executable, "-c", PROBE], cwd=BACKEND, env=_child_env(),
        capture_output=True, text=True, timeout=120,
    )
    assert proc.returncode == 0, proc.stderr[-3000:]
    statuses = json.loads(proc.stdout.strip().splitlines()[-1])
    # Positive control: the child really served requests, so a 404 below is
    # the route being absent, not the probe being broken.
    assert statuses.pop("/health/") == 200, statuses
    assert statuses == {p: 404 for p in statuses}, statuses


def test_nothing_in_settings_reintroduces_a_media_root_at_the_code():
    """A FORWARD guard, not evidence of the fix.

    This passes on the vulnerable tree too (MEDIA_ROOT was undefined there, and
    undefined is what made Django serve the working directory). The test above
    is the one that went 200 -> 404. This one exists so that a later "let's
    serve uploads" change has to point MEDIA_ROOT at a dedicated directory
    instead of somewhere inside the checkout.
    """
    from django.conf import settings

    root = str(getattr(settings, "MEDIA_ROOT", "") or "")
    if not root:
        return
    assert not str(BACKEND).startswith(root.rstrip("/")), (
        f"MEDIA_ROOT {root!r} contains the source tree"
    )
