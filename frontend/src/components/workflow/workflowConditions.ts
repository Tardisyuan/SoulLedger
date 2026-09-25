import type { ConditionClause, ConditionFact, ConditionOp } from "@soulledger/core/api";
import { CIVILIZATION_OPTIONS } from "@soulledger/core/config/civilizations";

/**
 * The client half of `backend/apps/workflow/conditions.py`: the same three
 * facts, the same operators, the same "every clause set is a box" analysis —
 * so 发布 can be disabled on an empty or overlapping condition before the
 * round trip, with the backend still deciding (`POST publish/` runs the Python
 * original and 400s with the same codes).
 *
 * Declarative on both sides. A clause is `{fact, op, value}`; nothing here or
 * there parses a string or evaluates anything.
 */

export const NUMBER_OPS: readonly ConditionOp[] = ["lt", "lte", "gt", "gte", "eq"];
export const ENUM_OPS: readonly ConditionOp[] = ["in", "not_in"];

/**
 * `Verdict` (backend/apps/judgment/models.py). Spelled out because core has no
 * verdict list of its own for the judgment enum; the backend refuses any other
 * member at publish (`bad_value`), so a drift here shows up as a 400, not as a
 * silently wrong branch.
 */
export const VERDICTS = ["PASSED", "FAILED", "PURGATORY", "RETRY"] as const;

export const FACTS: Record<ConditionFact, { kind: "number" } | { kind: "enum"; values: readonly string[] }> = {
  balance: { kind: "number" },
  civilization: { kind: "enum", values: CIVILIZATION_OPTIONS },
  verdict: { kind: "enum", values: VERDICTS },
};

export const FACT_KEYS = Object.keys(FACTS) as ConditionFact[];

export function opsFor(fact: ConditionFact): readonly ConditionOp[] {
  return FACTS[fact].kind === "number" ? NUMBER_OPS : ENUM_OPS;
}

/** A fresh clause for `fact`, valid as it stands. */
export function defaultClause(fact: ConditionFact = "balance"): ConditionClause {
  const spec = FACTS[fact];
  return spec.kind === "number"
    ? { fact, op: "lt", value: 0 }
    : { fact, op: "in", value: [spec.values[0]] };
}

export type ClauseError = "unknown_fact" | "bad_op" | "bad_value";

export function clauseError(clause: ConditionClause): ClauseError | null {
  const spec = FACTS[clause.fact];
  if (!spec) return "unknown_fact";
  if (spec.kind === "number") {
    if (!NUMBER_OPS.includes(clause.op)) return "bad_op";
    return typeof clause.value === "number" && Number.isInteger(clause.value) ? null : "bad_value";
  }
  if (!ENUM_OPS.includes(clause.op)) return "bad_op";
  const v = clause.value;
  if (!Array.isArray(v) || v.length === 0 || v.some((x) => !spec.values.includes(x))) return "bad_value";
  return null;
}

type Interval = [number, number];
type Box = Map<ConditionFact, Interval | Set<string>>;

function clauseBox(c: ConditionClause): Interval | Set<string> {
  const spec = FACTS[c.fact];
  if (spec.kind === "number") {
    const v = c.value as number;
    // Integer intervals, as in Python: `< 0` is `≤ -1`.
    switch (c.op) {
      case "lt":
        return [-Infinity, v - 1];
      case "lte":
        return [-Infinity, v];
      case "gt":
        return [v + 1, Infinity];
      case "gte":
        return [v, Infinity];
      default:
        return [v, v];
    }
  }
  const listed = new Set(c.value as string[]);
  return c.op === "in" ? listed : new Set(spec.values.filter((x) => !listed.has(x)));
}

function meet(a: Interval | Set<string>, b: Interval | Set<string>): Interval | Set<string> {
  if (Array.isArray(a)) {
    const [lo, hi] = b as Interval;
    return [Math.max(a[0], lo), Math.min(a[1], hi)];
  }
  return new Set([...a].filter((x) => (b as Set<string>).has(x)));
}

function empty(x: Interval | Set<string>): boolean {
  return Array.isArray(x) ? x[0] > x[1] : x.size === 0;
}

/** The box a clause set describes, or null when no case can satisfy it. Assumes well-formed clauses. */
export function region(when: readonly ConditionClause[]): Box | null {
  const box: Box = new Map();
  for (const c of when) {
    const next = box.has(c.fact) ? meet(box.get(c.fact)!, clauseBox(c)) : clauseBox(c);
    if (empty(next)) return null;
    box.set(c.fact, next);
  }
  return box;
}

export function overlaps(a: Box, b: Box): boolean {
  for (const [fact, x] of a) {
    const y = b.get(fact);
    if (y !== undefined && empty(meet(x, y))) return false;
  }
  return true;
}

const OP_SIGN: Record<ConditionOp, string> = {
  lt: "<",
  lte: "≤",
  gt: ">",
  gte: "≥",
  eq: "=",
  in: "∈",
  not_in: "∉",
};

type TFunc = (key: string, params?: Record<string, string>) => string;

/** "余额 < 0" — the canvas label and the inspector summary. */
export function clauseText(c: ConditionClause, t: TFunc): string {
  const fact = t(`workflow.editor.condition.fact.${c.fact}`);
  const value = Array.isArray(c.value)
    ? c.value
        .map((v) => (c.fact === "civilization" ? t(`workflow.civilizations.${v}`) : t(`judgment.verdicts.${v.toLowerCase()}`)))
        .join(" / ")
    : String(c.value);
  return `${fact} ${OP_SIGN[c.op] ?? c.op} ${value}`;
}

export function whenText(when: readonly ConditionClause[], t: TFunc): string {
  return when.map((c) => clauseText(c, t)).join(" ∧ ");
}
