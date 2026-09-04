/**
 * Tests for app/notifications/page.tsx.
 *
 * The unread count drives three separate pieces of UI (the bell badge, the
 * "mark all read" button, the tab pill) off one derived number, and the
 * filter tab has to actually change the request — a filter that renders as
 * selected but sends no `is_read=false` looks completely normal on a tenant
 * whose notifications happen to be unread. Both are pinned here, along with
 * the failure toasts for the two mutations.
 */
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import type { ReactNode } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import NotificationsPage from "@/app/notifications/page";
import { notificationsApi } from "@soulledger/core/api";

jest.mock("@soulledger/core/api", () => ({
  notificationsApi: { list: jest.fn(), markRead: jest.fn(), markAllRead: jest.fn() },
}));

const mockShowToast = jest.fn();

jest.mock("@/src/contexts/ToastContext", () => ({
  useToast: () => ({ showToast: mockShowToast }),
}));

jest.mock("@/src/contexts/I18nContext", () => ({
  useI18n: () => ({
    t: (key: string) => key,
    formatDateTime: (v: string) => `dt(${v})`,
    locale: "en",
    hydrated: true,
  }),
}));

const mockedList = notificationsApi.list as jest.Mock;
const mockedMarkRead = notificationsApi.markRead as jest.Mock;
const mockedMarkAllRead = notificationsApi.markAllRead as jest.Mock;

function notification(over: Record<string, unknown> = {}) {
  return {
    id: 1,
    title: "Verdict ready",
    message: "Soul Meng judged",
    notification_type: "JUDGMENT_COMPLETED",
    is_read: false,
    created_at: "2026-01-01T00:00:00Z",
    ...over,
  };
}

function renderPage() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const Wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
  return render(<NotificationsPage />, { wrapper: Wrapper });
}

beforeEach(() => {
  jest.clearAllMocks();
  mockedList.mockResolvedValue({ data: { results: [notification()] } });
  mockedMarkRead.mockResolvedValue({});
  mockedMarkAllRead.mockResolvedValue({});
});

// ── Listing ──────────────────────────────────────────────────────────

describe("NotificationsPage listing", () => {
  it("renders each notification's title, body and formatted timestamp", async () => {
    renderPage();

    expect(await screen.findByText("Verdict ready")).toBeInTheDocument();
    expect(screen.getByText("Soul Meng judged")).toBeInTheDocument();
    expect(screen.getByText("dt(2026-01-01T00:00:00Z)")).toBeInTheDocument();
  });

  it("shows the empty state when the inbox is empty", async () => {
    mockedList.mockResolvedValue({ data: { results: [] } });

    renderPage();

    expect(await screen.findByText("notifications.empty")).toBeInTheDocument();
  });

  it("renders a distinct icon per notification type and a fallback for unknown ones", async () => {
    mockedList.mockResolvedValue({
      data: {
        results: [
          notification({ id: 1, title: "A", notification_type: "WORKFLOW_ASSIGNED" }),
          notification({ id: 2, title: "B", notification_type: "APPEAL_REQUIRED" }),
          notification({ id: 3, title: "C", notification_type: "REINCARNATION_COMPLETE" }),
          notification({ id: 4, title: "D", notification_type: "KARMIC_UPDATE" }),
          notification({ id: 5, title: "E", notification_type: "ROLE_ASSIGNED" }),
          notification({ id: 6, title: "F", notification_type: "SOMETHING_NEW" }),
          notification({ id: 7, title: "G", notification_type: undefined }),
        ],
      },
    });

    const { container } = renderPage();

    await screen.findByText("A");
    // Seven rows, each with exactly one icon — including the two that fall
    // through to the default bell.
    expect(container.querySelectorAll(".w-10.h-10 svg")).toHaveLength(7);
  });
});

// ── Unread accounting ────────────────────────────────────────────────

