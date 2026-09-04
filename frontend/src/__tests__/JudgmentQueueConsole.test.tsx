/**
 * The triage console: one case on screen, the whole decision surface with it,
 * a verdict is one keystroke, and giving one advances without a navigation.
 *
 * The keyboard map is the interface here, not a convenience layer over it
 * (§4.2 asks for it explicitly), so it is tested as such — including the guard
 * that typing "1" in the notes field must never file a verdict.
 */
import { render, screen, waitFor, act, fireEvent } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { JudgmentQueueConsole } from "@/src/components/judgment/JudgmentQueueConsole";
import { judgmentApi } from "@soulledger/core/api";

const mockPush = jest.fn();
const mockShowToast = jest.fn();

const JUDGMENT = {
  id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  soul: "s-1",
  soul_name: "第一位待判者",
  civilization: "CHINESE",
  judge: null,
  judge_name: null,
  court: "第一殿",
  evidence_json: {},
  confession: "生平所记，尽在此卷。",
  verdict: null,
  notes: "",
  is_final: false,
  created_at: "2026-08-01T00:00:00Z",
  concluded_at: null,
};

const NEXT_JUDGMENT = { ...JUDGMENT, id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", soul_name: "第二位待判者" };

function cursor(judgment: typeof JUDGMENT | null, remaining = 2) {
  return {
    data: {
      total: 2,
      remaining,
      skipped: 2 - remaining,
      position: judgment ? 2 - remaining + 1 : null,
      judgment,
      soul: judgment
        ? {
            id: "s-1",
            name: judgment.soul_name,
            current_state: "JUDGING",
            civilization: "CHINESE",
            tenant_code: "CN_DIYU",
            birth_date: { year: 1820, month: 3, day: 4 },
            death_date: null,
            origin_location: "钱塘",
            birth_name: "孟氏",
            description: "",
            merit_score: 120,
            demerit_score: 78,
            karmic_balance: 42,
          }
        : null,
      ledger: judgment
        ? {
            soul_id: "s-1",
            soul_name: judgment.soul_name,
            merit_score: 120,
            demerit_score: 78,
            karmic_balance: 42,
            record_count: 1,
            records: [
              { id: "r-1", record_type: "MERIT", category: "", description: "修桥铺路", weight: 30, recorded_at: "2026-01-01T00:00:00Z" },
            ],
          }
        : null,
      prior_cycles: [],
      realm_options: [
        { id: "realm-1", realm_code: "DY_01_HEAVEN", civilization: "CHINESE", display_name: "天道", name_local: "天道", realm_type: "HEAVEN", tier: 1, is_eternal: false },
      ],
    },
  };
}

jest.mock("@soulledger/core/api", () => ({
  judgmentApi: { next: jest.fn(), conclude: jest.fn().mockResolvedValue({ data: {} }) },
}));

jest.mock("next/navigation", () => ({
  useRouter: () => ({ push: mockPush }),
}));

jest.mock("@/src/contexts/ToastContext", () => ({
  useToast: () => ({ showToast: mockShowToast }),
}));

jest.mock("@/src/contexts/I18nContext", () => ({
  useI18n: () => ({
    t: (key: string, params?: Record<string, string>) =>
      params ? `${key}:${Object.values(params).join(",")}` : key,
    locale: "zh-Hans",
    hydrated: true,
    formatDate: (v: string) => String(v),
    formatDateTime: (v: string) => String(v),
  }),
}));

const mockNext = judgmentApi.next as jest.Mock;
const mockConclude = judgmentApi.conclude as jest.Mock;

function renderConsole() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <JudgmentQueueConsole />
    </QueryClientProvider>
  );
}

beforeEach(() => {
  jest.clearAllMocks();
  mockNext.mockImplementation(async (params?: { skip?: string[] }) => {
    const skipped = params?.skip ?? [];
    const queue = [JUDGMENT, NEXT_JUDGMENT].filter((j) => !skipped.includes(j.id));
    return cursor(queue[0] ?? null, queue.length);
  });
  mockConclude.mockResolvedValue({ data: {} });
});

