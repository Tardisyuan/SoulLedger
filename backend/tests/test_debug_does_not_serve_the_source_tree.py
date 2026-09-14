"""A DEBUG server must not hand out the repository (BP-05).

`config/urls.py` ended with `+ static(settings.MEDIA_URL,
document_root=settings.MEDIA_ROOT)`, and neither setting was defined. Django's
defaults then make `MEDIA_URL` `"/"` and `MEDIA_ROOT` `""` — the process's
working directory — so under DEBUG every path that was not a route was a file
read from `backend/`: `GET /config/settings.py` answered 200, and `GET /.env`
would have answered with the database and Redis credentials. The dev
`docker-compose.yml` runs with `DEBUG=true`.

At the time nothing uploaded a file, so the route was removed. Since
2026-09-14 avatars are uploaded (`POST /api/v1/social/profiles/me/avatar/`),
and the route is back — with MEDIA_URL "/media/" and a MEDIA_ROOT of its own.
The first test below still holds the source tree to 404; the last one holds
/media/ to MEDIA_ROOT and nothing beside it.

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


MEDIA_PROBE = """
import django, json
django.setup()
from django.test import Client
c = Client()
out = {}
for p in ["/media/avatars/2026/09/ok.png", "/media/manage.py", "/media/.env",
          "/media/../manage.py", "/media/%2e%2e/manage.py", "/media/..%2fmanage.py",
          "/media/%2e%2e/.env", "/manage.py", "/.env", "/health/"]:
    r = c.get(p)
    body = b"".join(r.streaming_content) if getattr(r, "streaming", False) else r.content
    out[p] = [r.status_code, body.decode("latin-1")[:40]]
print(json.dumps(out))
"""


def test_media_serves_media_root_and_nothing_outside_it(tmp_path):
    """Avatars are uploaded now (2026-09-14), so DEBUG serves `/media/` again —
    from an explicit MEDIA_ROOT. This is the other side of the BP-05 hole: the
    route exists, and it must reach that one directory and nothing beside it.

    A `.env` and a `manage.py` are planted one level ABOVE the media root, so a
    traversal that escaped would find a real file and answer 200 — a 404 here
    is the guard working, not an absent target.
    """
    import json

    media = tmp_path / "media"
    (media / "avatars" / "2026" / "09").mkdir(parents=True)
    (media / "avatars" / "2026" / "09" / "ok.png").write_bytes(b"PNG-BYTES-FROM-MEDIA")
    (tmp_path / ".env").write_text("SECRET=leaked")
    (tmp_path / "manage.py").write_text("LEAKED-MANAGE")

    env = _child_env()
    env["MEDIA_ROOT"] = str(media)
    proc = subprocess.run(
        [sys.executable, "-c", MEDIA_PROBE], cwd=BACKEND, env=env,
        capture_output=True, text=True, timeout=120,
    )
    assert proc.returncode == 0, proc.stderr[-3000:]
    got = json.loads(proc.stdout.strip().splitlines()[-1])
    assert got.pop("/health/")[0] == 200, got
    assert got.pop("/media/avatars/2026/09/ok.png") == [200, "PNG-BYTES-FROM-MEDIA"], got
    for path, (code, body) in got.items():
        # 400 is Django refusing a `..` segment outright (SuspiciousFileOperation),
        # 404 is the file not being under MEDIA_ROOT. Both are refusals.
        assert code in (400, 404), (path, code, body)
        assert "LEAKED" not in body and "SECRET" not in body, (path, body)
