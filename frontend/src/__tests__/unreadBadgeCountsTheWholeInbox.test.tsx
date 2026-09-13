/**
 * FL-15: the bell's number is the unread inbox, not the first page of it.
 *
 * `AppLayout` cached under `notificationKeys.unreadCount` but stored
 * `res.data.results` and rendered `notifications.length` — the length of one
 * page (PAGE_SIZE 20). With 21 unread the bell said 20. The list endpoint
 * already returns the real total as `count`; no new endpoint is needed.
 *
 * The fixture is the case a page-length implementation cannot pass: `count`
 * is 21 while `results` carries 20, so the 21st unread notification exists
 * only on page two.
 */
import { render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

jest.mock("@/src/contexts/I18nContext", () => ({
  LOCALE_LABELS: { "zh-Hans": "简体中文", en: "English", egy: "Kemet" },
  useI18n: () => ({
    t: (key: string) => key,
    locale: "zh-Hans",
    hydrated: true,
    formatDate: (v: unknown) => String(v),
    formatDateTime: (v: unknown) => String(v),
  }),
}));

jest.mock("@/src/contexts/ThemeContext", () => ({
  useTheme: () => ({ theme: "dark", toggleTheme: jest.fn() }),
}));

const mockTenant = {
  user: { id: 1, username: "admin", role: "ADMIN", tenant: null, permissions: [] },
  tenantCode: "CN",
  logout: jest.fn(),
};
jest.mock("@/src/contexts/TenantContext", () => ({
  useTenant: () => mockTenant,
}));

jest.mock("next/navigation", () => ({
  usePathname: () => "/dashboard",
  useRouter: () => ({ push: jest.fn(), replace: jest.fn(), prefetch: jest.fn() }),
}));

const mockList = jest.fn();
jest.mock("@soulledger/core/api", () => ({
  notificationsApi: { list: (...args: unknown[]) => mockList(...args) },
  authApi: { logout: jest.fn().mockResolvedValue({}) },
}));

jest.mock("@/src/components/connection-status", () => ({
  ConnectionStatus: () => null,
}));

jest.mock("@/src/hooks/useSidebarMenus", () => ({
  ...jest.requireActual("@/src/hooks/useSidebarMenus"),
  useSidebarMenus: () => ({ data: [] }),
}));

import { AppLayout } from "@/src/components/layout/AppLayout";

function firstPage(size: number) {
  return Array.from({ length: size }, (_, i) => ({
    id: i + 1,
    title: `n${i + 1}`,
    message: `n${i + 1}`,
    is_read: false,
    created_at: "2026-09-13T00:00:00Z",
  }));
}

function renderLayout() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const Wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  return render(<AppLayout>page body</AppLayout>, { wrapper: Wrapper });
}

describe("the unread badge", () => {
  it("counts the unread notification that only exists on page two", async () => {
    mockList.mockResolvedValue({ data: { count: 21, next: "?page=2", previous: null, results: firstPage(20) } });

    renderLayout();

    const bell = await screen.findByRole("button", { name: "notifications.title (21)" });
    expect(bell).toBeInTheDocument();
    // Absence: a page-length badge says 20, and would sit here instead.
    expect(screen.queryByRole("button", { name: "notifications.title (20)" })).not.toBeInTheDocument();
    expect(mockList).toHaveBeenCalledWith({ is_read: "false" });
  });

  it("shows no count when the inbox has nothing unread", async () => {
    mockList.mockResolvedValue({ data: { count: 0, next: null, previous: null, results: [] } });

    renderLayout();

    expect(await screen.findByRole("button", { name: "notifications.title" })).toBeInTheDocument();
  });
});
