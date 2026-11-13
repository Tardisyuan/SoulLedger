/**
 * @jest-environment node
 *
 * The one test of eventRegistry.test.ts that reads a backend file. It lives here
 * so that the handler tests beside it are selected by imports like any other
 * test, and only this one runs on every push (frontend/jest.always-run.txt
 * lists tests that read files, and lists a file whole).
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { getRegisteredEvents, REALTIME_ONLY_EVENT_TYPES } from "@/lib/events/event_registry";

describe("scheduler events", () => {
  it("mirrors exactly the event constants backend/apps/scheduler/realtime.py publishes", () => {
    // The authority is the backend module, not this repo's copy of it: an
    // event renamed or added there must turn this red, not fall through to
    // the unknown-event handler (which invalidates nothing) in production.
    const source = readFileSync(
      path.join(__dirname, "..", "..", "..", "backend", "apps", "scheduler", "realtime.py"),
      "utf8"
    );
    expect(/^DOMAIN = "(\w+)"$/m.exec(source)?.[1]).toBe("scheduler");
    const published = [...source.matchAll(/^[A-Z_]+ = "(SCHEDULER_[A-Z_]+)"$/gm)].map((m) => m[1]).sort();
    expect(published.length).toBeGreaterThanOrEqual(3);
    expect([...REALTIME_ONLY_EVENT_TYPES].sort()).toEqual(published);
    // Plus the one scheduler event that is an EventType member, not a module constant.
    expect(getRegisteredEvents("scheduler").sort()).toEqual([...published, "SCHEDULER_RUN_FAILED"].sort());
  });
});
