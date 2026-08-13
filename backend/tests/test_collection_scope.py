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

The collection counts are floors with slack, not exact figures — the suite is
expected to grow. Raise them when they get stale; never lower one to make a red
build green, because "fewer tests than yesterday" is the thing being detected.
"""
import functools
import re
import subprocess
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[2]
BACKEND = REPO_ROOT / "backend"

# Measured at the time of writing: 339 in apps/*/tests.py, 943 in backend/tests/,
# 692 in apps/**/test_*.py, 1974 total. Floors sit below those with room for the
# suite to shuffle, but far above what survives if a whole tree stops being
# collected.
MIN_APP_TESTS_PY = 300
MIN_BACKEND_TESTS_TREE = 900
MIN_TOTAL = 1900

APP_TESTS_PY_NODE = re.compile(r"^backend/apps/[^/]+/tests\.py::")
BACKEND_TESTS_NODE = re.compile(r"^backend/tests/")


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


def test_app_tests_py_tree_is_not_shrinking():
    collected = _collected_node_ids()
    count = sum(1 for node in collected if APP_TESTS_PY_NODE.match(node))
    assert count >= MIN_APP_TESTS_PY, (
        f"Only {count} tests collected from backend/apps/*/tests.py, expected "
        f"at least {MIN_APP_TESTS_PY}."
    )


def test_backend_tests_tree_is_not_shrinking():
    collected = _collected_node_ids()
    count = sum(1 for node in collected if BACKEND_TESTS_NODE.match(node))
    assert count >= MIN_BACKEND_TESTS_TREE, (
        f"Only {count} tests collected from backend/tests/, expected at least "
        f"{MIN_BACKEND_TESTS_TREE}."
    )


def test_total_collection_is_not_shrinking():
    count = len(_collected_node_ids())
    assert count >= MIN_TOTAL, (
        f"Only {count} tests collected in total, expected at least {MIN_TOTAL}. "
        "A large drop here usually means a whole tree stopped being collected "
        "rather than that tests were deliberately deleted."
    )
