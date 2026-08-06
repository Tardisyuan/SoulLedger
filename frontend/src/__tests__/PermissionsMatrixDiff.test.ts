/**
 * Tests for the pure diff/tier helpers behind app/permissions/page.tsx's
 * three-tier save guard.
 *
 * assign_role_permissions (backend/apps/perm/views.py) REPLACES a role's
 * entire grant set on every call — there is no partial/additive mode. These
 * helpers are what decide, from the diff between a role's loaded baseline
 * and the operator's in-progress selection, whether a save can go straight
 * through (tier 1), needs a confirmation modal listing every removed
 * codename (tier 2), or needs typed-name confirmation because it clears the
 * role to zero (tier 3). Getting a tier boundary off by one here means a
 * destructive replace either fires with no warning or gets over-gated.
 */
import {
  computeRoleDiff,
  cloneGrantMap,
  findNonSubsetPair,
  findCountParadox,
  type GrantMap,
} from "@/app/permissions/page";
import type { Permission } from "@/lib/api";

function perm(id: number, codename: string, category = "soul"): Permission {
  return { id, codename, name: codename, category };
}

const PERMS_BY_ID: Record<number, Permission> = {
  1: perm(1, "soul.read"),
  2: perm(2, "soul.update"),
  3: perm(3, "soul.delete"),
  4: perm(4, "menu.read", "system"),
  5: perm(5, "dispatch.manage", "dispatch"),
  6: perm(6, "judgment.execute", "judgment"),
  7: perm(7, "workflow.approve", "workflow"),
  8: perm(8, "workflow.advance", "workflow"),
};

describe("computeRoleDiff", () => {
  it("returns null when the selection matches the baseline exactly", () => {
    const before = new Set([1, 2]);
    const after = new Set([2, 1]); // same members, different insertion order
    expect(computeRoleDiff("VIEWER", before, after, PERMS_BY_ID)).toBeNull();
  });

  it("classifies a pure addition as tier 1, even with several codenames added", () => {
    const before = new Set([1]);
    const after = new Set([1, 2, 3]);
    const diff = computeRoleDiff("VIEWER", before, after, PERMS_BY_ID);
    expect(diff).not.toBeNull();
    expect(diff!.tier).toBe(1);
    expect(diff!.removedIds).toEqual([]);
    expect(diff!.addedCodenames).toEqual(["soul.delete", "soul.update"]);
  });

  it("classifies a single removal alongside additions as tier 2, not tier 1", () => {
    // The off-by-one this guards against: "mostly additions" is not "pure
    // addition" the moment even one codename leaves the set.
    const before = new Set([1, 2]);
    const after = new Set([1, 3]); // drops 2, adds 3
    const diff = computeRoleDiff("GUARDIAN", before, after, PERMS_BY_ID);
    expect(diff!.tier).toBe(2);
    expect(diff!.removedCodenames).toEqual(["soul.update"]);
    expect(diff!.addedCodenames).toEqual(["soul.delete"]);
  });

  it("classifies a removal that leaves at least one codename as tier 2", () => {
    const before = new Set([1, 2, 3]);
    const after = new Set([1]);
    const diff = computeRoleDiff("GUARDIAN", before, after, PERMS_BY_ID);
    expect(diff!.tier).toBe(2);
    expect(diff!.afterCount).toBe(1);
  });

  it("classifies clearing every held codename as tier 3", () => {
    const before = new Set([1, 2, 3]);
    const after = new Set<number>();
    const diff = computeRoleDiff("VIEWER", before, after, PERMS_BY_ID);
    expect(diff!.tier).toBe(3);
    expect(diff!.afterCount).toBe(0);
  });

  it("does NOT classify as tier 3 when every currently-held codename is removed but a new one is added", () => {
    // The other off-by-one: removedIds === beforeIds is not the tier-3 test.
    // The AFTER set must be empty — swapping the role's one codename for a
    // different one still leaves it holding exactly one thing.
    const before = new Set([1]);
    const after = new Set([2]); // 1 removed, 2 added — role ends with size 1
    const diff = computeRoleDiff("VIEWER", before, after, PERMS_BY_ID);
    expect(diff!.tier).toBe(2);
    expect(diff!.afterCount).toBe(1);
  });

  it("flags removesMenuRead only when menu.read is actually in the removed set", () => {
    const before = new Set([1, 4]);
    const withMenuRemoved = computeRoleDiff("GUARDIAN", before, new Set([1]), PERMS_BY_ID);
    expect(withMenuRemoved!.removesMenuRead).toBe(true);

    const withoutMenuRemoved = computeRoleDiff("GUARDIAN", before, new Set([4]), PERMS_BY_ID);
    expect(withoutMenuRemoved!.removesMenuRead).toBe(false);
  });

  it("sorts added/removed codenames for a stable, readable confirmation list", () => {
    const before = new Set([3, 1]);
    const after = new Set([2]);
    const diff = computeRoleDiff("VIEWER", before, after, PERMS_BY_ID);
    expect(diff!.removedCodenames).toEqual(["soul.delete", "soul.read"]);
    expect(diff!.addedCodenames).toEqual(["soul.update"]);
  });
});

