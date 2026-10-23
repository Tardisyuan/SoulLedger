"""Every `@receiver` module is imported by app start, not by the URLconf.

A receiver is connected when its module is imported. Two post_delete receivers
that remove files from storage (judgment attachments, chat images) were
imported only by views that `config.urls` pulls in, so a celery worker or a
management command — which never loads urls — deleted the rows and left the
files behind. They are now imported from their `AppConfig.ready()`.

A fresh interpreter is the measurement: in the test process urls are long
loaded, so `sys.modules` would hold every module regardless.
"""
import json
import os
import subprocess
import sys
from pathlib import Path

BACKEND = Path(__file__).resolve().parents[1]

_PROBE = """
import json, sys, django
django.setup()
print(json.dumps({"urls": "config.urls" in sys.modules, "loaded": sorted(sys.modules)}))
"""


def _receiver_modules():
    found = []
    for path in sorted((BACKEND / "apps").rglob("*.py")):
        if path.name == "tests.py" or path.name.startswith("test_") or "migrations" in path.parts:
            continue
        if "@receiver(" in path.read_text(encoding="utf-8"):
            found.append(".".join(path.relative_to(BACKEND).with_suffix("").parts))
    return found


def test_receiver_modules_are_imported_by_django_setup_alone():
    modules = _receiver_modules()
    assert "apps.judgment.attachments" in modules and "apps.chat.images" in modules, modules

    env = {**os.environ, "DJANGO_SETTINGS_MODULE": "config.settings"}
    out = subprocess.run(
        [sys.executable, "-c", _PROBE], cwd=BACKEND, env=env, capture_output=True, text=True, check=True
    ).stdout
    probe = json.loads(out.strip().splitlines()[-1])

    assert probe["urls"] is False, "django.setup() imported config.urls; this probe measures nothing"
    missing = [m for m in modules if m not in probe["loaded"]]
    assert missing == [], (
        f"receivers not connected until urls load: {missing}. "
        f"Import the module from its app's AppConfig.ready()."
    )
