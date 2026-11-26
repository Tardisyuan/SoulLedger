"""scripts/gates_classify.py — the decision rules of scripts/run-gates.sh, as functions (2026-11-26, user decision).

The subprocess tests in test_prepush_runs_the_gates_a_change_can_break.py drive the whole script; these call the
rules directly. Reads "scripts" (the module, by path) and builds its own small checkout under tmp_path.
"""
import importlib.util
import subprocess
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[2]
_spec = importlib.util.spec_from_file_location("gates_classify", ROOT / "scripts" / "gates_classify.py")
gc = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(gc)


@pytest.fixture
def checkout(tmp_path):
    (tmp_path / "backend" / "tests").mkdir(parents=True)
    (tmp_path / "backend" / "tests" / "reads-outside-backend.txt").write_text(
        "# comment frontend\n"
        "tests/test_reads_web.py   frontend\n"
        "tests/test_reads_all.py   *\n"
        "tests/test_reads_core.py  packages\n"
    )
    (tmp_path / "frontend").mkdir()
    (tmp_path / "frontend" / "jest.always-run.txt").write_text("src/__tests__/readsBackend.test.ts backend\n")
    return str(tmp_path)


def run(checkout, *changed, **kw):
    return gc.classify(list(changed), checkout, **kw)


def areas(v):
    return {k: v[f"RUN_{k.upper()}"] for k in ("core", "frontend", "backend")}


NONE = {"core": 0, "frontend": 0, "backend": 0}
JS = {"core": 1, "frontend": 1, "backend": 0}
BACKEND = {"core": 0, "frontend": 0, "backend": 1}
ALL = {"core": 1, "frontend": 1, "backend": 1}


class TestRootLevelFiles:
    def test_the_js_tree_and_the_pytest_config(self, checkout):
        assert areas(run(checkout, "package-lock.json")) == JS
        assert areas(run(checkout, "pytest.ini")) == BACKEND

    def test_inert_files_run_nothing_and_do_not_hide_a_real_one(self, checkout):
        assert areas(run(checkout, "README.md", ".gitignore", "docker-compose.yml")) == NONE
        assert areas(run(checkout, "README.md", "package-lock.json")) == JS

    def test_an_unknown_root_file_runs_everything_and_says_why(self, checkout):
        v = run(checkout, "tsconfig.base.json")
        assert areas(v) == ALL and v["UNKNOWN_ROOT"] == "tsconfig.base.json"
        assert v["RUN_MIGRATION"] == 1 and v["RUN_META"] == 1
        assert "a root-level file this script does not recognise\n" in v["FULL_F"]


class TestTheGateScriptsAreOneList:
    @pytest.mark.parametrize("path", sorted(gc.GATE_SCRIPTS))
    def test_each_role_reaches_its_rule(self, checkout, path):
        roles = gc.GATE_SCRIPTS[path]
        v = run(checkout, path)
        assert v["RUN_BACKEND"] == ("backend" in roles), v
        assert ("the gate machinery itself changed: " + path in v["FULL_F"]) == ("jest" in roles), v["FULL_F"]
        assert (gc.e2e_hit([path]) == path) == ("e2e" in roles)
        assert (gc.e2e_hit([path], demo=True) == path) == ("demo" in roles)

    def test_the_list_names_real_files_and_this_module_runs_everything_that_tests_it(self):
        assert all((ROOT / p).is_file() for p in gc.GATE_SCRIPTS)
        assert gc.GATE_SCRIPTS["scripts/gates_classify.py"] == {"backend", "jest", "e2e", "demo"}

    def test_select_backend_tests_uses_the_same_list(self):
        spec = importlib.util.spec_from_file_location("sbt", ROOT / "scripts" / "select-backend-tests.py")
        sbt = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(sbt)
        assert sbt.GATE_SCRIPTS == gc.GATE_SCRIPTS


