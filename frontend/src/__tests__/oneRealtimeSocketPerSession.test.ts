/**
 * One realtime socket per session, and one module that opens it.
 *
 * WHAT WENT WRONG. `app/layout.tsx` mounted `WebSocketProvider` and, inside
 * it, `SocialEventBusProvider`. Each built its own client — `WSClient` and
 * `SocialWSClient` — and both clients derived the SAME URL from
 * `getWebSocketUrl()` (`/ws/notifications/`), so every session held two
 * sockets to one endpoint and every server push arrived twice. Both handlers
 * routed into `lib/events/event_registry`'s `dispatchEvent`, so each push was
 * two toasts and two invalidations (measured on 2026-09-12: FL-01).
 *
 * `useSocialEventBus` had no consumer outside its own file and one identity
 * test; `SocialWSClient` had no consumer outside that hook. Both are gone.
 *
 * WHY A SOURCE SCAN AND NOT A RENDER. `app/layout.tsx` is an async server
 * component that reads `cookies()` and imports two font packages; rendering it
 * under jest is not a thing this suite does anywhere. What can be stated
 * without rendering, and is the actual invariant, is structural: exactly one
 * module constructs a `WebSocket`, and exactly one module imports it. A second
 * client module — or a second importer of the one client — is how the defect
 * comes back, and either is visible here on the day it is written.
 *
 * Comments are stripped first, because the note over `WSClient.disconnect`
 * spells out `new WebSocket` in prose, and this file's own header does too.
 */
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";

const ROOT = path.join(__dirname, "..", "..", "..");
const SCANNED_DIRS = [
  "packages/core/src",
  "frontend/app",
  "frontend/src",
  "frontend/lib",
  "frontend/hooks",
  "frontend/components",
];

function walk(dir: string, out: string[] = []): string[] {
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === "node_modules" || entry.name === "__tests__") continue;
      walk(full, out);
    } else if (/\.tsx?$/.test(entry.name) && !/\.d\.ts$/.test(entry.name)) {
      out.push(full);
    }
  }
  return out;
}

function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
}

const SOURCES = walk(path.join(ROOT, "packages/core/src"))
  .concat(SCANNED_DIRS.slice(1).flatMap((dir) => walk(path.join(ROOT, dir))))
  .map((file) => ({
    file: path.relative(ROOT, file),
    code: stripComments(readFileSync(file, "utf8")),
  }));

describe("one realtime socket per session", () => {
  it("scanned a real tree", () => {
    // The floor for the scan, as every scanner in this directory carries one:
    // an empty tree passes both assertions below for the wrong reason.
    expect(SOURCES.length).toBeGreaterThan(200);
    expect(SOURCES.some(({ file }) => file === "packages/core/src/ws/client.ts")).toBe(true);
  });

  it("exactly one module constructs a WebSocket", () => {
    const constructors = SOURCES.filter(({ code }) => /\bnew\s+WebSocket\s*\(/.test(code)).map(
      ({ file }) => file
    );
    expect(constructors).toEqual(["packages/core/src/ws/client.ts"]);
  });

  it("exactly one module imports that client", () => {
    // Both spellings of the path: the package specifier the web tree uses and
    // the relative one a sibling inside `packages/core/src` would use.
    const importers = SOURCES.filter(({ code }) =>
      /from\s+"(?:@soulledger\/core\/ws\/|\.\.?\/(?:\.\.\/)*ws\/)/.test(code)
    ).map(({ file }) => file);
    expect(importers).toEqual(["frontend/src/contexts/WebSocketContext.tsx"]);
  });
});
