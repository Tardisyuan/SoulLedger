"""The pre-push hook must run the gates a change can break — including changes at
the repository root.

Why this file exists
--------------------
`.git/hooks/pre-push` is the only gate in this repository that runs on a push:
neither GitHub Actions workflow runs on pushes (since 2026-10-30 `ci.yml` runs daily
and on `v*` tags, `security.yml` weekly, both also by hand). It decides what to
run from the paths a push touches — `frontend/`, `backend/`, `packages/` — and
until 2026-09-11 nothing tested that decision at all.

Nothing at the repository root matched any of the three prefixes. Two
consecutive pushes that day were blind: a regenerated `package-lock.json`
(`694aec9` — 182 packages moved, one of them `nwsapi`, which turned eight jest
tests into timeouts and one file from about a second into 262 s) and the
`nwsapi` pin in the root `package.json` (`c6368ea`). For both the hook printed

    frontend:0 backend:0 core:0 changed files

and ran nothing. The gates were run by hand both times; that is the only reason
the slowdown was caught before it landed.

The same blind spot covered the backend: `pytest.ini` and `conftest.py` live at
the root too. `pytest.ini`'s own comment explains that its bare `tests.py`
pattern is the only reason `apps/*/tests.py` is collected at all, and
`test_collection_scope.py` fails if that pattern goes — but only if something
runs the backend suite, and for a `pytest.ini`-only push nothing did.

What is tested, and against which file
--------------------------------------
The hook body is read out of `scripts/install-hooks.sh`, the generator, rather
than `.git/hooks/pre-push`. The installed copy only exists on machines that ran
the installer, and a test that reads it would pass on one machine and error on
the next; the generator is what every install writes, and it is in git.

The hook's `PREPUSH_CHANGED` / `PREPUSH_CLASSIFY_ONLY` seam makes it print the
gate decisions and exit before running any gate. Those decisions are the exact
`RUN_CORE` / `RUN_FRONTEND` / `RUN_BACKEND` variables the gates' own `if`s read —
computed once in the hook, so this file asserts what actually decides, not a
second copy of the rule.

What "would really fail" means here
-----------------------------------
Each case was checked by breaking the hook, before being trusted green
(2026-09-11, one mutation at a time, 18 tests):

* `package-lock.json` out of `JS_ROOT_RE` → 2 red: the lockfile-only test (the
  exact `694aec9` push) and the mixed README + lockfile one;
* `pytest.ini` out of `BACKEND_ROOT_RE` → 1 red, the pytest.ini case;
* the unknown-root branch replaced with `if false` → 1 red,
  `test_an_unrecognised_root_file_runs_every_gate` — the one that keeps the NEXT
  root-level file from inheriting this blind spot;
* `INERT_ROOT_RE` made to match everything → 1 red, the same unknown-root test,
  and only that one. The known lists are counted independently of the inert
  filter, so an over-broad "safe" list can swallow unrecognised files but not
  package-lock.json or pytest.ini. That is by construction, not by luck: keep
  it that way if the classifier is ever restructured;
* the backend gate changed to re-derive `TOUCHES_BACKEND -gt 0` instead of
  reading `RUN_BACKEND` → 1 red, the seam test. Without it the classify line
  could stay right while the gate it describes quietly drifted.

From a worktree (`TestFromAWorktree`)
-------------------------------------
Also 2026-09-11: a push from `.claude/worktrees/*` was refused twice as "a model
changed without a migration" by a commit that touched no model. The hook read
`.prepush.env` from the worktree, where the gitignored file does not exist, so
PYTHON_BIN fell back to a bare `python` without Django; the worktree has no
`backend/.env` either, so no SECRET_KEY; and the makemigrations output went to
/dev/null, so both read as a migration problem. These run the real hook body in
a throwaway repository with a real worktree and a fake interpreter — no Django,
no network, and git isolated from this machine's config (the hook runs pytest
itself, and git may export GIT_DIR into it).

The hook and scripts/run-gates.sh (2026-09-30)
----------------------------------------------
The gate logic moved out of the heredoc into `scripts/run-gates.sh`, so a
session can run what a push would. The heredoc now only turns git's stdin into
PREPUSH_CHANGED and execs the runner; every test above still goes through the
heredoc, so the seam is unchanged. `TestJestSelection` pins what sends jest to a
full run instead of `--findRelatedTests` + `frontend/jest.always-run.txt`.
"""

import json
import os
import re
import shutil
import subprocess
import sys
from pathlib import Path

import pytest

REPO_ROOT = Path(__file__).resolve().parents[2]
GENERATOR = REPO_ROOT / "scripts" / "install-hooks.sh"
RUNNER = REPO_ROOT / "scripts" / "run-gates.sh"
READERS = REPO_ROOT / "backend" / "tests" / "reads-outside-backend.txt"


def _hook_body() -> str:
    """The pre-push heredoc, exactly as the installer would write it."""
    src = GENERATOR.read_text(encoding="utf-8")
    m = re.search(
        r"^cat > \"\$HOOKS_DIR/pre-push\" << 'EOF'\n(.*?)^EOF$",
        src,
        re.S | re.M,
    )
    assert m, f"could not find the pre-push heredoc in {GENERATOR}"
    return m.group(1)


@pytest.fixture(scope="module")
def hook(tmp_path_factory):
    path = tmp_path_factory.mktemp("hook") / "pre-push"
    path.write_text(_hook_body(), encoding="utf-8")
    path.chmod(0o755)
    return path


def _classify(hook, changed: list[str]) -> dict[str, int]:
    env = {k: v for k, v in os.environ.items() if k not in ("SKIP_PREPUSH",)}
    env["PREPUSH_CHANGED"] = "\n".join(changed)
    env["PREPUSH_CLASSIFY_ONLY"] = "1"
    proc = subprocess.run(
        ["bash", str(hook)],
        cwd=REPO_ROOT,
        env=env,
        capture_output=True,
        text=True,
        timeout=60,
    )
    assert proc.returncode == 0, f"hook exited {proc.returncode}\n{proc.stdout}\n{proc.stderr}"
    m = re.search(r"^classify: core=(\d) frontend=(\d) backend=(\d)$", proc.stdout, re.M)
    assert m, f"no classify line in hook output:\n{proc.stdout}"
    return {"core": int(m.group(1)), "frontend": int(m.group(2)), "backend": int(m.group(3))}


NONE = {"core": 0, "frontend": 0, "backend": 0}
JS = {"core": 1, "frontend": 1, "backend": 0}
BACKEND = {"core": 0, "frontend": 0, "backend": 1}
ALL = {"core": 1, "frontend": 1, "backend": 1}


class TestTheSeamIsReal:
    def test_the_generator_has_a_pre_push_hook(self):
        """Non-vacuity: every test below is meaningless over an empty body."""
        body = _hook_body()
        assert "scripts/run-gates.sh" in body and "PREPUSH_CHANGED" in body
        runner = RUNNER.read_text(encoding="utf-8")
        assert "RUN_CORE" in runner and "PREPUSH_CLASSIFY_ONLY" in runner
        assert len(runner.splitlines()) > 100

    def test_the_gates_read_the_same_variables_the_classifier_prints(self):
        """If a gate re-derived its own condition, this file would be testing a
        copy of the rule rather than the rule."""
        body = RUNNER.read_text(encoding="utf-8")
        for var in ("RUN_CORE", "RUN_FRONTEND", "RUN_BACKEND"):
            assert re.search(rf'^if \[ "\${var}" = 1 \](; then| \|\|)', body, re.M), (
                f"no gate reads {var} directly"
            )


class TestRootLevelFiles:
    def test_a_lockfile_only_push_runs_the_js_gates(self, hook):
        """The 2026-09-11 push, exactly."""
        assert _classify(hook, ["package-lock.json"]) == JS

    @pytest.mark.parametrize("name", ["package.json", ".nvmrc"])
    def test_the_other_js_tree_files_run_the_js_gates(self, hook, name):
        assert _classify(hook, [name]) == JS

    @pytest.mark.parametrize("name", ["pytest.ini", "conftest.py"])
    def test_a_pytest_config_change_runs_the_backend_gate(self, hook, name):
        assert _classify(hook, [name]) == BACKEND

    def test_an_unrecognised_root_file_runs_every_gate(self, hook):
        """Fail closed. A root file nobody has classified cannot be assumed inert."""
        assert _classify(hook, ["tsconfig.base.json"]) == ALL

    @pytest.mark.parametrize(
        "name",
        ["README.md", "CLAUDE.md", ".dockerignore", "docker-compose.yml", ".gitignore"],
    )
    def test_documentation_and_deployment_files_run_nothing(self, hook, name):
        """The inverse assertion. A hook that runs ten minutes of tests for a
        README edit is a hook people learn to skip."""
        assert _classify(hook, [name]) == NONE

    def test_an_inert_file_does_not_hide_a_real_one_beside_it(self, hook):
        """`e4683f3` pushed README.md, README.en.md and package-lock.json
        together. An inert file in the set must not carry the rest with it."""
        assert _classify(hook, ["README.md", "package-lock.json"]) == JS


class TestTheExistingPrefixesStillWork:
    """The three prefix rules predate this file; pin them so the refactor that
    folded them into RUN_* variables cannot have changed them."""

    def test_frontend(self, hook):
        assert _classify(hook, ["frontend/app/page.tsx"]) == {
            "core": 0, "frontend": 1, "backend": 0,
        }

    def test_core_implies_frontend(self, hook):
        assert _classify(hook, ["packages/core/src/index.ts"]) == JS

    def test_backend(self, hook):
        assert _classify(hook, ["backend/apps/souls/models.py"]) == BACKEND

    def test_top_level_directories_outside_the_code_roots_are_not_gated(self, hook):
        """Deliberate — see the hook's comment. docs/ must not trigger a full run."""
        assert _classify(hook, ["docs/README.md", "scripts/status.sh"]) == NONE

    @pytest.mark.parametrize(
        "name", ["scripts/run-gates.sh", "scripts/install-hooks.sh", "scripts/gate-lock.sh"]
    )
    def test_the_gate_machinery_runs_the_backend_suite_that_tests_it(self, hook, name):
        """This file is the machinery's only test, and it reads the scripts
        rather than importing them. Until 2026-09-30 a push that changed only
        the hook generator ran no gate at all."""
        assert _classify(hook, [name]) == BACKEND


# Everything the hook reads from the environment, plus git's own variables:
# none of this machine's settings may leak into the throwaway repository.
_STRIPPED = (
    "SKIP_PREPUSH", "PREPUSH_CHANGED", "PREPUSH_CLASSIFY_ONLY", "SECRET_KEY",
    "DEBUG", "PYTHON_BIN", "RUFF_BIN", "DATABASE_URL", "REDIS_URL", "PYTEST_PREPUSH_ARGS",
    # The hook's own hand-off to run-gates.sh. These tests run inside a push, and
    # a push to main must not make every "selective" assertion here read full.
    "PREPUSH_RANGE", "PREPUSH_TO_MAIN", "GATES_FULL",
    # Exported by a full run to the pytest that runs these very tests.
    "SOULLEDGER_SQLITE_TEMPLATE",
)


def _clean_env(**extra) -> dict[str, str]:
    # GATES_*: the outer run's settings (a delegated run sets GATES_IN_REMOTE, GATES_PG_URL …) must not
    # reach the throwaway gates these tests start — inside one, they took the PostgreSQL path (2026-10-28).
    env = {k: v for k, v in os.environ.items()
           if k not in _STRIPPED and not k.startswith(("GIT_", "GATES_"))}
    env.update(GIT_CONFIG_GLOBAL=os.devnull, GIT_CONFIG_NOSYSTEM="1", **extra)
    return env


def _git(cwd: Path, *args: str) -> None:
    subprocess.run(
        ["git", "-c", "user.name=t", "-c", "user.email=t@t", *args],
        cwd=cwd, env=_clean_env(), check=True, capture_output=True, text=True, timeout=60,
    )


