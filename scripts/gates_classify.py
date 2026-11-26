"""The decision rules of scripts/run-gates.sh: what a list of changed files runs (2026-11-26, user decision).

Stdlib only, Python 3.11, no state: every answer is a function of the changed paths (one per line, on stdin)
and of files in the checkout. run-gates.sh keeps the argument parser, the ssh / rsync / lock orchestration and
the running of the gates; it asks this module what to run. demo-remote.sh --auto asks it too, and
select-backend-tests.py takes GATE_SCRIPTS from here. The reasoning behind each rule is written beside the rule
in run-gates.sh's history (`git log -L` on the old shell); the short form is kept here.

    gates_classify.py classify <root> [--full] [--gates-full]   shell assignments (eval) for run-gates.sh
    gates_classify.py readers <list file>                         stdin: top-level entries; the reader lines
    gates_classify.py proves <ledger> <tree>                      stdin: files, or "-"; prints full / selective
    gates_classify.py e2e-missing <ledger> <tree> <a,b,…>         the projects that tree has not passed
    gates_classify.py e2e-auto [--demo]                           the first change a browser suite can see

A change to this file runs the gate tests, the whole web jest and the browser suites (GATE_SCRIPTS below).
"""
import os
import re
import shlex
import subprocess
import sys

# THE GATE MACHINERY, ONE LIST (2026-11-26). Each changed path here makes select-backend-tests.py pick the
# backend tests that name it (they read these files as text). The roles say what else it runs:
#   backend  the backend side runs at all (TOUCHES_BACKEND): its only tests are in the backend suite;
#   jest     the web jest runs in full ("the gate machinery itself changed", FULL_RULES);
#   e2e      --e2e=auto runs the browsers (their runner changed);
#   demo     demo-remote.sh --auto runs the demo E2E.
# The roles are what each of the four former lists said; a file without a role is one no list named.
GATE_SCRIPTS = {
    "scripts/run-gates.sh": {"backend", "jest", "e2e"},
    "scripts/gates-remote.sh": {"backend", "jest", "e2e"},
    "scripts/remote-common.sh": {"backend", "jest", "e2e", "demo"},
    "scripts/gates_classify.py": {"backend", "jest", "e2e", "demo"},
    "scripts/install-hooks.sh": {"backend", "jest"},
    "scripts/gate-lock.sh": {"backend"},
    "scripts/select-backend-tests.py": set(),
}


def _gate_re(role):
    return "|".join(re.escape(p) for p, roles in GATE_SCRIPTS.items() if role in roles)


# Root-level files that change nothing a gate measures: documentation and deployment. Any other root-level
# file runs every gate (fail closed: nobody knows what a file this script has never seen affects).
INERT_ROOT_RE = r"(\.md$|^(docker-compose[A-Za-z0-9._-]*\.ya?ml|\.dockerignore|\.gitignore|\.claudeignore|\.env\.example)$)"
JS_ROOT_RE = r"^(package\.json|package-lock\.json|\.nvmrc)$"
BACKEND_ROOT_RE = r"^(pytest\.ini|conftest\.py)$"

# --e2e=auto: browsers only when the change can reach them. E2E serves the frontend build with mocked API
# fixtures (no backend), so it sees frontend/, packages/core/, the JS dependency tree, its own runner, and any
# root-level file not on INERT_ROOT_RE ...
E2E_AUTO_RE = rf"^(frontend/|packages/core/|package\.json$|package-lock\.json$|\.nvmrc$|scripts/e2e-report\.py$|({_gate_re('e2e')})$)"
# ... except what no browser loads: unit tests and their support files, the jest / vitest / eslint
# configuration, documentation (2026-11-13, test review #10a). Shared with demo-remote.sh --auto.
E2E_BLIND_COMMON_RE = (r"(\.md$|^frontend/src/__tests__/|^frontend/.*\.test\.tsx?$|^packages/core/(.*/)?__tests__/"
                       r"|^packages/core/.*\.test\.tsx?$|^frontend/(jest|eslint)\.[^/]+$|^packages/core/(vitest|eslint)\.[^/]+$)")
# For the gates' browser suites the demo's specs (playwright.config.ts ignores **/demo/**) and recordings are
# blind too; for the demo E2E they are triggers.
E2E_BLIND_RE = E2E_BLIND_COMMON_RE + r"|^frontend/e2e/demo/|^frontend/demo/data/"
DEMO_AUTO_RE = (r"^(frontend/|packages/core/|package\.json$|package-lock\.json$|\.nvmrc$"
                rf"|scripts/(demo-remote\.sh|demo-e2e-inner\.sh|demo-e2e-summary\.py|check-demo-bundle\.sh)$|({_gate_re('demo')})$)")

