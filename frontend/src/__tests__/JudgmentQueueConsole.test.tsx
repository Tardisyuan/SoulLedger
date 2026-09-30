/**
 * The triage console: one case on screen, the whole decision surface with it,
 * a verdict is one keystroke, and giving one advances without a navigation.
 *
 * The keyboard map is the interface here, not a convenience layer over it
 * (§4.2 asks for it explicitly), so it is tested as such — including the guard
 * that typing "1" in the notes field must never file a verdict.
 *
 * A verdict is POSTed the moment its key is pressed: the eight-second undo
 * window, the U key and the undo strip were removed on 2026-09-25
 * (「落判即提交,不可撤回」, as on the desk).
 */
import { render, screen, waitFor, act, fireEvent, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { JudgmentQueueConsole } from "@/src/components/judgment/JudgmentQueueConsole";
import { judgmentApi } from "@soulledger/core/api";
import { isMinePending } from "@/src/components/judgment/RowMark";

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
  judgmentApi: {
    next: jest.fn(),
    conclude: jest.fn().mockResolvedValue({ data: {} }),
    // 「我认领的」分组(QueueMinePanel)读 `?group=mine`;认领与改派是 claims.py 的两个动作。
    list: jest.fn().mockResolvedValue({ data: { count: 0, next: null, previous: null, results: [] } }),
    claim: jest.fn().mockResolvedValue({ data: {} }),
    reassign: jest.fn().mockResolvedValue({ data: {} }),
    assignableOfficers: jest.fn().mockResolvedValue({ data: [] }),
  },
}));

// The hook raises its toasts through the core `notify` port; point it here so
// the claimed-by-other refusal can be asserted by key and params rather than by
// whatever the web adapter renders into document.body.
jest.mock("@soulledger/core/platform", () => ({
  ...jest.requireActual("@soulledger/core/platform"),
  notify: (...args: unknown[]) => mockShowToast(...args),
}));

jest.mock("next/navigation", () => ({
  useRouter: () => ({ push: mockPush }),
}));

