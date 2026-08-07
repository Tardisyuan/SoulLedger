/**
 * Pure-function tests for the Stage 3 soul lifecycle spine's row builders
 * (src/components/souls/soulLifecycleRows.ts). Kept separate from the
 * component test so the row construction/sorting/grouping/filtering rules —
 * the actual logic the design doc specifies — can be asserted directly
 * without going through React rendering or i18n mocks.
 */
import {
  buildKarmaRows,
  buildBirthMarker,
  buildDeathMarker,
  buildJudgmentMarkers,
  buildDispositionMarkers,
  buildReincarnationMarkers,
  groupSystemEvents,
  describeSystemEvent,
  computeFutureStages,
  buildCycleBandRows,
  filterRows,
  sortRows,
  type SpineRow,
} from "@/src/components/souls/soulLifecycleRows";
import type { LedgerRecord } from "@/lib/api/ledger";
import type { Soul } from "@/lib/api/souls";
import type { SoulEvent } from "@/lib/api/events";
import type { Judgment } from "@/lib/api/judgment";
import type { Disposition } from "@/lib/api/disposition";
import type { Reincarnation } from "@/lib/api/reincarnation";

function record(overrides: Partial<LedgerRecord> = {}): LedgerRecord {
  return {
    id: "r1",
    type: "MERIT",
    category: "CHARITY",
    description: "gave alms",
    original_weight: 10,
    effective_weight: 8,
    years_elapsed: 5,
    decay_factor: 0.8,
    civilization: "CHINESE",
    recorded_at: "2020-01-01T00:00:00Z",
    event_date: { year: 2020, month: 1, day: 1 },
    is_milestone: false,
    ...overrides,
  };
}

function soul(overrides: Partial<Soul> = {}): Soul {
  return {
    id: "s1",
    name: "Current Name",
    civilization: "CHINESE",
    current_state: "ALIVE",
    birth_date: { year: 1900, month: 1, day: 1 },
    death_date: null,
    date_problems: [],
    origin_location: "Beijing",
    description: "",
    ...overrides,
  } as Soul;
}

describe("buildKarmaRows", () => {
  it("signs effective/original by MERIT vs DEMERIT and carries decay figures", () => {
    const rows = buildKarmaRows([
      record({ id: "m1", type: "MERIT", original_weight: 10, effective_weight: 8 }),
      record({ id: "d1", type: "DEMERIT", original_weight: 6, effective_weight: 3 }),
    ]);
    const merit = rows.find((r) => r.id === "karma-m1")!;
    const demerit = rows.find((r) => r.id === "karma-d1")!;
    expect(merit.effectiveSigned).toBe(8);
    expect(merit.originalSigned).toBe(10);
    expect(demerit.effectiveSigned).toBe(-3);
    expect(demerit.originalSigned).toBe(-6);
  });

  it("labels the row by event_date year, not recorded_at, when event_date is present", () => {
    const rows = buildKarmaRows([record({ event_date: { year: -44, month: 3, day: 15 } })]);
    expect(rows[0].dateLabel).toBe("44 BCE");
  });

  it("falls back to recorded_at when event_date is null", () => {
    const rows = buildKarmaRows([record({ event_date: null, recorded_at: "1969-07-20T00:00:00Z" })]);
    expect(rows[0].dateLabel).toBe("1969-07-20");
  });
});

describe("birth/death markers", () => {
  it("returns null when the date is absent", () => {
    expect(buildBirthMarker(soul({ birth_date: null }), "born")).toBeNull();
    expect(buildDeathMarker(soul({ death_date: null }), "died")).toBeNull();
  });

  it("builds a marker when the date is present", () => {
    const m = buildBirthMarker(soul({ birth_date: { year: 1900, month: 1, day: 1 } }), "born title");
    expect(m?.title).toBe("born title");
    expect(m?.category).toBe("structural");
  });
});