# Jest: --findRelatedTests follows imports; each rule names a change it cannot trace and sends the web jest
# to a full run. Language packs, three kinds of data file, the generated schema and the design tokens are
# traced (or read by always-run tests), so they are exempt (JEST_TRACED_*), as are two top-level files that
# are code, not config.
FULL_RULES = [
    (rf"^({_gate_re('jest')})$", "the gate machinery itself changed"),
    (r"^(package\.json|package-lock\.json|\.nvmrc)$", "the JS dependency tree changed"),
    (r"^(frontend|packages/core)/[^/]+$", "top-level config of frontend/ or packages/core/ changed (jest, ts, next, eslint, package.json)"),
    (r"^(frontend|packages/core)/.*\.(json|md|ya?ml)$", "a data file under frontend/ or packages/core/ changed"),
    (r"^frontend/lib/platform/web\.[^/]+$", "a module frontend/jest.setup.js runs before every test changed"),
]
JEST_TRACED_DATA_RE = (r"^(packages/core/messages/|packages/core/tokens/[^/]+\.tokens\.json$|packages/core/openapi/schema\.yml$"
                       r"|frontend/src/__tests__/support/(egyPendingKeys|egyVocabulary)\.json$|frontend/demo/data/.+\.json$)")
JEST_TRACED_CODE_RE = r"^frontend/(proxy|instrumentation[^/]*)\.ts$"

# The migration round trips run only when something they test changed: a migration, their harness, a
# conftest, the lock file, pytest.ini, a file holding one of them (found by content), or an unknown root file.
MIGRATION_PATH_RE = (r"^(backend/apps/[^/]+/migrations/|backend/tests/migration_roundtrip\.py$|backend/tests/conftest\.py$"
                     r"|backend/requirements\.lock$|conftest\.py$|pytest\.ini$)")
# The two suite-about-the-suite tests (each starts a second pytest) run only when what they guard changed;
# the collection-scope one also for any changed backend test file.
META_TESTS = ["backend/tests/test_collection_scope.py", "backend/tests/test_audit_assertions_are_not_vacuous.py"]
SCOPE_TEST = "backend/tests/test_collection_scope.py"
META_PATH_RE = (r"^(pytest\.ini$|conftest\.py$|backend/.*conftest\.py$|backend/requirements\.lock$|backend/config/"
                r"|backend/apps/(audit|tenants)/|backend/apps/core/lock_join_guard\.py$|backend/apps/[^/]+/tests\.py$"
                r"|backend/tests/test_collection_scope\.py$|backend/tests/test_audit_assertions_are_not_vacuous\.py$)")
SCOPE_PATH_RE = r"^backend/(apps|tests)/(.*/)?(test_[^/]*|tests)\.py$"
# A test that reads files (the mobile readers here, and app_jest in run-gates.sh).
READS_FILES_RE = r"""readFileSync|readdirSync|existsSync|statSync|execSync|execFileSync|spawnSync|['"](node:)?(fs|fs/promises|child_process)['"]"""


def _count(lines, pattern):
    return sum(1 for f in lines if re.search(pattern, f))


def _first(lines, pattern, skip=()):
    return next((f for f in lines if re.search(pattern, f) and not any(re.search(s, f) for s in skip)), "")


def _read(path):
    try:
        with open(path, encoding="utf-8", errors="surrogateescape") as f:
            return f.read()
    except OSError:
        return None


def _git(root, *args):
    out = subprocess.run(["git", "-C", root, *args], capture_output=True, text=True, check=False)
    return [x for x in out.stdout.split("\n") if x]


def readers_for(list_file, tops):
    """Of a readers list (reads-outside-backend.txt, jest.always-run.txt): the first field of each line whose
    other fields name `*` or one of the top-level entries `tops`."""
    text = _read(list_file) or ""
    out = []
    for line in text.split("\n"):
        parts = line.split()
        if parts and not parts[0].startswith("#") and any(p == "*" or p in tops for p in parts[1:]):
            out.append(parts[0])
    return out


def reader_follows_change(text, tops, top_entries):
    """Does an app's file-reading test read something that changed? jestAlwaysRunList.test.ts's derivedLabel,
    failing open: a subprocess or git → yes; names top-level entries → yes when one changed; names none but
    climbs to the repository root → yes; stays inside its own app → no."""
    if re.search(r"execSync|execFileSync|spawnSync|child_process|(^|[^\w])git ", text, re.MULTILINE):
        return True
    named = False
    for t in top_entries:
        if re.search("['\"`/]" + re.escape(t) + "['\"`/]", text):
            named = True
            if t in tops:
                return True
    if named:
        return False
    return bool(re.search(r'REPO|repoRoot|ROOT(\W|$)|"\.\.", "\.\.", "\.\."|\.\./\.\./\.\.', text, re.MULTILINE))


