/**
 * /cross-judgments 的列菜单:案件标题列钉住,其余可隐藏;偏好记在本浏览器。
 */
import { fireEvent, render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import CrossJudgmentsPage from "@/app/cross-judgments/page";
import { crossTenantJudgmentsApi } from "@soulledger/core/api";

jest.mock("@soulledger/core/api", () => ({
  crossTenantJudgmentsApi: { list: jest.fn(), exportCsv: jest.fn() },
  PAGE_SIZE: 20,
}));
jest.mock("@soulledger/core/api/client", () => ({ PAGE_SIZE: 20 }));
jest.mock("@/src/contexts/I18nContext", () => ({
  useI18n: () => ({ t: (key: string) => key, formatDate: (v: string) => v, locale: "zh-Hans", hydrated: true }),
}));
jest.mock("@/src/contexts/ToastContext", () => ({ useToast: () => ({ showToast: jest.fn() }) }));
jest.mock("@/src/contexts/TenantContext", () => ({ useTenant: () => ({ user: { id: 1, tenant: { code: "CN_DIYU" } } }) }));
jest.mock("@/src/components/layout/MenuGloss", () => ({ MenuGloss: () => null }));
jest.mock("@/src/hooks/usePermissions", () => {
  const has = () => true;
  return { usePermissions: () => ({ hasPermission: has, hasAnyPermission: has, hasAllPermissions: has }) };
});

const COLS = "soulledger.cross-judgments.columns";
const headers = () => screen.queryAllByRole("columnheader").map((h) => h.textContent);
const open = () => fireEvent.click(screen.getByRole("button", { name: /^list\.columns\.button/ }));

function renderPage() {
  (crossTenantJudgmentsApi.list as jest.Mock).mockResolvedValue({
    data: { count: 1, results: [{ id: "c1", title: "联合案甲", status: "ACTIVE", initiating_tenant_code: "EU_HEAVEN_HELL", initiating_tenant_display_name: "欧洲天堂" }] },
  });
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={client}><CrossJudgmentsPage /></QueryClientProvider>);
}

beforeEach(() => localStorage.clear());

it("the case title column is pinned and cannot be hidden; the hint shows", async () => {
  renderPage();
  await screen.findByText("联合案甲");
  open();
  const pinned = screen.getByRole("menuitemcheckbox", { name: "crossJudgments.case_title" });
  expect(pinned).toBeDisabled();
  expect(pinned).toHaveAttribute("aria-disabled", "true");
  fireEvent.click(pinned);
  expect(headers()).toContain("crossJudgments.case_title");
  expect(screen.getByRole("menuitemcheckbox", { name: "crossJudgments.status_label" })).not.toBeDisabled();
  expect(screen.getByText("list.columns.hint")).toBeInTheDocument();
});

it("hiding a column drops header and cells, persists, and survives a remount", async () => {
  const { unmount } = renderPage();
  await screen.findByText("联合案甲");
  expect(screen.getByText("欧洲天堂", { exact: false })).toBeInTheDocument();
  open();
  fireEvent.click(screen.getByRole("menuitemcheckbox", { name: "crossJudgments.initiated_by" }));
  expect(headers()).not.toContain("crossJudgments.initiated_by");
  expect(screen.queryByText("欧洲天堂", { exact: false })).toBeNull();
  expect(JSON.parse(localStorage.getItem(COLS)!)).toEqual({ hidden: "initiated_by" });
  unmount();
  renderPage();
  await screen.findByText("联合案甲");
  expect(headers()).not.toContain("crossJudgments.initiated_by");
});
