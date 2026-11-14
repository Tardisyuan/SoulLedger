/**
 * 案卷台就地判(用户 2026-11-14,fe-ia §3.5):右栏的判栏。按界面测 —— 1–4 只选中、⌘⏎ 落印、这一行滑出、选中到下一件、
 * 5 秒到点才发 `conclude/`、U 收回;未认领的先认领;要理由的裁决送去卷宗整页;393 宽不接键;选中后预取下一件;
 * 偏好「落印前先确认」打开时走回读层、当场发、没有撤回条。
 * 第四十六批第一节:判栏是最右一栏(栏头「判栏」),页头只有幽灵的「打开卷宗 ↗」、认领只在判栏;行滑出 440ms(减少动态 120ms);
 * 撤回条在判栏里、⌘Z 撤回;要写理由的判决在选项上说、选中后落印键换成「去卷宗整页写理由 →」;回读层焦点在「返回」、⌘⏎ 落印。
 */
import { act, fireEvent, screen, waitFor, within } from "@testing-library/react";
import type { Judgment } from "@soulledger/core/api/judgment";
import { judgmentApi } from "@soulledger/core/api/judgment";
import { dossiersApi } from "@soulledger/core/api/dossiers";
import { UNDO_MS } from "@soulledger/core/hooks/useJudgmentQueue";
import { CaseDesk, PREFETCH_DELAY_MS, SEAL_LEAVE_MS, SEAL_LEAVE_REDUCED_MS } from "@/src/components/desk/CaseDesk";
import { SEAL_READBACK_STORAGE_KEY } from "@/src/components/judgment/SealReadback";
import { renderWithProviders } from "./support/render";

const mockPush = jest.fn();
const mockShowToast = jest.fn();

// next/dynamic never resolves its loader under jest; hand back the real rail synchronously.
jest.mock("next/dynamic", () => () => require("@/src/components/desk/VerdictRail").default);
jest.mock("next/navigation", () => ({
  useRouter: () => ({ push: mockPush, replace: jest.fn(), back: jest.fn() }),
  usePathname: () => "/desk",
  useSearchParams: () => new URLSearchParams(),
}));
jest.mock("@/src/contexts/TenantContext", () => ({
  useTenant: () => ({ user: { role: "JUDGE", permissions: ["judgment.read", "judgment.execute"] } }),
}));
jest.mock("@/src/contexts/ToastContext", () => ({
  useToast: () => ({ showToast: mockShowToast }),
}));
jest.mock("@soulledger/core/api/judgment", () => ({
  ...jest.requireActual("@soulledger/core/api/judgment"),
  judgmentApi: {
    claim: jest.fn().mockResolvedValue({ data: {} }),
    release: jest.fn().mockResolvedValue({ data: {} }),
    conclude: jest.fn().mockResolvedValue({ data: {} }),
  },
}));
jest.mock("@soulledger/core/api/dossiers", () => ({
  ...jest.requireActual("@soulledger/core/api/dossiers"),
  dossiersApi: { desk: jest.fn(), get: jest.fn(), list: jest.fn() },
}));

const mockDesk = dossiersApi.desk as jest.Mock;
const mockDossier = dossiersApi.get as jest.Mock;
const mockConclude = judgmentApi.conclude as jest.Mock;

function row(id: string, over: Partial<Judgment> = {}): Judgment {
  return {
    id,
    case_number: `CN-2026-${id}`,
    soul: `s-${id}`,
    soul_name: `魂${id}`,
    civilization: "CHINESE",
    judge: null,
    judge_name: null,
    court: "第一殿",
    evidence_json: {},
    confession: "",
    verdict: null,
    notes: "",
    is_final: false,
    created_at: "2026-11-01T00:00:00Z",
    concluded_at: null,
    ...over,
  } as Judgment;
}

const COUNTS = { mine: 2, deferred: 0, unclaimed: 1, others: 0, total: 3, overdue: 0, returned: 0, sources: { queue: 3, city_god: 0, cross: 0 }, elsewhere: {} };
const MINE = ["1", "2"];

