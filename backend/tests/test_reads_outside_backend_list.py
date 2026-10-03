"""`backend/tests/reads-outside-backend.txt` must name exactly the backend tests
that can reach a file outside `backend/`, and what each one reaches.

The mirror of `frontend/src/__tests__/jestAlwaysRunList.test.ts`. The pre-push
gate (`scripts/run-gates.sh`) runs the whole backend suite only when a backend
file changes. Some backend tests read frontend, packages/core, mobile or root
files as text — `test_workflow_preset_case_types.py` parses
`frontend/src/components/workflow/WorkflowEditor.tsx` — so a change outside
`backend/` can break them, and until 2026-10-02 no such push ran them: the A1
workflow redesign broke that test and every frontend-only push passed until a
later branch happened to touch `backend/`.

Each line is `<test path, relative to backend/>  <top-level entries>`. When a
push changes nothing under `backend/`, the gate runs every listed test whose
entries include the first path component of a changed file (`frontend`,
`packages`, `docker-compose.production.yml`, ...), and every test listed with
`*`.

The list is derived, not curated:

* A test is ON the list when its source — or a `tests.*` module it imports,
  transitively (`test_workflow_preset_case_types.py` gets `REPO_ROOT` from
  `test_workflow_preset_node_types.py`; `chat_support.py` reads
  `config/synapse`) — holds a handle on the repository root:
  `.parents[N]` with N deep enough to leave `backend/`, a name `REPO` /
  `REPO_ROOT`, `BACKEND.parent` / `BASE_DIR.parent`, `.parent.parent`, three
  nested `os.path.dirname(`, a `"../` string, or `"git"` as an argument.
* Its ENTRIES are the repository's top-level names (everything beside
  `backend/`) that appear in that same source, quoted or slash-delimited:
  `REPO_ROOT / "frontend"`, `"packages/core/messages"`, `"pytest.ini"`. A test
  that reaches the root but names none of them is `*`: it runs on any change
  outside `backend/`. Fail closed.

Over-selection costs seconds; under-selection is a silent hole, so the patterns
are loose. The one known ceiling: a test that names an entry AND walks the whole
repository without naming what it walks would be under-selected; none does on
2026-10-02. Application code (non-test) reads no file outside `backend/` (checked
2026-10-02: every such path in `apps/` and `config/` is in a comment or a
backup-directory default), which is why only tests are scanned.

A missing line, a stale line, and a line with the wrong entries all fail. Proven
red on 2026-10-02: a throwaway test reading `frontend/package.json` that was not
on the list; a listed file that does not exist.

This file spells its own patterns, so it matches them and is on the list.
"""

import re
import subprocess
from pathlib import Path

BACKEND = Path(__file__).resolve().parents[1]
REPO = BACKEND.parent
LIST = BACKEND / "tests" / "reads-outside-backend.txt"

ROOT_HANDLE = re.compile(
    r"parents\[\s*(\d+)\s*\]"
    r"|\bREPO(?:_ROOT)?\b"
    r"|\b(?:BACKEND|BASE_DIR)\.parent\b"
    r"|\.parent\.parent\b"
    r"|(?:os\.path\.dirname\(\s*){3}"
    r"""|['"]\.\./"""
    r"""|['"]git['"]"""
)
FROM_TESTS = re.compile(r"^\s*from\s+tests(?:\.(\w+))?\s+import\s+([\w\s,()]+)", re.M)
IMPORT_TESTS = re.compile(r"^\s*import\s+tests\.(\w+)", re.M)
SKIP_DIRS = {".venv", "node_modules", "__pycache__", "media", "staticfiles"}
NOT_ENTRIES = {"backend", ".git", "node_modules"}


def _module(name: str) -> Path | None:
    f = BACKEND / "tests" / f"{name}.py"
    return f if f.is_file() else None


def _imported(src: str) -> set[Path]:
    out: set[Path] = set()
    for m in FROM_TESTS.finditer(src):
        if m.group(1):  # from tests.x import ...
            names = [m.group(1)]
        else:  # from tests import x, y as z
            names = [n.split()[0] for n in re.split(r"[,()]", m.group(2)) if n.strip()]
        out |= {f for f in map(_module, names) if f}
    out |= {f for f in map(_module, IMPORT_TESTS.findall(src)) if f}
    return out


def _closure(f: Path, seen: set[Path] | None = None) -> set[Path]:
    seen = set() if seen is None else seen
    if f not in seen:
        seen.add(f)
        for g in _imported(f.read_text(encoding="utf-8")):
            _closure(g, seen)
    return seen


def _reaches_root(f: Path) -> bool:
    # parents[depth] of a file `depth` directories below the repository root
    # is the root itself (backend/tests/x.py: parents[2]).
    depth = len(f.relative_to(REPO).parts) - 1
    return any(
        m.group(1) is None or int(m.group(1)) >= depth
        for m in ROOT_HANDLE.finditer(f.read_text(encoding="utf-8"))
    )


def _entries(files: set[Path]) -> list[str]:
    text = "\n".join(f.read_text(encoding="utf-8") for f in files)
    # Tracked top-level entries only: `os.listdir` also saw ignored local dirs
    # (media/, __pycache__/, .prepush.env), so the derived list differed between
    # the main checkout and a clean worktree, and the guard went red on merge.
    tracked = subprocess.run(
        ["git", "-C", str(REPO), "ls-files"], capture_output=True, text=True, check=True
    ).stdout.splitlines()
    names = sorted({t.split("/", 1)[0] for t in tracked} - set(NOT_ENTRIES))
    found = sorted(n for n in names if re.search(rf"""['"/]{re.escape(n)}['"/]""", text))
    return found or ["*"]


def _test_files() -> list[Path]:
    return [
        p
        for p in BACKEND.rglob("*.py")
        if not SKIP_DIRS & set(p.relative_to(BACKEND).parts)
        and (p.name.startswith("test_") or p.name == "tests.py")
    ]


def derived() -> list[str]:
    out = []
    for p in _test_files():
        files = _closure(p)
        if any(_reaches_root(f) for f in files):
            out.append(" ".join([p.relative_to(BACKEND).as_posix(), *_entries(files)]))
    return sorted(out)


def listed() -> list[str]:
    lines = LIST.read_text(encoding="utf-8").splitlines()
    return sorted(" ".join(s.split()) for s in lines if s.strip() and not s.lstrip().startswith("#"))


def test_it_is_derived_from_something():
    """Non-vacuity: a pattern that stopped matching would empty both sides."""
    lines = derived()
    assert len(lines) > 30
    assert any(
        line.startswith("tests/test_workflow_preset_case_types.py ") and " frontend" in line
        for line in lines
    )


def test_it_names_every_test_that_reads_outside_backend():
    have = set(listed())
    missing = [line for line in derived() if line not in have]
    # Add (or correct) these lines in backend/tests/reads-outside-backend.txt.
    # Left off, a test that reads a frontend file does not run on a
    # frontend-only push.
    assert missing == []


def test_it_names_nothing_else():
    want = set(derived())
    stale = [line for line in listed() if line not in want]
    # Deleted, renamed, entries changed, or no longer reading outside backend/.
    assert stale == []
