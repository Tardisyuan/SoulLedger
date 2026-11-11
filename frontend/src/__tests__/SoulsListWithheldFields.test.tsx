/**
 * /souls 列表里被字段权限藏掉的字段(审计 2026-11-11 P-11):后端把它从这一行里拿掉(与详情同一口径),
 * 页面显示 MissingValue「已隐藏 — 本角色不可见」,而不是空白的链接或空徽章。没被藏的行照常显示。
 * 后端那一半见 backend/tests/test_field_permissions_reach_lists_and_exports.py。
 */
import { screen } from "@testing-library/react";
import SoulsPage from "@/app/souls/page";
import { renderWithProviders } from "./support/render";

let mockRows: Record<string, unknown>[] = [];
jest.mock("@soulledger/core/hooks/useSouls", () => ({
  useSoulImportPreview: () => ({ mutate: jest.fn(), mutateAsync: jest.fn(), isPending: false, reset: jest.fn() }),
  useSoulImportCommit: () => ({ mutate: jest.fn(), mutateAsync: jest.fn(), isPending: false, reset: jest.fn() }),
  useSouls: () => ({
    data: { results: mockRows, count: mockRows.length },
    isLoading: false,
    isError: false,
    isPlaceholderData: false,
    refetch: jest.fn(),
  }),
  useSoul: () => ({ isLoading: false, isError: false }),
  useCreateSoul: () => ({ mutateAsync: jest.fn() }),
  useBatchRecycleSouls: () => ({ mutate: jest.fn(), isPending: false }),
}));
jest.mock("@soulledger/core/api", () => ({
  ...jest.requireActual("@soulledger/core/api"),
  PAGE_SIZE: 20,
  soulsApi: { list: jest.fn().mockResolvedValue({ data: { count: 0, results: [] } }), export: jest.fn(), exportCsv: jest.fn() },
}));
jest.mock("next/navigation", () => ({
  useRouter: () => ({ push: jest.fn() }),
  useSearchParams: () => new URLSearchParams(""),
}));
jest.mock("@/src/contexts/TenantContext", () => ({
  useTenant: () => ({ user: { role: "JUDGE", permissions: ["soul.read"] } }),
}));
jest.mock("@/src/contexts/I18nContext", () => require("./support/mocks").i18nMock({ params: "colon", locale: "zh-Hans", hydrated: true }));

const WITHHELD = "common.value.unrecorded — souls.field_withheld";
const BASE = { birth_date: null, date_problems: [], has_date_warning: false, has_record_error: false, is_eval_identity: false, is_archived: false, soup_taken_at: null };

beforeEach(() => {
  window.localStorage.clear();
  mockRows = [
    { ...BASE, id: "open", name: "沈青梧", civilization: "CHINESE", current_state: "JUDGING", death_date: { year: 1303, month: 4, day: 6 }, karmic_balance: 1 },
    // name / civilization / current_state / death_date hidden by a FieldPermission rule: the keys are absent.
    { ...BASE, id: "ruled", karmic_balance: 2 },
  ];
});

it("被藏的字段显示「已隐藏」,没被藏的那一行照常", async () => {
  renderWithProviders(<SoulsPage />, { i18n: false });
  const open = (await screen.findByText("沈青梧")).closest("tr")!;
  expect(open.querySelector('[aria-label$="souls.field_withheld"]')).toBeNull();
  expect(open).toHaveTextContent("1303");

  const ruled = screen.getByRole("link", { name: WITHHELD }).closest("tr")!;
  expect(ruled).not.toBe(open);
  // 姓名、文明、状态、死亡日期四格,各一个 MissingValue,读屏器读得到原因。
  expect(ruled.querySelectorAll(`[aria-label="${WITHHELD}"]`)).toHaveLength(4);
  expect(ruled.querySelectorAll("[data-missing]").length).toBeGreaterThanOrEqual(4);
});
