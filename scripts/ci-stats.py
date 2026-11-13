#!/usr/bin/env python3
"""Assemble the CI run's test counts into the shape of frontend/src/config/landing-stats.json ("tests" block).

usage: ci-stats.py <dir holding backend.xml, web.json, soul_app.json, officer_app.json> > landing-stats.json
Counts are passed tests (skipped excluded), read from pytest's --junitxml and jest's --json. No E2E count:
Playwright's reporter is not wired for it, so that key is left out rather than guessed.
"""
import datetime
import json
import os
import sys
import xml.etree.ElementTree as ET
from pathlib import Path

d = Path(sys.argv[1])
suite = ET.parse(d / "backend.xml").getroot()
suite = suite if suite.tag == "testsuite" else suite[0]
backend = sum(int(suite.get(k, 0)) * s for k, s in (("tests", 1), ("skipped", -1), ("failures", -1), ("errors", -1)))
tests = {"backend": f"{backend:,}"}
for key in ("web", "soul_app", "officer_app"):
    tests[key] = f"{json.loads((d / f'{key}.json').read_text())['numPassedTests']:,}"
server, repo, run = (os.environ.get(k, "") for k in ("GITHUB_SERVER_URL", "GITHUB_REPOSITORY", "GITHUB_RUN_ID"))
print(json.dumps({
    "measured": datetime.date.today().isoformat(),
    "commit": os.environ.get("GITHUB_SHA", ""),
    "run": f"{server}/{repo}/actions/runs/{run}" if run else "",
    "tests": tests,
}, indent=2, ensure_ascii=False))