class TestReaders:
    def test_the_lines_naming_what_changed_and_the_star_lines(self, checkout):
        v = run(checkout, "frontend/app/page.tsx")
        assert v["BACKEND_READERS"].split("\n") == ["tests/test_reads_web.py", "tests/test_reads_all.py"]
        assert v["RUN_JEST_READERS"] == 0  # the frontend runs in full

    def test_a_backend_change_runs_the_web_readers_of_the_backend(self, checkout):
        v = run(checkout, "backend/apps/x/models.py")
        assert v["BACKEND_READERS"] == "" and v["JEST_READERS"] == "src/__tests__/readsBackend.test.ts"
        assert v["RUN_JEST_READERS"] == 1

    def test_a_missing_list_runs_the_backend_suite(self, checkout):
        (Path(checkout) / "backend/tests/reads-outside-backend.txt").unlink()
        v = run(checkout, "docs/x.md")
        assert v["RUN_BACKEND"] == 1 and v["READERS_MISSING"] == 1

    def test_a_mobile_reader_follows_only_what_it_names(self):
        tops = {"backend"}
        assert gc.reader_follows_change('fs.readFileSync(path.join(REPO, "backend", "x"))', tops, ["backend", "frontend"])
        assert not gc.reader_follows_change('read("/frontend/x")', tops, ["backend", "frontend"])
        assert gc.reader_follows_change('execSync("git ls-files")', set(), ["backend"])
        assert not gc.reader_follows_change("readFileSync('./theme.ts')", tops, ["backend"])


class TestJestFullRuns:
    def test_traced_data_is_selective_and_untraced_data_is_not(self, checkout):
        for f in ("packages/core/messages/en.json", "packages/core/src/creditsOss.json"):
            (Path(checkout) / f).parent.mkdir(parents=True, exist_ok=True)
            (Path(checkout) / f).write_text("{}\n")
        assert run(checkout, "packages/core/messages/en.json")["FULL_F"] == ""
        assert run(checkout, "packages/core/src/creditsOss.json")["FULL_F"] == (
            "a data file under frontend/ or packages/core/ changed: packages/core/src/creditsOss.json\n")

    def test_a_deleted_file_and_the_app_rules(self, checkout):
        v = run(checkout, "frontend/gone.ts", "mobile/app.json")
        assert "a file was deleted or renamed: frontend/gone.ts\n" in v["FULL_F"]
        assert "an app file outside src/, or not code: mobile/app.json\n" in v["APP_FULL_F"]
        assert "an app file was deleted or renamed: mobile/app.json\n" in v["APP_FULL_F"]

    def test_full_and_gates_full_come_first(self, checkout):
        v = run(checkout, "docs/x.md", mode_full=True, gates_full=True)
        assert v["FULL_F"] == "--full\nGATES_FULL=1\n" and v["FULL_RUN"] == 1 and v["META_SKIP"] == ""


class TestMetaAndMigration:
    def test_a_new_test_file_runs_the_collection_scope_test_only(self, checkout):
        v = run(checkout, "backend/tests/test_new.py")
        assert (v["RUN_META"], v["RUN_SCOPE"]) == (0, 1)
        assert v["META_SKIP"] == "backend/tests/test_audit_assertions_are_not_vacuous.py"

    def test_a_file_holding_a_round_trip_runs_the_round_trips(self, checkout):
        (Path(checkout) / "backend/tests/test_rt.py").write_text("pytestmark = pytest.mark.migration\n")
        assert run(checkout, "backend/tests/test_rt.py")["RUN_MIGRATION"] == 1
        assert run(checkout, "backend/tests/test_other.py")["RUN_MIGRATION"] == 0


class TestLedgers:
    LEDGER = "t1\t2026-11-26, a\tbackend/a.py|backend/b.py\nt1\t2026-11-26, b\tbackend/c.py\nt2\tx\t*\n"

    def test_selective_passes_are_united_and_must_cover_every_file(self):
        assert gc.proves(self.LEDGER, "t1", "backend/a.py\nbackend/c.py\n") == "selective"
        assert gc.proves(self.LEDGER, "t1", "backend/a.py\nbackend/d.py") == ""
        assert gc.proves(self.LEDGER, "t1", "-") == ""
        assert gc.proves(self.LEDGER, "t3", "") == ""

    def test_a_full_pass_vouches_for_anything(self):
        assert gc.proves(self.LEDGER, "t2", "-") == "full"
        assert gc.proves(self.LEDGER, "t2", "anything") == "full"

    def test_e2e_projects_across_lines(self):
        ledger = "t\tchromium\td\nt\tfirefox\td\nu\tmobile-chrome\td\n"
        assert gc.e2e_missing(ledger, "t", "chromium,firefox") == []
        assert gc.e2e_missing(ledger, "t", "chromium,mobile-chrome") == ["mobile-chrome"]