def classify(changed, root, mode_full=False, gates_full=False):
    """Every gate decision from one change list (the lines of `echo "$CHANGED"`), as {shell variable: value}."""
    v = {}
    v["TOUCHES_FRONTEND"] = _count(changed, r"^frontend/")
    v["TOUCHES_BACKEND"] = _count(changed, rf"^backend/|^({_gate_re('backend')})$")
    # packages/ runs core, and core runs the frontend and both apps (they compile its sources).
    v["TOUCHES_CORE"] = _count(changed, r"^packages/")
    # mobile/'s theme test reads globals.css; the officer app uses mobile/'s jest setup, metro, plugins, modules.
    v["TOUCHES_MOBILE"] = _count(changed, r"^(mobile/|frontend/app/globals\.css$)")
    v["TOUCHES_OFFICER"] = _count(changed, r"^(mobile-officer/|mobile/)")

    # Root-level files: the JS tree, the pytest config, and — fail closed — anything not known to be inert.
    root_level = [f for f in changed if "/" not in f and f]
    v["JS_ROOT"] = _count(root_level, JS_ROOT_RE)
    v["BACKEND_ROOT"] = _count(root_level, BACKEND_ROOT_RE)
    unknown = [f for f in root_level if not re.search(JS_ROOT_RE, f) and not re.search(BACKEND_ROOT_RE, f)
               and not re.search(INERT_ROOT_RE, f)]
    v["UNKNOWN_ROOT"] = "\n".join(unknown)
    v["TOUCHES_CORE"] += v["JS_ROOT"] + (1 if unknown else 0)
    v["TOUCHES_BACKEND"] += v["BACKEND_ROOT"] + (1 if unknown else 0)

    core = v["TOUCHES_CORE"] > 0
    run = {
        "RUN_CORE": core,
        "RUN_FRONTEND": v["TOUCHES_FRONTEND"] > 0 or core,
        "RUN_BACKEND": v["TOUCHES_BACKEND"] > 0,
        "RUN_MOBILE": v["TOUCHES_MOBILE"] > 0 or core,
        "RUN_OFFICER": v["TOUCHES_OFFICER"] > 0 or core,
    }

    # Tests that read another area's files run when that area is not running in full.
    tops = sorted({f.split("/", 1)[0] for f in changed if f})
    v["TOPS"] = "\n".join(tops)
    readers_list = os.path.join(root, "backend", "tests", "reads-outside-backend.txt")
    backend_readers, v["READERS_MISSING"] = [], 0
    if not run["RUN_BACKEND"]:
        if os.path.isfile(readers_list):
            backend_readers = readers_for(readers_list, set(tops))
        else:
            v["READERS_MISSING"], run["RUN_BACKEND"] = 1, True
    v["BACKEND_READERS"] = "\n".join(backend_readers)
    jest_list = os.path.join(root, "frontend", "jest.always-run.txt")
    jest_readers = readers_for(jest_list, set(tops)) if not run["RUN_FRONTEND"] and os.path.isfile(jest_list) else []
    v["RUN_JEST_READERS"] = 1 if jest_readers else 0
    v["JEST_READERS"] = "\n".join(jest_readers)
    mobile_readers = []
    if not run["RUN_MOBILE"]:
        top_entries = _git(root, "ls-tree", "--name-only", "HEAD")
        for f in _git(root, "ls-files", "mobile/*.test.ts", "mobile/*.test.tsx"):
            text = _read(os.path.join(root, f))
            if text is not None and re.search(READS_FILES_RE, text) and reader_follows_change(text, set(tops), top_entries):
                mobile_readers.append(f)
    v["MOBILE_READERS"] = "\n".join(mobile_readers)

    migration = _count(changed, MIGRATION_PATH_RE) + (1 if unknown else 0)
    migration += sum(1 for f in changed if re.search(r"^backend/.*\.py$", f) and os.path.isfile(os.path.join(root, f))
                     and re.search(r"migration_round_trip|mark\.migration", _read(os.path.join(root, f)) or ""))
    v["TOUCHES_MIGRATION"] = migration
    v["RUN_MIGRATION"] = int(run["RUN_BACKEND"] and migration > 0)

    full_run = 1 if mode_full or gates_full else 0
    v["FULL_RUN"] = full_run
    meta = _count(changed, META_PATH_RE) + (1 if unknown else 0) + full_run
    v["TOUCHES_META"] = meta
    v["RUN_META"] = int(meta > 0)
    v["RUN_SCOPE"] = int(meta > 0 or _count(changed, SCOPE_PATH_RE) > 0)
    skip = [] if meta > 0 else [t for t in META_TESTS if not (v["RUN_SCOPE"] and t == SCOPE_TEST)]
    v["META_SKIP"] = "\n".join(skip)
    v["META_TESTS"] = "\n".join(META_TESTS)
    v["SCOPE_TEST"] = SCOPE_TEST
    v["READS_FILES_RE"] = READS_FILES_RE

    # Why the web jest runs in full (empty: selective), then why the apps' jest does.
    why = []
    if mode_full:
        why.append("--full")
    if gates_full:
        why.append("GATES_FULL=1")
    if unknown:
        why.append("a root-level file this script does not recognise")
    for pattern, name in FULL_RULES:
        hit = _first(changed, pattern, skip=(JEST_TRACED_DATA_RE, JEST_TRACED_CODE_RE))
        if hit:
            why.append(f"{name}: {hit}")
    gone = next((f for f in changed if f and not os.path.exists(os.path.join(root, f))
                 and f.startswith(("frontend/", "packages/core/"))), "")
    if gone:
        why.append(f"a file was deleted or renamed: {gone}")
    v["FULL_F"] = "".join(w + "\n" for w in why)
    app = list(why)
    hit = _first(changed, r"^(mobile|mobile-officer|packages/mobile-ui)/",
                 skip=(r"^(mobile|mobile-officer|packages/mobile-ui)/src/.*\.(ts|tsx|js|jsx)$",))
    if hit:
        app.append(f"an app file outside src/, or not code: {hit}")
    hit = _first(changed, r"^(packages/mobile-ui/src/platform|mobile-officer/src/keptText)([./]|$)")
    if hit:
        app.append(f"a module the app's jest.setup.js loads for every test changed: {hit}")
    gone = next((f for f in changed if f.startswith(("mobile/", "mobile-officer/", "packages/mobile-ui/"))
                 and not os.path.exists(os.path.join(root, f))), "")
    if gone:
        app.append(f"an app file was deleted or renamed: {gone}")
    v["APP_FULL_F"] = "".join(w + "\n" for w in app)

    v.update({k: int(b) for k, b in run.items()})
    return v