@pytest.fixture
def checkouts(tmp_path):
    """A throwaway repository and one worktree of it — the .claude/worktrees/* shape."""
    main = tmp_path / "main"
    (main / "backend").mkdir(parents=True)
    (main / "backend" / "manage.py").write_text("")
    (main / "scripts").mkdir()
    for name in ("install-hooks.sh", "run-gates.sh", "gate-lock.sh"):
        (main / "scripts" / name).write_text((GENERATOR.parent / name).read_text(encoding="utf-8"))
    (main / "backend" / "tests").mkdir()
    (main / "backend" / "tests" / READERS.name).write_text(READERS.read_text(encoding="utf-8"))
    (main / ".gitignore").write_text(".prepush.env\nbackend/.env\n")
    _git(main, "init", "-q", "-b", "main")
    _git(main, "add", "-A")
    _git(main, "commit", "-q", "-m", "init")
    wt = tmp_path / "wt"
    _git(main, "worktree", "add", "-q", str(wt), "-b", "wt")
    assert (wt / ".git").is_file(), "precondition: a worktree's .git is a file"
    return main, wt


def _fake_python(tmp_path: Path, body: str) -> str:
    """Stands in for PYTHON_BIN. The hook's first use of it is makemigrations."""
    path = tmp_path / "fake-python"
    path.write_text("#!/bin/bash\n" + body)
    path.chmod(0o755)
    return str(path)


def _run(hook, cwd: Path, changed: list[str], **extra) -> subprocess.CompletedProcess:
    return subprocess.run(
        ["bash", str(hook)],
        cwd=cwd, env=_clean_env(PREPUSH_CHANGED="\n".join(changed), **extra),
        capture_output=True, text=True, timeout=60,
    )


def _backend_gate(hook, cwd: Path, python: str, **extra) -> subprocess.CompletedProcess:
    return _run(
        hook, cwd, ["backend/x.py"], PYTHON_BIN=python, RUFF_BIN=shutil.which("true"), **extra,
    )


class TestFromAWorktree:
    def test_the_main_checkouts_prepush_env_is_loaded(self, hook, checkouts):
        """The file is gitignored, so a worktree never has its own copy."""
        main, wt = checkouts
        (main / ".prepush.env").write_text('echo "MARK: main copy sourced"\n')
        proc = _run(hook, wt, ["docs/x.md"], PREPUSH_CLASSIFY_ONLY="1")
        assert proc.returncode == 0, proc.stdout + proc.stderr
        assert "MARK: main copy sourced" in proc.stdout, (
            f"a worktree push did not load the main checkout's .prepush.env:\n{proc.stdout}"
        )

    def test_a_worktrees_own_copy_still_wins(self, hook, checkouts):
        main, wt = checkouts
        (main / ".prepush.env").write_text('echo "MARK: main copy sourced"\n')
        (wt / ".prepush.env").write_text('echo "MARK: worktree copy sourced"\n')
        proc = _run(hook, wt, ["docs/x.md"], PREPUSH_CLASSIFY_ONLY="1")
        assert "MARK: worktree copy sourced" in proc.stdout
        assert "MARK: main copy sourced" not in proc.stdout

    def test_without_backend_env_the_gates_get_cis_secret_key(self, hook, checkouts, tmp_path):
        """No backend/.env → settings.py refuses to load. CI has no .env either."""
        _, wt = checkouts
        py = _fake_python(tmp_path, 'echo "SEEN SECRET_KEY=${SECRET_KEY:-unset}"; exit 1\n')
        proc = _backend_gate(hook, wt, py)
        assert "SEEN SECRET_KEY=ci-test-key-not-for-production-32-bytes-min" in proc.stdout, proc.stdout

    def test_a_checkout_with_backend_env_is_left_to_it(self, hook, checkouts, tmp_path):
        """The inverse: settings.py loads backend/.env itself, so nothing is exported."""
        main, _ = checkouts
        (main / "backend" / ".env").write_text("SECRET_KEY=from-dotenv\n")
        py = _fake_python(tmp_path, 'echo "SEEN SECRET_KEY=${SECRET_KEY:-unset}"; exit 1\n')
        proc = _backend_gate(hook, main, py)
        assert "SEEN SECRET_KEY=unset" in proc.stdout, proc.stdout

    def test_a_secret_key_already_set_is_not_replaced(self, hook, checkouts, tmp_path):
        _, wt = checkouts
        py = _fake_python(tmp_path, 'echo "SEEN SECRET_KEY=${SECRET_KEY:-unset}"; exit 1\n')
        proc = _backend_gate(hook, wt, py, SECRET_KEY="mine")
        assert "SEEN SECRET_KEY=mine" in proc.stdout, proc.stdout

    def test_an_interpreter_without_django_is_not_called_a_missing_migration(
        self, hook, checkouts, tmp_path
    ):
        """The 2026-09-11 refusal, exactly."""
        main, _ = checkouts
        py = _fake_python(
            tmp_path, "echo \"ModuleNotFoundError: No module named 'django'\" >&2; exit 1\n"
        )
        proc = _backend_gate(hook, main, py)
        assert proc.returncode == 1
        assert "a model changed" not in proc.stdout, (
            f"a failure to run was reported as a missing migration:\n{proc.stdout}"
        )
        assert "could not run" in proc.stdout
        assert "ModuleNotFoundError" in proc.stdout, "the actual error was not shown"

    def test_a_real_missing_migration_is_still_named_as_one(self, hook, checkouts, tmp_path):
        """The inverse: the gate this replaced must still say what it said when true."""
        main, _ = checkouts
        py = _fake_python(
            tmp_path,
            "printf \"Migrations for 'souls':\\n  souls/migrations/0099_auto.py\\n\"; exit 1\n",
        )
        proc = _backend_gate(hook, main, py)
        assert proc.returncode == 1
        assert "a model changed without a migration" in proc.stdout, proc.stdout
        assert "souls/migrations/0099_auto.py" in proc.stdout

    def test_the_installer_runs_from_a_worktree(self, checkouts):
        """`.git` is a file there, so `$ROOT_DIR/.git/hooks` is not a directory."""
        main, wt = checkouts
        proc = subprocess.run(
            ["bash", str(wt / "scripts" / "install-hooks.sh")],
            cwd=wt, env=_clean_env(), capture_output=True, text=True, timeout=60,
        )
        assert proc.returncode == 0, proc.stdout + proc.stderr
        installed = main / ".git" / "hooks" / "pre-push"
        assert installed.read_text(encoding="utf-8") == _hook_body()
        assert os.access(installed, os.X_OK)
        # The copy a branch without scripts/run-gates.sh falls back to.
        copy = main / ".git" / "hooks" / "soulledger-gates" / "run-gates.sh"
        assert copy.read_text(encoding="utf-8") == RUNNER.read_text(encoding="utf-8")


def _fake_venv(checkout: Path, python_body: str) -> Path:
    """A `backend/.venv` whose python prints a marker; its ruff always passes."""
    bin_dir = checkout / "backend" / ".venv" / "bin"
    bin_dir.mkdir(parents=True)
    (bin_dir / "python").write_text("#!/bin/bash\n" + python_body)
    (bin_dir / "ruff").write_text("#!/bin/bash\nexit 0\n")
    for exe in ("python", "ruff"):
        (bin_dir / exe).chmod(0o755)
    return bin_dir


def _path_with_a_bare_python(tmp_path: Path) -> str:
    """PATH with a `python` on it that announces itself — the interpreter the
    hook used to fall back to, and must not reach for any more."""
    bare = tmp_path / "bare-bin"
    bare.mkdir()
    (bare / "python").write_text('#!/bin/bash\necho "BARE PYTHON USED"; exit 1\n')
    (bare / "python").chmod(0o755)
    return f"{bare}:{os.environ.get('PATH', '')}"


class TestTheProjectVenv:
    """The backend gates run in `backend/.venv` (user decision, 2026-09-14).

    Before, the interpreter was `PYTHON_BIN` from `.prepush.env`, else a bare
    `python` on PATH. On this machine that was the shared conda `vision`
    environment — Python 3.12 and the dependency versions from before
    `d561340` — while the image and CI install `requirements.lock` on 3.11. A
    green push measured a different dependency set from the one that ships;
    and the bare-`python` fallback is the 2026-09-11 refusal above.
    """

    def test_the_checkouts_venv_is_used_without_any_setting(self, hook, checkouts, tmp_path):
        main, _ = checkouts
        _fake_venv(main, 'echo "SEEN VENV PYTHON"; exit 1\n')
        proc = _run(hook, main, ["backend/x.py"], PATH=_path_with_a_bare_python(tmp_path))
        assert "SEEN VENV PYTHON" in proc.stdout, proc.stdout + proc.stderr
        assert "BARE PYTHON USED" not in proc.stdout
        assert "backend/.venv" in proc.stdout, "the run does not say which interpreter it used"

    def test_a_worktree_uses_the_main_checkouts_venv(self, hook, checkouts, tmp_path):
        """`.venv` is gitignored, so a worktree has none — same as `.prepush.env`."""
        main, wt = checkouts
        _fake_venv(main, 'echo "SEEN MAIN VENV PYTHON"; exit 1\n')
        proc = _run(hook, wt, ["backend/x.py"], PATH=_path_with_a_bare_python(tmp_path))
        assert "SEEN MAIN VENV PYTHON" in proc.stdout, proc.stdout + proc.stderr

    def test_a_worktrees_own_venv_wins(self, hook, checkouts, tmp_path):
        main, wt = checkouts
        _fake_venv(main, 'echo "SEEN MAIN VENV PYTHON"; exit 1\n')
        _fake_venv(wt, 'echo "SEEN WORKTREE VENV PYTHON"; exit 1\n')
        proc = _run(hook, wt, ["backend/x.py"])
        assert "SEEN WORKTREE VENV PYTHON" in proc.stdout, proc.stdout
        assert "SEEN MAIN VENV PYTHON" not in proc.stdout

    def test_python_bin_still_overrides_the_venv_and_says_so(self, hook, checkouts, tmp_path):
        main, _ = checkouts
        _fake_venv(main, 'echo "SEEN VENV PYTHON"; exit 1\n')
        py = _fake_python(tmp_path, 'echo "SEEN OVERRIDE PYTHON"; exit 1\n')
        proc = _backend_gate(hook, main, py)
        assert "SEEN OVERRIDE PYTHON" in proc.stdout, proc.stdout
        assert "SEEN VENV PYTHON" not in proc.stdout
        assert "PYTHON_BIN" in proc.stdout, "an override that is not announced is invisible"

    def test_no_venv_and_no_override_refuses_with_the_command_that_builds_one(
        self, hook, checkouts, tmp_path
    ):
        main, _ = checkouts
        proc = _run(hook, main, ["backend/x.py"], PATH=_path_with_a_bare_python(tmp_path))
        assert proc.returncode == 1, proc.stdout
        assert "BARE PYTHON USED" not in proc.stdout, (
            f"the hook fell back to whatever `python` is on PATH:\n{proc.stdout}"
        )
        assert "backend/.venv" in proc.stdout
        assert "uv venv --python 3.11" in proc.stdout
        assert "requirements.lock" in proc.stdout


# ── The migration round trips, and what pytest is actually invoked with ─────
#
# 2026-09-29: the 26 tests carrying the `migration` marker cost 813 s of a
# 23-minute backend run. Pre-push now runs `-m "not migration"` unless the push
# touches something those tests exercise, and `--no-cov` always (the coverage
# floor is CI's). Mutation-checked when written: see the report of that change.


def _classify_migration(hook, changed: list[str]) -> int:
    env = {k: v for k, v in os.environ.items() if k not in ("SKIP_PREPUSH",)}
    env["PREPUSH_CHANGED"] = "\n".join(changed)
    env["PREPUSH_CLASSIFY_ONLY"] = "1"
    proc = subprocess.run(
        ["bash", str(hook)], cwd=REPO_ROOT, env=env, capture_output=True, text=True, timeout=60,
    )
    assert proc.returncode == 0, proc.stdout + proc.stderr
    m = re.search(r"^classify-migration: migration=(\d)$", proc.stdout, re.M)
    assert m, f"no classify-migration line in hook output:\n{proc.stdout}"
    return int(m.group(1))