describe("NotificationsPage unread count", () => {
  it("counts only the unread notifications", async () => {
    mockedList.mockResolvedValue({
      data: {
        results: [
          notification({ id: 1, is_read: false }),
          notification({ id: 2, is_read: true, title: "Read one" }),
          notification({ id: 3, is_read: false, title: "Third" }),
        ],
      },
    });

    renderPage();

    await screen.findByText("Read one");
    // Badge on the bell plus the pill on the unread tab.
    expect(screen.getAllByText("2")).toHaveLength(2);
  });

  it("caps the bell badge at 99+ but leaves the tab pill exact", async () => {
    mockedList.mockResolvedValue({
      data: { results: Array.from({ length: 150 }, (_, i) => notification({ id: i, title: `n${i}` })) },
    });

    renderPage();

    expect(await screen.findByText("99+")).toBeInTheDocument();
    expect(screen.getByText("150")).toBeInTheDocument();
  });

  it("hides the badge and the mark-all button when everything is read", async () => {
    mockedList.mockResolvedValue({ data: { results: [notification({ is_read: true })] } });

    renderPage();

    await screen.findByText("Verdict ready");
    expect(screen.queryByText("notifications.mark_all_read")).not.toBeInTheDocument();
    expect(screen.queryByText("notifications.mark_read")).not.toBeInTheDocument();
  });
});

// ── Filtering ────────────────────────────────────────────────────────

describe("NotificationsPage filter tabs", () => {
  it("requests everything with no params on the default tab", async () => {
    renderPage();

    await screen.findByText("Verdict ready");
    expect(mockedList).toHaveBeenCalledWith(undefined);
  });

  it("sends is_read=false when the unread tab is selected", async () => {
    renderPage();

    fireEvent.click(await screen.findByText("notifications.unread"));

    await waitFor(() => expect(mockedList).toHaveBeenCalledWith({ is_read: "false" }));
  });

  it("drops the filter again when switching back to all", async () => {
    renderPage();

    fireEvent.click(await screen.findByText("notifications.unread"));
    await waitFor(() => expect(mockedList).toHaveBeenCalledWith({ is_read: "false" }));
    mockedList.mockClear();

    fireEvent.click(screen.getByText("notifications.all"));

    await waitFor(() => expect(mockedList).toHaveBeenCalledWith(undefined));
  });
});

// ── Mutations ────────────────────────────────────────────────────────

describe("NotificationsPage mark-as-read", () => {
  it("marks a single notification read by its stringified id", async () => {
    renderPage();

    fireEvent.click(await screen.findByText("notifications.mark_read"));

    await waitFor(() => expect(mockedMarkRead).toHaveBeenCalledWith("1"));
  });

  it("toasts when marking one read fails", async () => {
    mockedMarkRead.mockRejectedValue(new Error("500"));
    renderPage();

    fireEvent.click(await screen.findByText("notifications.mark_read"));

    await waitFor(() =>
      expect(mockShowToast).toHaveBeenCalledWith("notifications.mark_read_error", "error"),
    );
  });

  it("marks everything read from the header button", async () => {
    renderPage();

    fireEvent.click(await screen.findByText("notifications.mark_all_read"));

    await waitFor(() => expect(mockedMarkAllRead).toHaveBeenCalled());
  });

  it("toasts when marking all read fails", async () => {
    mockedMarkAllRead.mockRejectedValue(new Error("500"));
    renderPage();

    fireEvent.click(await screen.findByText("notifications.mark_all_read"));

    await waitFor(() =>
      expect(mockShowToast).toHaveBeenCalledWith("notifications.mark_all_error", "error"),
    );
  });

  it("offers no mark-read action on an already-read notification", async () => {
    mockedList.mockResolvedValue({
      data: {
        results: [
          notification({ id: 1, is_read: true, title: "Read" }),
          notification({ id: 2, is_read: false, title: "Unread" }),
        ],
      },
    });

    renderPage();

    await screen.findByText("Read");
    expect(screen.getAllByText("notifications.mark_read")).toHaveLength(1);
  });

  /**
   * 选中的那个 tab 自己说自己被选中。
   *
   * 之前两个筛选按钮只在 `border-b-2` 的颜色和文字颜色上不同 —— 读屏用户听到
   * 的是两个一模一样的按钮,分不出当前在看哪一组。这里断言的是真页面,不是一个
   * 我自己写对的合成 tab 条。
   */
  it("筛选 tab 用 aria-pressed 报告选中,而不是只靠颜色", async () => {
    renderPage();

    const all = await screen.findByRole("button", { name: /notifications\.all/ });
    const unread = screen.getByRole("button", { name: /notifications\.unread/ });
    expect(all).toHaveAttribute("aria-pressed", "true");
    expect(unread).toHaveAttribute("aria-pressed", "false");

    fireEvent.click(unread);

    // 两边都断言:只断言「新的那个是 true」,在一个把两个都设成 true 的实现下
    // 同样会绿。
    await waitFor(() => expect(unread).toHaveAttribute("aria-pressed", "true"));
    expect(all).toHaveAttribute("aria-pressed", "false");
  });
});
