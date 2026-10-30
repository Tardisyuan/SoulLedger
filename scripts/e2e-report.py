"""Per-project summary of a Playwright JSON report, for `scripts/run-gates.sh --e2e`.

All projects run in one `playwright test`, so the line reporter's totals no longer say which project a
number belongs to. This reads the json reporter's file and prints, per requested project, the passed /
failed / flaky / skipped counts and every failed and flaky test by name (a test green only on the retry
is flaky and is named, not hidden). Exit 1 when the report is missing or unreadable, or carries
run-level errors (a webServer that never came up): Playwright's own exit status decides pass or fail.

    python3 scripts/e2e-report.py report.json chromium firefox mobile-chrome
"""
import json
import sys
from collections import Counter, defaultdict

LABELS = {"expected": "passed", "unexpected": "failed", "flaky": "flaky", "skipped": "skipped"}


def _tests(suite, path=()):
    title = (*path, suite["title"]) if suite.get("title") else path
    for spec in suite.get("specs", []):
        for test in spec.get("tests", []):
            yield test.get("projectName", ""), test.get("status", ""), " › ".join((*title, spec.get("title", "")))
    for child in suite.get("suites", []):
        yield from _tests(child, title)


def summary(report: dict, projects) -> list:
    counts, named = defaultdict(Counter), defaultdict(list)
    for suite in report.get("suites", []):
        for project, status, name in _tests(suite):
            counts[project][status] += 1
            if status in ("unexpected", "flaky"):
                named[project].append(f"      {LABELS[status]}: [{project}] {name}")
    lines = []
    for project in projects or sorted(counts):
        c = counts[project]
        parts = [f"{c[k]} {v}" for k, v in LABELS.items() if c[k]] or ["no tests"]
        lines.append(f"    {project}: {', '.join(parts)}")
        lines += named[project]
    for error in report.get("errors", []):
        message = (error.get("message") or str(error)).strip().splitlines() or [""]
        lines.append(f"    error: {message[0]}")
    return lines


def main(argv) -> int:
    try:
        with open(argv[1], encoding="utf-8") as fh:
            report = json.load(fh)
    except (OSError, ValueError, IndexError) as exc:
        print(f"    e2e-report: no readable Playwright JSON report ({exc})")
        return 1
    print("\n".join(summary(report, argv[2:])))
    return 1 if report.get("errors") else 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