class TestMigrationRoundTripsRunOnlyWhenRelevant:
    @pytest.mark.parametrize(
        "changed",
        [
            ["backend/apps/realms/migrations/0018_split_greek_from_european.py"],
            ["backend/tests/migration_roundtrip.py"],
            ["backend/tests/conftest.py"],
            ["conftest.py"],
            ["pytest.ini"],
            ["backend/requirements.lock"],
            # A file holding a round-trip test, found by its content: the
            # fixture user and the hand-marked module.
            ["backend/tests/test_greek_civilization.py"],
            ["backend/tests/test_migration_reverse_scope.py"],
            # Fail closed on a root file nobody has classified.
            ["tsconfig.base.json"],
            # One relevant file among irrelevant ones still counts.
            ["backend/apps/souls/views.py", "backend/apps/souls/migrations/0001_initial.py"],
        ],
    )
    def test_a_change_the_round_trips_exercise_runs_them(self, hook, changed):
        assert _classify_migration(hook, changed) == 1

    @pytest.mark.parametrize(
        "changed",
        [
            ["backend/apps/souls/views.py"],
            ["backend/apps/souls/models.py"],
            ["backend/tests/test_audit_assertions_are_not_vacuous.py"],
            # No backend gate at all -> no migration tests either.
            ["frontend/app/page.tsx"],
            ["README.md"],
        ],
    )
    def test_a_change_they_cannot_see_skips_them(self, hook, changed):
        """The inverse: without it, a rule that always says 1 passes the test above."""
        assert _classify_migration(hook, changed) == 0

    def test_the_marker_names_the_tests_the_rule_is_about(self):
        """The hook finds round-trip tests by `migration_round_trip` or
        `mark.migration` in the file. If every such test were not actually
        marked, `-m "not migration"` would keep running it and the rule above
        would be about nothing; if the marker reached tests outside those
        files, the grep would miss a file whose tests are being skipped."""
        tests_dir = REPO_ROOT / "backend" / "tests"
        holders = {
            p.name for p in tests_dir.glob("test_*.py")
            if re.search(r"migration_round_trip|mark\.migration", p.read_text(encoding="utf-8"))
        }
        proc = subprocess.run(
            [sys.executable, "-m", "pytest", "--collect-only", "-qq", "--no-cov",
             "-p", "no:cacheprovider", "-m", "migration",
             "-c", str(REPO_ROOT / "pytest.ini"), str(tests_dir)],
            cwd=REPO_ROOT, capture_output=True, text=True, timeout=300,
            env={**os.environ, "PYTHONPATH": str(REPO_ROOT / "backend")},
        )
        assert proc.returncode == 0, proc.stdout + proc.stderr
        marked = [line for line in proc.stdout.splitlines() if "::" in line]
        marked_files = {line.split("::")[0].rsplit("/", 1)[-1] for line in marked}
        assert len(marked) >= 26, f"only {len(marked)} tests carry the marker:\n{proc.stdout}"
        assert marked_files <= holders, f"marked outside the files the hook greps: {marked_files - holders}"
        assert "test_migration_roundtrip.py" in marked_files


def _classify_meta(hook, changed: list[str], **extra) -> int:
    env = {k: v for k, v in os.environ.items() if k not in ("SKIP_PREPUSH", "GATES_FULL")}
    env.update(PREPUSH_CHANGED="\n".join(changed), PREPUSH_CLASSIFY_ONLY="1", **extra)
    proc = subprocess.run(
        ["bash", str(hook)], cwd=REPO_ROOT, env=env, capture_output=True, text=True, timeout=60,
    )
    assert proc.returncode == 0, proc.stdout + proc.stderr
    m = re.search(r"^classify-meta: meta=(\d)$", proc.stdout, re.M)
    assert m, f"no classify-meta line in hook output:\n{proc.stdout}"
    return int(m.group(1))


class TestSuiteAboutTheSuiteRunsOnlyWhenRelevant:
    """test_collection_scope.py and test_audit_assertions_are_not_vacuous.py each
    start a second pytest. They are skipped unless what they guard changed."""

    @pytest.mark.parametrize(
        "changed",
        [
            ["pytest.ini"],
            ["conftest.py"],
            ["backend/tests/conftest.py"],
            ["backend/apps/social/tests/conftest.py"],
            ["backend/requirements.lock"],
            ["backend/config/settings.py"],
            ["backend/apps/audit/oncommit_guard.py"],
            ["backend/apps/audit/models.py"],
            ["backend/apps/tenants/models.py"],
            ["backend/apps/core/lock_join_guard.py"],
            ["backend/apps/souls/tests.py"],
            ["backend/tests/test_collection_scope.py"],
            ["backend/tests/test_audit_assertions_are_not_vacuous.py"],
            ["tsconfig.base.json"],
            ["backend/apps/souls/views.py", "pytest.ini"],
        ],
    )
    def test_a_change_they_guard_runs_them(self, hook, changed):
        assert _classify_meta(hook, changed) == 1

    @pytest.mark.parametrize(
        "changed",
        [
            ["backend/apps/souls/views.py"],
            ["backend/apps/souls/models.py"],
            ["backend/tests/test_auth_account.py"],
            ["frontend/app/page.tsx"],
            ["README.md"],
        ],
    )
    def test_a_change_they_cannot_see_skips_them(self, hook, changed):
        """The inverse: without it, a rule that always says 1 passes the test above."""
        assert _classify_meta(hook, changed) == 0

    def test_a_full_run_runs_them(self, hook):
        assert _classify_meta(hook, ["backend/apps/souls/views.py"], GATES_FULL="1") == 1

    def test_a_push_to_main_alone_does_not(self, hook):
        """2026-10-24: a push to main is selective like any other."""
        assert _classify_meta(hook, ["backend/apps/souls/views.py"], PREPUSH_TO_MAIN="1") == 0

    def test_the_names_the_rule_skips_are_real_files(self):
        """A renamed test would be silently 'ignored' by a path that no longer exists,
        and run on every push again — or worse, the rule would name nothing."""
        body = RUNNER.read_text(encoding="utf-8")
        block = re.search(r"META_TESTS='([^']*)'", body)
        assert block, "META_TESTS not found in run-gates.sh"
        names = block.group(1).split()
        assert len(names) == 2
        for name in names:
            assert (REPO_ROOT / name).is_file(), name


@pytest.fixture
def fake_backend(tmp_path):
    """PYTHON_BIN whose `-m pytest` prints its argv and SECRET_KEY and passes;
    `manage.py` passes; anything else (the service probe, the port picker) is
    the real python3, so the hook reaches its pytest line for real."""
    py = tmp_path / "fake-python"
    py.write_text(
        "#!/bin/bash\n"
        'case "$1" in\n'
        "  manage.py) exit 0 ;;\n"
        # One line: the hook keeps only pytest's last four.
        '  -m) if [ "$2" = pytest ]; then shift 2; '
        'echo "PYTEST TEMPLATE=${SOULLEDGER_SQLITE_TEMPLATE:-unset} SECRET_KEY=$SECRET_KEY ARGS=$(printf \'[%s]\' "$@")"; exit 0; fi ;;\n'
        "esac\n"
        'exec python3 "$@"\n'
    )
    py.chmod(0o755)
    if not shutil.which("redis-server") and not os.environ.get("REDIS_URL"):
        pytest.skip("the hook refuses without redis-server or a reachable REDIS_URL")
    return str(py)


def _pytest_line(hook, cwd, python, changed):
    proc = _run(
        hook, cwd, changed, PYTHON_BIN=python, RUFF_BIN=shutil.which("true"),
        REDIS_URL=os.environ.get("REDIS_URL", ""),
    )
    assert proc.returncode == 0, proc.stdout + proc.stderr
    m = re.search(r"^PYTEST TEMPLATE=\S* SECRET_KEY=(\S*) ARGS=(.*)$", proc.stdout, re.M)
    assert m, f"pytest was never invoked:\n{proc.stdout}"
    return re.findall(r"\[([^\]]*)\]", m.group(2)), m.group(1)


def _template_switch(hook, cwd, python, changed, **extra):
    proc = _run(
        hook, cwd, changed, PYTHON_BIN=python, RUFF_BIN=shutil.which("true"),
        REDIS_URL=os.environ.get("REDIS_URL", ""), **extra,
    )
    assert proc.returncode == 0, proc.stdout + proc.stderr
    m = re.search(r"^PYTEST TEMPLATE=(\S*) ", proc.stdout, re.M)
    assert m, f"pytest was never invoked:\n{proc.stdout}"
    return m.group(1)


class TestWhatPytestIsInvokedWith:
    def test_each_test_has_a_time_limit_that_ends_its_worker(self, hook, checkouts, fake_backend):
        """2026-10-19 a run hung for hours holding the gate lock, and every session waited."""
        main, _ = checkouts
        args, _ = _pytest_line(hook, main, fake_backend, ["backend/apps/souls/views.py"])
        joined = " ".join(args)
        assert "-o faulthandler_timeout=300" in joined, args
        assert "-o faulthandler_exit_on_timeout=true" in joined, args

    def test_the_tests_keep_their_order_and_the_slowest_are_named(self, hook, checkouts, fake_backend):
        """No --ff. --dist worksteal is on (2026-10-29): plain -n left the slow migration round trips on one
        worker at the end; the order dependence that made it red on 10-28 was fixed in the root conftest."""
        main, _ = checkouts
        args, _ = _pytest_line(hook, main, fake_backend, ["backend/apps/souls/views.py"])
        assert "--ff" not in args and "--failed-first" not in args, args
        assert "--durations=30" in args and "--durations-min=5" in args, args
        # The stand-in python has no xdist, so -n never reaches this line here: read the script for it.
        text = (REPO_ROOT / "scripts" / "run-gates.sh").read_text(encoding="utf-8")
        assert 'XDIST="-n $PYTEST_WORKERS --dist worksteal"' in text

    def test_an_ordinary_run_reuses_the_sqlite_template(self, hook, checkouts, fake_backend):
        main, _ = checkouts
        assert _template_switch(hook, main, fake_backend, ["backend/apps/souls/views.py"]) == "unset"

    def test_a_full_run_migrates_for_real_and_checks_the_template(self, hook, checkouts, fake_backend):
        main, _ = checkouts
        assert _template_switch(hook, main, fake_backend, ["backend/apps/souls/views.py"], GATES_FULL="1") == "0"

    def test_a_push_to_main_reuses_the_template(self, hook, checkouts, fake_backend):
        main, _ = checkouts
        assert _template_switch(hook, main, fake_backend, ["backend/apps/souls/views.py"], PREPUSH_TO_MAIN="1") == "unset"

    def test_an_ordinary_backend_change_skips_the_round_trips_and_coverage(
        self, hook, checkouts, fake_backend
    ):
        main, _ = checkouts
        args, _ = _pytest_line(hook, main, fake_backend, ["backend/apps/souls/views.py"])
        assert "--no-cov" in args
        i = args.index("-m")
        assert args[i + 1] == "not migration", args

    def test_a_migration_change_runs_the_round_trips(self, hook, checkouts, fake_backend):
        main, _ = checkouts
        args, _ = _pytest_line(
            hook, main, fake_backend, ["backend/apps/souls/migrations/0099_x.py"]
        )
        assert "-m" not in args and "not migration" not in args, args
        assert "--no-cov" in args

    def test_an_ordinary_backend_change_leaves_out_the_suite_about_the_suite(
        self, hook, checkouts, fake_backend
    ):
        main, _ = checkouts
        args, _ = _pytest_line(hook, main, fake_backend, ["backend/apps/souls/views.py"])
        assert "--ignore=tests/test_collection_scope.py" in args, args
        assert "--ignore=tests/test_audit_assertions_are_not_vacuous.py" in args, args

    def test_a_change_outside_backend_drops_them_from_the_readers_too(
        self, hook, checkouts, fake_backend
    ):
        """test_collection_scope.py is a `*` reader: it used to run on every push.
        (A docs change: the throwaway checkout has no frontend/ for jest to run in.)"""
        main, _ = checkouts
        args, _ = _pytest_line(hook, main, fake_backend, ["docs/notes.md"])
        assert "tests/test_collection_scope.py" not in args, args
        assert any(a.startswith("tests/") for a in args), f"no reader ran at all: {args}"

    def test_a_pytest_config_change_keeps_them(self, hook, checkouts, fake_backend):
        main, _ = checkouts
        args, _ = _pytest_line(hook, main, fake_backend, ["pytest.ini"])
        assert not [a for a in args if a.startswith("--ignore=")], args

    def test_pytest_gets_the_long_test_key_even_over_backend_env(
        self, hook, checkouts, fake_backend
    ):
        """backend/.env may hold a short key (the main checkout's was 20 bytes);
        pytest.ini makes PyJWT's short-key warning an error."""
        main, _ = checkouts
        (main / "backend" / ".env").write_text("SECRET_KEY=short\n")
        _, key = _pytest_line(hook, main, fake_backend, ["backend/apps/souls/views.py"])
        assert key == "ci-test-key-not-for-production-32-bytes-min"
        assert len(key.encode()) >= 32


