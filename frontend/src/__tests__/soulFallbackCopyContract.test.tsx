/**
 * The two soul-detail columns against the REAL `I18nProvider` and the REAL
 * message bundles: does the copy they draw come out of `tf`, and does `tf`
 * pick the right side of its branch.
 *
 * WHY THIS FILE EXISTS. `tf(key, fallback)` renders `fallback` when no bundle
 * has `key`, and it detects that case by comparing `t`'s answer *against the
 * key* — `t` returns the key itself on a miss, so `t(k) || fallback` can never
 * reach its right-hand side (I18nContext's `makeTranslateWithFallback` carries
 * the full argument). Both components below used to declare a private copy of
 * that helper; `b3a3e7c` had already moved a third copy out of
 * `app/souls/[id]/page.tsx` into the context.
 *
 * Measured before those copies were removed, by mutation rather than by
 * reading:
 *
 *   - `if (t(key) === key)` -> `if (false)` (never detect the echo, so every
 *     call site renders a raw dotted key): `SoulLifecycleTimeline.test.tsx`
 *     went red on 3 tests. `ledgerQuantityContract.render.test.tsx`, the only
 *     suite that renders `SoulKarmaLedgerCard`, stayed GREEN — all 97 tests —
 *     even though all seven of that card's `tf` keys are absent from all three
 *     bundles, so the whole block would have shipped reading
 *     "ledger.decayed_merit" to an operator.
 *   - `if (t(key) === key)` -> `if (true)` (never consult the bundle, always
 *     render the source-literal fallback): BOTH suites stayed green, 97
 *     passed. Nothing anywhere pinned the other direction — that a key which
 *     IS present must beat the fallback, or a translated bundle still shows
 *     the literal.
 *
 * This file closes both. It asserts presence (the fallback copy is on screen),
 * absence (no raw dotted key is), and the reverse case (a key the bundle does
 * have wins over the literal written beside it).
 *
 * The real provider is used, not a `t: (key) => key` stub. A stub that echoes
 * keys puts every call site on the fallback branch unconditionally, which is
 * precisely the half that cannot see the `if (true)` mutation.
 */
import { render, screen } from "@testing-library/react";

import type { Judgment } from "@soulledger/core/api/judgment";
import type { Soul } from "@soulledger/core/api/souls";
import { I18nProvider } from "@/src/contexts/I18nContext";
import { SoulLifecycleTimeline } from "@/src/components/souls/SoulLifecycleTimeline";

// Recharts under next/dynamic is unrelated to what this file asserts and is a
// known source of jsdom flake. `requireActual` first so the stub replaces one
// export instead of deleting the rest of the module.
//
// Declared here rather than in the shared render helper: `jest.mock` is hoisted
// per test file and does not travel through an import.
jest.mock("@/src/components/charts/LazyDashboardCharts", () => ({
  ...jest.requireActual("@/src/components/charts/LazyDashboardCharts"),
  LazyLifespanBarChart: () => null,
}));

// The real `RequirePermission` runs; the identity underneath it is an ADMIN, so
// the action row this file reads is rendered. That the gate actually withholds
// for a non-ADMIN is `permissionGatesActuallyWithhold.test.tsx`'s job.
jest.mock("@/src/contexts/TenantContext", () => ({
  useTenant: () => ({
    user: { id: 1, username: "admin", role: "ADMIN", tenant: null, permissions: [] },
  }),
}));

import { BALANCE_READING, INHERITANCE } from "./support/ledgerQuantityFixtures";
import { renderCard } from "./support/ledgerQuantityRender";

/**
 * A raw i18n key that reached the screen: two or more dot-separated lowercase
 * segments.
 *
 * Deliberately not "does the output contain one specific key". A scan for
 * offenders is clean when it scans nothing, so every use below is paired with a
 * floor — the copy that must be present — asserted in the same test. Numerals
 * (`0.800`, `×1.000`) do not match: a segment has to start with a letter.
 */
const RAW_KEY = /(?:[a-z][a-z0-9_]*\.)+[a-z0-9_]+/g;

function rawKeysIn(container: HTMLElement): string[] {
  return Array.from(new Set((container.textContent ?? "").match(RAW_KEY) ?? []));
}

// ---------------------------------------------------------------------------
// SoulKarmaLedgerCard
// ---------------------------------------------------------------------------

/**
 * Every literal this card hands `tf`, with the copy written beside it.
 *
 * Written out rather than scraped from the component: a test that reads its
 * expectation out of the thing under test endorses whatever the thing under
 * test says. The list is also the floor for the absence scan below — with it
 * empty, "no raw key on screen" would pass over a card that drew nothing.
 */