class TestSideBase:
    """side_base: the newest commit of HEAD's last 300 whose tree the ledger vouches for, for what that commit changes
    against the merge-base. A three-commit history: mb → a (adds a.py) → b (adds b.py)."""

    @pytest.fixture
    def repo(self, tmp_path):
        r = tmp_path / "r"
        r.mkdir()
        g = lambda *a: subprocess.run(["git", "-C", str(r), "-c", "user.email=t@t", "-c", "user.name=t", *a],  # noqa: E731
                                      capture_output=True, text=True, check=True).stdout.strip()
        g("init", "-q")
        sha = {}
        for name in ("mb", "a", "b"):
            (r / f"{name}.py").write_text(name)
            g("add", "-A")
            g("commit", "-q", "-m", name)
            sha[name] = (g("rev-parse", "HEAD"), g("rev-parse", "HEAD^{tree}"))
        return str(r), sha

    def base(self, repo, ledger, mb, tmp_path):
        path = tmp_path / "ledger"
        if ledger is not None:
            path.write_text(ledger)
        return gc.side_base(str(path), mb, repo)

    def test_no_ledger_and_no_matching_tree(self, repo, tmp_path):
        r, sha = repo
        assert self.base(r, None, sha["mb"][0], tmp_path) == ("", "; no pass recorded")
        assert self.base(r, "nope\tx\t*\n", sha["mb"][0], tmp_path) == (
            "", "; none of the last 300 commits has a tree that passed")

    def test_the_newest_tree_whose_pass_covers_its_changes(self, repo, tmp_path):
        r, sha = repo
        mb = sha["mb"][0]
        # b's selective pass covers only a.py, not b.py: b is skipped, a's full pass is the base.
        ledger = f"{sha['b'][1]}\td\ta.py\n{sha['a'][1]}\td\t*\n"
        assert self.base(r, ledger, mb, tmp_path) == (sha["a"][0], "last tree that passed, full")
        # Two lines for b, united, cover a.py and b.py.
        ledger += f"{sha['b'][1]}\td\tb.py\n"
        assert self.base(r, ledger, mb, tmp_path) == (sha["b"][0], "last tree that passed, selective")

    def test_without_a_merge_base_only_a_full_pass_counts(self, repo, tmp_path):
        r, sha = repo
        ledger = f"{sha['b'][1]}\td\ta.py|b.py\n{sha['a'][1]}\td\t*\n"
        assert self.base(r, ledger, "", tmp_path)[0] == sha["a"][0]

    def test_a_tree_without_a_tab_is_not_a_record(self, repo, tmp_path):
        r, sha = repo
        assert self.base(r, f"{sha['mb'][1]}\n", sha["mb"][0], tmp_path)[0] == ""


class TestTheCommandLine:
    def test_side_base_prints_assignments_bash_can_eval(self, tmp_path):
        out = subprocess.run(["python3", "-I", str(ROOT / "scripts" / "gates_classify.py"), "side-base", str(tmp_path / "x"), ""],
                             capture_output=True, text=True, check=True).stdout
        sh = subprocess.run(["bash", "-c", 'eval "$1"; printf "%s|%s" "$SIDE_BASE" "$SIDE_WHY"', "_", out],
                            capture_output=True, text=True, check=True).stdout
        assert sh == "|; no pass recorded"

    def test_classify_prints_shell_assignments_bash_can_eval(self, checkout):
        out = subprocess.run(["python3", "-I", str(ROOT / "scripts" / "gates_classify.py"), "classify", checkout],
                             input="frontend/src/gone.ts\ntsconfig.x.json", capture_output=True, text=True, check=True).stdout
        sh = subprocess.run(["bash", "-c", 'eval "$1"; printf "%s|%s" "$RUN_BACKEND" "$FULL_F"', "_", out],
                            capture_output=True, text=True, check=True).stdout
        assert sh == "1|a root-level file this script does not recognise\na file was deleted or renamed: frontend/src/gone.ts\n"


def test_sync_files_leaves_out_a_tracked_file_deleted_but_not_committed(tmp_path):
    """`git ls-files` still lists it, and rsync stopped on it with exit 23 (gates, mobile sync; 2026-11-27)."""
    git = ["git", "-C", str(tmp_path), "-c", "user.name=t", "-c", "user.email=t@t", "-c", "commit.gpgsign=false"]
    subprocess.run(["git", "init", "-q", str(tmp_path)], check=True)
    for name in ("kept", "gone"):
        (tmp_path / name).write_text(name)
    subprocess.run([*git, "add", "."], check=True)
    subprocess.run([*git, "commit", "-qm", "x"], check=True)
    (tmp_path / "gone").unlink()
    (tmp_path / "new").write_text("new")
    out = subprocess.run(
        ["bash", "-c", f'source "{ROOT}/scripts/remote-common.sh"; sync_files'],
        cwd=tmp_path, capture_output=True, check=True,
    ).stdout.split(b"\0")
    assert sorted(f for f in out if f) == [b"kept", b"new"]
