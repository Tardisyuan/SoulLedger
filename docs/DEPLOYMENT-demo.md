# The Vercel demo

A build of `frontend/` with no backend at all. Every visitor gets the same world, and whatever they change stays in
their own browser tab until they sign out or back in. It exists to be shown to people who want to see the product.

## How it works

`NEXT_PUBLIC_DEMO_MODE=1` at build time is the only switch. Without it the build behaves as if the demo did not exist:
the three entry points (`PlatformProvider`, the login page, the root layout) are behind a comparison the bundler folds, and
`frontend/demo/` never reaches a chunk. `src/__tests__/demoStaysOutOfTheNormalBuild.test.ts` holds the spelling of the
gates; `scripts/check-demo-bundle.sh absent|present` checks what a finished build really contains.

With it on:

| Piece | File | What it does |
|---|---|---|
| Interception | `demo/install.ts` | axios gets another adapter, `fetch` is wrapped for `/api/v1/` paths, `WebSocket` becomes a stand-in that says "connected" and stays quiet. No Service Worker, no network. |
| Reads | `demo/store.ts` | Answers GETs from the recording, under the session's overlay. Timestamps move with the calendar, so "two hours ago" stays true. |
| Writes | `demo/writes.ts`, `demo/flows.ts` | Generic create / patch / delete, plus the main lines that have to move state like the server (see below). |
| Sign-in | `demo/DemoLogin.tsx` | One button per role; goes through the real `authApi.login`, which the demo answers. `proxy.ts` still gates routes on the same cookie. |
| Banner | `demo/DemoBanner.tsx` | The strip on top of every page. |

Reset: the overlay lives in `sessionStorage`. A reload keeps it; a new tab or another person starts clean; sign-in and
sign-out drop it, along with any drafts in `localStorage`.

Anything the recording does not know reads as empty and logs a `console.info("[demo] …")`; it never errors.

## Deploying on Vercel

1. New Project → import this repository.
2. **Root Directory**: `frontend`. Leave "Include files outside the Root Directory" on: `packages/core` and the root
   `package-lock.json` are outside it.
3. `frontend/vercel.json` already sets the framework, the install command (`npx npm@11 ci` from the repo root: npm 10
   installs a broken tree from this lockfile, see `CLAUDE.md`) and `NEXT_PUBLIC_DEMO_MODE=1`. Add no other environment
   variables. In particular no `NEXT_PUBLIC_API_URL` and no Sentry DSN.
4. **Node.js Version**: 22.x. `.nvmrc` says 20.19.5 for this machine; the repo's gates are also green on 22.
5. Deploy. `next.config.js` turns `output: "standalone"` off in demo mode, and `proxy.ts` runs as Vercel's middleware.

To look at a demo build by hand, on the gates' machine:

```bash
DEMO_PUBLISH="-p 3334:3334" scripts/demo-remote.sh scripts/demo-serve-inner.sh   # then http://gates-host.lan:3334
```

Or on any machine with the dependencies installed: `cd frontend && NEXT_PUBLIC_DEMO_MODE=1 npx next build && npx next start -p 3334`.

## Re-recording the data

`frontend/demo/data/<role>.json` is recorded from the real backend, not written by hand. When the API or the seed changes:

```bash
scripts/demo-record.sh        # needs GATES_REMOTE in .prepush.env; nothing heavy runs on this machine
```

That syncs this tree to the gates' machine and, in a container: creates a database on the throwaway PostgreSQL, migrates,
runs the seed commands and `scripts/demo-seed.py`, starts Django and a normal build, then `scripts/demo-record.mjs` signs in
as each role, walks every page and clicks every tab, sweeps every GET the OpenAPI schema declares, and writes the JSON. The
database is dropped at the end and the files come back here. Tokens and secret-named fields are removed from what is
recorded. To change what is in the world, edit `scripts/demo-seed.py`.

## Verifying

```bash
scripts/demo-remote.sh scripts/demo-e2e-inner.sh
```

Builds the demo, checks the bundle markers, and runs `frontend/e2e/demo/` (`frontend/playwright.demo.config.ts`), whose every
test fails if a request leaves the page's own origin. A normal `playwright test` ignores that directory.
