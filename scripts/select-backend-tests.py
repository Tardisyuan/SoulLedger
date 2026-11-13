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

ONE LAYER OF REVERSE DEPENDENCY (2026-11-10, test-suite review #5). When A
changes, every app B whose non-test code imports `apps.A` (read with `ast`, not
regex; migrations and test files do not count) also gets its own tests, the
files under backend/apps/B/. One layer only: if C imports B, C's tests are not
added for a change in A. Measured 2026-11-10 (591 test files, a one-file change
in each of the 27 apps): 2320 → 2693 selected in sum, +16%; per app +0% (menus)
to +75% (org 20 → 35); judgment 166 → 180. Applying all three rules to B instead
selected 300–560 of 591 for most apps (nearly every test names `apps.authentication`
or `apps.tenants`) — that is `--full`, not a selection, so B gets its directory only.

THREE HOLES CLOSED 2026-11-13 (test review #1, #3):
  - CONTRACT TESTS. A backend-only push never ran the tests that compare the backend with the
    frontend / the committed schema: they name no app and call no URL, they read
    packages/core/openapi/schema.yml or frontend/e2e/fixtures.ts. A serializers.py change in each
    of the 27 apps selected test_committed_schema_matches_the_backend.py 0 times of 27. Now any
    non-test file under backend/apps/ also selects the lines of tests/reads-outside-backend.txt
    labelled frontend / packages / mobile / mobile-officer (`contract_readers`).
  - `apps/core` is imported by 25 of the 27 apps and 575 of 622 test files live in backend/tests/,
    which the reverse layer does not reach: a non-test change under it runs everything (FULL_RULES).
  - An app mounted at the bare `api/v1/` (workflow) had no URL prefix; its prefixes are now the
    first segments its own urls.py registers. And a changed test file selects the tests that
    import from it, as a changed helper module always did.

What it can still miss, accepted by the user: a test outside backend/apps/B/ that
reaches A only through B, or a test that reaches A through two or more apps, with
A's name and URL absent from its own source. `--full` still runs everything.
"""
import ast
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
    # the hub app (2026-11-13, user decision); its own test files are still selective
    (r"^backend/apps/core/(?!(.*/)?(test_[^/]*|tests)\.py$)", "apps/core changed, and nearly every app imports it"),
]
# The lines of reads-outside-backend.txt that compare the backend with another area carry one of these.
CONTRACT_TOPS = {"frontend", "packages", "mobile", "mobile-officer"}
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
    # An app mounted at the bare `api/v1/` has no prefix there (the pattern above needs one character):
    # its prefixes are what its own urls.py registers — `router.register(r"workflows", …)`, `path("x/", …)`.
    for app in re.findall(r"""path\(\s*["']api/v1/["']\s*,\s*include\(\s*["']apps\.(\w+)\.urls""", src):
        try:
            with open(os.path.join(BACKEND, "apps", app, "urls.py"), encoding="utf-8") as f:
                own = f.read()
        except OSError:
            continue
        for first in re.findall(r"""(?:\.register|\bpath)\(\s*r?["']([^"'<(]+?)/?["']""", own):
            pre.setdefault(app, set()).add(first)
    return pre


def contract_readers():
    """Test files that read frontend / packages / the apps: the backend-against-the-other-side contracts."""
    out = []
    try:
        with open(os.path.join(BACKEND, "tests", "reads-outside-backend.txt"), encoding="utf-8") as f:
            for line in f:
                parts = line.split()
                # ponytail: a line that also names `scripts` reads the gate / deploy scripts and quotes other
                # areas' paths as data (test_prepush… alone is ~2000 lines of subprocesses); left to its own
                # trigger. If one of them turns out to compare the backend with the frontend, drop this clause.
                if parts and not parts[0].startswith("#") and CONTRACT_TOPS & set(parts[1:]) and "scripts" not in parts[1:]:
                    out.append(parts[0])
    except OSError:
        pass
    return out


def importers():
    """{A: {B, …}}: apps whose non-test, non-migration code imports `apps.A`."""
    root = os.path.join(BACKEND, "apps")
    names = {a for a in os.listdir(root) if os.path.isdir(os.path.join(root, a)) and not a.startswith("_")}
    graph = {}
    for b in names:
        for d, dirs, files in os.walk(os.path.join(root, b)):
            dirs[:] = [x for x in dirs if x not in ("__pycache__", "migrations", "tests")]
            for f in files:
                if not f.endswith(".py") or is_test_file(f):
                    continue
                try:
                    with open(os.path.join(d, f), encoding="utf-8") as fh:
                        tree = ast.parse(fh.read())
                except (OSError, SyntaxError):
                    continue
                for node in ast.walk(tree):
                    if isinstance(node, ast.Import):
                        mods = [a.name for a in node.names]
                    elif isinstance(node, ast.ImportFrom) and node.level == 0 and node.module:
                        # `from apps import judgment` names the app in the alias, not the module
                        mods = [node.module] + ([f"apps.{a.name}" for a in node.names] if node.module == "apps" else [])
                    else:
                        continue
                    for m in mods:
                        parts = m.split(".")
                        if len(parts) > 1 and parts[0] == "apps" and parts[1] in names and parts[1] != b:
                            graph.setdefault(parts[1], set()).add(b)
    return graph


def select(changed):
    changed = [c for c in changed if c]
    for path in changed:
        for rule, why in FULL_RULES:
            if re.search(rule, path):
                return None, f"{why}: {path}"
    apps = sorted({p.split("/")[2] for p in changed if p.startswith("backend/apps/") and p.count("/") >= 3})
    graph = importers() if apps else {}
    # one layer: the importers of the changed apps, not the importers of those
    importing = set().union(*(graph.get(a, set()) for a in apps)) - set(apps)
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
    picked.update(t for t in tests if t.split("/")[0] == "apps" and t.split("/")[1] in importing)
    if any(p.startswith("backend/apps/") and not is_test_file(p) for p in changed):
        picked.update(t for t in contract_readers() if t in tests)
    for path in changed:
        if not path.startswith("backend/"):
            continue
        rel = path[len("backend/"):]
        if is_test_file(rel):
            if os.path.exists(os.path.join(BACKEND, rel)):
                picked.add(rel)
            # the tests that import a helper from it (`from tests.test_x import …`, `from .test_x import …`)
            stem = os.path.splitext(os.path.basename(rel))[0]
            if stem.startswith("test_"):
                imp = re.compile(r"(?:from [\w.]*\.|import )" + re.escape(stem) + r"\b")
                picked.update(t for t in tests if imp.search(text(t)))
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
