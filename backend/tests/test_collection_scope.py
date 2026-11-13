"""
Meta-tests: guard the suite's own collection scope.

The backend keeps its tests in two trees, and only one of them is collected by
pytest's default rules:

  * ``backend/tests/`` — ``test_*.py``, collected by any pytest anywhere.
  * ``backend/apps/*/tests.py`` — 12 Django-convention modules that match no
    default pattern. They are collected *only* because ``pytest.ini`` lists a
    bare ``tests.py`` in ``python_files``.

Dropping ``tests.py`` from that line reads like removing a redundant pattern.
It is not: it deletes several hundred tests from every run, and because a test
that is never collected cannot fail, the build stays green while the coverage
number quietly slides. That is the exact failure mode these meta-tests exist to
convert into a red test.

There are no count floors here any more (2026-11-13). The three there were
(300 / 900 / 1900 tests) had been written against 1974 tests and were still in
place at several times that, so most of the suite could stop being collected and
stay green. What is asserted instead does not go stale: every test file on disk
— the same walk ``scripts/select-backend-tests.py`` selects from — shows up in
pytest's collection.
"""
import functools
import importlib.util
import subprocess
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[2]
BACKEND = REPO_ROOT / "backend"

# The gate's own list of test files (apps/ and tests/, `test_*.py` and `tests.py`,
# migrations excluded). Reused, not re-derived: a file the selector can pick and
# pytest cannot collect is exactly the gap this file exists for.
_spec = importlib.util.spec_from_file_location(
    "select_backend_tests", REPO_ROOT / "scripts" / "select-backend-tests.py"
)
_selector = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(_selector)


@functools.lru_cache(maxsize=1)
def _collected_node_ids() -> tuple[str, ...]:
    """Node IDs from a full ``--collect-only`` run, via a clean subprocess.

    ``-o addopts=...`` drops the coverage flags from ``pytest.ini`` (nothing is
    executed, so they would only slow this down and confuse the parent run's
    report) while keeping ``--import-mode=importlib``. That import mode is not
    optional: the 12 ``tests.py`` modules share a basename, and under the
    default prepend mode collection dies on the duplicate.
    """
    proc = subprocess.run(
        [
            sys.executable, "-m", "pytest",
            "--collect-only", "-q",
            "-o", "addopts=--import-mode=importlib",
            "-p", "no:cacheprovider",
        ],
        cwd=REPO_ROOT,
        capture_output=True,
        text=True,
        timeout=600,
    )
    assert proc.returncode == 0, (
        "Collecting the suite failed, so the collection scope cannot be "
        f"checked at all.\nexit={proc.returncode}\n"
        f"--- stdout ---\n{proc.stdout[-4000:]}\n--- stderr ---\n{proc.stderr[-2000:]}"
    )
    return tuple(line for line in proc.stdout.splitlines() if "::" in line)


def test_bare_tests_py_is_still_a_python_files_pattern(pytestconfig):
    """The one config line that makes backend/apps/*/tests.py collectable."""
    patterns = pytestconfig.getini("python_files")
    assert "tests.py" in patterns, (
        "pytest.ini lost `tests.py` from python_files. Every "
        "backend/apps/*/tests.py module just stopped being collected — the "
        "suite will still pass, with several hundred fewer tests in it."
    )

    app_tests_py = sorted(p.relative_to(REPO_ROOT) for p in BACKEND.glob("apps/*/tests.py"))
    assert len(app_tests_py) >= 12, (
        f"Expected at least 12 backend/apps/*/tests.py modules, found "
        f"{len(app_tests_py)}: {[str(p) for p in app_tests_py]}"
    )


def test_every_app_tests_py_module_is_collected():
    """Not just 'some tests.py files' — each one of them, by name."""
    collected = _collected_node_ids()
    collected_files = {node.split("::", 1)[0] for node in collected}

    missing = [
        str(p.relative_to(REPO_ROOT))
        for p in sorted(BACKEND.glob("apps/*/tests.py"))
        if str(p.relative_to(REPO_ROOT)) not in collected_files
    ]
    assert not missing, (
        "These test modules exist on disk but pytest collected nothing from "
        f"them: {missing}. Either python_files no longer matches `tests.py`, "
        "or the modules failed to import."
    )


def test_every_test_file_on_disk_is_collected():
    """A file that stops being collected does not fail; it stops existing.

    Covers what the floors used to stand in for — a tree dropped from
    ``testpaths``, a ``python_files`` pattern lost, a ``conftest`` ``collect_ignore``,
    a module that no longer declares any test — and names the files.
    """
    on_disk = [f"backend/{rel}" for rel in _selector.all_test_files()]
    # The walk found something: this file, and one of each kind of name.
    assert "backend/tests/test_collection_scope.py" in on_disk
    assert any(f.endswith("/tests.py") for f in on_disk)

    collected_files = {node.split("::", 1)[0] for node in _collected_node_ids()}
    missing = [f for f in on_disk if f not in collected_files]
    assert not missing, (
        f"{len(missing)} of {len(on_disk)} test files exist on disk but pytest "
        f"collected nothing from them: {missing}"
    )