# ── jest: selective unless a rule says full (2026-09-30) ────────────────────
#
# The runner prints `classify-jest: full=<0|1>` and one `full because:` line per
# rule that matched. Mutation-checked when written: see the report of that change.


def _classify_jest(hook, changed: list[str], **extra) -> tuple[int, str]:
    env = {k: v for k, v in os.environ.items() if k not in _STRIPPED}
    env.update(PREPUSH_CHANGED="\n".join(changed), PREPUSH_CLASSIFY_ONLY="1", **extra)
    proc = subprocess.run(
        ["bash", str(hook)], cwd=REPO_ROOT, env=env, capture_output=True, text=True, timeout=60,
    )
    assert proc.returncode == 0, proc.stdout + proc.stderr
    m = re.search(r"^classify-jest: full=(\d)$", proc.stdout, re.M)
    assert m, f"no classify-jest line in hook output:\n{proc.stdout}"
    return int(m.group(1)), proc.stdout


class TestJestSelection:
    @pytest.mark.parametrize(
        "changed",
        [
            ["frontend/app/page.tsx"],
            ["packages/core/src/index.ts"],
            ["frontend/src/__tests__/suiteShape.test.ts"],
            ["backend/apps/souls/views.py"],
            # 2026-10-27: a language pack is traced through its static imports.
            ["packages/core/messages/en.json"],
            ["frontend/app/page.tsx", "packages/core/messages/egy.json"],
        ],
    )
    def test_an_ordinary_source_change_is_selective(self, hook, changed):
        """The inverse of everything below: a rule set that always said full
        would pass every other test in this class."""
        assert _classify_jest(hook, changed)[0] == 0

    @pytest.mark.parametrize(
        "changed",
        [
            ["frontend/jest.config.js"],
            ["frontend/tsconfig.json"],
            ["packages/core/package.json"],
            ["package-lock.json"],
            ["frontend/src/__tests__/support/egyVocabulary.json"],
            ["scripts/run-gates.sh"],
            ["scripts/install-hooks.sh"],
            # A path that no longer exists: deleted, or the old half of a rename.
            ["frontend/src/components/NoSuchComponent.tsx"],
            ["tsconfig.base.json"],
            # One matching file among ordinary ones still counts.
            ["frontend/app/page.tsx", "packages/core/openapi/schema.yml"],
        ],
    )
    def test_what_jest_cannot_trace_forces_a_full_run_and_says_why(self, hook, changed):
        full, out = _classify_jest(hook, changed)
        assert full == 1, out
        assert "full because:" in out

    def test_gates_full_forces_it(self, hook):
        assert _classify_jest(hook, ["frontend/app/page.tsx"], GATES_FULL="1")[0] == 1

    def test_gates_full_0_does_not_force_selective(self, hook):
        """There is no way to force a selective run. GATES_FULL=0 is not one."""
        full, out = _classify_jest(
            hook, ["frontend/tsconfig.json"], GATES_FULL="0"
        )
        assert full == 1, out
        full, _ = _classify_jest(hook, ["frontend/app/page.tsx"], GATES_FULL="0", PREPUSH_TO_MAIN="1")
        assert full == 0  # 2026-10-24: main is selective too

    def test_the_runner_names_the_file_that_forced_it(self, hook):
        _, out = _classify_jest(hook, ["frontend/app/page.tsx", "packages/core/openapi/schema.yml"])
        assert "data file" in out and "packages/core/openapi/schema.yml" in out


def _classify_app_jest(hook, changed: list[str], **extra) -> tuple[int, str]:
    _, out = _classify_jest(hook, changed, **extra)
    m = re.search(r"^classify-app-jest: full=(\d)$", out, re.M)
    assert m, f"no classify-app-jest line in hook output:\n{out}"
    return int(m.group(1)), out


class TestAppJestSelection:
    """mobile/ and mobile-officer/ jest: selective like the web one (2026-10-27)."""

    @pytest.mark.parametrize(
        "changed",
        [
            ["mobile/src/navigation.tsx"],
            ["mobile-officer/src/shared.ts"],
            ["packages/core/messages/en.json"],
            ["packages/core/src/index.ts"],
            ["frontend/app/globals.css"],
        ],
    )
    def test_code_in_the_graph_is_selective(self, hook, changed):
        assert _classify_app_jest(hook, changed)[0] == 0

    @pytest.mark.parametrize(
        "changed",
        [
            ["mobile/jest.config.js"],
            ["mobile-officer/package.json"],
            ["mobile/app.json"],
            ["mobile/plugins/withBuildTuning.js"],
            ["mobile/src/locales.json"],
            ["mobile/src/NoSuchScreen.tsx"],
            ["package-lock.json"],
            ["scripts/run-gates.sh"],
            ["mobile/src/navigation.tsx", "mobile/app.json"],
        ],
    )
    def test_what_the_app_graph_cannot_trace_forces_a_full_run(self, hook, changed):
        full, out = _classify_app_jest(hook, changed)
        assert full == 1, out
        assert "app full because:" in out

    def test_gates_full_forces_it(self, hook):
        assert _classify_app_jest(hook, ["mobile/src/navigation.tsx"], GATES_FULL="1")[0] == 1


class TestCoverageOnFull:
    """A3 (2026-10-31): jest's coverageThreshold (frontend/jest.config.js: global and packages/core/src) is
    evaluated only under --coverage, and every local run passed --coverage=false — so only CI saw core's
    branches fall to 70.58% against 74. `--full` now runs web jest with coverage, and each app's
    `test:coverage` when the app defines one. A selective run stays without: a threshold is an aggregate
    over every file under its key, and the related tests leave most of those unexecuted."""

    CHANGED = "frontend/app.tsx\nmobile/src/a.ts\nmobile-officer/src/b.ts"

    def _calls(self, checkouts, tmp_path, fake_backend, *args) -> list[str]:
        main, _ = checkouts
        for d in ("frontend", "mobile/src", "mobile-officer/src"):
            (main / d).mkdir(parents=True, exist_ok=True)
        (main / "frontend" / "jest.always-run.txt").write_text("")
        for f in self.CHANGED.split("\n"):
            (main / f).write_text("")
        (main / "mobile" / "package.json").write_text('{"scripts": {"test": "jest", "test:coverage": "jest --coverage"}}\n')
        (main / "mobile-officer" / "package.json").write_text('{"scripts": {"test": "jest"}}\n')
        _git(main, "add", "-A")
        _git(main, "commit", "-q", "-m", "js areas")
        b = tmp_path / "bin"
        b.mkdir()
        log = tmp_path / "calls"
        for tool in ("npx", "npm"):
            (b / tool).write_text(f'#!/bin/bash\necho "{tool} $*" >> "{log}"\n')
            (b / tool).chmod(0o755)
        env = _clean_env(PREPUSH_CHANGED=self.CHANGED, PYTHON_BIN=fake_backend, RUFF_BIN=shutil.which("true"),
                         DATABASE_URL="sqlite:///:memory:", REDIS_URL=os.environ.get("REDIS_URL", ""))
        env["PATH"] = f"{b}:{env['PATH']}"
        proc = subprocess.run(["bash", str(main / "scripts" / "run-gates.sh"), "--prepush", *args], cwd=main,
                              env=env, capture_output=True, text=True, timeout=120)
        assert proc.returncode == 0, proc.stdout + proc.stderr
        return log.read_text().splitlines()

    def test_full_runs_web_jest_with_coverage_and_the_apps_coverage_script(self, checkouts, tmp_path, fake_backend):
        calls = self._calls(checkouts, tmp_path, fake_backend, "--full")
        (jest,) = [c for c in calls if c.startswith("npx jest ") and "--listTests" not in c]
        assert " --coverage " in f"{jest} " and "--coverage=false" not in jest, jest
        assert any(c.startswith("npm run --workspace mobile test:coverage ") for c in calls), calls
        # The officer app has no test:coverage: its plain `test` still runs, it is not skipped.
        assert any(c.startswith("npm run --workspace mobile-officer test ") for c in calls), calls

    def test_a_selective_run_stays_without_coverage(self, checkouts, tmp_path, fake_backend):
        calls = self._calls(checkouts, tmp_path, fake_backend)
        (jest,) = [c for c in calls if c.startswith("npx jest ") and "--listTests" not in c]
        assert "--coverage=false" in jest, jest
        assert not any("test:coverage" in c for c in calls), calls




def _push(hook, cwd: Path, remote_ref: str) -> subprocess.CompletedProcess:
    """Run the hook the way git does: the pushed refs on stdin, no seam."""
    head = subprocess.run(
        ["git", "rev-parse", "HEAD"], cwd=cwd, env=_clean_env(), capture_output=True, text=True,
    ).stdout.strip()
    base = subprocess.run(
        ["git", "rev-parse", "HEAD~1"], cwd=cwd, env=_clean_env(), capture_output=True, text=True,
    ).stdout.strip()
    env = _clean_env(PREPUSH_CLASSIFY_ONLY="1")
    return subprocess.run(
        ["bash", str(hook)], cwd=cwd, env=env, input=f"refs/heads/wt {head} {remote_ref} {base}\n",
        capture_output=True, text=True, timeout=60,
    )


class TestWhatTheHookHandsTheRunner:
    def _commit_a_frontend_file(self, wt: Path):
        (wt / "frontend" / "app").mkdir(parents=True)
        (wt / "frontend" / "app" / "page.tsx").write_text("export default 1\n")
        _git(wt, "add", "-A")
        _git(wt, "commit", "-q", "-m", "page")

    def test_a_push_to_main_is_selective_too(self, hook, checkouts):
        """2026-10-24 user decision: main no longer forces the full set (it cost ~15-20 min a push)."""
        _, wt = checkouts
        self._commit_a_frontend_file(wt)
        proc = _push(hook, wt, "refs/heads/main")
        assert proc.returncode == 0, proc.stdout + proc.stderr
        assert "classify: core=0 frontend=1 backend=0" in proc.stdout, proc.stdout
        assert "classify-jest: full=0" in proc.stdout

    def test_a_push_to_a_feature_branch_is_selective(self, hook, checkouts):
        _, wt = checkouts
        self._commit_a_frontend_file(wt)
        proc = _push(hook, wt, "refs/heads/feature")
        assert proc.returncode == 0, proc.stdout + proc.stderr
        assert "classify-jest: full=0" in proc.stdout, proc.stdout

    def test_a_checkout_without_the_runner_uses_the_installed_copy(self, hook, checkouts):
        main, wt = checkouts
        subprocess.run(
            ["bash", str(main / "scripts" / "install-hooks.sh")],
            cwd=main, env=_clean_env(), check=True, capture_output=True, timeout=60,
        )
        (wt / "scripts" / "run-gates.sh").unlink()
        proc = _run(hook, wt, ["frontend/app/page.tsx"], PREPUSH_CLASSIFY_ONLY="1")
        assert proc.returncode == 0, proc.stdout + proc.stderr
        assert "using the copy installed with the hook" in proc.stdout
        assert "classify: core=0 frontend=1 backend=0" in proc.stdout


