/**
 * 灵魂详情「账簿 × 卷宗」版式里会算的那两块:户头进度的「当前」从哪来,
 * 以及「丙 · 审判」的判词取哪一份、只有它是衬线。
 *
 * 真 I18nProvider,不用回显键的替身 —— 理由见 SoulLedgerBook.test.tsx 第 3 条。
 */
import { render, screen, within } from "@testing-library/react";

import type { Disposition, Judgment, Reincarnation, Soul } from "@soulledger/core/api";
import { I18nProvider } from "@/src/contexts/I18nContext";
import { stepStatuses } from "@/src/components/souls/detail/soulProgress";
import { SoulLedgerProgress } from "@/src/components/souls/detail/SoulLedgerProgress";
import { SoulLedgerSections } from "@/src/components/souls/detail/SoulLedgerSections";

const ALL = [true, true, true, true] as const;

describe("stepStatuses — the 当前 step comes from current_state, not from which data exists", () => {
  it("puts a second-life ALIVE soul at 01 even though it holds a previous life's records", () => {
    expect(stepStatuses("ALIVE", ALL)).toEqual(["current", "future", "future", "future"]);
  });

  it("walks JUDGING → 02, DISPOSED and SETTLED → 03, REINCARNATING → 04", () => {
    expect(stepStatuses("JUDGING", ALL)).toEqual(["done", "current", "future", "future"]);
    expect(stepStatuses("DISPOSED", ALL)).toEqual(["done", "done", "current", "future"]);
    expect(stepStatuses("SETTLED", ALL)).toEqual(["done", "done", "current", "future"]);
    expect(stepStatuses("REINCARNATING", ALL)).toEqual(["done", "done", "done", "current"]);
  });

  it("gives LOST (and an unknown state) no current step, marking only what has records", () => {
    expect(stepStatuses("LOST", [true, true, false, false])).toEqual(["done", "done", "future", "future"]);
    expect(stepStatuses("NOPE", [true, false, false, false])).toEqual(["done", "future", "future", "future"]);
  });
});

function judgment(over: Partial<Judgment> & Pick<Judgment, "id" | "created_at">): Judgment {
  return {
    soul: "s1",
    soul_name: "沈青梧",
    civilization: "CHINESE",
    judge: null,
    judge_name: null,
    court: "",
    evidence_json: {},
    confession: "",
    verdict: null,
    notes: "",
    citations: [],
    is_final: false,
    concluded_at: null,
    ...over,
  };
}

const SOUL = {
  id: "s1",
  name: "沈青梧",
  civilization: "CHINESE",
  current_state: "DISPOSED",
  birth_date: null,
  death_date: null,
  origin_location: "",
  description: "",
} as unknown as Soul;

const wrap = (ui: React.ReactElement) => render(<I18nProvider>{ui}</I18nProvider>);

describe("SoulLedgerProgress", () => {
  it("marks the current step, says 未至 for later ones, and a MissingValue where a passed step has no record", () => {
    const { container } = wrap(
      <SoulLedgerProgress
        soul={SOUL}
        judgments={[]}
        dispositions={[]}
        reincarnations={[] as Reincarnation[]}
        birthDisplay={null}
        deathDisplay={null}
      />
    );
    const steps = within(screen.getByTestId("soul-ledger-progress")).getAllByRole("listitem");
    expect(steps.map((s) => s.getAttribute("data-step-status"))).toEqual(["done", "done", "current", "future"]);
    expect(steps[2]).toHaveTextContent("03 处置 · 当前");
    expect(steps[3]).toHaveTextContent("未至");
    // 02 审判已过但没有一份判决:是「未记录」,不是编一个日期,也不是「未至」。
    expect(steps[1].querySelector('[data-missing="unrecorded"]')).not.toBeNull();
    expect(steps[1]).not.toHaveTextContent("未至");
    // 行程条与进度格读同一组状态。
    const stations = container.querySelectorAll("[data-route-status]");
    expect(Array.from(stations, (s) => s.getAttribute("data-route-status"))).toEqual([
      "done",
      "done",
      "current",
      "future",
    ]);
  });
});

describe("SoulLedgerSections — 丙 · 审判", () => {
  const judgments = [
    judgment({ id: "old", created_at: "2026-06-01T00:00:00Z", concluded_at: "2026-06-02T00:00:00Z", is_final: true, verdict: "FAILED", notes: "旧判词", court: "第一殿", judge_name: "秦广王" }),
    judgment({ id: "new", created_at: "2026-06-09T00:00:00Z", concluded_at: "2026-06-15T00:00:00Z", is_final: true, verdict: "PURGATORY", notes: "功过相抵，暂入救濟門。", court: "第五殿", judge_name: "阎罗王" }),
    judgment({ id: "open", created_at: "2026-06-20T00:00:00Z", notes: "未结案的草稿" }),
  ];

  it("quotes the latest concluded judgment's notes, signed by its court and judge, in the page's only serif", () => {
    const { container } = wrap(
      <SoulLedgerSections judgments={judgments} dispositions={[] as Disposition[]} reincarnations={[]} events={[]} />
    );
    const quote = screen.getByTestId("soul-verdict-quote");
    expect(quote).toHaveTextContent("功过相抵，暂入救濟門。");
    expect(quote.className).toContain("text-quote");
    expect(container).toHaveTextContent("— 第五殿 阎罗王");
    // 缺席:旧判词与未结案的草稿都不进引文。
    expect(container).not.toHaveTextContent("旧判词");
    expect(container).not.toHaveTextContent("未结案的草稿");
    expect(container.querySelectorAll(".font-serif")).toHaveLength(1);
  });

  it("draws each verdict with its glyph and says 待决 for an open case", () => {
    wrap(<SoulLedgerSections judgments={judgments} dispositions={[]} reincarnations={[]} events={[]} />);
    const rows = screen.getAllByTestId("ledger-judgment-row");
    expect(rows).toHaveLength(3);
    expect(rows[0]).toHaveTextContent("待决");
    expect(rows[1]).toHaveTextContent("◇");
    expect(rows[2]).toHaveTextContent("✕");
  });
});