describe("cloneGrantMap", () => {
  it("deep-clones so mutating the clone never touches the source", () => {
    const source: GrantMap = { ADMIN: new Set([1, 2]) };
    const clone = cloneGrantMap(source);
    clone.ADMIN.add(99);
    expect(source.ADMIN.has(99)).toBe(false);
  });
});

describe("findNonSubsetPair", () => {
  it("finds two roles where neither holds a subset of the other's grants, excluding ADMIN", () => {
    const grants: GrantMap = {
      ADMIN: new Set([1, 2, 3, 4, 5, 6, 7, 8]),
      JUDGE: new Set([1, 6, 7, 8]), // holds judgment/workflow.approve+advance GUARDIAN lacks
      GUARDIAN: new Set([1, 2, 5]), // holds soul.update/dispatch.manage JUDGE lacks
      VIEWER: new Set([1]), // subset of both — should not be picked over JUDGE/GUARDIAN
    };
    const pair = findNonSubsetPair(grants, ["ADMIN", "GUARDIAN", "JUDGE", "VIEWER"]);
    expect(pair).not.toBeNull();
    expect([pair!.a, pair!.b].sort()).toEqual(["GUARDIAN", "JUDGE"]);
    expect(pair!.aOnly.length).toBeGreaterThan(0);
    expect(pair!.bOnly.length).toBeGreaterThan(0);
  });

  it("returns null when every non-ADMIN role is a subset of some other role", () => {
    const grants: GrantMap = {
      ADMIN: new Set([1, 2, 3]),
      MODERATOR: new Set([1, 2]),
      VIEWER: new Set([1]),
    };
    expect(findNonSubsetPair(grants, ["ADMIN", "MODERATOR", "VIEWER"])).toBeNull();
  });
});

describe("findCountParadox", () => {
  it("picks the pair with the largest count gap where the smaller role still holds something exclusive", () => {
    const grants: GrantMap = {
      ADMIN: new Set([1, 2, 3, 4, 5, 6, 7, 8]),
      // MODERATOR: big set, but missing workflow.approve/advance (7, 8)
      MODERATOR: new Set([1, 2, 3, 4, 5, 6]),
      // JUDGE: smaller set, but holds 7 and 8 exclusively vs MODERATOR
      JUDGE: new Set([1, 6, 7, 8]),
      // GUARDIAN: smaller still, holds 2 exclusively vs JUDGE but the gap is
      // narrower than MODERATOR vs JUDGE — should lose to that pair.
      GUARDIAN: new Set([1, 2]),
    };
    const paradox = findCountParadox(grants, ["ADMIN", "MODERATOR", "JUDGE", "GUARDIAN"]);
    expect(paradox).not.toBeNull();
    expect(paradox!.higher).toBe("MODERATOR");
    expect(paradox!.lower).toBe("JUDGE");
    expect(paradox!.exclusiveToLower.sort()).toEqual([7, 8]);
  });

  it("returns null when the role with more grants is always a superset of every smaller role", () => {
    const grants: GrantMap = {
      ADMIN: new Set([1, 2, 3]),
      MODERATOR: new Set([1, 2]),
      VIEWER: new Set([1]),
    };
    expect(findCountParadox(grants, ["ADMIN", "MODERATOR", "VIEWER"])).toBeNull();
  });
});
