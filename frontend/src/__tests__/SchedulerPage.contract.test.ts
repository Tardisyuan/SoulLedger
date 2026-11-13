/**
 * @jest-environment node
 *
 * The one test of SchedulerPage.test.tsx that reads a backend file. It renders
 * nothing, so it lives here: the page tests are selected by imports, and only
 * this runs on every push (frontend/jest.always-run.txt lists a file whole).
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import en from "@soulledger/core/messages/en.json";
import egy from "@soulledger/core/messages/egy.json";
import zhHans from "@soulledger/core/messages/zh-Hans.json";
import egyPendingKeys from "./support/egyPendingKeys.json";

describe("the bundles cover every job the backend registers", () => {
  it("has a description for each JobSpec in backend/apps/scheduler/registry.py, in all three locales", () => {
    // The backend derives description_key as "scheduler.jobs." + key with dots
    // flattened (JobSpec.description_key). Derived from the registry, not from
    // a list here, so a ninth job turns this red until it has copy.
    const source = readFileSync(path.join(__dirname, "..", "..", "..", "backend", "apps", "scheduler", "registry.py"), "utf8");
    const keys = [...source.matchAll(/JobSpec\(\s*"([\w.]+)"/g)].map((m) => m[1].replace(/\./g, "_"));
    expect(keys.length).toBeGreaterThanOrEqual(8);
    for (const [locale, bundle] of [["zh-Hans", zhHans], ["en", en], ["egy", egy]] as const) {
      const jobs = (bundle as { scheduler: { jobs: Record<string, string> } }).scheduler.jobs;
      // egy may lack exactly the job names listed in egyPendingKeys.json (Design has not given the words).
      const pending = new Set<string>(egyPendingKeys);
      const exempt = (k: string) => locale === "egy" && pending.has(`scheduler.jobs.${k}`);
      expect({ locale, missing: keys.filter((k) => !jobs[k] && !exempt(k)) }).toEqual({ locale, missing: [] });
    }
  });
});
