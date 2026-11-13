/**
 * @jest-environment node
 *
 * The two tests of officerAssist.test.tsx that read backend files. They render
 * nothing, so they live here: the panel tests are selected by imports, and only
 * these run on every push (frontend/jest.always-run.txt lists a file whole).
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { OFFICER_EMPTY_ANSWER, OFFICER_SCREENS } from "@soulledger/core/api/officer-assist";

const ASSIST = path.join(__dirname, "..", "..", "..", "backend", "apps", "soul_assist");

describe("the console's copies of two backend constants", () => {
  it("OFFICER_SCREENS is the backend's tuple, member for member", () => {
    const models = readFileSync(path.join(ASSIST, "models.py"), "utf8");
    const block = /OFFICER_SCREENS = \(([\s\S]*?)\n\)/.exec(models)?.[1] ?? "";
    const backend = [...block.matchAll(/"([^"]+)"/g)].map((m) => m[1]);
    expect(backend.length).toBeGreaterThan(20);
    expect([...OFFICER_SCREENS].sort()).toEqual([...backend].sort());
  });

  it("the fixed empty answer the console recognizes is the backend's OFFICER_EMPTY_ANSWER, word for word", () => {
    const service = readFileSync(path.join(ASSIST, "service.py"), "utf8");
    const block = /OFFICER_EMPTY_ANSWER = \{([\s\S]*?)\n\}/.exec(service)?.[1] ?? "";
    const backend = Object.fromEntries([...block.matchAll(/"([^"]+)": "([^"]+)"/g)].map((m) => [m[1], m[2]]));
    expect(backend).toEqual(OFFICER_EMPTY_ANSWER);
  });
});