describe("buildJudgmentMarkers", () => {
  const labels = { entered: (court: string) => `entered:${court}`, verdict: (v: string) => `verdict:${v}` };

  function judgment(overrides: Partial<Judgment> = {}): Judgment {
    return {
      id: "j1",
      soul: "s1",
      soul_name: "x",
      civilization: "CHINESE",
      judge: null,
      judge_name: null,
      court: "地府",
      evidence_json: {},
      confession: "",
      verdict: null,
      notes: "",
      is_final: false,
      created_at: "2020-01-01T00:00:00Z",
      concluded_at: null,
      ...overrides,
    };
  }

  it("always emits an 'entered judgment' marker", () => {
    const rows = buildJudgmentMarkers([judgment()], labels);
    expect(rows).toHaveLength(1);
    expect(rows[0].title).toBe("entered:地府");
  });

  it("adds a second verdict marker only when is_final and verdict are set", () => {
    const rows = buildJudgmentMarkers(
      [judgment({ is_final: true, verdict: "PASSED", concluded_at: "2020-02-01T00:00:00Z" })],
      labels
    );
    expect(rows).toHaveLength(2);
    expect(rows[1].title).toBe("verdict:PASSED");
    expect(rows[1].tone).toBe("merit");
  });

  it("colors a FAILED verdict as demerit tone and PURGATORY as info", () => {
    const failed = buildJudgmentMarkers([judgment({ is_final: true, verdict: "FAILED" })], labels);
    const purgatory = buildJudgmentMarkers([judgment({ is_final: true, verdict: "PURGATORY" })], labels);
    expect(failed[1].tone).toBe("demerit");
    expect(purgatory[1].tone).toBe("info");
  });

  it("does not add a verdict marker for an open (non-final) judgment", () => {
    const rows = buildJudgmentMarkers([judgment({ is_final: false, verdict: null })], labels);
    expect(rows).toHaveLength(1);
  });
});

describe("buildDispositionMarkers", () => {
  const labels = { executed: (realm: string) => `executed:${realm}`, eternal: "eternal", memoryReset: (y: string) => `reset:${y}` };

  function disposition(overrides: Partial<Disposition> = {}): Disposition {
    return {
      id: "d1",
      soul: "s1",
      judgment: "j1",
      destination_realm: "realm-uuid-1234",
      realm_name: "十八层地狱",
      realm_code: "HELL_18",
      is_eternal: false,
      is_executed: true,
      executed_at: "2020-03-01T00:00:00Z",
      memory_reset: "FULL",
      notes: "",
      created_at: "2020-02-15T00:00:00Z",
      ...overrides,
    };
  }

  it("titles the marker with the realm name, never the raw UUID", () => {
    const rows = buildDispositionMarkers([disposition()], labels);
    expect(rows[0].title).toBe("executed:十八层地狱");
    expect(rows[0].title).not.toContain("realm-uuid-1234");
  });

  it("puts the UUID only in the idChip field, as a value a caller can render as a small chip", () => {
    const rows = buildDispositionMarkers([disposition()], labels);
    expect(rows[0].idChip).toBe("realm-uuid-1234");
  });

  it("skips dispositions that have not been executed yet", () => {
    const rows = buildDispositionMarkers([disposition({ is_executed: false })], labels);
    expect(rows).toHaveLength(0);
  });
});

describe("buildReincarnationMarkers", () => {
  it("builds one marker per reincarnation record", () => {
    const r: Reincarnation = {
      id: "re1",
      soul: "s1",
      disposition: "d1",
      target_realm: "HUMAN_REALM",
      rebirth_form: "HUMAN",
      cycle_count: 1,
      previous_realm: "HELL_18",
      new_identity: "沈砚秋",
      notes: "",
      reincarnated_at: "2020-04-01T00:00:00Z",
    };
    const rows = buildReincarnationMarkers([r], {
      reborn: (name) => `reborn:${name}`,
      cycle: (n, realm) => `cycle:${n}:${realm}`,
    });
    expect(rows[0].title).toBe("reborn:沈砚秋");
    expect(rows[0].metadata).toBe("cycle:1:HUMAN_REALM");
  });
});

describe("system events — grouping and payload decoding", () => {
  function event(overrides: Partial<SoulEvent> = {}): SoulEvent {
    return {
      id: "e1",
      soul: "s1",
      event_type: "KARMA_RECALCULATED",
      payload: {},
      actor: "system",
      create_time: "2020-01-01T00:00:00Z",
      ...overrides,
    };
  }

  it("collapses consecutive identical (type, actor, timestamp) events into one group", () => {
    const events = [
      event({ id: "e1" }),
      event({ id: "e2" }),
      event({ id: "e3" }),
      event({ id: "e4", event_type: "STATE_CHANGED", create_time: "2020-01-02T00:00:00Z" }),
    ];
    const groups = groupSystemEvents(events);
    expect(groups).toHaveLength(2);
    expect(groups.find((g) => g.eventType === "KARMA_RECALCULATED")?.items).toHaveLength(3);
  });

  it("does not merge same-type events at different timestamps", () => {
    const events = [
      event({ id: "e1", create_time: "2020-01-01T00:00:00Z" }),
      event({ id: "e2", create_time: "2020-01-02T00:00:00Z" }),
    ];
    expect(groupSystemEvents(events)).toHaveLength(2);
  });

  it("decodes STATE_CHANGED payload into a readable transition instead of the bare token", () => {
    const text = describeSystemEvent(
      event({ event_type: "STATE_CHANGED", payload: { old_state: "JUDGING", new_state: "DISPOSED", reason: "Judgment concluded: PASSED" } })
    );
    expect(text).not.toBe("STATE_CHANGED");
    expect(text).toContain("JUDGING");
    expect(text).toContain("DISPOSED");
    expect(text).toContain("Judgment concluded: PASSED");
  });

  it("falls back to a label map (not the raw token) for an unmapped-but-known event type, and to the token itself only when truly unknown", () => {
    expect(describeSystemEvent(event({ event_type: "SOUL_CREATED", payload: {} }))).not.toBe("SOUL_CREATED");
    expect(describeSystemEvent(event({ event_type: "SOME_FUTURE_EVENT_TYPE", payload: {} }))).toBe("SOME_FUTURE_EVENT_TYPE");
  });
});