beforeEach(() => {
  jest.useFakeTimers();
  jest.clearAllMocks();
  localStorage.removeItem(SEAL_READBACK_STORAGE_KEY);
  const groups: Record<string, Judgment[]> = {
    mine: [row("1", { soul_name: "赵志强", claimed_by: 7 } as Partial<Judgment>), row("2", { soul_name: "哪吒", claimed_by: 7 } as Partial<Judgment>)],
    deferred: [],
    unclaimed: [row("3", { soul_name: "沉香" })],
    others: [],
  };
  mockDesk.mockResolvedValue({
    data: { groups: ["mine", "unclaimed", "others", "deferred"].map((group) => ({ group, total: groups[group].length, rows: groups[group] })), counts: COUNTS, month_done_pct: 22 },
  });
  mockDossier.mockImplementation((id: string) =>
    Promise.resolve({
      data: {
        id, version: 1, phase: MINE.includes(id) ? "HEARING" : "UNCLAIMED", citations: [], soul_redacted: false,
        judgment: row(id, { kind: "ORIGINAL" } as Partial<Judgment>),
        soul: { id: `s-${id}`, name: `魂${id}`, current_state: "JUDGING", diyu_station: "", is_residing: false, records: [] },
        whereabouts: { hall: "CN_DIYU", residing: false, realm_code: null, since: null, spine: { civ: "cn", at: "hall", n: 1 } },
        actions: MINE.includes(id)
          ? { claim: false, release: true, conclude: true, refusals: { claim: "already_yours" } }
          : { claim: true, release: false, conclude: true, refusals: { release: "not_claimed" } },
      },
    }),
  );
});
afterEach(() => {
  jest.useRealTimers();
  localStorage.removeItem(SEAL_READBACK_STORAGE_KEY);
});

const press = async (init: { key: string; metaKey?: boolean; ctrlKey?: boolean }) => {
  await act(async () => {
    fireEvent.keyDown(window, init);
  });
};
const run = async (ms: number) => {
  await act(async () => {
    jest.advanceTimersByTime(ms);
  });
};
const current = () => document.querySelector('[data-desk-row][aria-current="true"]')?.getAttribute("data-testid");
const judging = async () => {
  renderWithProviders(<CaseDesk />);
  await waitFor(() => expect(screen.getByTestId("desk-rail")).toHaveAttribute("data-state", "judge"));
};