def proves(ledger_text, tree, files):
    """Does a side's ledger vouch for <tree> and these changed files? "full" when a full pass (`*`) of the tree
    is recorded; "selective" when the files its selective passes covered, all its lines united, include every
    one of <files> ("-" asks for a full pass only); "" otherwise."""
    seen, have = False, set()
    for line in ledger_text.split("\n"):
        fields = line.split("\t")
        if fields[0] != tree:
            continue
        seen = True
        covered = fields[2] if len(fields) > 2 else ""
        if covered == "*":
            return "full"
        have.update(covered.split("|"))
    if not seen or files == "-":
        return ""
    return "selective" if all(f in have for f in files.split("\n") if f) else ""


def e2e_missing(ledger_text, tree, want):
    """The projects of <want> (comma-separated) that no line of the E2E ledger records for <tree>."""
    have = set()
    for line in ledger_text.split("\n"):
        fields = line.split("\t")
        if fields[0] == tree and len(fields) > 1:
            have.update(fields[1].split(","))
    return [w for w in want.split(",") if w not in have]


def e2e_hit(changed, demo=False):
    """The first changed file the browser suites (or, with demo, the demo E2E) can see; "" for none."""
    hit = _first(changed, DEMO_AUTO_RE if demo else E2E_AUTO_RE, skip=(E2E_BLIND_COMMON_RE if demo else E2E_BLIND_RE,))
    return hit or next((f for f in changed if f and "/" not in f and not re.search(INERT_ROOT_RE, f)), "")


def main(argv):
    cmd, args = argv[1], argv[2:]
    if cmd == "classify":
        v = classify(sys.stdin.read().split("\n"), args[0], "--full" in args, "--gates-full" in args)
        print("\n".join(f"{k}={shlex.quote(str(x))}" for k, x in v.items()))
    elif cmd == "readers":
        print("\n".join(readers_for(args[0], set(sys.stdin.read().split("\n")))))
    elif cmd == "proves":
        print(proves(_read(args[0]) or "", args[1], sys.stdin.read()))
    elif cmd == "e2e-missing":
        print("\n".join(e2e_missing(_read(args[0]) or "", args[1], args[2])))
    elif cmd == "e2e-auto":
        print(e2e_hit(sys.stdin.read().split("\n"), demo="--demo" in args))
    else:
        sys.exit(f"gates_classify.py: unknown command {cmd}")


if __name__ == "__main__":
    main(sys.argv)