describe("computeFutureStages", () => {
  it("lists every stage after the current one, plus NEXT_LIFE, for ALIVE", () => {
    expect(computeFutureStages("ALIVE")).toEqual(["JUDGING", "DISPOSED", "REINCARNATING", "NEXT_LIFE"]);
  });

  it("lists only what's left for JUDGING", () => {
    expect(computeFutureStages("JUDGING")).toEqual(["DISPOSED", "REINCARNATING", "NEXT_LIFE"]);
  });

  it("lists only NEXT_LIFE once REINCARNATING", () => {
    expect(computeFutureStages("REINCARNATING")).toEqual(["NEXT_LIFE"]);
  });

  it("has nothing pending for the absorbing terminal states", () => {
    expect(computeFutureStages("SETTLED")).toEqual([]);
    expect(computeFutureStages("LOST")).toEqual([]);
  });
});

describe("buildCycleBandRows", () => {
  it("returns nothing for a soul that has never reincarnated", () => {
    expect(buildCycleBandRows(soul(), [], (n) => `life ${n}`)).toEqual([]);
  });

  it("builds one band per life, using birth_name for life 1 and new_identity for later lives", () => {
    const s = soul({ name: "沈砚秋", birth_name: "崔明远" });
    const reinc: Reincarnation = {
      id: "re1",
      soul: "s1",
      disposition: "d1",
      target_realm: "HUMAN_REALM",
      rebirth_form: "HUMAN",
      cycle_count: 1,
      previous_realm: "HELL_18",
      new_identity: "沈砚秋",
      notes: "",
      reincarnated_at: "2020-04-01T00:00:00Z",
    };
    const rows = buildCycleBandRows(s, [reinc], (n) => `life ${n}`);
    expect(rows).toHaveLength(2);
    expect(rows[0].cycleNumber).toBe(1);
    expect(rows[0].name).toBe("崔明远");
    expect(rows[0].isCurrent).toBe(false);
    expect(rows[1].cycleNumber).toBe(2);
    expect(rows[1].name).toBe("沈砚秋");
    expect(rows[1].isCurrent).toBe(true);
  });
});

describe("filterRows / sortRows", () => {
  const rows: SpineRow[] = [
    { id: "k1", kind: "karma", category: "karma", sortKey: 10, dateLabel: null, effectiveSigned: 1, originalSigned: 1, decayFactor: 1, yearsElapsed: 0, title: "", category_code: "X", type: "MERIT", isMilestone: false },
    { id: "j1", kind: "marker", category: "judgment", sortKey: 20, dateLabel: null, glyph: "", title: "", tone: "neutral" },
    { id: "s1", kind: "system", category: "system", sortKey: 30, dateLabel: null, title: "", count: 1, actor: "system", items: [] },
    { id: "st1", kind: "future", category: "structural", sortKey: 5, title: "", hint: "" },
  ];

  it("always keeps structural rows regardless of tab", () => {
    expect(filterRows(rows, "karma", false).some((r) => r.id === "st1")).toBe(true);
    expect(filterRows(rows, "judgment", false).some((r) => r.id === "st1")).toBe(true);
  });

  it("hides system rows unless includeSystemEvents is true, in every tab", () => {
    expect(filterRows(rows, "all", false).some((r) => r.id === "s1")).toBe(false);
    expect(filterRows(rows, "all", true).some((r) => r.id === "s1")).toBe(true);
  });

  it("'karma' tab shows only karma-category rows (plus structural)", () => {
    const visible = filterRows(rows, "karma", false).map((r) => r.id);
    expect(visible).toEqual(expect.arrayContaining(["k1", "st1"]));
    expect(visible).not.toContain("j1");
  });

  it("'judgment' tab shows only judgment-category rows (plus structural)", () => {
    const visible = filterRows(rows, "judgment", false).map((r) => r.id);
    expect(visible).toEqual(expect.arrayContaining(["j1", "st1"]));
    expect(visible).not.toContain("k1");
  });

  it("sorts newest-first by sortKey", () => {
    const sorted = sortRows(rows).map((r) => r.id);
    expect(sorted).toEqual(["s1", "j1", "k1", "st1"]);
  });
});
