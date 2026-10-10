/**
 * /notifications 的批量(第十五批 C2):勾选后底部出现批量条 —— 标为已读 / 删除(先确认);
 * 「全部已读」在页头,不需要先选。批量之后外壳角标(`unreadCount`)与列表一并失效刷新。
 * 范围(只动自己的通知、条数上限)是后端的事,见 backend/tests/test_notifications_batch.py。
 */
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { ReactNode } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import NotificationsPage from "@/app/notifications/page";
import { notificationsApi } from "@soulledger/core/api";
import { notificationKeys } from "@soulledger/core/query_keys";

jest.mock("@soulledger/core/api", () => ({
  notificationsApi: {
    list: jest.fn(), markRead: jest.fn(), markAllRead: jest.fn(), batchRead: jest.fn(), batchDelete: jest.fn(),
  },
}));
const mockShowToast = jest.fn();
jest.mock("@/src/contexts/TenantContext", () => ({ useTenant: () => ({ user: { role: "JUDGE", permissions: [] } }) }));
jest.mock("@/src/contexts/ToastContext", () => ({ useToast: () => ({ showToast: mockShowToast }) }));
jest.mock("@/src/contexts/I18nContext", () => ({
  useI18n: () => ({
    t: (key: string, params?: Record<string, string>) => (params ? `${key}:${Object.values(params).join(",")}` : key),
    formatDateTime: (v: string) => `dt(${v})`,
    formatDate: (v: string) => `d(${v})`,
    locale: "en",
    hydrated: true,
  }),
}));

const n = (id: number, over: Record<string, unknown> = {}) => ({
  id, title: `Note ${id}`, message: "m", notification_type: "SYSTEM", is_read: false,
  created_at: "2026-01-01T00:00:00Z", ...over,
});

let client: QueryClient;
function renderPage() {
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const Wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  return render(<NotificationsPage />, { wrapper: Wrapper });
}
const tick = (title: string) => fireEvent.click(screen.getByRole("checkbox", { name: `notifications.select_row:${title}` }));
const bar = () => screen.queryByRole("region", { name: "notifications.batch_region" });

beforeEach(() => {
  jest.clearAllMocks();
  (notificationsApi.list as jest.Mock).mockResolvedValue({ data: { results: [n(1), n(2), n(3, { is_read: true })] } });
  (notificationsApi.batchRead as jest.Mock).mockResolvedValue({ data: { marked_read: 2 } });
  (notificationsApi.batchDelete as jest.Mock).mockResolvedValue({ data: { deleted: 2 } });
});

it("shows no batch bar until something is ticked, and 全部已读 needs no selection", async () => {
  renderPage();
  await screen.findByText("Note 1");
  expect(bar()).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "notifications.mark_all_read" }));
  await waitFor(() => expect(notificationsApi.markAllRead).toHaveBeenCalled());
  expect(notificationsApi.batchRead).not.toHaveBeenCalled();
});

it("marks the ticked ones read, reports the server's count and refreshes the unread badge", async () => {
  renderPage();
  await screen.findByText("Note 1");
  const invalidate = jest.spyOn(client, "invalidateQueries");
  tick("Note 1");
  tick("Note 2");
  expect(bar()).toHaveTextContent("notifications.batch_selected:2");
  fireEvent.click(within(bar()!).getByRole("button", { name: "notifications.mark_read" }));
  await waitFor(() => expect(notificationsApi.batchRead).toHaveBeenCalledWith(["1", "2"]));
  await waitFor(() => expect(mockShowToast).toHaveBeenCalledWith("notifications.mark_all_success:2", "success"));
  expect(invalidate).toHaveBeenCalledWith({ queryKey: notificationKeys.unreadCount });
  await waitFor(() => expect(bar()).toBeNull());
});

it("asks before deleting: cancel deletes nothing, confirm deletes the ticked ones", async () => {
  renderPage();
  await screen.findByText("Note 1");
  tick("Note 1");
  tick("Note 3");
  fireEvent.click(within(bar()!).getByRole("button", { name: "common.delete" }));
  expect(await screen.findByText("notifications.batch_delete_title:2")).toBeInTheDocument();
  expect(notificationsApi.batchDelete).not.toHaveBeenCalled();
  fireEvent.click(within(screen.getByRole("alertdialog")).getByRole("button", { name: "common.cancel" }));
  await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull());
  expect(notificationsApi.batchDelete).not.toHaveBeenCalled();

  fireEvent.click(within(bar()!).getByRole("button", { name: "common.delete" }));
  fireEvent.click(within(await screen.findByRole("alertdialog")).getByRole("button", { name: "common.delete" }));
  await waitFor(() => expect(notificationsApi.batchDelete).toHaveBeenCalledWith(["1", "3"]));
  await waitFor(() => expect(mockShowToast).toHaveBeenCalledWith("notifications.batch_deleted:2", "success"));
});

it("drops the selection when the filter changes", async () => {
  renderPage();
  await screen.findByText("Note 1");
  tick("Note 1");
  expect(bar()).not.toBeNull();
  fireEvent.click(screen.getByRole("button", { name: /notifications.unread/ }));
  await waitFor(() => expect(bar()).toBeNull());
});

it("ticks nothing beyond the batch limit", async () => {
  const many = Array.from({ length: 101 }, (_, i) => n(i + 1));
  (notificationsApi.list as jest.Mock).mockResolvedValue({ data: { results: many } });
  renderPage();
  await screen.findByText("Note 1");
  fireEvent.click(screen.getByRole("checkbox", { name: "notifications.select_all" }));
  expect(bar()).toHaveTextContent("notifications.batch_selected:100");
  tick("Note 101");
  expect(bar()).toHaveTextContent("notifications.batch_selected:100");
});
