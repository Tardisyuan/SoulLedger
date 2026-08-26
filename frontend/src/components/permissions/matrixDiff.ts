import { Permission } from "@/lib/api";

// ─────────────────────────────────────────────────────────────────────────
// Pure helpers — no React/DOM dependency, re-exported from
// app/permissions/page.tsx so src/__tests__/PermissionsMatrixDiff.test.ts can
// exercise the three-tier save guard directly instead of through a fully
// mounted page.
// ─────────────────────────────────────────────────────────────────────────

/** roleName -> set of granted permission ids. */
export type GrantMap = Record<string, Set<number>>;

export interface RoleDiff {
  role: string;
  addedIds: number[];
  removedIds: number[];
  addedCodenames: string[];
  removedCodenames: string[];
  beforeCount: number;
  afterCount: number;
  /** 1 = pure addition, 2 = removal but not to zero, 3 = clears every codename this role holds. */
  tier: 1 | 2 | 3;
  removesMenuRead: boolean;
}

export function codenameOf(permsById: Record<number, Permission>, id: number): string {
  return permsById[id]?.codename ?? String(id);
}

/**
 * Diffs one role's in-progress checked selection against its loaded
 * baseline. Returns null when nothing changed — callers filter those out so
 * an untouched role never shows up in a save confirmation.
 *
 * assign_role_permissions replaces a role's ENTIRE grant set on every call,
 * so this is the only thing standing between a stray click and silently
 * wiping a role. Tier boundaries, spelled out because they're the likeliest
 * place for an off-by-one (see PermissionsMatrixDiff.test.ts):
 *   - tier 1 requires removedIds to be EMPTY, not "small" — one removal
 *     alongside ten additions is still a removal, not a pure addition.
 *   - tier 3 requires the AFTER set to be empty, not "removedIds equals
 *     beforeIds" — unchecking every currently-granted box while also
 *     checking one brand-new box still clears the role to a set of size
 *     zero relative to nothing... no: it leaves size 1, which is tier 2, not
 *     3. Zero remaining after the edit is what tier 3 tests for, exactly
 *     because that's the case the typed-confirmation gate exists for.
 */
export function computeRoleDiff(
  role: string,
  before: Set<number>,
  after: Set<number>,
  permsById: Record<number, Permission>
): RoleDiff | null {
  const addedIds = [...after].filter((id) => !before.has(id));
  const removedIds = [...before].filter((id) => !after.has(id));
  if (addedIds.length === 0 && removedIds.length === 0) return null;

  const tier: 1 | 2 | 3 = removedIds.length === 0 ? 1 : after.size === 0 ? 3 : 2;
  const removedCodenames = removedIds.map((id) => codenameOf(permsById, id)).sort();

  return {
    role,
    addedIds,
    removedIds,
    addedCodenames: addedIds.map((id) => codenameOf(permsById, id)).sort(),
    removedCodenames,
    beforeCount: before.size,
    afterCount: after.size,
    tier,
    removesMenuRead: removedCodenames.includes("menu.read"),
  };
}

export function cloneGrantMap(map: GrantMap): GrantMap {
  const out: GrantMap = {};
  for (const [role, ids] of Object.entries(map)) out[role] = new Set(ids);
  return out;
}

/**
 * Finds a pair of roles where neither's grant set contains the other's —
 * live proof that the roles are peers, not a ladder. ADMIN is excluded: by
 * design it is a superset of everyone, so pairing it in would only ever
 * surface the uninteresting "ADMIN also has X" case. Real data, no
 * hardcoded role names or codenames.
 */
export function findNonSubsetPair(
  grants: GrantMap,
  roleNames: string[]
): { a: string; b: string; aOnly: number[]; bOnly: number[] } | null {
  const names = roleNames.filter((r) => r !== "ADMIN");
  for (let i = 0; i < names.length; i++) {
    for (let j = i + 1; j < names.length; j++) {
      const a = names[i];
      const b = names[j];
      const setA = grants[a] ?? new Set<number>();
      const setB = grants[b] ?? new Set<number>();
      const aOnly = [...setA].filter((id) => !setB.has(id));
      const bOnly = [...setB].filter((id) => !setA.has(id));
      if (aOnly.length > 0 && bOnly.length > 0) {
        return { a, b, aOnly, bOnly };
      }
    }
  }
  return null;
}

/**
 * Finds the most dramatic real example of "holds more codenames overall"
 * not implying "holds a superset" or "outranks": `higher` has strictly more
 * total grants than `lower`, yet `lower` holds at least one codename
 * `higher` doesn't. Picks the largest count gap among valid pairs so the
 * callout leads with the strongest proof available in the live data.
 */
export function findCountParadox(
  grants: GrantMap,
  roleNames: string[]
): { higher: string; higherCount: number; lower: string; lowerCount: number; exclusiveToLower: number[] } | null {
  const names = roleNames.filter((r) => r !== "ADMIN");
  let best: { higher: string; higherCount: number; lower: string; lowerCount: number; exclusiveToLower: number[] } | null = null;
  for (const higher of names) {
    for (const lower of names) {
      if (higher === lower) continue;
      const higherSet = grants[higher] ?? new Set<number>();
      const lowerSet = grants[lower] ?? new Set<number>();
      if (higherSet.size <= lowerSet.size) continue;
      const exclusiveToLower = [...lowerSet].filter((id) => !higherSet.has(id));
      if (exclusiveToLower.length === 0) continue;
      const gap = higherSet.size - lowerSet.size;
      if (!best || gap > best.higherCount - best.lowerCount) {
        best = { higher, higherCount: higherSet.size, lower, lowerCount: lowerSet.size, exclusiveToLower };
      }
    }
  }
  return best;
}