describe("JudgmentQueueConsole", () => {
  it("puts the whole decision surface on screen for one case", async () => {
    renderConsole();
    await waitFor(() => expect(screen.getByText("第一位待判者")).toBeInTheDocument());

    // identity, case file, ledger, prior cycles, realms — §4.2's list.
    expect(screen.getByText("judgment.queue.identity")).toBeInTheDocument();
    expect(screen.getByText("judgment.queue.case")).toBeInTheDocument();
    expect(screen.getByText("修桥铺路")).toBeInTheDocument();
    // Heading and the grid's <caption> both carry the label.
    expect(screen.getAllByText("judgment.queue.prior_cycles").length).toBeGreaterThan(0);
    expect(screen.getByText("天道")).toBeInTheDocument();
    // Exactly one case — the queue is not a list.
    expect(screen.queryByText("第二位待判者")).not.toBeInTheDocument();
  });

  it("shows progress as N of M", async () => {
    renderConsole();
    await waitFor(() => expect(screen.getByText("judgment.queue.progress:1,2")).toBeInTheDocument());
    expect(screen.getByRole("progressbar")).toHaveAttribute("aria-valuenow", "1");
  });

  it("renders a verdict on a digit key and advances to the next case", async () => {
    renderConsole();
    await waitFor(() => expect(screen.getByText("第一位待判者")).toBeInTheDocument());

    await act(async () => {
      fireEvent.keyDown(window, { key: "1" });
    });

    await waitFor(() => expect(screen.getByText("第二位待判者")).toBeInTheDocument());
    // Held, not sent — see useJudgmentQueue's header note.
    expect(mockConclude).not.toHaveBeenCalled();
    expect(screen.getByRole("status")).toHaveTextContent("judgment.queue.pending_verdict");
  });

  it("自动重复不算第二次按键 —— 长按 `w` 不会把复选框来回翻", async () => {
    // 长按时浏览器每 ~30ms 发一次 `keydown`,`repeat: true`。这里挑 `w` 而不是
    // 数字键,因为它测的正是 hook 那道 judgmentId 守卫**够不到**的那一半:
    // 一个纯 UI 的开关,重复一次就翻一次,翻成一个没人选过的值。
    renderConsole();
    await waitFor(() => expect(screen.getByText("第一位待判者")).toBeInTheDocument());
    const checkbox = screen.getByRole("checkbox") as HTMLInputElement;
    expect(checkbox.checked).toBe(false);

    await act(async () => {
      fireEvent.keyDown(window, { key: "w" });                 // 真的按下
      fireEvent.keyDown(window, { key: "w", repeat: true });   // 键还按着
      fireEvent.keyDown(window, { key: "w", repeat: true });
      fireEvent.keyDown(window, { key: "w", repeat: true });
    });

    // 按了一次,翻了一次。缺陷版本里翻四次,落回 false。
    expect(checkbox.checked).toBe(true);
  });

  it("offers undo while the verdict is held, and undo brings the case back", async () => {
    renderConsole();
    await waitFor(() => expect(screen.getByText("第一位待判者")).toBeInTheDocument());

    await act(async () => {
      fireEvent.keyDown(window, { key: "2" });
    });
    await waitFor(() => expect(screen.getByText("judgment.queue.undo")).toBeInTheDocument());

    await act(async () => {
      fireEvent.keyDown(window, { key: "u" });
    });

    await waitFor(() => expect(screen.getByText("第一位待判者")).toBeInTheDocument());
    expect(mockConclude).not.toHaveBeenCalled();
  });

  it("defers on S without sending anything", async () => {
    renderConsole();
    await waitFor(() => expect(screen.getByText("第一位待判者")).toBeInTheDocument());

    await act(async () => {
      fireEvent.keyDown(window, { key: "s" });
    });

    await waitFor(() => expect(screen.getByText("第二位待判者")).toBeInTheDocument());
    expect(mockConclude).not.toHaveBeenCalled();
    expect(mockNext).toHaveBeenCalledWith(expect.objectContaining({ skip: [JUDGMENT.id] }));
  });

  it("ignores verdict keys while the operator is typing a note", async () => {
    renderConsole();
    await waitFor(() => expect(screen.getByText("第一位待判者")).toBeInTheDocument());
    const notes = screen.getByLabelText("judgment.queue.notes");

    await act(async () => {
      fireEvent.keyDown(notes, { key: "1" });
    });

    // Still the same case, nothing held: a "1" in a note is a note.
    expect(screen.getByText("第一位待判者")).toBeInTheDocument();
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });

  it("sends the note and the workflow flag along with the verdict", async () => {
    renderConsole();
    await waitFor(() => expect(screen.getByText("第一位待判者")).toBeInTheDocument());

    fireEvent.change(screen.getByLabelText("judgment.queue.notes"), { target: { value: "证据不足" } });
    // Two separate acts: the W toggle must have re-rendered before the verdict
    // key is read, exactly as two real keystrokes would.
    await act(async () => {
      fireEvent.keyDown(window, { key: "w" });
    });
    await act(async () => {
      fireEvent.keyDown(window, { key: "4" });
    });

    await waitFor(() => expect(screen.getByRole("status")).toBeInTheDocument());
    // Flush by leaving the queue, which is also the "Esc leaves" path.
    await act(async () => {
      fireEvent.keyDown(window, { key: "Escape" });
    });

    expect(mockConclude).toHaveBeenCalledWith(JUDGMENT.id, {
      verdict: "RETRY",
      notes: "证据不足",
      create_workflow: true,
    });
    expect(mockPush).toHaveBeenCalledWith("/judgment");
  });

  it("shows the keyboard map on ?", async () => {
    renderConsole();
    await waitFor(() => expect(screen.getByText("第一位待判者")).toBeInTheDocument());
    expect(screen.queryByText("judgment.queue.keyboard_map")).not.toBeInTheDocument();

    await act(async () => {
      fireEvent.keyDown(window, { key: "?" });
    });

    expect(screen.getByText("judgment.queue.keyboard_map")).toBeInTheDocument();
    expect(screen.getByText("judgment.queue.key_verdicts")).toBeInTheDocument();
  });

  it("says the queue is clear rather than showing an error", async () => {
    mockNext.mockResolvedValue(cursor(null, 0));
    renderConsole();
    await waitFor(() => expect(screen.getByText("judgment.queue.exhausted_title")).toBeInTheDocument());
  });

  it("surfaces a fetch failure with a retry rather than a blank console", async () => {
    mockNext.mockRejectedValue(new Error("boom"));
    renderConsole();
    await waitFor(() => expect(screen.getByText("judgment.queue.error_title")).toBeInTheDocument());
    expect(screen.getByText("common.retry")).toBeInTheDocument();
  });
});