class TestRunGatesOutsideAPush:
    def test_it_sees_committed_and_untracked_changes_since_base(self, checkouts):
        _, wt = checkouts
        base = subprocess.run(
            ["git", "rev-parse", "HEAD"], cwd=wt, env=_clean_env(), capture_output=True, text=True,
        ).stdout.strip()
        (wt / "backend" / "x.py").write_text("")
        _git(wt, "add", "-A")
        _git(wt, "commit", "-q", "-m", "x")
        (wt / "frontend" / "app").mkdir(parents=True)
        (wt / "frontend" / "app" / "untracked.tsx").write_text("")
        proc = subprocess.run(
            ["bash", str(wt / "scripts" / "run-gates.sh"), "--base", base],
            cwd=wt, env=_clean_env(PREPUSH_CLASSIFY_ONLY="1"),
            capture_output=True, text=True, timeout=60,
        )
        assert proc.returncode == 0, proc.stdout + proc.stderr
        assert "classify: core=0 frontend=1 backend=1" in proc.stdout, proc.stdout
        assert "classify-jest: full=0" in proc.stdout

    def test_full_flag(self, checkouts):
        _, wt = checkouts
        (wt / "frontend" / "app").mkdir(parents=True)
        (wt / "frontend" / "app" / "untracked.tsx").write_text("")
        proc = subprocess.run(
            ["bash", str(wt / "scripts" / "run-gates.sh"), "--full", "--base", "HEAD"],
            cwd=wt, env=_clean_env(PREPUSH_CLASSIFY_ONLY="1"),
            capture_output=True, text=True, timeout=60,
        )
        assert proc.returncode == 0, proc.stdout + proc.stderr
        assert "classify-jest: full=1" in proc.stdout
        assert "--full" in proc.stdout


# ── tests that read another area's files (2026-10-02) ───────────────────────
#
# The A1 workflow redesign changed only frontend/ and broke
# tests/test_workflow_preset_case_types.py, which parses WorkflowEditor.tsx;
# no frontend-only push ran it. The runner prints `classify-readers:` and one
# `backend reader:` line per selected backend test file.


def _readers(changed: list[str]) -> tuple[dict[str, int], list[str], str]:
    env = _clean_env(PREPUSH_CHANGED="\n".join(changed), PREPUSH_CLASSIFY_ONLY="1")
    proc = subprocess.run(
        ["bash", str(RUNNER)], cwd=REPO_ROOT, env=env, capture_output=True, text=True, timeout=60,
    )
    assert proc.returncode == 0, proc.stdout + proc.stderr
    m = re.search(r"^classify-readers: jest=(\d) mobile=(\d) backend=(\d+)$", proc.stdout, re.M)
    assert m, f"no classify-readers line:\n{proc.stdout}"
    files = re.findall(r"^  backend reader: (\S+)$", proc.stdout, re.M)
    assert len(files) == int(m.group(3)), proc.stdout
    return {"jest": int(m.group(1)), "mobile": int(m.group(2))}, files, proc.stdout


def _listed_readers() -> dict[str, list[str]]:
    out = {}
    for line in READERS.read_text(encoding="utf-8").splitlines():
        if line.strip() and not line.lstrip().startswith("#"):
            path, *entries = line.split()
            out[path] = entries
    return out


class TestReadersOfAnotherArea:
    def test_a_frontend_only_change_runs_the_backend_tests_that_read_it(self):
        """The 2026-10-02 miss, exactly."""
        _, files, out = _readers(["frontend/src/components/workflow/WorkflowEditor.tsx"])
        assert "tests/test_workflow_preset_case_types.py" in files, out
        assert "classify: core=0 frontend=1 backend=0" in out, "the whole backend suite must not run"

    def test_the_selection_is_exactly_the_matching_lines(self):
        """Absence as well as presence: a selector that took every line would
        pass the test above."""
        _, files, _ = _readers(["frontend/app/page.tsx"])
        want = sorted(p for p, e in _listed_readers().items() if "frontend" in e or "*" in e)
        assert sorted(files) == want
        assert "apps/ledger/test_readings.py" not in files  # reads packages/ only

    def test_a_star_line_runs_on_any_change_outside_backend(self):
        stars = sorted(p for p, e in _listed_readers().items() if e == ["*"])
        assert stars, "precondition: the list has a `*` line"
        _, files, _ = _readers(["README.md"])
        assert sorted(files) == sorted(
            p for p, e in _listed_readers().items() if "*" in e or "README.md" in e
        )
        assert set(stars) <= set(files)

    def test_a_backend_change_runs_the_whole_suite_not_the_readers(self):
        _, files, out = _readers(["backend/apps/perm/checker.py"])
        assert files == [] and "backend=1" in out

    def test_a_backend_change_runs_the_frontend_and_mobile_tests_that_read_files(self):
        """The mirror: roleForbiddenCodenamesMatchBackend reads
        backend/apps/perm/checker.py; mobile's assist test reads soul_assist."""
        areas, _, _ = _readers(["backend/apps/perm/checker.py"])
        assert areas == {"jest": 1, "mobile": 1}

    def test_an_area_running_in_full_does_not_also_run_its_readers(self):
        areas, _, _ = _readers(["frontend/app/page.tsx", "mobile/src/App.tsx"])
        assert areas == {"jest": 0, "mobile": 0}


# ── The officer app (mobile-officer/, 灵魂簿 · 官员) ────────────────────────────────
#
# A new top-level workspace is invisible to this hook until it is named: before it was, a push that
# changed only mobile-officer/ printed `core:0 frontend:0 backend:0` and ran nothing (the same hole mobile/
# once had, see run-gates.sh). The runner prints `classify-officer: officer=<0|1>`. mobile-officer/ also
# imports mobile/src's leaf modules in place, so a change under mobile/ must run it too.


def _classify_officer(hook, changed: list[str]) -> int:
    env = {k: v for k, v in os.environ.items() if k not in ("SKIP_PREPUSH",)}
    env["PREPUSH_CHANGED"] = "\n".join(changed)
    env["PREPUSH_CLASSIFY_ONLY"] = "1"
    proc = subprocess.run(
        ["bash", str(hook)], cwd=REPO_ROOT, env=env, capture_output=True, text=True, timeout=60,
    )
    assert proc.returncode == 0, proc.stdout + proc.stderr
    m = re.search(r"^classify-officer: officer=(\d)$", proc.stdout, re.M)
    assert m, f"no classify-officer line in hook output:\n{proc.stdout}"
    return int(m.group(1))


class TestTheOfficerAppIsGated:
    @pytest.mark.parametrize(
        "changed",
        [
            ["mobile-officer/src/shell.tsx"],
            ["mobile-officer/package.json"],
            # Shared in place: mobile/src's ui / theme / i18n are the officer app's too.
            ["mobile/src/ui.tsx"],
            # It consumes packages/core's sources, and the root JS files decide every install.
            ["packages/core/src/api/officer-app.ts"],
            ["package-lock.json"],
        ],
    )
    def test_these_changes_run_the_officer_gates(self, hook, changed):
        assert _classify_officer(hook, changed) == 1

    @pytest.mark.parametrize(
        "changed",
        [["backend/apps/souls/models.py"], ["frontend/app/page.tsx"], ["docs/README.md"]],
    )
    def test_unrelated_changes_do_not(self, hook, changed):
        assert _classify_officer(hook, changed) == 0

    def test_the_runner_runs_all_three_officer_gates(self):
        runner = (REPO_ROOT / "scripts" / "run-gates.sh").read_text(encoding="utf-8")
        for script in ("typecheck", "lint"):
            assert f"npm run --workspace mobile-officer {script}" in runner
        # jest goes through app_jest (2026-10-27), which runs the named workspace's own `test` script
        # (`test:coverage` on --full when the app has one, 2026-10-31 — TestCoverageOnFull).
        assert re.search(r"^\s*app_jest mobile-officer ", runner, re.M)
        assert 'npm run --workspace "$dir" "$script"' in runner and "local script=test\n" in runner

    def test_every_workspace_the_runner_names_exists(self):
        """`--workspace officer` named no workspace: npm refused, and the hook read that as a failed
        typecheck. This pin used to assert that very string, so it was green while every push was red."""
        import json
        import re

        runner = (REPO_ROOT / "scripts" / "run-gates.sh").read_text(encoding="utf-8")
        declared = json.loads((REPO_ROOT / "package.json").read_text(encoding="utf-8"))["workspaces"]
        dirs = {d for d in declared if "*" not in d}
        dirs |= {str(p.relative_to(REPO_ROOT)) for d in declared if "*" in d for p in REPO_ROOT.glob(d) if p.is_dir()}
        names = {
            json.loads((REPO_ROOT / d / "package.json").read_text(encoding="utf-8"))["name"]
            for d in dirs if (REPO_ROOT / d / "package.json").exists()
        }
        named = set(re.findall(r"--workspace[ =]([^\s\"']+)", runner))
        named |= set(re.findall(r"^\s*app_jest (\S+) ", runner, re.M))
        assert named, "the runner names no workspace at all"
        assert named <= dirs | names, sorted(named - dirs - names)


class TestATreeThatAlreadyPassedFull:
    """A push of a tree `run-gates.sh --full` already passed is let through (2026-10-19, user decision).

    The push to main runs the full set; running it again right after a full pass of the very same
    files cost ~22 minutes a push. Only an exact tree match skips — the second case is the guard.
    """

    def _push(self, hook, wt: Path, stamp: Path) -> subprocess.CompletedProcess:
        sha = subprocess.run(["git", "rev-parse", "HEAD"], cwd=wt, env=_clean_env(),
                             capture_output=True, text=True, check=True).stdout.strip()
        return _run(hook, wt, ["backend/x.py"], PREPUSH_RANGE=f"{'0' * 40}..{sha}",
                    GATES_STAMP_FILE=str(stamp), PREPUSH_CLASSIFY_ONLY="1")

    def _tree(self, wt: Path) -> str:
        return subprocess.run(["git", "rev-parse", "HEAD^{tree}"], cwd=wt, env=_clean_env(),
                              capture_output=True, text=True, check=True).stdout.strip()

    def test_the_same_tree_is_not_run_again(self, hook, checkouts, tmp_path):
        _, wt = checkouts
        stamp = tmp_path / "passed"
        stamp.write_text(f"{self._tree(wt)}\t2026-10-19 12:00, abc1234\n")
        proc = self._push(hook, wt, stamp)
        assert proc.returncode == 0, proc.stdout + proc.stderr
        assert "already passed" in proc.stdout, proc.stdout
        assert "classify:" not in proc.stdout, "the gates were classified (would have run) for a tree that passed"

    def test_a_different_tree_runs_as_before(self, hook, checkouts, tmp_path):
        _, wt = checkouts
        stamp = tmp_path / "passed"
        stamp.write_text(f"{'f' * 40}\t2026-10-19 12:00, abc1234\n")
        proc = self._push(hook, wt, stamp)
        assert proc.returncode == 0, proc.stdout + proc.stderr
        assert "already passed" not in proc.stdout
        assert re.search(r"^classify: ", proc.stdout, re.M), proc.stdout


