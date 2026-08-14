/**
 * Component tests for SoulLifecycleTimeline — the Stage 3 "灵魂账页" spine
 * that replaces the four stacked judgment/disposition/reincarnation/event-log
 * boxes on app/souls/[id]/page.tsx (docs/design-handoff/BRIEF.md §4.1).
 */
import { render, screen, fireEvent } from "@testing-library/react";
import { SoulLifecycleTimeline } from "@/src/components/souls/SoulLifecycleTimeline";
import type { Soul } from "@/lib/api/souls";
import type { Judgment } from "@/lib/api/judgment";
import type { LedgerRecord } from "@/lib/api/ledger";
import type { SoulEvent } from "@/lib/api/events";

jest.mock("@/src/contexts/I18nContext", () => ({
  useI18n: () => ({
    t: (key: string) => key,
    locale: "zh-Hans",
    hydrated: true,
  }),
}));

jest.mock("@/src/components/rbac/RequirePermission", () => ({
  RequirePermission: ({ children }: { children: React.ReactNode }) => children,
}));

function baseSoul(overrides: Partial<Soul> = {}): Soul {
  return {
    id: "soul-1",
    name: "Test Soul",
    civilization: "CHINESE",
    current_state: "ALIVE",
    birth_date: null,
    death_date: null,
    date_problems: [],
    origin_location: "",
    description: "",
    ...overrides,
  } as Soul;
}

const noop = () => {};

describe("SoulLifecycleTimeline — empty-history soul", () => {
  it("shows dashed 'not yet' placeholder rows instead of an empty box, for a fresh ALIVE soul", () => {
    render(
      <SoulLifecycleTimeline
        soul={baseSoul()}
        judgments={[]}
        dispositions={[]}
        reincarnations={[]}
        events={[]}
        ledgerRecords={[]}
        onOpenJudgmentQueue={noop}
      />
    );

    // Fallback copy for each unreached stage (tf() falls back to Chinese
    // text since messages/*.json is out of scope for this component, same
    // convention the rest of this page already uses).
    expect(screen.getByText("尚未开始 · 灵魂身故后进入审判队列")).toBeInTheDocument();
    expect(screen.getByText("尚未开始 · 裁决后按判定结果分配去向")).toBeInTheDocument();
    expect(screen.getByText("尚未开始 · 需先完成处置")).toBeInTheDocument();
    expect(screen.getByText("待处置与轮回完成后确定")).toBeInTheDocument();
  });

  it("shows nothing pending for a terminal (SETTLED) soul", () => {
    render(
      <SoulLifecycleTimeline
        soul={baseSoul({ current_state: "SETTLED" })}
        judgments={[]}
        dispositions={[]}
        reincarnations={[]}
        events={[]}
        ledgerRecords={[]}
        onOpenJudgmentQueue={noop}
      />
    );
    expect(screen.queryByText("待处置与轮回完成后确定")).not.toBeInTheDocument();
  });
});

describe("SoulLifecycleTimeline — awaiting-judgment action row", () => {
  const openJudgment: Judgment = {
    id: "judgment-1",
    soul: "soul-1",
    soul_name: "Test Soul",
    civilization: "CHINESE",
    judge: null,
    judge_name: null,
    court: "",
    evidence_json: {},
    confession: "",
    citations: [],
    verdict: null,
    notes: "",
    is_final: false,
    created_at: "2024-01-01T00:00:00Z",
    concluded_at: null,
  };

  it("renders a highlighted card with a primary action instead of an empty judgment box, and the button opens the right judgment", () => {
    const onOpen = jest.fn();
    render(
      <SoulLifecycleTimeline
        soul={baseSoul({ current_state: "JUDGING" })}
        judgments={[openJudgment]}
        dispositions={[]}
        reincarnations={[]}
        events={[]}
        ledgerRecords={[]}
        onOpenJudgmentQueue={onOpen}
      />
    );

    const button = screen.getByRole("button", { name: "在审判队列中打开" });
    fireEvent.click(button);
    expect(onOpen).toHaveBeenCalledWith("judgment-1");

    // JUDGING itself is not also listed as a dashed future stage — it's the
    // highlighted "now" row above, not a "尚未开始" placeholder.
    expect(screen.queryByText("尚未开始 · 灵魂身故后进入审判队列")).not.toBeInTheDocument();
    expect(screen.getByText("尚未开始 · 裁决后按判定结果分配去向")).toBeInTheDocument();
  });
});

describe("SoulLifecycleTimeline — tabs and system-event toggle", () => {
  const ledgerRecords: LedgerRecord[] = [
    {
      id: "rec-1",
      type: "MERIT",
      category: "CHARITY",
      description: "karma entry",
      original_weight: 10,
      effective_weight: 8,
      years_elapsed: 2,
      decay_factor: 0.8,
      civilization: "CHINESE",
      recorded_at: "2020-01-01T00:00:00Z",
      event_date: { year: 2020, month: 1, day: 1 },
      is_milestone: false,
    },
  ];

  const judgments: Judgment[] = [
    {
      id: "judgment-2",
      soul: "soul-1",
      soul_name: "Test Soul",
      civilization: "CHINESE",
      judge: null,
      judge_name: null,
      court: "地府",
      evidence_json: {},
      citations: [],
      confession: "",
      verdict: "PASSED",
      notes: "",
      is_final: true,
      created_at: "2019-01-01T00:00:00Z",
      concluded_at: "2019-02-01T00:00:00Z",
    },
  ];

  const events: SoulEvent[] = [
    { id: "evt-1", soul: "soul-1", event_type: "KARMA_RECALCULATED", payload: { delta: 3 }, actor: "system", create_time: "2020-01-05T00:00:00Z" },
  ];

  it("仅业力 tab hides judgment markers but keeps the karma row", () => {
    render(
      <SoulLifecycleTimeline
        soul={baseSoul({ current_state: "DISPOSED" })}
        judgments={judgments}
        dispositions={[]}
        reincarnations={[]}
        events={[]}
        ledgerRecords={ledgerRecords}
        onOpenJudgmentQueue={noop}
      />
    );
    expect(screen.getByText("karma entry")).toBeInTheDocument();
    expect(screen.getByText("裁决 · PASSED")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "仅业力" }));

    expect(screen.getByText("karma entry")).toBeInTheDocument();
    expect(screen.queryByText(/裁决 ·/)).not.toBeInTheDocument();
  });

  it("system event rows stay hidden until 含系统事件 is checked", () => {
    render(
      <SoulLifecycleTimeline
        soul={baseSoul()}
        judgments={[]}
        dispositions={[]}
        reincarnations={[]}
        events={events}
        ledgerRecords={[]}
        onOpenJudgmentQueue={noop}
      />
    );

    expect(screen.queryByText(/业力重算/)).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("checkbox"));

    expect(screen.getByText(/业力重算/)).toBeInTheDocument();
  });
});