/**
 * The decision bar, and the two layout facts it exists to fix.
 *
 * The verdict controls used to be the last block under a two-column grid of
 * panels, so a long confession or a long ledger pushed them below the fold —
 * on the screen whose entire job is deciding. And the pending-undo strip
 * rendered ABOVE those panels, so **every verdict shifted the whole case
 * down**: an operator reading the next case could not see the undo countdown
 * for the previous one, which is the only moment that countdown exists for.
 *
 * Both are layout, which jsdom does not compute — it has no viewport and no
 * scrolling. So these assert the STRUCTURE that produces the behaviour: the
 * controls live inside a sticky container, and the undo slot is present at a
 * fixed height whether or not a verdict is pending. A screenshot test would
 * assert the outcome; this asserts the mechanism, and says so rather than
 * pretending otherwise.
 */
describe("the decision bar", () => {
  const stickyBar = (container: HTMLElement) =>
    container.querySelector<HTMLElement>(".sticky.bottom-0");

  it("keeps every verdict control inside the sticky bar", async () => {
    const { container } = renderConsole();
    await screen.findByText("第一位待判者");

    const bar = stickyBar(container);
    expect(bar).not.toBeNull();
    // All four verdicts and Defer — the irreversible controls — are the bar's
    // whole contents. If one were left in the scroll it could be off-screen at
    // the moment it is needed.
    for (const key of ["1", "2", "3", "4", "S"]) {
      expect(bar!.textContent).toContain(key);
    }
  });

  it("leaves the notes field OUT of the bar, where it does not double its height", async () => {
    const { container } = renderConsole();
    await screen.findByText("第一位待判者");

    const bar = stickyBar(container);
    expect(bar!.querySelector("#queue-notes")).toBeNull();
    // But still on the page, and still reachable — `N` focuses it.
    expect(container.querySelector("#queue-notes")).not.toBeNull();
  });

  it("reserves the undo slot before anything is pending", async () => {
    const { container } = renderConsole();
    await screen.findByText("第一位待判者");

    const bar = stickyBar(container);
    const slot = bar!.querySelector("[aria-live='polite']");
    // Present and empty. Mounting it on the first verdict is what used to push
    // the case down; a reserved slot cannot.
    expect(slot).not.toBeNull();
    expect(slot!.textContent).toBe("");
    expect(slot!.className).toContain("h-10");
  });

  it("fills that same slot when a verdict is pending, without adding one", async () => {
    const { container } = renderConsole();
    await screen.findByText("第一位待判者");

    fireEvent.keyDown(window, { key: "1" });

    await waitFor(() =>
      expect(stickyBar(container)!.querySelector("[aria-live='polite']")!.textContent).not.toBe("")
    );
    // Still exactly one slot — the strip moved into the reserved space rather
    // than inserting a new row.
    expect(stickyBar(container)!.querySelectorAll("[aria-live='polite']")).toHaveLength(1);
    expect(screen.getByRole("status").textContent).toContain("第一位待判者");
  });

  /**
   * 本次坐堂的最后一案。
   *
   * 撤销条曾经和「有没有下一张卡片」死死绑在一起,于是它恰恰在唯一还能用到它
   * 的时刻消失。`U` 依然能按 —— 键盘监听是无条件的 —— 但屏幕上没有任何东西
   * 说它能按。
   */
  describe("最后一案:撤销条要活过卡片", () => {
    beforeEach(() => {
      // 队列里只有一条。裁完它,下一次 next 就返回 null。
      mockNext.mockImplementation(async (params?: { skip?: string[] }) => {
        const skipped = params?.skip ?? [];
        const queue = [JUDGMENT].filter((j) => !skipped.includes(j.id));
        return cursor(queue[0] ?? null, queue.length);
      });
    });

    it("裁完最后一案,倒计时和撤销按钮仍在屏幕上", async () => {
      const { container } = renderConsole();
      await screen.findByText("第一位待判者");

      fireEvent.keyDown(window, { key: "1" });

      // 卡片没了 —— 裁决按钮行跟着走,因为已经没有东西可裁。
      await waitFor(() =>
        expect(screen.queryByText("第一位待判者")).not.toBeInTheDocument()
      );
      expect(screen.queryByText("judgment.queue.defer")).not.toBeInTheDocument();

      // 但撤销条还在,而且还在那条 sticky 里。
      expect(stickyBar(container)).not.toBeNull();
      expect(screen.getByText("judgment.queue.undo")).toBeInTheDocument();
      expect(screen.getByRole("status").textContent).toContain("第一位待判者");
    });

    it("裁决还扣着时不说「队列已清空」—— 它离没清空只差一次撤销", async () => {
      renderConsole();
      await screen.findByText("第一位待判者");

      fireEvent.keyDown(window, { key: "1" });
      await waitFor(() =>
        expect(screen.queryByText("第一位待判者")).not.toBeInTheDocument()
      );

      // 缺席断言。`queue.isExhausted` 的 `pending === null` 那一项正是这条,
      // 而它在被接上之前是零消费者。
      expect(screen.queryByText("judgment.queue.exhausted_title")).not.toBeInTheDocument();
    });

    it("撤销之后案子回来,撤销条让位给裁决按钮", async () => {
      renderConsole();
      await screen.findByText("第一位待判者");

      fireEvent.keyDown(window, { key: "1" });
      await screen.findByText("judgment.queue.undo");
      fireEvent.keyDown(window, { key: "u" });

      await screen.findByText("第一位待判者");
      expect(screen.queryByText("judgment.queue.undo")).not.toBeInTheDocument();
      expect(screen.getByText("judgment.queue.defer")).toBeInTheDocument();
      expect(mockConclude).not.toHaveBeenCalled();
    });
  });
});