class TestASelectivePassIsNotRunAgain:
    """A green selective run is recorded with the files it covered; a push of that tree changing
    only those files is let through (2026-10-27, user decision). A session ran the gates and then
    pushed, and the hook ran the same tests again."""

    def _env(self, stamp: Path, python: str, **extra) -> dict:
        return _clean_env(PYTHON_BIN=python, RUFF_BIN=shutil.which("true"), GATES_STAMP_FILE=str(stamp),
                          REDIS_URL=os.environ.get("REDIS_URL", ""), **extra)

    def _head(self, repo: Path, what: str = "HEAD") -> str:
        return subprocess.run(["git", "rev-parse", what], cwd=repo, env=_clean_env(),
                              capture_output=True, text=True, check=True).stdout.strip()

    def _push(self, hook, repo: Path, stamp: Path, changed: list[str], **extra):
        return _run(hook, repo, changed, PREPUSH_RANGE=f"{'0' * 40}..{self._head(repo)}",
                    GATES_STAMP_FILE=str(stamp), PREPUSH_CLASSIFY_ONLY="1", **extra)

    def test_a_green_selective_run_is_recorded_and_its_push_skips(self, hook, checkouts, fake_backend, tmp_path):
        main, _ = checkouts
        (main / "backend" / "x.py").write_text("X = 1\n")
        _git(main, "add", "-A")
        _git(main, "commit", "-q", "-m", "x")
        stamp = tmp_path / "passed"
        run = subprocess.run(["bash", str(main / "scripts" / "run-gates.sh"), "--base", "HEAD~1"], cwd=main,
                             env=self._env(stamp, fake_backend), capture_output=True, text=True, timeout=120)
        assert run.returncode == 0, run.stdout + run.stderr
        assert "recorded a selective pass" in run.stdout, run.stdout
        line = (tmp_path / "passed-selective").read_text()
        assert line.startswith(self._head(main, "HEAD^{tree}") + "\t") and line.rstrip().endswith("\tbackend/x.py"), line
        push = self._push(hook, main, stamp, ["backend/x.py"])
        assert push.returncode == 0, push.stdout + push.stderr
        assert "for these changes" in push.stdout, push.stdout
        assert "classify:" not in push.stdout, "the gates were classified (would have run) for changes that passed"

    def _stamp_for(self, main: Path, tmp_path: Path, files: str) -> Path:
        stamp = tmp_path / "passed"
        (tmp_path / "passed-selective").write_text(
            f"{self._head(main, 'HEAD^{tree}')}\t2026-10-27 12:00, abc1234\t{files}\n")
        return stamp

    def test_a_push_changing_a_file_the_run_did_not_cover_runs(self, hook, checkouts, tmp_path):
        main, _ = checkouts
        stamp = self._stamp_for(main, tmp_path, "backend/a.py")
        push = self._push(hook, main, stamp, ["backend/a.py", "backend/b.py"])
        assert "for these changes" not in push.stdout
        assert re.search(r"^classify: ", push.stdout, re.M), push.stdout

    def test_a_subset_of_the_covered_files_skips(self, hook, checkouts, tmp_path):
        main, _ = checkouts
        stamp = self._stamp_for(main, tmp_path, "backend/a.py|backend/b.py")
        assert "for these changes" in self._push(hook, main, stamp, ["backend/b.py"]).stdout

    def test_another_tree_runs(self, hook, checkouts, tmp_path):
        main, _ = checkouts
        stamp = tmp_path / "passed"
        (tmp_path / "passed-selective").write_text(f"{'f' * 40}\t2026-10-27 12:00, abc1234\tbackend/a.py\n")
        assert "for these changes" not in self._push(hook, main, stamp, ["backend/a.py"]).stdout

    def test_gates_full_at_push_time_still_runs(self, hook, checkouts, tmp_path):
        main, _ = checkouts
        stamp = self._stamp_for(main, tmp_path, "backend/a.py")
        assert "for these changes" not in self._push(hook, main, stamp, ["backend/a.py"], GATES_FULL="1").stdout


class TestStaticChecksRunBeforeAnyTests:
    """2026-10-27: a ruff error used to surface only after the web and app jest had run."""

    def test_every_type_check_and_linter_comes_before_the_first_test_runner(self):
        text = (REPO_ROOT / "scripts" / "run-gates.sh").read_text(encoding="utf-8")
        static = ['echo "  → core tsc"', 'echo "  → core eslint"', 'echo "  → tsc"', 'echo "  → eslint"',
                  'echo "  → mobile tsc"', 'echo "  → mobile eslint"', 'echo "  → officer tsc"',
                  'echo "  → officer eslint"', 'echo "  → ruff"', 'echo "  → makemigrations --check"']
        tests = ['echo "  → core vitest"', 'echo "  → jest"', 'echo "  → $dir jest"', 'echo "  → pytest"']
        for s in static:
            assert text.count(s) == 1, s
        last_static = max(text.index(s) for s in static)
        first_test = min(text.index(t) for t in tests)
        assert last_static < first_test


class TestJestReadersFollowWhatChanged:
    """When the web jest does not run, only the file-reading tests labelled with what changed run
    (2026-10-27). The labels are derived by frontend/src/__tests__/jestAlwaysRunList.test.ts."""

    def _readers(self, hook, changed):
        _, out = _classify_jest(hook, changed)
        m = re.search(r"^classify-jest-readers: (\d+)$", out, re.M)
        assert m, out
        return set(re.findall(r"^  jest reader: (\S+)$", out, re.M))

    def _labelled(self, label):
        lines = (REPO_ROOT / "frontend" / "jest.always-run.txt").read_text(encoding="utf-8").splitlines()
        return {ln.split()[0] for ln in lines if ln.strip() and not ln.startswith("#") and label in ln.split()[1:]}

    def test_a_backend_change_runs_the_backend_readers_and_the_stars_only(self, hook):
        got = self._readers(hook, ["backend/apps/souls/views.py"])
        assert self._labelled("backend") <= got and self._labelled("*") <= got, got
        everything = self._labelled("frontend") | self._labelled("packages") | self._labelled("backend") | self._labelled("*")
        unrelated = everything - self._labelled("backend") - self._labelled("*")
        assert unrelated and not (unrelated & got), "a test that does not read backend/ ran on a backend push"

    def test_a_docs_change_does_not_run_the_backend_readers(self, hook):
        got = self._readers(hook, ["docs/notes.md"])
        assert self._labelled("*") <= got
        only_backend = self._labelled("backend") - self._labelled("docs") - self._labelled("*")
        assert only_backend and not (only_backend & got), got


class TestRealPostgres:
    """`run-gates.sh --real-pg` (2026-10-28, user decision): the by-app selection plus every
    PostgreSQL-only test on backend/.env's PostgreSQL; round trips only when a migration changed;
    `--full` runs everything. Never falls back to SQLite."""

    PG_ONLY = "tests/test_x.py::test_needs_row_locks"

    def _gates(self, repo: Path, python: str, *args, changed=("backend/apps/souls/views.py",), **extra):
        # REDIS_URL is forwarded as `_pytest_line` does (_clean_env strips it). Without it a machine with a
        # Redis but no redis-server binary — the GitHub runner: a redis service, REDIS_URL set — passed the
        # `fake_backend` skip and then had the gates refuse: "redis-server not found and the configured
        # cache is unreachable" (CI, 2026-10-31, review A4).
        extra.setdefault("REDIS_URL", os.environ.get("REDIS_URL", ""))
        env = _clean_env(PREPUSH_CHANGED="\n".join(changed), PYTHON_BIN=python, RUFF_BIN=shutil.which("true"),
                         GATES_PG_ONLY_TESTS=self.PG_ONLY, **extra)
        return subprocess.run(["bash", str(repo / "scripts" / "run-gates.sh"), "--prepush", "--real-pg", *args],
                              cwd=repo, env=env, capture_output=True, text=True, timeout=120)

    def test_only_the_backend_runs_and_round_trips_wait_for_a_migration(self, hook):
        out = _classify_jest(hook, ["backend/apps/souls/views.py", "frontend/app/page.tsx"])[1]
        assert "classify: core=0 frontend=1" in out  # the ordinary run is unchanged
        proc = subprocess.run(
            ["bash", str(REPO_ROOT / "scripts" / "run-gates.sh"), "--prepush", "--real-pg"], cwd=REPO_ROOT,
            env=_clean_env(PREPUSH_CHANGED="backend/apps/souls/views.py\nfrontend/app/page.tsx",
                           PREPUSH_CLASSIFY_ONLY="1"), capture_output=True, text=True, timeout=60)
        assert "classify: core=0 frontend=0 backend=1" in proc.stdout, proc.stdout
        assert "classify-mobile: mobile=0" in proc.stdout and "classify-migration: migration=0" in proc.stdout
        assert "classify-readers: jest=0" in proc.stdout, proc.stdout

    def test_full_includes_the_migration_round_trips(self):
        proc = subprocess.run(
            ["bash", str(REPO_ROOT / "scripts" / "run-gates.sh"), "--prepush", "--real-pg", "--full"], cwd=REPO_ROOT,
            env=_clean_env(PREPUSH_CHANGED="backend/apps/souls/views.py", PREPUSH_CLASSIFY_ONLY="1"),
            capture_output=True, text=True, timeout=60)
        assert "classify-migration: migration=1" in proc.stdout, proc.stdout

    def test_it_refuses_without_a_postgres_url(self, checkouts, fake_backend):
        main, _ = checkouts
        (main / "backend" / ".env").write_text("DATABASE_URL=sqlite:///db.sqlite3\n")
        proc = self._gates(main, fake_backend)
        assert proc.returncode != 0
        assert "is not PostgreSQL" in proc.stdout, proc.stdout
        assert "PYTEST TEMPLATE" not in proc.stdout

    def test_an_unreachable_postgres_is_a_refusal_not_sqlite(self, checkouts, fake_backend):
        main, _ = checkouts
        (main / "backend" / ".env").write_text("DATABASE_URL=postgres://u:p@127.0.0.1:1/x\n")
        proc = self._gates(main, fake_backend)
        assert proc.returncode != 0
        assert "PostgreSQL unreachable" in proc.stdout, proc.stdout
        assert "PYTEST TEMPLATE" not in proc.stdout

    def _reachable(self, main: Path, python: str, *args) -> tuple[subprocess.CompletedProcess, list[list[str]]]:
        """The gates against a listening stand-in PostgreSQL; returns the run and each pytest's argv."""
        import socket

        listener = socket.socket()
        listener.bind(("127.0.0.1", 0))
        listener.listen()
        try:
            port = listener.getsockname()[1]
            (main / "backend" / ".env").write_text(f'DATABASE_URL="postgres://u:p@127.0.0.1:{port}/x"\n')
            proc = self._gates(main, python, *args, DATABASE_URL="sqlite:///:memory:")
        finally:
            listener.close()
        assert proc.returncode == 0, proc.stdout + proc.stderr
        runs = re.findall(r"^PYTEST TEMPLATE=\S* SECRET_KEY=\S* ARGS=(.*)$", proc.stdout, re.M)
        return proc, [re.findall(r"\[([^\]]*)\]", r) for r in runs]

    def test_a_reachable_postgres_runs_the_selection_plus_the_postgres_only_tests(
        self, checkouts, fake_backend
    ):
        main, _ = checkouts
        # A stand-in selector, so the by-app branch runs (with none, the whole suite runs — PG-only included).
        (main / "scripts" / "select-backend-tests.py").write_text("print('tests/test_souls.py')\n")
        proc, runs = self._reachable(main, fake_backend)
        assert len(runs) == 1, proc.stdout  # no multi-database guard without --full (next test)
        args = runs[0]
        assert "--create-db" in args and "faulthandler_timeout=600" in args, args
        assert self.PG_ONLY in args and "tests/test_souls.py" in args, args
        assert "-m" in args and "not migration" in args, args
        assert "→ ruff, makemigrations: skipped — --real-pg runs pytest only" in proc.stdout

    def test_full_also_runs_the_multidb_guard_that_the_suite_skips(self, checkouts, fake_backend):
        """C21 (2026-10-31): tests/test_multidb_shadow.py exists only under --ds=config.settings_multidb,
        so every ordinary run skips it. `--real-pg --full` runs it, on the same database, before the suite."""
        main, _ = checkouts
        proc, runs = self._reachable(main, fake_backend, "--full")
        assert len(runs) == 2, proc.stdout
        guard, suite = runs
        assert "--ds=config.settings_multidb" in guard and "tests/test_multidb_shadow.py" in guard, guard
        assert guard[guard.index("-m") + 1] == "multidb" and "--create-db" in guard, guard
        assert "--ds=config.settings_multidb" not in suite and "tests/test_multidb_shadow.py" not in suite, suite


