import type { MeRebirthApplication } from "@soulledger/core/api/soul";

import {
  APPLICATION_BADGES,
  LABEL_STACK_THRESHOLD,
  SOUL_STATE_BADGES,
  UNKNOWN_BADGE,
  badgeSpec,
  expiryOf,
  formatStamp,
  lexiconKey,
  stacksLabel,
  timelineOf,
} from "../rules";
import { application } from "./stubApi";

const app = (overrides: Record<string, unknown>) => application(overrides) as unknown as MeRebirthApplication;

describe("badgeSpec", () => {
  it("the five application states are told apart by glyph or border, not by colour alone", () => {
    const shapes = Object.values(APPLICATION_BADGES).map((b) => `${b.glyph}/${b.border}`);
    expect(new Set(shapes).size).toBe(Object.keys(APPLICATION_BADGES).length);
  });

  it("a member the copy layer could not name gets the unknown shape, even when the table has it", () => {
    expect(badgeSpec(APPLICATION_BADGES, "REJECTED", true)).toBe(APPLICATION_BADGES.REJECTED);
    expect(badgeSpec(APPLICATION_BADGES, "REJECTED", false)).toBe(UNKNOWN_BADGE);
    expect(badgeSpec(APPLICATION_BADGES, "ON_HOLD", true)).toBe(UNKNOWN_BADGE);
    expect(badgeSpec(SOUL_STATE_BADGES, null, true)).toBe(UNKNOWN_BADGE);
  });

  it("the unknown shape is its own: dotted border and a question mark, used by no known state", () => {
    expect(UNKNOWN_BADGE).toEqual({ tone: "unknown", glyph: "?", border: "dotted" });
    const known = [...Object.values(APPLICATION_BADGES), ...Object.values(SOUL_STATE_BADGES)];
    expect(known.filter((b) => b.glyph === "?" || b.border === "dotted")).toEqual([]);
  });
});

describe("expiryOf (initial password)", () => {
  const now = Date.parse("2026-09-17T12:00:00Z");
  const at = (minutes: number) => new Date(now + minutes * 60_000).toISOString();

  it("under 6 hours warns; 6 hours exactly does not", () => {
    expect(expiryOf(at(5 * 60 + 59), now)).toEqual({ hoursLeft: 5, warning: true, expired: false });
    expect(expiryOf(at(6 * 60), now)).toEqual({ hoursLeft: 6, warning: false, expired: false });
    expect(expiryOf(at(39 * 60 + 30), now)).toEqual({ hoursLeft: 39, warning: false, expired: false });
  });

  it("under an hour is 0 hours, not a negative or rounded-up number", () => {
    expect(expiryOf(at(30), now)).toEqual({ hoursLeft: 0, warning: true, expired: false });
  });

  it("past the deadline is expired, with 0 left", () => {
    expect(expiryOf(at(-90), now)).toEqual({ hoursLeft: 0, warning: true, expired: true });
  });

  it("no deadline, or an unreadable one, is no box at all", () => {
    expect(expiryOf(null, now)).toBeNull();
    expect(expiryOf("not a date", now)).toBeNull();
  });
});

describe("stacksLabel", () => {
  it(`switches to two lines above ${LABEL_STACK_THRESHOLD} characters`, () => {
    expect(stacksLabel("Cross-civilization")).toBe(false); // 18
    expect(stacksLabel("Cross-civilization.")).toBe(true); // 19
    expect(stacksLabel("Sheemtet Seth Wetep")).toBe(true);
    expect(stacksLabel("是否跨文明")).toBe(false);
  });

  it("counts characters, not UTF-16 units", () => {
    expect(stacksLabel("𓋴".repeat(18))).toBe(false);
  });
});

describe("lexiconKey", () => {
  it("Egypt reads the scores as heart and feather; the others keep merit and demerit", () => {
    expect(lexiconKey("eg", "merit")).toBe("soul_app.lexicon.eg.merit");
    expect(lexiconKey("eg", "demerit")).toBe("soul_app.lexicon.eg.demerit");
    for (const civ of ["neutral", "cn", "eu", "gr"] as const) {
      expect(lexiconKey(civ, "merit")).toBe("soul_app.life.merit");
    }
  });
});

describe("formatStamp", () => {
  it("is YYYY-MM-DD HH:mm in device time", () => {
    expect(formatStamp(new Date(2026, 8, 2, 14, 20).toISOString())).toBe("2026-09-02 14:20");
    expect(formatStamp(null)).toBeNull();
    expect(formatStamp("garbage")).toBeNull();
  });
});

describe("timelineOf", () => {
  const CREATED = "2026-09-02T06:20:00Z";
  const DECIDED = "2026-09-09T08:40:00Z";
  const shape = (a: MeRebirthApplication) => timelineOf(a).map((s) => `${s.key}:${s.state}${s.at ? `@${s.at}` : ""}`);

  it("under review: submitted, the current node, the outcome still to come", () => {
    expect(shape(app({ created_at: CREATED }))).toEqual([`submitted:done@${CREATED}`, "current:now", "outcome:todo"]);
    const current = timelineOf(app({})).find((s) => s.key === "current")!;
    expect(current.label).toEqual({ node: "EVALUATION", role: "JUDGE", appeal: false });
  });

  it("rejected and appealable: the rejection carries decided_at, the appeal is still open", () => {
    expect(
      shape(app({ created_at: CREATED, status: "REJECTED", decided_at: DECIDED, current_step: null, can_appeal: true }))
    ).toEqual([`submitted:done@${CREATED}`, `rejected:done@${DECIDED}`, "appeal-open:todo"]);
  });

  it("appealing: decided_at is NOT pinned on the first rejection, and nothing is given a time it does not have", () => {
    const steps = timelineOf(
      app({ created_at: CREATED, status: "APPEALING", decided_at: DECIDED, appeal_statement: "请复核", current_step: { node_type: "APPEAL", approver_role: "MODERATOR", is_appeal: true } })
    );
    expect(steps.map((s) => `${s.key}:${s.state}${s.at ? `@${s.at}` : ""}`)).toEqual([
      `submitted:done@${CREATED}`,
      "rejected:done",
      "appealed:done",
      "current:now",
      "outcome:todo",
    ]);
  });

  it("final outcomes carry decided_at", () => {
    expect(shape(app({ created_at: CREATED, status: "APPROVED", decided_at: DECIDED, current_step: null }))).toEqual([
      `submitted:done@${CREATED}`,
      `outcome:done@${DECIDED}`,
    ]);
    expect(
      shape(app({ created_at: CREATED, status: "APPEAL_REJECTED", decided_at: DECIDED, appeal_statement: "x", current_step: null }))
    ).toEqual([`submitted:done@${CREATED}`, "rejected:done", "appealed:done", `outcome:done@${DECIDED}`]);
  });

  it("an unknown status invents no steps beyond what the fields say", () => {
    expect(shape(app({ created_at: CREATED, status: "ON_HOLD", current_step: null }))).toEqual([`submitted:done@${CREATED}`]);
  });
});
