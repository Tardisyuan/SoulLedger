"""Passed/failed counts of a Playwright JSON report, with each failure's first error line."""
import json
import re
import sys

ANSI = re.compile(r"\x1b\[[0-9;]*m")
report = json.load(open(sys.argv[1], encoding="utf-8"))
counts = {"passed": 0, "failed": 0, "skipped": 0, "flaky": 0}
failures = []


def walk(suite):
    for spec in suite.get("specs", []):
        for test in spec["tests"]:
            status = {"expected": "passed", "unexpected": "failed", "skipped": "skipped", "flaky": "flaky"}[test["status"]]
            counts[status] += 1
            if status == "failed":
                error = (test["results"][-1].get("error") or {}).get("message", "")
                failures.append((f"{test['projectName']} › {spec['title']}", ANSI.sub("", error)[:900]))
    for child in suite.get("suites", []):
        walk(child)


for suite in report["suites"]:
    walk(suite)
print(counts)
for title, error in failures:
    print(f"FAIL {title}\n    {error}")
