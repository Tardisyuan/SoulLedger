/**
 * Component tests for SoulLifecycleTimeline — the Stage 3 "灵魂账页" spine
 * that replaces the four stacked judgment/disposition/reincarnation/event-log
 * boxes on app/souls/[id]/page.tsx (docs/design-handoff/BRIEF.md §4.1).
 */
import { render, screen, fireEvent } from "@testing-library/react";
import { SoulLifecycleTimeline } from "@/src/components/souls/SoulLifecycleTimeline";
import type { Soul } from "@soulledger/core/api/souls";
import type { Judgment } from "@soulledger/core/api/judgment";
import type { LedgerRecord } from "@soulledger/core/api/ledger";
import type { SoulEvent } from "@soulledger/core/api/events";

jest.mock("@/src/contexts/I18nContext", () => ({
  useI18n: () => ({
    t: (key: string) => key,
    locale: "zh-Hans",
    hydrated: true,
  }),
}));

// 这里曾把 `RequirePermission` 桩成透传。那个桩不看 `permissions` 这个 prop,
// 于是本文件覆盖到的每一道权限门都可以被整个删掉而本套件全绿。改成桩它下面
// 那层 `useTenant`:真实的门跑起来,身份是一个「什么都有」的 ADMIN,所以本文件
// 原有的断言语义不变,而门本身不再被绕过。
// 门**扣住东西**这件事由 `permissionGatesActuallyWithhold.test.tsx` 用非 ADMIN
// 身份正反两面守;那份守卫已用变异证实会红。
jest.mock("@/src/contexts/TenantContext", () => ({
  useTenant: () => ({
    user: { id: 1, username: "admin", role: "ADMIN", tenant: null, permissions: [] },
  }),
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

    // Identified by the raw event_type on the row's `title`, not by its copy.
    // This used to look for the literal "业力重算", which only worked because
    // soulLifecycleRows.ts carried a hard-coded Chinese label map — the very
    // thing that made the row untranslatable. That copy now lives in
    // souls.events.* in the three bundles, and this file's `t` echoes keys, so
    // matching on Chinese here would be matching on a defect.
    expect(document.querySelector('[title="KARMA_RECALCULATED"]')).toBeNull();

    fireEvent.click(screen.getByRole("checkbox"));

    const row = document.querySelector('[title="KARMA_RECALCULATED"]');
    expect(row).not.toBeNull();
    // Raw member recoverable from `title`, and absent from the text beside it.
    // What that text actually says in each locale is asserted against the real
    // bundles in soulLifecycleEventCopy.test.tsx.
    expect(row?.textContent).not.toContain("KARMA_RECALCULATED");
    // The Δ+3 from the payload still renders — the row decodes the event, it
    // does not just name its type.
    expect(row?.textContent).toContain("Δ+3");
  });
});