// 控制台现在把裁决控件挂在 `judgment.execute` 上(后端 views.py:82 就是这么
// 分的)。`usePermissions` 读 `useTenant().user`,所以这里给一个握着该权限的
// 用户;下面「只读」那一组自己把它换成不握的。
const mockUser: { id?: number; role: string; permissions: string[] } | null = {
  role: "JUDGE",
  permissions: ["judgment.read", "judgment.execute"],
};
let currentUser: typeof mockUser = mockUser;
jest.mock("@/src/contexts/TenantContext", () => ({
  useTenant: () => ({ user: currentUser }),
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

afterEach(() => {
  // Toasts are module-level DOM appended straight to `document.body`, and this
  // file never cleaned them up — a leftover from one test was still in the
  // document during the next. It went unnoticed while every toast carried
  // `role="alert"`: nothing here queries for that. The moment success/info
  // toasts became `role="status"` — which is the correct tier for them — they
  // started colliding with the undo strip's own `role="status"`, and six tests
  // in this file went red at once.
  //
  // That is a leak this file always had, surfaced rather than introduced.
  // `notifyPortCarriesTheToast.test.ts:91` has done exactly this since it was
  // written.
  document.getElementById("toast-container")?.remove();
});

// A concluded case is no longer pending, so the server stops handing it out.
const concluded = new Set<string>();

beforeEach(() => {
  jest.clearAllMocks();
  concluded.clear();
  currentUser = mockUser;
  mockNext.mockImplementation(async (params?: { skip?: string[] }) => {
    const skipped = params?.skip ?? [];
    const queue = [JUDGMENT, NEXT_JUDGMENT].filter((j) => !skipped.includes(j.id) && !concluded.has(j.id));
    return cursor(queue[0] ?? null, queue.length);
  });
  mockConclude.mockImplementation(async (id: string) => {
    concluded.add(id);
    return { data: {} };
  });
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

  it("renders a verdict on a digit key: POSTs it at once and advances to the next case", async () => {
    renderConsole();
    await waitFor(() => expect(screen.getByText("第一位待判者")).toBeInTheDocument());

    await act(async () => {
      fireEvent.keyDown(window, { key: "1" });
    });

    // Sent on the keystroke — no timer has run, and none needs to.
    expect(mockConclude).toHaveBeenCalledTimes(1);
    expect(mockConclude).toHaveBeenCalledWith(JUDGMENT.id, {
      verdict: "PASSED",
      notes: "",
      create_workflow: false,
    });
    await waitFor(() => expect(screen.getByText("第二位待判者")).toBeInTheDocument());
    // Absence: nothing on screen offers to take it back.
    expect(screen.queryByText("judgment.queue.undo")).not.toBeInTheDocument();
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
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

  it("U is no longer a key: it neither takes a verdict back nor sends another", async () => {
    renderConsole();
    await waitFor(() => expect(screen.getByText("第一位待判者")).toBeInTheDocument());

    await act(async () => {
      fireEvent.keyDown(window, { key: "2" });
    });
    await waitFor(() => expect(screen.getByText("第二位待判者")).toBeInTheDocument());
    await act(async () => {
      fireEvent.keyDown(window, { key: "u" });
    });

    expect(mockConclude).toHaveBeenCalledTimes(1);
    expect(screen.getByText("第二位待判者")).toBeInTheDocument();
    expect(mockShowToast).not.toHaveBeenCalled();
  });

  it("a case claimed by another officer: says who, sets it aside for the sitting", async () => {
    mockConclude.mockRejectedValueOnce({
      response: {
        status: 409,
        data: { error: "claimed", code: "claimed_by_other", claimed_by: 7, claimed_by_name: "崔判官" },
      },
    });
    renderConsole();
    await waitFor(() => expect(screen.getByText("第一位待判者")).toBeInTheDocument());

    await act(async () => {
      fireEvent.keyDown(window, { key: "1" });
    });

    // A warning banner split into a title and one sentence (第三类 F 组 2.2) — not a toast.
    const banner = await screen.findByTestId("claim-refusal");
    expect(banner).toHaveAttribute("role", "alert");
    expect(within(banner).getByText("judgment.queue.claimed_title:崔判官")).toBeInTheDocument();
    expect(within(banner).getByText("judgment.queue.claimed_body")).toBeInTheDocument();
    expect(banner.className).toMatch(/color-warning/);
    expect(banner.className).not.toMatch(/color-danger/);
    expect(mockShowToast).not.toHaveBeenCalled();
    // Deferred for the sitting, not handed straight back to hit the same 409.
    await waitFor(() => expect(screen.getByText("judgment.queue.stat_deferred:1")).toBeInTheDocument());
    expect(screen.getByText("第二位待判者")).toBeInTheDocument();
    expect(screen.queryByText("第一位待判者")).not.toBeInTheDocument();
    // 「打开下一件」: the next case is already on screen; the warning goes.
    fireEvent.click(within(banner).getByRole("button", { name: "judgment.queue.claimed_next" }));
    expect(screen.queryByTestId("claim-refusal")).toBeNull();
  });

  it("R's bar says how many are set aside this sitting and puts them all back", async () => {
    renderConsole();
    await waitFor(() => expect(screen.getByText("第一位待判者")).toBeInTheDocument());
    expect(screen.queryByTestId("session-deferred")).toBeNull();
    await act(async () => {
      fireEvent.keyDown(window, { key: "s" });
    });
    const bar = await screen.findByTestId("session-deferred");
    expect(within(bar).getByText("judgment.queue.session_deferred:1")).toBeInTheDocument();
    const button = within(bar).getByRole("button", { name: "judgment.queue.restore_all" });
    expect(button).toHaveAttribute("aria-keyshortcuts", "R");
    expect(within(button).getByText("R")).toBeInTheDocument();
    await act(async () => {
      fireEvent.click(button);
    });
    expect(screen.queryByTestId("session-deferred")).toBeNull();
  });

  it("the verdict buttons carry key, glyph and word; W's checkbox carries its keycap", async () => {
    renderConsole();
    await waitFor(() => expect(screen.getByText("第一位待判者")).toBeInTheDocument());
    // 补足 B8:字形 + 文字在左,数字键在右。
    const passed = document.querySelector('[data-verdict="PASSED"]') as HTMLElement;
    expect(passed.textContent).toMatch(/^✓.*1$/);
    expect((document.querySelector('[data-verdict="RETRY"]') as HTMLElement).textContent).toMatch(/^↺.*4$/);
    const workflow = screen.getByRole("checkbox", { name: /judgment\.queue\.create_workflow/ });
    expect(workflow.closest("label")?.querySelector("kbd")?.textContent).toBe("W");
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

    // Still the same case, nothing sent: a "1" in a note is a note.
    expect(screen.getByText("第一位待判者")).toBeInTheDocument();
    expect(mockConclude).not.toHaveBeenCalled();
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

    expect(mockConclude).toHaveBeenCalledWith(JUDGMENT.id, {
      verdict: "RETRY",
      notes: "证据不足",
      create_workflow: true,
    });
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
    // Design's six plus C (v2 claim, 2026-09-30), in order — no U (withdrawn with the undo window).
    const listed = Array.from(document.querySelectorAll("[data-shortcut]")).map((el) => el.getAttribute("data-shortcut"));
    expect(listed).toEqual(["1–4", "C", "S", "W", "R", "N", "?"]);
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
 * The decision bar.
 *
 * The verdict controls used to be the last block under a two-column grid of
 * panels, so a long confession or a long ledger pushed them below the fold —
 * on the screen whose entire job is deciding.
 *
 * That is layout, which jsdom does not compute — it has no viewport and no
 * scrolling. So these assert the STRUCTURE that produces the behaviour: the
 * controls live inside a sticky container.
 */
describe("the decision bar", () => {
  const stickyBar = (container: HTMLElement) =>
    container.querySelector<HTMLElement>(".sticky.bottom-\\(--bottom-bar\\)");

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

  it("the last case of a sitting: the verdict is sent and the console says the queue is clear", async () => {
    mockNext.mockImplementation(async (params?: { skip?: string[] }) => {
      const skipped = params?.skip ?? [];
      const queue = [JUDGMENT].filter((j) => !skipped.includes(j.id) && !concluded.has(j.id));
      return cursor(queue[0] ?? null, queue.length);
    });
    renderConsole();
    await screen.findByText("第一位待判者");

    await act(async () => {
      fireEvent.keyDown(window, { key: "1" });
    });

    expect(mockConclude).toHaveBeenCalledTimes(1);
    await screen.findByText("judgment.queue.exhausted_title");
    expect(screen.queryByText("judgment.queue.defer")).not.toBeInTheDocument();
  });

  /**
   * 只读:能看队列,不能裁决。
   *
   * 后端 `views.py:82` 把 `conclude → judgment.execute`、`next_pending →
   * judgment.read` 分开,并在注释里写明「能看不能判的人照样给他屏幕,而裁决
   * 按钮才是他用不了的那个」。屏幕那一半建了,按钮那一半没建 —— 于是只有
   * judgment.read 的操作员拿到四个亮着的裁决按钮,按下去卡片前进、倒计时开始,
   * 八秒后 403 被渲染成泛用的 `commit_error`:「未提交,该条已放回队列」,
   * 说的是一个八秒前就离开屏幕的案子。
   */
  describe("只读:有 judgment.read 没有 judgment.execute", () => {
    beforeEach(() => {
      currentUser = { role: "JUDGE", permissions: ["judgment.read"] };
    });

    it("照样给屏幕 —— 案子的内容全在", async () => {
      renderConsole();
      // 这一半原本就是对的,钉住它,免得「修好按钮」变成「连屏幕一起收走」。
      expect(await screen.findByText("第一位待判者")).toBeInTheDocument();
    });

    it("四个裁决按钮一个都不在,换成一句说明", async () => {
      renderConsole();
      await screen.findByText("第一位待判者");

      expect(screen.getByText("judgment.queue.read_only")).toBeInTheDocument();
      // 缺席断言,而且要断言**不存在**而不是「被禁用」:禁用的控件仍然在说
      // 「这是你的,只是现在不行」,而这不是时机问题,是这个操作员的常态。
      for (const key of ["1", "2", "3", "4"]) {
        expect(screen.queryByText(key)).not.toBeInTheDocument();
      }
    });

    it("数字键按下去什么都不发生 —— 卡片不动,请求不发", async () => {
      renderConsole();
      await screen.findByText("第一位待判者");

      await act(async () => {
        fireEvent.keyDown(window, { key: "1" });
        fireEvent.keyDown(window, { key: "w" });
      });

      expect(screen.getByText("第一位待判者")).toBeInTheDocument();
      expect(mockConclude).not.toHaveBeenCalled();
      expect(screen.queryByRole("status")).not.toBeInTheDocument();
    });

    it("跳过仍然可用 —— 它是会话内的,什么都不写", async () => {
      renderConsole();
      await screen.findByText("第一位待判者");

      await act(async () => {
        fireEvent.keyDown(window, { key: "s" });
      });

      await waitFor(() => expect(screen.getByText("第二位待判者")).toBeInTheDocument());
      expect(mockConclude).not.toHaveBeenCalled();
    });
  });
});

/**
 * 键盘作用域、播报、按压态。
 */
describe("控制台不抢别人已经处理过的按键", () => {
  it("被上层处理过的 Escape 不会顺带把队列也退掉", async () => {
    renderConsole();
    await screen.findByText("第一位待判者");

    // `defaultPrevented` 是只读的 —— 传进 init 里不会生效(第一版就是这么写
    // 的,于是这条测的是普通 Escape,恒绿)。真的装一个前置监听器去
    // `preventDefault()`,正是抽屉与弹层做的事:它们不调 stopPropagation,
    // 而 React 在根容器分发,所以这个 window 监听器照样会跑到。
    const upstream = (event: KeyboardEvent) => {
      if (event.key === "Escape") event.preventDefault();
    };
    window.addEventListener("keydown", upstream, { capture: true });
    try {
      await act(async () => {
        fireEvent.keyDown(window, { key: "Escape" });
      });
    } finally {
      window.removeEventListener("keydown", upstream, { capture: true });
    }

    // 还在队列里。缺陷版本会跳走。
    expect(screen.getByText("第一位待判者")).toBeInTheDocument();
    expect(mockPush).not.toHaveBeenCalled();
  });

  it("键盘图开着时 Escape 关图,而不是离开队列", async () => {
    renderConsole();
    await screen.findByText("第一位待判者");

    await act(async () => {
      fireEvent.keyDown(window, { key: "?" });
    });
    expect(screen.getByText("judgment.queue.keyboard_map")).toBeInTheDocument();

    await act(async () => {
      fireEvent.keyDown(window, { key: "Escape" });
    });

    expect(screen.queryByText("judgment.queue.keyboard_map")).not.toBeInTheDocument();
    // 两边都断言:图关了,而且**没有**顺带离开。
    expect(mockPush).not.toHaveBeenCalled();
    expect(screen.getByText("第一位待判者")).toBeInTheDocument();
  });

  it("图关掉之后,Escape 才是离开", async () => {
    renderConsole();
    await screen.findByText("第一位待判者");

    await act(async () => {
      fireEvent.keyDown(window, { key: "Escape" });
    });

    expect(mockPush).toHaveBeenCalledWith("/judgment");
  });
});

describe("裁决按钮有按压态,且四个长得一样(补足 B8)", () => {
  it("四个裁决键和延后都有 active: 底色,不位移", async () => {
    renderConsole();
    await screen.findByText("第一位待判者");

    // `Button` 的表头把这条记成「190 个里 0 个有 active」,而这四个是全产品
    // 最重要的按钮,它们手搓所以没进那次修复。v2 的按下态是换底色(line),不位移。
    for (const key of ["1", "2", "3", "4", "S"]) {
      const kbd = screen.getByText(key);
      const button = kbd.closest("button");
      expect(button).not.toBeNull();
      expect(button!.className).toContain("active:bg-[oklch(var(--color-line))]");
      expect(button!.className).not.toContain("translate-y");
    }
  });

  it("落判不靠颜色:四个键同一串类名,没有内联颜色,也不读判决 / 危险色", async () => {
    renderConsole();
    await screen.findByText("第一位待判者");
    const buttons = ["PASSED", "FAILED", "PURGATORY", "RETRY"].map(
      (v) => document.querySelector(`[data-verdict="${v}"]`) as HTMLElement
    );
    expect(new Set(buttons.map((b) => b.className)).size).toBe(1);
    for (const b of buttons) {
      expect(b.getAttribute("style")).toBeNull();
      expect(b.outerHTML).not.toMatch(/--color-(verdict|danger|success|warning)/);
    }
  });
});

/**
 * 「同时开审批流」跟着案子走,不跟着坐堂走。
 *
 * `createWorkflow` 是 `useState(false)`,而每案重置的那个 effect 只清 `notes`
 * —— 它上面的注释还写着「笔记属于眼前这个案子,永远不属于下一个」,而这条规则
 * 覆盖的两样东西里,代码只对其中一样生效了。
 *
 * 于是勾一次 W,接下来裁的每一个案子都会静默开一个审批流:`rule()` 每次裁决都
 * 把这个值原样传下去。
 */
describe("审批流复选框不跨案子", () => {
  it("换到下一个案子时,勾选被清掉", async () => {
    renderConsole();
    await screen.findByText("第一位待判者");

    await act(async () => {
      fireEvent.keyDown(window, { key: "w" });
    });
    expect((screen.getByRole("checkbox") as HTMLInputElement).checked).toBe(true);

    // 裁一个,前进到下一个。
    await act(async () => {
      fireEvent.keyDown(window, { key: "1" });
    });
    await screen.findByText("第二位待判者");

    expect((screen.getByRole("checkbox") as HTMLInputElement).checked).toBe(false);
  });

  it("那一次裁决本身仍然带着勾选 —— 清的是下一个,不是这一个", async () => {
    renderConsole();
    await screen.findByText("第一位待判者");

    // 两个 act,不是一个。浏览器里两次 keydown 是两个任务,React 会在它们
    // 之间重渲染,于是 `rule` 的闭包看得到刚勾上的值。塞进同一个 act 里就
    // 没有那次重渲染,`rule` 拿到的是旧的 false —— 那样测到的是 React 的
    // 批处理,不是这段代码。
    await act(async () => {
      fireEvent.keyDown(window, { key: "w" });
    });
    await act(async () => {
      fireEvent.keyDown(window, { key: "1" });
    });

    // 缺席断言的反面:重置不许把当前这次裁决的意图也一起吃掉。
    expect(mockConclude).toHaveBeenCalledWith(
      JUDGMENT.id,
      expect.objectContaining({ create_workflow: true })
    );
  });
});

/**
 * 规范 v2 这一轮用户拍板的三项队列功能:C 键认领、改派、「我认领的」独立分组
 * (B9 里 Design 列为「新功能待定」;动效沿用交互与动效第三节 2c)。后端早就有
 * (apps/judgment/claims.py 的 claim / reassign / assignable-officers,列表 `?group=mine`),
 * 缺的只是队列页上的这三个动作。
 */
describe("队列页:认领 · 改派 · 我认领的", () => {
  const mockClaim = judgmentApi.claim as jest.Mock;
  const mockReassign = judgmentApi.reassign as jest.Mock;
  const mockList = judgmentApi.list as jest.Mock;
  const mockOfficers = judgmentApi.assignableOfficers as jest.Mock;
  const ME = 5;
  const mine = (j: typeof JUDGMENT) => ({ ...j, claimed_by: ME, claimed_by_name: "我" });

  beforeEach(() => {
    currentUser = { id: ME, role: "JUDGE", permissions: ["judgment.read", "judgment.execute"] };
    mockList.mockResolvedValue({ data: { count: 0, next: null, previous: null, results: [] } });
  });

  it("C 认领屏上这一件,并说一声", async () => {
    renderConsole();
    await screen.findByText("第一位待判者");
    await act(async () => {
      fireEvent.keyDown(window, { key: "c" });
    });
    expect(mockClaim).toHaveBeenCalledWith(JUDGMENT.id);
    await waitFor(() => expect(mockShowToast).toHaveBeenCalledWith("judgment.claim.done_claim:1", "success"));
  });

  it("焦点在备注框里时 c 是一个字,不是认领", async () => {
    renderConsole();
    await screen.findByText("第一位待判者");
    const notes = screen.getByPlaceholderText("judgment.queue.notes_placeholder");
    notes.focus();
    await act(async () => {
      fireEvent.keyDown(notes, { key: "c" });
    });
    expect(mockClaim).not.toHaveBeenCalled();
  });

  it("已经有人认领的这一件:写出是谁,C 不再发请求", async () => {
    mockNext.mockResolvedValue(cursor({ ...JUDGMENT, claimed_by: 99, claimed_by_name: "钟馗" } as typeof JUDGMENT));
    renderConsole();
    await screen.findByText("judgment.claim.claimed_by:钟馗");
    expect(within(screen.getByTestId("queue-claim")).queryByRole("button", { name: /judgment.claim.claim/ })).toBeNull();
    await act(async () => {
      fireEvent.keyDown(window, { key: "c" });
    });
    expect(mockClaim).not.toHaveBeenCalled();
  });

  it("没有落判权限的人:C 什么也不做,也没有「我认领的」", async () => {
    currentUser = { id: ME, role: "VIEWER", permissions: ["judgment.read"] };
    renderConsole();
    await screen.findByText("第一位待判者");
    await act(async () => {
      fireEvent.keyDown(window, { key: "c" });
    });
    expect(mockClaim).not.toHaveBeenCalled();
    expect(screen.queryByTestId("queue-mine")).toBeNull();
  });

  it("改派只给握着 judgment.assign 的人", async () => {
    renderConsole();
    await screen.findByText("第一位待判者");
    expect(within(screen.getByTestId("queue-claim")).queryByRole("button", { name: "judgment.claim.reassign" })).toBeNull();
  });

  it("改派屏上这一件:按选中的人发请求,toast 写「谁 → 谁」,这一件本次不再出现", async () => {
    currentUser = { id: ME, role: "MODERATOR", permissions: ["judgment.read", "judgment.execute", "judgment.assign"] };
    mockOfficers.mockResolvedValue({ data: [{ id: 7, username: "zhongkui", display_name: "钟馗", role: "JUDGE", in_hand: 2 }] });
    renderConsole();
    await screen.findByText("第一位待判者");

    fireEvent.click(within(screen.getByTestId("queue-claim")).getByRole("button", { name: "judgment.claim.reassign" }));
    const dialog = await screen.findByRole("dialog");
    fireEvent.click(await within(dialog).findByRole("radio", { name: /钟馗/ }));
    await act(async () => {
      fireEvent.click(within(dialog).getByRole("button", { name: "judgment.claim.reassign_confirm" }));
    });

    expect(mockReassign).toHaveBeenCalledWith(JUDGMENT.id, 7);
    await waitFor(() => expect(mockShowToast).toHaveBeenCalledWith("judgment.queue.reassigned:第一位待判者,钟馗", "success"));
    // 交出去的那一件进了跳过名单:队列前进到下一件,而且不算「延后」(R 不会放它回来)。
    await screen.findByText("第二位待判者");
    expect(mockNext).toHaveBeenLastCalledWith(expect.objectContaining({ skip: [JUDGMENT.id] }));
    expect(screen.queryByTestId("session-deferred")).toBeNull();
  });

  it("「我认领的」:每行带行首色标与读屏文字「待我处理」", async () => {
    mockList.mockResolvedValue({ data: { count: 2, next: null, previous: null, results: [mine(JUDGMENT), mine(NEXT_JUDGMENT)] } });
    renderConsole();
    const panel = await screen.findByTestId("queue-mine");
    await waitFor(() => expect(within(panel).getAllByTestId("queue-mine-row")).toHaveLength(2));
    expect(mockList).toHaveBeenCalledWith({ group: "mine", ordering: "created_at" });
    expect(within(panel).getAllByTestId("row-mark")).toHaveLength(2);
    expect(within(panel).getAllByText("judgment.row_mark.mine")).toHaveLength(2);
  });

  it("刚认领的那一件排到「我认领的」最上面", async () => {
    // 服务端按入队时间排:认领之前只有第二件,认领之后第一件排在它后面。
    mockList.mockResolvedValue({ data: { count: 1, next: null, previous: null, results: [mine(NEXT_JUDGMENT)] } });
    renderConsole();
    await screen.findByText("第一位待判者");
    mockList.mockResolvedValue({ data: { count: 2, next: null, previous: null, results: [mine(NEXT_JUDGMENT), mine(JUDGMENT)] } });
    await act(async () => {
      fireEvent.keyDown(window, { key: "c" });
    });
    const panel = screen.getByTestId("queue-mine");
    await waitFor(() => expect(within(panel).getAllByTestId("queue-mine-row")).toHaveLength(2));
    expect(within(panel).getAllByTestId("queue-mine-row")[0]).toHaveTextContent("第一位待判者");
  });
});

describe("行首色标只表示「待我处理」(B12)", () => {
  it("未结案且认领人是我 → 有", () => {
    expect(isMinePending({ concluded_at: null, claimed_by: 5 }, 5)).toBe(true);
  });

  it.each([
    ["已结案", { concluded_at: "2026-09-30T00:00:00Z", claimed_by: 5 }, 5],
    ["别人认领", { concluded_at: null, claimed_by: 6 }, 5],
    ["无人认领", { concluded_at: null, claimed_by: null }, 5],
    ["没登录", { concluded_at: null, claimed_by: 5 }, undefined],
  ] as const)("%s → 没有", (_label, judgment, user) => {
    expect(isMinePending(judgment, user)).toBe(false);
  });
});