class TestTheWholeRunOnAnotherMachine:
    """GATES_REMOTE (2026-10-28, user decision): this machine decides what runs, rsyncs the tree and runs
    this same script there in a container; it never falls back to running here."""

    def _bin(self, tmp_path: Path, image_ok=True, remote_status=0) -> Path:
        b = tmp_path / "bin"
        b.mkdir(exist_ok=True)
        (b / "ssh").write_text(
            "#!/bin/bash\n"
            'case "$*" in\n'
            f'  *"docker image inspect"*) exit {0 if image_ok else 1} ;;\n'
            '  *"docker rm -f"*) exit 0 ;;\n'
            f'  *"cat > "*) cat > "{tmp_path}/changed" ; exit 0 ;;\n'
            f'  *"docker run"*) printf "%s" "$*" > "{tmp_path}/remote-run"; echo "pre-push: ok (remote)"; exit {remote_status} ;;\n'
            "esac\nexit 0\n")
        (b / "rsync").write_text("#!/bin/bash\ncat >/dev/null\nexit 0\n")
        for f in ("ssh", "rsync"):
            (b / f).chmod(0o755)
        return b

    def _run(self, repo, tmp_path, *args, prepush=True, **kw):
        b = self._bin(tmp_path, **{k: kw.pop(k) for k in ("image_ok", "remote_status") if k in kw})
        env = _clean_env(GATES_REMOTE="fake-host", GATES_REMOTE_DB_URL="postgres://sl:x@sl-pg-test:5432/s",
                         GATES_STAMP_FILE=str(tmp_path / "passed"), **kw)
        if prepush:
            env["PREPUSH_CHANGED"] = "backend/apps/souls/views.py"
        env["PATH"] = f"{b}:{env['PATH']}"
        cmd = ["bash", str(repo / "scripts" / "run-gates.sh"), *(["--prepush"] if prepush else []), *args]
        return subprocess.run(cmd, cwd=repo, env=env, capture_output=True, text=True, timeout=120)

    def test_it_runs_there_and_nothing_runs_here(self, checkouts, tmp_path):
        main, _ = checkouts
        proc = self._run(main, tmp_path)
        assert proc.returncode == 0, proc.stdout + proc.stderr
        assert "only syncs and waits" in proc.stdout and "pre-push: ok (remote)" in proc.stdout, proc.stdout
        assert "→ ruff" not in proc.stdout and "PYTEST TEMPLATE" not in proc.stdout, "checks ran here"
        remote = (tmp_path / "remote-run").read_text()
        assert "GATES_IN_REMOTE=1" in remote and "run-gates.sh --prepush" in remote, remote
        assert "DATABASE_URL='postgres://sl:x@sl-pg-test:5432/s'" in remote and "flock" in remote, remote
        assert "GATE_LOCK=0" in remote, "the container's own gate lock must be off: pids repeat across containers"
        assert "TMPDIR=/sl-tmp" in remote and "TMPDIR=/app" not in remote, "temp files inside the tree load its conftest twice"
        assert (tmp_path / "changed").read_text().strip() == "backend/apps/souls/views.py"

    def test_full_and_real_pg_are_handed_over(self, checkouts, tmp_path):
        main, _ = checkouts
        self._run(main, tmp_path, "--full", "--real-pg")
        assert "run-gates.sh --prepush --full --real-pg" in (tmp_path / "remote-run").read_text()

    def test_an_unreachable_machine_stops_the_run_instead_of_running_here(self, checkouts, tmp_path):
        """2026-10-28 user decision: no fallback to this machine — running here is what froze it."""
        main, _ = checkouts
        proc = self._run(main, tmp_path, image_ok=False)
        assert proc.returncode != 0
        assert "unreachable" in proc.stdout and "SKIP_PREPUSH=1" in proc.stdout, proc.stdout
        assert "→ ruff" not in proc.stdout and not (tmp_path / "remote-run").exists()

    def test_a_red_run_there_is_a_red_run_here(self, checkouts, tmp_path):
        main, _ = checkouts
        proc = self._run(main, tmp_path, remote_status=1)
        assert proc.returncode != 0
        assert "the gates failed on fake-host" in proc.stdout, proc.stdout

    def test_a_green_run_there_is_recorded_here(self, checkouts, tmp_path):
        main, _ = checkouts
        (main / "backend" / "x.py").write_text("X = 1\n")
        _git(main, "add", "-A")
        _git(main, "commit", "-q", "-m", "x")
        proc = self._run(main, tmp_path, "--base", "HEAD~1", prepush=False)
        assert proc.returncode == 0, proc.stdout + proc.stderr
        assert "recorded a selective pass" in proc.stdout, proc.stdout
        assert (tmp_path / "passed-selective").read_text().rstrip().endswith("\tbackend/x.py")


class TestEndToEndOnAnotherMachine:
    """`run-gates.sh --e2e` (2026-10-28, user decision): Playwright runs on GATES_REMOTE, never here."""

    def _bin(self, tmp_path: Path, image_ok=True) -> Path:
        b = tmp_path / "bin"
        b.mkdir(exist_ok=True)
        (b / "ssh").write_text(
            "#!/bin/bash\n"
            'case "$*" in\n'
            f'  *"docker image inspect"*) exit {0 if image_ok else 1} ;;\n'
            '  *"docker rm -f"*) exit 0 ;;\n'
            f'  *"docker run"*) printf "%s" "$*" > "{tmp_path}/remote-run"; exit 0 ;;\n'
            "esac\nexit 0\n")
        (b / "rsync").write_text("#!/bin/bash\ncat >/dev/null\nexit 0\n")
        for f in ("ssh", "rsync"):
            (b / f).chmod(0o755)
        return b

    def _run(self, repo, tmp_path, *args, remote="fake-host", **kw):
        b = self._bin(tmp_path, **kw)
        env = _clean_env(**({"GATES_REMOTE": remote} if remote else {}))
        env["PATH"] = f"{b}:{env['PATH']}"
        return subprocess.run(["bash", str(repo / "scripts" / "run-gates.sh"), *args], cwd=repo, env=env,
                              capture_output=True, text=True, timeout=120)

    def test_without_a_remote_machine_it_refuses(self, checkouts, tmp_path):
        main, _ = checkouts
        proc = self._run(main, tmp_path, "--e2e", remote=None)
        assert proc.returncode == 2 and "never on this one" in proc.stdout, proc.stdout

    def test_e2e_runs_chromium_there(self, checkouts, tmp_path):
        main, _ = checkouts
        proc = self._run(main, tmp_path, "--e2e")
        assert proc.returncode == 0, proc.stdout + proc.stderr
        remote = (tmp_path / "remote-run").read_text()
        assert "PROJECTS='chromium'" in remote and "playwright test" in remote and "--retries=1" in remote, remote
        assert "npm run build" in remote and "sl-gates-e2e:1" in remote and "flock" in remote, remote
        assert "$(echo $PROJECTS" in remote, "the loop must reach the remote unexpanded"

    def test_all_projects_run_in_one_playwright_call_summed_from_its_json(self, checkouts, tmp_path):
        """2026-10-30: one `playwright test` (one webServer) for every project; per-project counts and the
        flaky/failed names come from the json reporter, read by scripts/e2e-report.py."""
        main, _ = checkouts
        self._run(main, tmp_path, "--e2e=all")
        remote = (tmp_path / "remote-run").read_text()
        assert remote.count("playwright test") == 1, remote
        assert "--project=$p" not in remote.split("playwright test")[1].split("\n")[0], "still one call per project"
        assert "$PF --reporter=line,json --retries=1" in remote, remote
        assert "PLAYWRIGHT_JSON_OUTPUT_NAME=/sl-tmp/e2e.json" in remote and "scripts/e2e-report.py" in remote, remote

    def test_all_means_the_three_projects(self, checkouts, tmp_path):
        main, _ = checkouts
        self._run(main, tmp_path, "--e2e=all")
        assert "PROJECTS='chromium,firefox,mobile-chrome'" in (tmp_path / "remote-run").read_text()

    def test_an_unreachable_machine_runs_nothing_here(self, checkouts, tmp_path):
        main, _ = checkouts
        proc = self._run(main, tmp_path, "--e2e", image_ok=False)
        assert proc.returncode == 1 and "does not run on this machine" in proc.stdout, proc.stdout
        assert not (tmp_path / "remote-run").exists()


# ── 2026-10-30 gate speed-ups (user decision): deps hashes, jest cache, two sides at once, e2e report ──


class TestTheRemoteDependencyHashes:
    """B3: node_modules and backend/.venv are reinstalled on the gate box by two hashes decided apart, and
    the venv is synced, never deleted. The hashes reach the container as SL_DEPS_JS / SL_DEPS_PY."""

    def _hashes(self, repo, tmp_path):
        proc = TestTheWholeRunOnAnotherMachine()._run(repo, tmp_path)
        assert proc.returncode == 0, proc.stdout + proc.stderr
        remote = (tmp_path / "remote-run").read_text()
        return re.search(r"SL_DEPS_JS=(\w+)", remote).group(1), re.search(r"SL_DEPS_PY=(\w+)", remote).group(1)

    def _write(self, repo, rel, text):
        (repo / rel).parent.mkdir(parents=True, exist_ok=True)
        (repo / rel).write_text(text)
        _git(repo, "add", "-A")

    def test_each_hash_moves_only_with_its_own_inputs(self, checkouts, tmp_path):
        main, _ = checkouts
        pkg = '{"name": "x", "version": "%s", "scripts": {"t": "%s"}, "dependencies": {"a": "%s"}}'
        self._write(main, "frontend/package.json", pkg % ("1.0.0", "jest", "1"))
        self._write(main, "backend/requirements.lock", "django==5.2\n")
        js, py = self._hashes(main, tmp_path)
        self._write(main, "frontend/package.json", pkg % ("1.0.1", "vitest", "1"))
        assert self._hashes(main, tmp_path) == (js, py), "a version or script change reinstalled something"
        self._write(main, "frontend/package.json", pkg % ("1.0.1", "vitest", "2"))
        js2, py2 = self._hashes(main, tmp_path)
        assert js2 != js and py2 == py
        self._write(main, "backend/requirements.lock", "django==5.2.1\n")
        js3, py3 = self._hashes(main, tmp_path)
        assert js3 == js2 and py3 != py2

    def test_the_venv_is_synced_not_rebuilt(self):
        text = RUNNER.read_text(encoding="utf-8")
        deps = text[text.index("REMOTE_DEPS='"):]
        deps = deps[: deps.index("fi'") + 3]
        assert "rm -rf backend/.venv" not in deps
        assert ".sl-deps-js" in deps and ".sl-deps-py" in deps and "venv-extras.py" in deps, deps
        assert "'" not in deps[len("REMOTE_DEPS='"):-1], "it is spliced into a single-quoted bash -c"
        assert text.count("$REMOTE_DEPS") == 2, "the gate run and the E2E run install the same way"


