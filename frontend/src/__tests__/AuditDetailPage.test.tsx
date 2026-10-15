/**
 * app/audit/[id]/page.tsx: the audit detail the backend always had (`AuditLogDetailSerializer`) and
 * the web never called. Shows who/when/what, the before → after table, and the trace link.
 */
import { render, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import AuditDetailPage from "@/app/audit/[id]/page";
import { auditApi } from "@soulledger/core/api";

jest.mock("@soulledger/core/api", () => ({
  auditApi: { get: jest.fn() },
  menusApi: {
    all: jest.fn().mockResolvedValue({ data: [] }),
    list: jest.fn().mockResolvedValue({ data: { results: [] } }),
  },
}));
jest.mock("next/navigation", () => ({
  useParams: () => ({ id: "7" }),
  useRouter: () => ({ back: jest.fn() }),
}));

let mockPermissions: string[] = ["audit.read"];
jest.mock("@/src/contexts/TenantContext", () => ({
  useTenant: () => ({ isAdmin: false, tenantCode: null, user: { role: "MODERATOR", permissions: mockPermissions } }),
}));
jest.mock("@/src/contexts/I18nContext", () => ({
  useI18n: () => ({
    t: (key: string) => key,
    formatDateTime: (v: string) => `dt(${v})`,
    formatDate: (v: string) => v,
    locale: "en",
    hydrated: true,
  }),
}));

const mockedGet = auditApi.get as jest.Mock;

function renderPage() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const Wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
  return render(<AuditDetailPage />, { wrapper: Wrapper });
}

beforeEach(() => {
  jest.clearAllMocks();
  mockPermissions = ["audit.read"];
  mockedGet.mockResolvedValue({
    data: {
      id: 7,
      action: "UPDATE",
      resource: "soul",
      resource_id: "9",
      description: "changed a soul",
      timestamp: "2026-01-01T00:00:00Z",
      username: "alice",
      user_display: "alice",
      tenant_code: "EG_DUAT",
      user_details: { id: 3, username: "alice", role: "MODERATOR", tenant: "CN_DIYU" },
      is_batch_operation: false,
      ip_address: "10.0.0.1",
      user_agent: "UA-STRING",
      trace_id: "abc 123",
      changes: { name: { old: "甲", new: "乙" }, batch_id: "xyz" },
    },
  });
});

it("shows the user with their own hall, the before → after table and the trace link", async () => {
  renderPage();
  await screen.findByText("changed a soul");
  expect(mockedGet).toHaveBeenCalledWith("7");
  expect(screen.getByText(/alice · CN_DIYU/)).toBeTruthy();
  expect(screen.getByText("甲")).toBeTruthy();
  expect(screen.getByText("乙")).toBeTruthy();
  expect(screen.getByText("xyz")).toBeTruthy();
  expect(screen.getByText("UA-STRING")).toBeTruthy();
  const link = screen.getByText("audit.detail.trace_filter").closest("a");
  expect(link?.getAttribute("href")).toBe("/audit?trace=abc%20123");
});

it("does not fetch without audit.read", async () => {
  mockPermissions = [];
  renderPage();
  await waitFor(() => expect(screen.getByText("audit.access_denied")).toBeTruthy());
  expect(mockedGet).not.toHaveBeenCalled();
});

it("says so when the record cannot be loaded", async () => {
  mockedGet.mockRejectedValue(new Error("404"));
  renderPage();
  await screen.findByText("audit.detail.not_found");
});
