#!/usr/bin/env bash
# Inside the demo container: build the demo and serve it, to look at it by hand.
#   DEMO_PUBLISH="-p 3334:3334" scripts/demo-remote.sh scripts/demo-serve-inner.sh   # then http://<GATES_REMOTE's address>:3334
cd /app/frontend || exit 1
NEXT_PUBLIC_DEMO_MODE=1 npx next build >/sl-tmp/demo-build.log 2>&1 || { tail -30 /sl-tmp/demo-build.log; exit 1; }
echo "demo: serving on :3334"
# The variable again: next.config.js reads it at start too, and without it would still say `output: "standalone"`.
NEXT_PUBLIC_DEMO_MODE=1 exec npx next start -H 0.0.0.0 -p 3334
