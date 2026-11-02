#!/usr/bin/env bash
# Inside the demo container (scripts/demo-remote.sh): build the demo, check its bundle, run frontend/e2e/demo.
set -u
cd /app/frontend || exit 1
NEXT_PUBLIC_DEMO_MODE=1 npx next build >/sl-tmp/demo-build.log 2>&1 || { tail -30 /sl-tmp/demo-build.log; exit 1; }
bash /app/scripts/check-demo-bundle.sh present /app/frontend/.next || exit 1
du -sh .next/static | sed 's/^/static: /'
rm -f /sl-tmp/demo-e2e.json
PLAYWRIGHT_JSON_OUTPUT_NAME=/sl-tmp/demo-e2e.json npx playwright test -c playwright.demo.config.ts --reporter=line,json "${@}" >/sl-tmp/demo-e2e.log 2>&1
rc=$?
python3 /app/scripts/demo-e2e-summary.py /sl-tmp/demo-e2e.json
echo "playwright exit: $rc"
exit $rc
