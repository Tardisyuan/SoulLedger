/**
 * The matrix draws 「! 禁授」 from core's `ROLE_FORBIDDEN_CODENAMES`; the rule itself
 * is `ROLE_FORBIDDEN_CODENAMES` in backend/apps/perm/checker.py. Read the Python
 * and compare, so the two cannot drift: a codename added there and not here would
 * be a cell that looks grantable and is refused on save.
 */
import { readFileSync } from "node:fs";
import path from "node:path";

import {
  ROLE_FORBIDDEN_CODENAMES,
  WORKFLOW_APPROVE_CODENAMES,
  WORKFLOW_DESIGN_CODENAMES,
  capabilityForbids,
} from "@soulledger/core/api/perm";

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

function backendSet(name: string): string[] {
  const m = readFileSync(CHECKER, "utf8").match(new RegExp(`^${name} = frozenset\\(\\{([^}]*)\\}\\)`, "m"));
  if (!m) throw new Error(`${name} not found in checker.py`);
  return [...m[1].matchAll(/"([^"]+)"/g)].map((c) => c[1]).sort();
}

it("the design / approve codenames are the backend's (2026-10-29 item 13: by capability, not by role name)", () => {
  expect([...WORKFLOW_DESIGN_CODENAMES].sort()).toEqual(backendSet("WORKFLOW_DESIGN_CODENAMES"));
  expect([...WORKFLOW_APPROVE_CODENAMES].sort()).toEqual(backendSet("WORKFLOW_APPROVE_CODENAMES"));
  expect(ROLE_FORBIDDEN_CODENAMES.MODERATOR).not.toContain("workflow.approve");
});

it("capabilityForbids: approve beside design, design beside approve, never for ADMIN", () => {
  const lead = new Set(["workflow.create", "workflow.read"]);
  const judge = new Set(["workflow.approve", "workflow.read"]);
  expect(capabilityForbids("LEAD_COPY", "workflow.approve", lead)).toBe(true);
  expect(capabilityForbids("LEAD_COPY", "workflow.advance", lead)).toBe(true);
  expect(capabilityForbids("LEAD_COPY", "workflow.update", lead)).toBe(false);
  expect(capabilityForbids("JUDGE", "workflow.create", judge)).toBe(true);
  expect(capabilityForbids("JUDGE", "workflow.approve", judge)).toBe(false);
  expect(capabilityForbids("VIEWER", "workflow.approve", new Set())).toBe(false);
  expect(capabilityForbids("ADMIN", "workflow.approve", lead)).toBe(false);
  // A role that (from old data) holds both: the approve side is the refused one, design stays editable.
  const both = new Set(["workflow.create", "workflow.approve"]);
  expect(capabilityForbids("X", "workflow.approve", both)).toBe(true);
  expect(capabilityForbids("X", "workflow.create", both)).toBe(false);
});
