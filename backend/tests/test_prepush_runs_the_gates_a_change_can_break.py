"""The pre-push hook must run the gates a change can break — including changes at
the repository root.

Why this file exists
--------------------
`.git/hooks/pre-push` is the only gate in this repository that runs by itself:
both GitHub Actions workflows are `workflow_dispatch` only. It decides what to
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
"""

import os
import re
import subprocess
from pathlib import Path

import pytest

REPO_ROOT = Path(__file__).resolve().parents[2]
GENERATOR = REPO_ROOT / "scripts" / "install-hooks.sh"


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
        assert "RUN_CORE" in body and "PREPUSH_CLASSIFY_ONLY" in body
        assert len(body.splitlines()) > 100

    def test_the_gates_read_the_same_variables_the_classifier_prints(self):
        """If a gate re-derived its own condition, this file would be testing a
        copy of the rule rather than the rule."""
        body = _hook_body()
        for var in ("RUN_CORE", "RUN_FRONTEND", "RUN_BACKEND"):
            assert re.search(rf'^if \[ "\${var}" = 1 \]; then', body, re.M), (
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
        ["README.md", "CLAUDE.md", "Dockerfile", "docker-compose.yml", ".gitignore"],
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
