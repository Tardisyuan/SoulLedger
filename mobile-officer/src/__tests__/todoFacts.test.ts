/** O-01: the timeline fold, the attachment helpers and the consequence sentence the confirm sheet picks. */
import type { FactHistory, TodoFacts } from "@soulledger/core/api/officer-app";

import { effectLine, historyView, isPdf, objectLines, sizeText, soulsView, unassignedShown } from "../todoFacts";

const step = (kind: FactHistory["kind"], name: string): FactHistory => ({ kind, name, actor: null, verdict: "", comment: "", at: null, mine: false });
const hall = (h: { display_name: string } | null | undefined) => h?.display_name ?? "";

describe("historyView", () => {
  const steps = [step("start", ""), step("decided", "a"), step("decided", "b"), step("decided", "c"), step("current", "d")];

  it("shows up to 4 steps in full", () => {
    expect(historyView(steps.slice(0, 4), false).shown).toHaveLength(4);
    expect(historyView(steps.slice(0, 4), false).hidden).toHaveLength(0);
  });

  it("past 4 keeps 发起 and the last 2, and folds the middle at position 1", () => {
    const v = historyView(steps, false);
    expect(v.shown.map((s) => s.name)).toEqual(["", "c", "d"]);
    expect(v.hidden.map((s) => s.name)).toEqual(["a", "b"]);
    expect(v.foldAt).toBe(1);
  });

  it("expanding shows every step", () => {
    expect(historyView(steps, true).shown).toHaveLength(5);
    expect(historyView(steps, true).hidden).toHaveLength(0);
  });
});

describe("attachments and lists", () => {
  it("tells a PDF from a picture and formats sizes", () => {
    expect(isPdf("application/pdf")).toBe(true);
    expect(isPdf("image/jpeg")).toBe(false);
    expect(sizeText(1.2 * 1024 * 1024)).toBe("1.2 MB");
    expect(sizeText(340 * 1024)).toBe("340 KB");
  });

  it("shows 2 souls and counts the rest", () => {
    expect(soulsView([1, 2, 3, 4], false)).toEqual({ shown: [1, 2], more: 2 });
    expect(soulsView([1, 2, 3, 4], true)).toEqual({ shown: [1, 2, 3, 4], more: 0 });
  });

  it("shows 3 unassigned letters until 「全部」 is pressed", () => {
    expect(unassignedShown([1, 2, 3, 4, 5], false)).toEqual([1, 2, 3]);
    expect(unassignedShown([1, 2, 3, 4, 5], true)).toHaveLength(5);
  });
});

describe("effectLine", () => {
  const facts = (f: Partial<TodoFacts>): { kind: string; title: string; facts: TodoFacts } => ({ kind: "approval", title: "t", facts: f as TodoFacts });

  it("approval: the last step says so; else it names the next node; unknown falls back to the older sentence", () => {
    const base = { kind: "approval", title: "x" };
    expect(effectLine({ ...base, facts: { node: { name: "n", index: 3, total: 3, is_last: true, next_name: null } } as TodoFacts }, "approve", hall)?.key).toBe("approve_effect.approval_last");
    expect(effectLine({ ...base, facts: { node: { name: "n", index: 1, total: 3, is_last: false, next_name: "二殿" } } as TodoFacts }, "approve", hall)).toEqual({ key: "approve_effect.approval", values: { next: "二殿" } });
    expect(effectLine({ ...base, facts: { node: { name: "n", index: 1, total: 3, is_last: null, next_name: null } } as TodoFacts }, "approve", hall)).toBeNull();
    // approval's reject keeps the existing sentence
    expect(effectLine({ ...base, facts: { node: { name: "n", index: 1, total: 3, is_last: false, next_name: "x" } } as TodoFacts }, "reject", hall)).toBeNull();
    expect(effectLine({ ...base, facts: undefined }, "approve", hall)).toBeNull();
  });

  it("dispatch: count and both halls, both verdicts", () => {
    const d = { ...facts({ soul_count: 12, from_hall: { code: "a", display_name: "十殿" }, to_hall: { code: "b", display_name: "九殿" } }), kind: "reassignment" };
    expect(effectLine(d, "approve", hall)).toEqual({ key: "approve_effect.dispatch", values: { n: "12", from: "十殿", to: "九殿" } });
    expect(effectLine(d, "reject", hall)?.key).toBe("reject_effect.dispatch");
  });

  it("rebirth names the soul", () => {
    const d = { ...facts({ soul: { name: "周阿满", soul_code: "S1" } }), kind: "rebirth" };
    expect(effectLine(d, "approve", hall)).toEqual({ key: "approve_effect.reincarnation", values: { name: "周阿满" } });
    expect(effectLine(d, "reject", hall)?.key).toBe("reject_effect.reincarnation");
  });

  it("cooldown: now -> typed days (or what was asked); reject keeps the days left", () => {
    const d = { ...facts({ soul: { name: "王二", soul_code: "S2" }, cooldown_now_days: 30, cooldown_asked_days: 10 }), kind: "cooldown" };
    expect(effectLine(d, "approve", hall)?.values).toEqual({ name: "王二", from: "30", to: "10" });
    expect(effectLine(d, "approve", hall, 7)?.values.to).toBe("7");
    expect(effectLine(d, "reject", hall)).toEqual({ key: "reject_effect.cooldown", values: { n: "30" } });
    const open = { ...facts({ soul: { name: "王二", soul_code: "S2" }, cooldown_now_days: 30, cooldown_asked_days: null }), kind: "cooldown" };
    expect(effectLine(open, "approve", hall)).toBeNull();
  });
});

describe("objectLines", () => {
  it("dispatch: souls and halls, then who asked", () => {
    const t = (key: string, v?: Record<string, string>) => `${key}${v ? JSON.stringify(v) : ""}`;
    const [top, bottom] = objectLines(
      { kind: "reassignment", title: "王二", facts: { soul_count: 12, requester: "钟书吏", from_hall: { code: "a", display_name: "十殿" }, to_hall: { code: "b", display_name: "九殿" } } as TodoFacts },
      hall,
      t,
    );
    expect(top).toContain("十殿 → 九殿");
    expect(bottom).toContain("钟书吏");
  });
});
