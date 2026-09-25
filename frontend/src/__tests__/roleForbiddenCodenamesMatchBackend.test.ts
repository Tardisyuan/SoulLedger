/**
 * The matrix draws 「! 禁授」 from core's `ROLE_FORBIDDEN_CODENAMES`; the rule itself
 * is `ROLE_FORBIDDEN_CODENAMES` in backend/apps/perm/checker.py. Read the Python
 * and compare, so the two cannot drift: a codename added there and not here would
 * be a cell that looks grantable and is refused on save.
 */
import { readFileSync } from "node:fs";
import path from "node:path";

import { ROLE_FORBIDDEN_CODENAMES } from "@soulledger/core/api/perm";

const CHECKER = path.resolve(__dirname, "../../../backend/apps/perm/checker.py");

function backendRule(): Record<string, string[]> {
  const source = readFileSync(CHECKER, "utf8");
  const block = source.match(/^ROLE_FORBIDDEN_CODENAMES = \{([\s\S]*?)^\}/m);
  if (!block) throw new Error("ROLE_FORBIDDEN_CODENAMES not found in checker.py");
  const rule: Record<string, string[]> = {};
  for (const m of block[1].matchAll(/"(\w+)":\s*frozenset\(\{([^}]*)\}\)/g)) {
    rule[m[1]] = [...m[2].matchAll(/"([^"]+)"/g)].map((c) => c[1]).sort();
  }
  return rule;
}

it("core's forbidden-grant table is the backend's, role by role and codename by codename", () => {
  const backend = backendRule();
  expect(Object.keys(backend).length).toBeGreaterThan(0);
  const core = Object.fromEntries(Object.entries(ROLE_FORBIDDEN_CODENAMES).map(([r, cs]) => [r, [...cs].sort()]));
  expect(core).toEqual(backend);
});