const CARD_FALLBACKS: Array<[key: string, copy: string]> = [
  ["ledger.raw_vs_decayed", "原始 / 衰减后"],
  ["ledger.raw_merit", "原始 功德"],
  ["ledger.raw_demerit", "原始 罪业"],
  ["ledger.decayed_merit", "衰减后 功德"],
  ["ledger.decayed_demerit", "衰减后 罪业"],
  ["ledger.advisory_disclaimer", "仅供裁决参考 · 业力不参与判定计算，裁决由判官作出"],
];

describe("SoulKarmaLedgerCard — copy comes out of tf, against the real bundles", () => {
  it("draws the written fallback for every key no bundle carries", () => {
    expect(CARD_FALLBACKS.length).toBeGreaterThanOrEqual(6);

    const { container } = renderCard(BALANCE_READING, INHERITANCE);

    for (const [, copy] of CARD_FALLBACKS) {
      expect(container.textContent).toContain(copy);
    }
  });

  it("never puts the key itself on screen in place of that copy", () => {
    const { container } = renderCard(BALANCE_READING, INHERITANCE);

    // Named explicitly, because this is the exact string the `if (false)`
    // mutation produced while the existing contract suite stayed green.
    expect(container.textContent).not.toContain("ledger.decayed_merit");
    // And generally: nothing dotted-lowercase reached the screen at all.
    expect(rawKeysIn(container)).toEqual([]);
  });

  it("interpolates {{name}} into the fallback, not just the bare literal", () => {
    // `ledger.raw_balance_sr` is "原始余额 {{n}}" with n = rawMerit - rawDemerit,
    // summed from `original_weight`. The RECORDS fixture is 30 merit and 12
    // demerit raw, so 18 — deliberately not the decayed 24/9/15 the visible
    // row above it draws, so a substitution reading the wrong sum would show.
    // A fallback branch that returned the literal unsubstituted would leave
    // "{{n}}" here.
    const { container } = renderCard(BALANCE_READING, INHERITANCE);
    const srOnly = container.querySelector(".sr-only");

    expect(srOnly?.textContent).toBe("原始余额 18");
    expect(container.textContent).not.toContain("{{n}}");
  });
});

// ---------------------------------------------------------------------------
// SoulLifecycleTimeline
// ---------------------------------------------------------------------------

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

const concludedJudgment: Judgment = {
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
  verdict: "PASSED",
  notes: "",
  is_final: true,
  created_at: "2019-01-01T00:00:00Z",
  concluded_at: "2019-02-01T00:00:00Z",
};

function renderTimeline(judgments: Judgment[] = []) {
  return render(
    <I18nProvider>
      <SoulLifecycleTimeline
        soul={baseSoul()}
        judgments={judgments}
        dispositions={[]}
        reincarnations={[]}
        events={[]}
        ledgerRecords={[]}
        onOpenJudgmentQueue={() => {}}
      />
    </I18nProvider>
  );
}

describe("SoulLifecycleTimeline — copy comes out of tf, against the real bundles", () => {
  it("draws the written fallback for stage copy no bundle carries", () => {
    renderTimeline();

    expect(screen.getByText("灵魂账页")).toBeInTheDocument();
    expect(screen.getByText("尚未开始 · 灵魂身故后进入审判队列")).toBeInTheDocument();
    expect(screen.getByText("尚未开始 · 裁决后按判定结果分配去向")).toBeInTheDocument();
    expect(screen.getByText("尚未开始 · 需先完成处置")).toBeInTheDocument();
    expect(screen.getByText("待处置与轮回完成后确定")).toBeInTheDocument();
  });

  it("never puts the key itself on screen in place of that copy", () => {
    const { container } = renderTimeline();

    expect(container.textContent).not.toContain("souls.detail.timeline.stage_judging");
    expect(rawKeysIn(container)).toEqual([]);
  });

  it("lets a key the bundle DOES carry beat the literal written beside it", () => {
    // The direction a "does the fallback fire" test cannot see, and the one
    // that stayed green under the `if (true)` mutation. The verdict row is
    // `tf("souls.detail.timeline.verdict", "裁决 · {{verdict}}", { verdict:
    // tf("souls.detail.verdict_passed", "PASSED") })` — the outer key is in no
    // bundle and the inner one is in all three ("善行通过" in zh-Hans, the
    // provider's default locale). So the row proves both branches at once, in
    // one string.
    renderTimeline([concludedJudgment]);

    expect(screen.getByText("裁决 · 善行通过")).toBeInTheDocument();
    // Absence, not just presence: the raw member must not be what is shown.
    expect(screen.queryByText("裁决 · PASSED")).not.toBeInTheDocument();
  });
});
