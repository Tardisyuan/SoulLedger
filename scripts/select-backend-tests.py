"""Which backend test files a change needs (2026-10-27, user decision: "按 app 选").

Reads the changed paths (repo-relative, one per line) on stdin. Prints either

    FULL<TAB><reason>

when the change is one this selection cannot trace, or the selected test files,
one per line, relative to backend/. An empty output means nothing backend-side
needs a test.

WHY BY APP, NOT BY IMPORT GRAPH. Measured 2026-10-27 on the last 15 backend
commits: following imports selected ~400 of 474 test files for most changes
(everything imports the models and conftest), and it selected 0 for a change to
apps/tenants/views.py, because Django reaches views through the URLconf string
`include("apps.tenants.urls")`, which no import edge shows. Selecting by app
picked 17–110 files for a one-app change.

A test file is selected for a changed app A when any of:
  - it lives under backend/apps/A/;
  - its source names the app: `apps.A` / `apps/A/` (not `apps.A_other`);
  - its source calls one of A's URL prefixes, `/api/v1/<prefix>/`, read from
    backend/config/urls.py (`path("api/v1/<prefix>/", include("apps.A.urls"))`).

What it can miss, accepted by the user: a test that reaches app A only through
another app's code, with neither A's name nor A's URL in its own source. `--full`
still runs everything.
"""
import os
import re
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
BACKEND = os.path.join(ROOT, "backend")

# Changes that alter how every test runs, or that this selection cannot map to an app.
FULL_RULES = [
    (r"^backend/config/", "backend settings / URLconf changed"),
    (r"(^|/)conftest\.py$", "a conftest changed"),
    (r"^pytest\.ini$", "pytest.ini changed"),
    (r"^backend/requirements", "backend dependencies changed"),
    (r"^backend/[^/]+$", "a top-level backend file changed"),
]
GATE_SCRIPTS = re.compile(r"^scripts/(run-gates|install-hooks|gate-lock|select-backend-tests)\.(sh|py)$")


def is_test_file(rel):
    name = os.path.basename(rel)
    return name.endswith(".py") and (name.startswith("test_") or name == "tests.py")


def all_test_files():
    out = []
    for top in ("apps", "tests"):
        for d, dirs, files in os.walk(os.path.join(BACKEND, top)):
            dirs[:] = [x for x in dirs if x not in ("__pycache__", "migrations")]
            for f in files:
                rel = os.path.relpath(os.path.join(d, f), BACKEND)
                if is_test_file(rel):
                    out.append(rel)
    return sorted(out)


def url_prefixes():
    try:
        with open(os.path.join(BACKEND, "config", "urls.py"), encoding="utf-8") as f:
            src = f.read()
    except OSError:
        return {}
    # Names imported from an app (`from apps.chat import urls as chat_urls`, `from apps.x.views import V`),
    # and routers built in this file from such a viewset (`user_router.register(r'', UserViewSet)`).
    owner = {}
    for app, names in re.findall(r"^from apps\.(\w+)[\w.]* import (.+)$", src, re.MULTILINE):
        for part in names.split(","):
            owner[part.split(" as ")[-1].strip(" ()")] = app
    for var, view in re.findall(r"^(\w+)\.register\(\s*r?['\"][^'\"]*['\"]\s*,\s*(\w+)", src, re.MULTILINE):
        if view in owner:
            owner[var] = owner[view]
    pre = {}
    for line in src.splitlines():
        m = re.search(r"""path\(\s*["']api/v1/([^"']+?)/?["']\s*,(.*)""", line)
        if not m:
            continue
        apps = set(re.findall(r"apps\.(\w+)", m.group(2)))
        apps.update(owner[w] for w in re.findall(r"\b(\w+)\b", m.group(2)) if w in owner)
        for app in apps:
            pre.setdefault(app, set()).add(m.group(1))
    return pre


def select(changed):
    changed = [c for c in changed if c]
    for path in changed:
        for rule, why in FULL_RULES:
            if re.search(rule, path):
                return None, f"{why}: {path}"
    apps = sorted({p.split("/")[2] for p in changed if p.startswith("backend/apps/") and p.count("/") >= 3})
    prefixes = url_prefixes()
    tests = all_test_files()
    src = {}

    def text(rel):
        if rel not in src:
            try:
                with open(os.path.join(BACKEND, rel), encoding="utf-8") as f:
                    src[rel] = f.read()
            except OSError:
                src[rel] = ""
        return src[rel]

    picked = set()
    for app in apps:
        name = re.compile(r"apps[./]" + re.escape(app) + r"(?![\w])")
        urls = [f"/api/v1/{p}/" for p in prefixes.get(app, ())]
        for t in tests:
            if t.startswith(f"apps/{app}/") or name.search(text(t)) or any(u in text(t) for u in urls):
                picked.add(t)
    for path in changed:
        if not path.startswith("backend/"):
            continue
        rel = path[len("backend/"):]
        if is_test_file(rel):
            if os.path.exists(os.path.join(BACKEND, rel)):
                picked.add(rel)
        elif rel.startswith("tests/"):
            # A helper module or data file the tests read: select the tests that name it.
            stem = os.path.splitext(os.path.basename(rel))[0]
            needles = [os.path.basename(rel)] + ([f"tests.{stem}", f"import {stem}"] if rel.endswith(".py") else [])
            picked.update(t for t in tests if any(n in text(t) for n in needles))
    # The gate scripts' only tests read them as text.
    if any(GATE_SCRIPTS.match(p) for p in changed):
        picked.update(t for t in tests if any(os.path.basename(p) in text(t) for p in changed if GATE_SCRIPTS.match(p)))
    return sorted(picked), None


def main():
    changed = sys.stdin.read().splitlines()
    picked, full = select(changed)
    if full:
        print(f"FULL\t{full}")
    else:
        print("\n".join(picked))


if __name__ == "__main__":
    main()