describe("案卷台就地判", () => {
  it("1 only selects; ⌘⏎ seals: the row leaves, the next is selected, and conclude/ goes out only after 5 s", async () => {
    await judging();
    expect(current()).toBe("desk-row-1");
    await press({ key: "1" });
    expect(document.querySelector('[data-testid="desk-rail"] [data-verdict="PASSED"]')).toHaveAttribute("aria-pressed", "true");
    expect(mockConclude).not.toHaveBeenCalled();

    await press({ key: "Enter", metaKey: true });
    // Staged, not sent; the strip names who and what.
    expect(mockConclude).not.toHaveBeenCalled();
    expect(screen.getByTestId("desk-undo")).toHaveTextContent("赵志强");
    expect(screen.getByTestId("desk-rail")).toHaveAttribute("data-state", "sealed");
    expect(screen.getByTestId("desk-row-1")).toHaveAttribute("data-leaving");

    await run(SEAL_LEAVE_MS);
    expect(screen.queryByTestId("desk-row-1")).not.toBeInTheDocument();
    expect(current()).toBe("desk-row-2");
    expect(screen.getByTestId("desk-seal-announce")).toHaveTextContent("赵志强");
    expect(screen.getByTestId("desk-seal-announce")).toHaveTextContent("哪吒");

    await run(UNDO_MS - SEAL_LEAVE_MS - 1);
    expect(mockConclude).not.toHaveBeenCalled();
    await run(1);
    expect(mockConclude).toHaveBeenCalledTimes(1);
    // The triage queue's payload: verdict and notes, no create_workflow (unsaid = the server's default flow).
    expect(mockConclude).toHaveBeenCalledWith("1", { verdict: "PASSED", notes: "" });
    expect(screen.queryByTestId("desk-undo")).not.toBeInTheDocument();
  });

  it("the row leaves in 440 ms (strike, slide, collapse), not the old 600", async () => {
    expect(SEAL_LEAVE_MS).toBe(440);
    await judging();
    await press({ key: "1" });
    await press({ key: "Enter", metaKey: true });
    await run(SEAL_LEAVE_MS - 1);
    expect(screen.getByTestId("desk-row-1")).toHaveAttribute("data-leaving");
    expect(current()).toBe("desk-row-1");
    await run(1);
    expect(screen.queryByTestId("desk-row-1")).not.toBeInTheDocument();
    expect(current()).toBe("desk-row-2");
  });

  it("the rail is its own column with a 判栏 head, and the undo strip sits inside it", async () => {
    await judging();
    const side = screen.getByTestId("desk-side");
    expect(side).toContainElement(screen.getByTestId("desk-rail"));
    expect(within(side).getByRole("heading", { name: /判栏/ })).toHaveTextContent("1–4 · ⌘⏎");
    // Not inside the dossier column any more.
    expect(screen.getByTestId("desk-case")).not.toContainElement(screen.getByTestId("desk-rail"));
    await press({ key: "1" });
    await press({ key: "Enter", metaKey: true });
    expect(side).toContainElement(screen.getByTestId("desk-undo"));
    expect(screen.getByTestId("desk-case")).not.toContainElement(screen.getByTestId("desk-undo"));
    expect(screen.getByTestId("desk-undo-button")).toHaveTextContent("⌘Z");
  });

  it("the page head keeps one ghost 打开卷宗 ↗; 认领 lives in the rail (the head's copy is drawn only at 393)", async () => {
    renderWithProviders(<CaseDesk />);
    await screen.findByTestId("desk-row-3");
    fireEvent.click(screen.getByTestId("desk-row-3"));
    await waitFor(() => expect(screen.getByTestId("desk-rail")).toHaveAttribute("data-state", "claim"));
    expect(screen.getByTestId("desk-open")).toHaveTextContent("↗");
    expect(screen.getByTestId("desk-claim")).toHaveClass("phoneOnly");
    expect(screen.getByTestId("desk-rail-claim")).not.toHaveClass("phoneOnly");
  });

  it("⌘Z inside the window takes it back, like U", async () => {
    await judging();
    await press({ key: "1" });
    await press({ key: "Enter", metaKey: true });
    await press({ key: "z", metaKey: true });
    await run(UNDO_MS * 2);
    expect(mockConclude).not.toHaveBeenCalled();
    expect(current()).toBe("desk-row-1");
    expect(screen.queryByTestId("desk-undo")).not.toBeInTheDocument();
  });

  it("U inside the window takes it back: nothing is sent, the row returns selected with its verdict", async () => {
    await judging();
    await press({ key: "3" });
    await press({ key: "Enter", ctrlKey: true });
    await run(SEAL_LEAVE_MS);
    expect(current()).toBe("desk-row-2");
    await press({ key: "u" });
    await run(UNDO_MS * 2);
    expect(mockConclude).not.toHaveBeenCalled();
    expect(current()).toBe("desk-row-1");
    await waitFor(() => expect(screen.getByTestId("desk-rail")).toHaveAttribute("data-state", "judge"));
    expect(document.querySelector('[data-testid="desk-rail"] [data-verdict="PURGATORY"]')).toHaveAttribute("aria-pressed", "true");
    expect(screen.queryByTestId("desk-undo")).not.toBeInTheDocument();
  });

  it("a failed conclude puts the case back on the desk and says whose it was", async () => {
    mockConclude.mockRejectedValueOnce({ response: { status: 500, data: {} } });
    await judging();
    await press({ key: "1" });
    await press({ key: "Enter", metaKey: true });
    await run(UNDO_MS);
    await waitFor(() => expect(mockShowToast).toHaveBeenCalledWith(expect.stringContaining("赵志强"), "error"));
    expect(screen.getByTestId("desk-row-1")).toBeInTheDocument();
  });

  it("an unclaimed case: the rail is only 认领 C — no verdict keys until it is claimed", async () => {
    renderWithProviders(<CaseDesk />);
    await screen.findByTestId("desk-row-3");
    fireEvent.click(screen.getByTestId("desk-row-3"));
    await waitFor(() => expect(screen.getByTestId("desk-rail")).toHaveAttribute("data-state", "claim"));
    expect(document.querySelector('[data-testid="desk-rail"] [data-verdict]')).toBeNull();
    // 1 / ⌘⏎ do nothing here.
    await press({ key: "1" });
    await press({ key: "Enter", metaKey: true });
    await run(UNDO_MS);
    expect(mockConclude).not.toHaveBeenCalled();
    fireEvent.click(screen.getByTestId("desk-rail-claim"));
    await waitFor(() => expect(judgmentApi.claim).toHaveBeenCalledWith("3"));
  });

  it("a verdict that needs a reason (原审「不过」) goes to the dossier page instead of sending a refused request", async () => {
    await judging();
    // Said on the option before it is chosen, and only on that one.
    expect(screen.getByTestId("desk-rail-reason-FAILED")).toHaveTextContent("要写理由");
    expect(screen.queryByTestId("desk-rail-reason-PASSED")).not.toBeInTheDocument();
    expect(screen.getByTestId("desk-rail-seal")).toBeInTheDocument();
    await press({ key: "2" });
    // Chosen: the seal key turns into the outlined 去卷宗整页写理由 →, with the reason above it.
    expect(screen.queryByTestId("desk-rail-seal")).not.toBeInTheDocument();
    expect(screen.getByTestId("desk-rail-to-dossier")).toHaveTextContent("去卷宗整页写理由");
    expect(screen.getByTestId("desk-rail-needs-reason")).toHaveTextContent("要选理由");
    expect(mockPush).not.toHaveBeenCalled();
    await press({ key: "Enter", metaKey: true });
    await run(UNDO_MS);
    expect(mockPush).toHaveBeenCalledWith("/judgment/1");
    expect(mockConclude).not.toHaveBeenCalled();
    expect(screen.queryByTestId("desk-undo")).not.toBeInTheDocument();
  });

  it("prefetches the next dossier about 150 ms after a row is selected, not before", async () => {
    renderWithProviders(<CaseDesk />);
    await waitFor(() => expect(mockDossier).toHaveBeenCalledWith("1"));
    expect(mockDossier).not.toHaveBeenCalledWith("2");
    await run(PREFETCH_DELAY_MS);
    await waitFor(() => expect(mockDossier).toHaveBeenCalledWith("2"));
  });

  describe("at 393 the rail does not take keys (the phone opens the dossier page as before)", () => {
    const realMatchMedia = window.matchMedia;
    afterEach(() => {
      window.matchMedia = realMatchMedia;
    });
    it("1 and ⌘⏎ do nothing", async () => {
      window.matchMedia = ((q: string) => ({ matches: q === "(max-width: 768px)", media: q })) as unknown as typeof window.matchMedia;
      await judging();
      await press({ key: "1" });
      await press({ key: "Enter", metaKey: true });
      await run(UNDO_MS);
      expect(document.querySelector('[data-testid="desk-rail"] [data-verdict="PASSED"]')).toHaveAttribute("aria-pressed", "false");
      expect(mockConclude).not.toHaveBeenCalled();
    });
  });

  describe("reduced motion", () => {
    const realMatchMedia = window.matchMedia;
    afterEach(() => {
      window.matchMedia = realMatchMedia;
    });
    it("the row fades out in 120 ms and leaves at once after that", async () => {
      window.matchMedia = ((q: string) => ({ matches: q === "(prefers-reduced-motion: reduce)", media: q })) as unknown as typeof window.matchMedia;
      await judging();
      await press({ key: "1" });
      await press({ key: "Enter", metaKey: true });
      await run(SEAL_LEAVE_REDUCED_MS - 1);
      expect(screen.getByTestId("desk-row-1")).toHaveAttribute("data-leaving");
      await run(1);
      expect(screen.queryByTestId("desk-row-1")).not.toBeInTheDocument();
      expect(current()).toBe("desk-row-2");
    });
  });

  describe("偏好「落印前先确认」", () => {
    beforeEach(() => localStorage.setItem(SEAL_READBACK_STORAGE_KEY, "on"));

    it("⌘⏎ opens a read-back of name, case number and verdict; focus is on 返回; no timer; the opening ⌘⏎ does not seal", async () => {
      await judging();
      await press({ key: "1" });
      await press({ key: "Enter", metaKey: true });
      const back = await screen.findByTestId("seal-readback");
      expect(screen.getByTestId("seal-readback-name")).toHaveTextContent("赵志强");
      expect(screen.getByTestId("seal-readback-case")).toHaveTextContent("CN-2026-1");
      expect(screen.getByTestId("seal-readback-verdict")).toHaveTextContent("通过");
      expect(back).toBeInTheDocument();
      expect(screen.getByTestId("seal-readback-cancel")).toHaveTextContent("返回");
      await waitFor(() => expect(document.activeElement).toBe(screen.getByTestId("seal-readback-cancel")));
      await run(UNDO_MS * 2);
      expect(mockConclude).not.toHaveBeenCalled();
      expect(screen.getByTestId("seal-readback")).toBeInTheDocument();
      expect(screen.getByTestId("desk-row-1")).not.toHaveAttribute("data-leaving");
    });

    it("inside the layer ⌘⏎ seals at once (the one key that does), with no undo strip", async () => {
      await judging();
      await press({ key: "1" });
      await press({ key: "Enter", metaKey: true });
      await screen.findByTestId("seal-readback");
      expect(mockConclude).not.toHaveBeenCalled();
      await press({ key: "Enter", metaKey: true });
      await waitFor(() => expect(mockConclude).toHaveBeenCalledWith("1", { verdict: "PASSED", notes: "" }));
      expect(mockConclude).toHaveBeenCalledTimes(1);
      expect(screen.queryByTestId("desk-undo")).not.toBeInTheDocument();
    });

    it("Esc returns: nothing sent, the case stays", async () => {
      await judging();
      await press({ key: "1" });
      await press({ key: "Enter", metaKey: true });
      await screen.findByTestId("seal-readback");
      await act(async () => {
        fireEvent.keyDown(document.activeElement ?? document.body, { key: "Escape" });
      });
      await waitFor(() => expect(screen.queryByTestId("seal-readback")).not.toBeInTheDocument());
      await run(UNDO_MS * 2);
      expect(mockConclude).not.toHaveBeenCalled();
      expect(current()).toBe("desk-row-1");
    });

    it("落印 in the layer sends at once, with no undo strip", async () => {
      await judging();
      await press({ key: "1" });
      await press({ key: "Enter", metaKey: true });
      fireEvent.click(await screen.findByTestId("seal-readback-confirm"));
      await waitFor(() => expect(mockConclude).toHaveBeenCalledWith("1", { verdict: "PASSED", notes: "" }));
      expect(screen.queryByTestId("desk-undo")).not.toBeInTheDocument();
      await run(SEAL_LEAVE_MS);
      expect(current()).toBe("desk-row-2");
    });

    it("取消 sends nothing and leaves the case where it was", async () => {
      await judging();
      await press({ key: "1" });
      await press({ key: "Enter", metaKey: true });
      fireEvent.click(await screen.findByTestId("seal-readback-cancel"));
      await run(UNDO_MS * 2);
      expect(mockConclude).not.toHaveBeenCalled();
      expect(current()).toBe("desk-row-1");
    });
  });
});
