import type { MeRebirthApplication } from "@soulledger/core/api/soul";

import {
  APPLICATION_BADGES,
  LABEL_STACK_THRESHOLD,
  SOUL_STATE_BADGES,
  UNKNOWN_BADGE,
  badgeSpec,
  buildFlow,
  expiryOf,
  formatStamp,
  layoutFor,
  lexiconKey,
  residenceOf,
  stacksLabel,
} from "../rules";
import { application } from "./stubApi";

const app = (overrides: Record<string, unknown>) => application(overrides) as unknown as MeRebirthApplication;

describe("badgeSpec", () => {
  it("the five application states are told apart by glyph or border, not by colour alone", () => {
    const shapes = Object.values(APPLICATION_BADGES).map((b) => `${b.glyph}/${b.border}`);
    expect(new Set(shapes).size).toBe(Object.keys(APPLICATION_BADGES).length);
  });

  it("all six soul states (backend SoulState) have their own shape: distinct glyph+border, no neutral dot", () => {
    expect(Object.keys(SOUL_STATE_BADGES).sort()).toEqual(["ALIVE", "DISPOSED", "JUDGING", "LOST", "REINCARNATING", "SETTLED"]);
    const specs = Object.values(SOUL_STATE_BADGES);
    expect(new Set(specs.map((b) => `${b.glyph}/${b.border}`)).size).toBe(6);
    // Glyph alone must already separate them — colour and border are extra, not the distinction.
    expect(new Set(specs.map((b) => b.glyph)).size).toBe(6);
    expect(specs.filter((b) => b.glyph === "·")).toEqual([]);
    expect(SOUL_STATE_BADGES).toMatchObject({
      ALIVE: { glyph: "○" },
      LOST: { glyph: "⊘", border: "dashed", tone: "neg" },
      SETTLED: { glyph: "≡" },
    });
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
  it("Egypt says feather side / heart side (handoff 2f; round 1's heart / feather weights withdrawn)", () => {
    expect(lexiconKey("eg", "merit")).toBe("soul_app.lexicon.eg.merit");
    expect(lexiconKey("eg", "demerit")).toBe("soul_app.lexicon.eg.demerit");
    expect(lexiconKey("eg", "judging")).toBe("soul_app.lexicon.eg.judging");
    for (const civ of ["neutral", "cn", "eu", "gr"] as const) {
      expect(lexiconKey(civ, "merit")).toBe("soul_app.life.merit");
      expect(lexiconKey(civ, "judging")).toBe("soul_app.soul_states.JUDGING");
    }
  });

  it("the two civilizations without rebirth carry their own no-rebirth and no-past-lives sentences; the others do not", () => {
    for (const civ of ["eg", "eu"] as const) {
      expect(lexiconKey(civ, "no_rebirth_title")).toBe(`soul_app.lexicon.${civ}.no_rebirth_title`);
      expect(lexiconKey(civ, "no_past_lives")).toBe(`soul_app.lexicon.${civ}.no_past_lives`);
    }
    for (const civ of ["neutral", "cn", "gr"] as const) {
      expect(lexiconKey(civ, "no_past_lives")).toBe("soul_app.past_lives.empty");
    }
  });
});

describe("residenceOf", () => {
  it("is_residing false (or no profile) is at home — even if home_civilization says otherwise", () => {
    expect(residenceOf("eg", undefined)).toEqual({ current: "eg", home: "eg", residing: false });
    expect(residenceOf("eg", { is_residing: false, home_civilization: "EGYPTIAN" })).toEqual({ current: "eg", home: "eg", residing: false });
    expect(residenceOf("eg", { is_residing: false, home_civilization: "CHINESE" })).toEqual({ current: "eg", home: "eg", residing: false });
  });

  it("a Chinese soul residing in the Duat: skin stays where it is, words come from home", () => {
    const r = residenceOf("eg", { is_residing: true, home_civilization: "CHINESE" });
    expect(r).toEqual({ current: "eg", home: "cn", residing: true });
    expect(lexiconKey(r.home, "merit")).toBe("soul_app.life.merit");
    expect(lexiconKey(r.current, "merit")).toBe("soul_app.lexicon.eg.merit");
  });

  it("an unknown home civilization is not a residence (no guessing a lexicon)", () => {
    expect(residenceOf("cn", { is_residing: true, home_civilization: "ATLANTEAN" })).toEqual({ current: "cn", home: "cn", residing: false });
  });
});

describe("layoutFor (handoff 2f-四)", () => {
  it("≤ 340pt is compact with a 16pt gutter; 341pt is not", () => {
    expect(layoutFor(340, 1)).toMatchObject({ compact: true, gutter: 16 });
    expect(layoutFor(341, 1)).toMatchObject({ compact: false, gutter: 20 });
  });

  it("text ≥ 1.3× grows, ≥ 1.7× stacks; just below each does not", () => {
    expect(layoutFor(393, 1.29)).toMatchObject({ grow: false, stack: false });
    expect(layoutFor(393, 1.3)).toMatchObject({ grow: true, stack: false });
    expect(layoutFor(393, 1.69)).toMatchObject({ grow: true, stack: false });
    expect(layoutFor(393, 1.7)).toMatchObject({ grow: true, stack: true });
  });
});

describe("formatStamp", () => {
  it("is YYYY-MM-DD HH:mm in device time", () => {
    expect(formatStamp(new Date(2026, 8, 2, 14, 20).toISOString())).toBe("2026-09-02 14:20");
    expect(formatStamp(null)).toBeNull();
    expect(formatStamp("garbage")).toBeNull();
  });
});

describe("buildFlow (handoff 2e)", () => {
  const CREATED = "2026-09-02T06:20:00Z";
  const DECIDED = "2026-09-09T08:40:00Z";
  const shape = (a: MeRebirthApplication) =>
    buildFlow(a).map((s) => `${s.key}:${s.state}${s.at ? `@${s.at}` : ""}${s.dashedAfter ? ":dashed" : ""}`);

  it("A · under review: submitted, the current step (role, no time, dashed after), decision pending", () => {
    const a = app({ created_at: CREATED });
    expect(shape(a)).toEqual([`submitted:done@${CREATED}`, "current:now:dashed", "decision:todo"]);
    const current = buildFlow(a).find((s) => s.key === "current")!;
    expect(current).toMatchObject({ role: "JUDGE", name: { key: "soul_app.timeline.under_review" } });
    expect(current.at).toBeUndefined();
  });

  it("B · rejected and appealable: the decision carries decided_at, then an open appeal", () => {
    const a = app({ created_at: CREATED, status: "REJECTED", decided_at: DECIDED, current_step: null, can_appeal: true });
    expect(shape(a)).toEqual([`submitted:done@${CREATED}`, `decided:done@${DECIDED}`, "appeal:todo"]);
    expect(buildFlow(a)[1].name).toEqual({ key: "soul_app.timeline.decided", status: "REJECTED" });
  });

  it("C · appealing: the first rejection carries first_decided_at (the backend copied it before clearing decided_at)", () => {
    const FIRST = "2026-09-05T02:00:00Z";
    const a = app({
      created_at: CREATED,
      status: "APPEALING",
      decided_at: null,
      first_decided_at: FIRST,
      first_rejection_reason: "x",
      appeal_statement: "请复核",
      current_step: { node_type: "APPEAL", approver_role: "JUDGE", is_appeal: true },
    });
    expect(shape(a)).toEqual([`submitted:done@${CREATED}`, `first-decision:done@${FIRST}`, "current:now:dashed", "decision:todo"]);
    expect(buildFlow(a)[2].name.key).toBe("soul_app.timeline.appeal_review");
  });

  it("C′ · appealed before first_decided_at existed: the first rejection says 'unrecorded', borrows no other time", () => {
    const a = app({
      created_at: CREATED,
      status: "APPEALING",
      decided_at: null,
      appeal_statement: "请复核",
      current_step: { node_type: "APPEAL", approver_role: "JUDGE", is_appeal: true },
    });
    const first = buildFlow(a)[1];
    expect(first).toMatchObject({ key: "first-decision", note: "soul_app.detail.not_recorded" });
    expect(first.at).toBeUndefined();
  });

  it("D · approved and not appealable: exactly two steps, nothing invented after", () => {
    expect(shape(app({ created_at: CREATED, status: "APPROVED", decided_at: DECIDED, current_step: null }))).toEqual([
      `submitted:done@${CREATED}`,
      `decided:done@${DECIDED}`,
    ]);
  });

  it("appeal rejected: rejection and appeal happened (no times), the appeal's decision has decided_at", () => {
    expect(
      shape(app({ created_at: CREATED, status: "APPEAL_REJECTED", decided_at: DECIDED, appeal_statement: "x", current_step: null }))
    ).toEqual([`submitted:done@${CREATED}`, "first-decision:done", "appealed:done", `decided:done@${DECIDED}`]);
  });

  it("only created_at, first_decided_at and decided_at are ever used as times", () => {
    const FIRST = "2026-09-05T02:00:00Z";
    const cases = [
      app({ created_at: CREATED }),
      app({ created_at: CREATED, status: "REJECTED", decided_at: DECIDED, current_step: null, can_appeal: true }),
      app({ created_at: CREATED, status: "APPEAL_REJECTED", decided_at: DECIDED, first_decided_at: FIRST, appeal_statement: "x", current_step: null }),
    ];
    const times = cases.flatMap((a) => buildFlow(a).map((s) => s.at).filter(Boolean));
    expect(times.filter((t) => t !== CREATED && t !== DECIDED && t !== FIRST)).toEqual([]);
  });

  it("an unknown status with no step and no decision draws only what exists", () => {
    expect(shape(app({ created_at: CREATED, status: "ON_HOLD", current_step: null }))).toEqual([`submitted:done@${CREATED}`]);
  });
});