class TestVenvExtras:
    """scripts/venv-extras.py: what the kept venv has that the requirement files no longer name."""

    def _mod(self):
        import importlib.util

        spec = importlib.util.spec_from_file_location("venv_extras", REPO_ROOT / "scripts" / "venv-extras.py")
        mod = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(mod)
        return mod

    def test_a_dropped_package_is_named_and_kept_ones_are_not(self, tmp_path):
        mod = self._mod()
        lock = tmp_path / "requirements.lock"
        lock.write_text("# comment\nDjango==5.2\nzope.interface==7 ; python_version>'3'\n    # via x\n-r other.txt\n")
        wanted = mod.required([lock])
        assert wanted == {"django", "zope-interface"}
        got = mod.extras(["Django", "zope_interface", "pip", "setuptools", "wheel", "Old_Package"], wanted)
        assert got == ["old-package"]


class TestTheJestCacheSurvivesTheNight:
    """B2: TMPDIR on the gate box is /sl-tmp, emptied daily; the cache lives in node_modules, which the
    rsync protects."""

    @pytest.mark.parametrize("config", ["frontend/jest.config.js", "mobile/jest.config.js",
                                        "mobile-officer/jest.config.js"])
    def test_cache_directory_is_under_node_modules(self, config):
        text = (REPO_ROOT / config).read_text(encoding="utf-8")
        assert re.search(r"cacheDirectory: ['\"]<rootDir>/node_modules/\.cache/jest['\"]", text), config

    def test_the_sync_keeps_node_modules(self):
        assert "--filter='P **/node_modules/'" in RUNNER.read_text(encoding="utf-8")


class TestTwoSidesAtOnce:
    """B4: in the remote run the backend pytest and the JS runners run side by side; one side failing does
    not stop the other, and both exit codes are reported."""

    def _repo(self, checkouts, tmp_path):
        main, _ = checkouts
        (main / "mobile" / "src").mkdir(parents=True)
        (main / "mobile" / "src" / "r.test.ts").write_text("import fs from 'fs'; fs.readFileSync('x');\n")
        _git(main, "add", "-A")
        _git(main, "commit", "-q", "-m", "mobile reader")
        b = tmp_path / "bin"
        b.mkdir()
        # The JS side: slower than the backend, and leaves a mark when it ran to the end.
        (b / "npm").write_text(f"#!/bin/bash\nsleep 3\ntouch '{tmp_path}/js-finished'\necho 'Tests: 6 passed'\n")
        (b / "npm").chmod(0o755)
        py = tmp_path / "fake-python"
        py.write_text(
            "#!/bin/bash\n"
            'case "$1" in\n'
            "  manage.py) exit 0 ;;\n"
            f'  -m) if [ "$2" = pytest ]; then touch "{tmp_path}/pytest-started"; echo "1 failed"; exit 1; fi ;;\n'
            "esac\n"
            'exec python3 "$@"\n')
        py.chmod(0o755)
        return main, b, str(py)

    def _run(self, repo, b, py, remote):
        env = _clean_env(PREPUSH_CHANGED="backend/x.py", PYTHON_BIN=py, RUFF_BIN=shutil.which("true"),
                         DATABASE_URL="sqlite:///:memory:", REDIS_URL=os.environ.get("REDIS_URL", ""),
                         **({"GATES_IN_REMOTE": "1"} if remote else {}))
        env["PATH"] = f"{b}:{env['PATH']}"
        return subprocess.run(["bash", str(repo / "scripts" / "run-gates.sh"), "--prepush"], cwd=repo, env=env,
                              capture_output=True, text=True, timeout=120)

    def test_a_red_backend_does_not_stop_the_js_side(self, checkouts, tmp_path, fake_backend):
        repo, b, py = self._repo(checkouts, tmp_path)
        proc = self._run(repo, b, py, remote=True)
        assert proc.returncode != 0
        assert (tmp_path / "pytest-started").exists() and (tmp_path / "js-finished").exists(), proc.stdout
        assert "side by side" in proc.stdout, proc.stdout
        assert "backend exit 1, JS exit 0" in proc.stdout, proc.stdout
        assert "Tests: 6 passed" in proc.stdout, "the JS log was not printed"

    def test_here_it_stays_serial_and_stops_at_the_first_red(self, checkouts, tmp_path, fake_backend):
        repo, b, py = self._repo(checkouts, tmp_path)
        proc = self._run(repo, b, py, remote=False)
        assert proc.returncode != 0 and "pytest failed" in proc.stdout, proc.stdout
        assert "side by side" not in proc.stdout
        assert not (tmp_path / "js-finished").exists(), "the serial run went on past a red pytest"

    def test_the_container_splits_its_cpus_between_the_sides(self):
        text = RUNNER.read_text(encoding="utf-8")
        assert "-e PYTEST_WORKERS=${GATES_REMOTE_PYTEST_WORKERS:-6}" in text
        assert "-e JEST_WORKERS=${GATES_REMOTE_JS_WORKERS:-6}" in text
        assert "--cpus ${GATES_REMOTE_CPUS:-12}" in text


class TestTheE2eReport:
    """B5: scripts/e2e-report.py turns one multi-project Playwright JSON report into per-project lines."""

    def _report(self, tmp_path, report):
        import json

        path = tmp_path / "e2e.json"
        path.write_text(json.dumps(report))
        return subprocess.run([sys.executable, "-I", str(REPO_ROOT / "scripts" / "e2e-report.py"), str(path),
                               "chromium", "firefox", "mobile-chrome"], capture_output=True, text=True, timeout=60)

    def test_counts_and_names_per_project(self, tmp_path):
        def spec(title, *tests):
            return {"title": title, "tests": [{"projectName": p, "status": s} for p, s in tests]}

        report = {"suites": [{"title": "souls.spec.ts", "specs": [
            spec("lists souls", ("chromium", "expected"), ("firefox", "unexpected"), ("mobile-chrome", "flaky")),
        ], "suites": [{"title": "detail", "specs": [
            spec("opens one", ("chromium", "expected"), ("firefox", "expected"), ("mobile-chrome", "skipped")),
        ]}]}], "errors": []}
        proc = self._report(tmp_path, report)
        assert proc.returncode == 0, proc.stdout + proc.stderr
        out = proc.stdout
        assert "    chromium: 2 passed\n" in out, out
        assert "    firefox: 1 passed, 1 failed\n" in out, out
        assert "    mobile-chrome: 1 flaky, 1 skipped\n" in out, out
        assert "failed: [firefox] souls.spec.ts › lists souls" in out, out
        assert "flaky: [mobile-chrome] souls.spec.ts › lists souls" in out, out
        assert "[chromium] souls.spec.ts" not in out, "a passing test was named"

    def test_a_missing_report_or_a_run_error_is_exit_1(self, tmp_path):
        missing = subprocess.run([sys.executable, "-I", str(REPO_ROOT / "scripts" / "e2e-report.py"),
                                  str(tmp_path / "none.json")], capture_output=True, text=True, timeout=60)
        assert missing.returncode == 1 and "no readable" in missing.stdout
        proc = self._report(tmp_path, {"suites": [], "errors": [{"message": "Timed out waiting for webServer\nmore"}]})
        assert proc.returncode == 1 and "error: Timed out waiting for webServer" in proc.stdout, proc.stdout
        assert "chromium: no tests" in proc.stdout


# ── scripts/mobile-remote.sh: Metro follows the JS dependencies (2026-10-31, user decision) ─────────


class TestMobileRemoteMetroFollowsTheDependencies:
    """The dependency hash is run-gates.sh's deps_hash_js (dependency fields + lockfile + image), and a Metro
    started under another hash is restarted by `metro sync` / `metro open` — on 2026-10-31 a dependency change
    followed by only `metro sync` bundled against a node_modules that was gone. ssh and rsync are fakes; the
    fake ssh answers `docker inspect` with the environment in `metro-env` (absent = no Metro running)."""

    def _repo(self, tmp_path):
        repo = tmp_path / "repo"
        (repo / "scripts").mkdir(parents=True)
        shutil.copy(REPO_ROOT / "scripts" / "mobile-remote.sh", repo / "scripts" / "mobile-remote.sh")
        (repo / "package-lock.json").write_text('{"lockfileVersion": 3}\n')
        self._pkg(repo, "1.0.0", "jest", "1")
        _git(repo, "init", "-q")
        _git(repo, "add", "-A")
        return repo

    def _pkg(self, repo, version, script, dep):
        (repo / "mobile").mkdir(exist_ok=True)
        (repo / "mobile" / "package.json").write_text(
            json.dumps({"name": "m", "version": version, "scripts": {"t": script}, "dependencies": {"a": dep}}))

    def _run(self, repo, tmp_path, *args):
        b = tmp_path / "bin"
        b.mkdir(exist_ok=True)
        log = tmp_path / "ssh.log"
        (b / "ssh").write_text(f'''#!/bin/bash
for a; do cmd="$a"; done
printf '%s\\n' "$cmd" >> {log}
case "$cmd" in *"docker inspect"*) [ -f {tmp_path}/metro-env ] && cat {tmp_path}/metro-env || exit 1 ;; esac
exit 0
''')
        (b / "rsync").write_text("#!/bin/bash\ncat >/dev/null\nexit 0\n")
        (b / "adb").write_text("#!/bin/bash\nexit 0\n")
        for f in b.iterdir():
            f.chmod(0o755)
        if log.exists():
            log.unlink()
        env = _clean_env(MOBILE_REMOTE="box")
        env["PATH"] = f"{b}:{env['PATH']}"
        proc = subprocess.run(["bash", str(repo / "scripts" / "mobile-remote.sh"), "mobile", *args], cwd=repo,
                              env=env, capture_output=True, text=True, timeout=60)
        return proc, (log.read_text() if log.exists() else "")

    def _deps(self, repo, tmp_path):
        proc, log = self._run(repo, tmp_path, "metro", "start")
        assert proc.returncode == 0, proc.stdout + proc.stderr
        return re.search(r"-e SL_DEPS=(\w+)", log).group(1)

    def test_only_the_dependency_fields_move_the_hash(self, tmp_path):
        repo = self._repo(tmp_path)
        first = self._deps(repo, tmp_path)
        self._pkg(repo, "1.0.1", "vitest", "1")
        assert self._deps(repo, tmp_path) == first, "a version or script edit reinstalled node_modules"
        self._pkg(repo, "1.0.1", "vitest", "2")
        assert self._deps(repo, tmp_path) != first
        (repo / "package-lock.json").write_text('{"lockfileVersion": 3, "x": 1}\n')
        assert self._deps(repo, tmp_path) != first

    def test_sync_restarts_a_metro_started_under_other_dependencies(self, tmp_path):
        repo = self._repo(tmp_path)
        (tmp_path / "metro-env").write_text("PATH=/usr/bin\nSL_DEPS=0123456789abcdef\n")
        proc, log = self._run(repo, tmp_path, "metro", "sync")
        assert proc.returncode == 0, proc.stdout + proc.stderr
        assert "restarting it" in proc.stdout and "docker run -d" in log, proc.stdout + log

    def test_open_restarts_it_too(self, tmp_path):
        repo = self._repo(tmp_path)
        (tmp_path / "metro-env").write_text("SL_DEPS=0123456789abcdef\n")
        (repo / "mobile" / "app.json").write_text('{"expo": {"android": {"package": "x.y"}}}')
        proc, log = self._run(repo, tmp_path, "metro", "open")
        assert proc.returncode == 0, proc.stdout + proc.stderr
        assert "restarting it" in proc.stdout and "docker run -d" in log, proc.stdout + log

    def test_a_current_metro_and_no_metro_are_left_alone(self, tmp_path):
        repo = self._repo(tmp_path)
        deps = self._deps(repo, tmp_path)
        (tmp_path / "metro-env").write_text(f"SL_DEPS={deps}\n")
        proc, log = self._run(repo, tmp_path, "metro", "sync")
        assert proc.returncode == 0 and "docker inspect" in log, proc.stdout + proc.stderr
        assert "docker run" not in log and "restarting" not in proc.stdout, log
        (tmp_path / "metro-env").unlink()
        proc, log = self._run(repo, tmp_path, "metro", "sync")
        assert proc.returncode == 0, proc.stdout + proc.stderr
        assert "docker run" not in log and "restarting" not in proc.stdout, log
