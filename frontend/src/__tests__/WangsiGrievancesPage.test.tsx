/**
 * 枉死申诉列表(2026-11-16):官员端 App「待我处理 · 枉死申诉」那一组在网页上的表。读同一个接口
 * (`/officer-app/todo/?kind=wangsi&offset=…`,一页 10 条),每行到审判页去审;门里按 `wangsi.execute` 给,只在地府。
 */
import { fireEvent, screen, waitFor } from "@testing-library/react";

const mockTodoGroup = jest.fn();
jest.mock("@soulledger/core/api/officer-app", () => ({
  ...jest.requireActual("@soulledger/core/api/officer-app"),
  officerAppApi: { todoGroup: (...a: unknown[]) => mockTodoGroup(...a) },
}));
jest.mock("@/src/contexts/I18nContext", () =>
  require("./support/mocks").i18nMock({ actual: true, locale: "zh-Hans", hydrated: true, formatDateTime: (v: string) => `@${v}` })
);
const mockUser: { permissions: string[] } = { permissions: ["wangsi.execute"] };
jest.mock("@/src/contexts/TenantContext", () =>
  require("./support/mocks").tenantMock({ user: () => ({ id: 1, role: "JUDGE", tenant: { civilization: "CHINESE" }, ...mockUser }) })
);

import WangsiGrievancesPage from "@/app/judgment/wangsi/page";
import { PAGES, doorTabs, type Viewer } from "@/src/lib/doors";
import { renderWithProviders } from "./support/render";

const row = (id: string, over: Record<string, unknown> = {}) => ({
  kind: "wangsi", id, title: `魂${id}`, created_at: `2026-11-0${id}T08:00:00Z`, target: { kind: "wangsi", id: `j${id}` },
  city_god_name: "常熟县城隍", grievance_level: "MAJOR", ...over,
});

beforeEach(() => {
  jest.clearAllMocks();
  mockUser.permissions = ["wangsi.execute"];
});

describe("枉死申诉 page", () => {
  it("lists the app's wangsi group, each soul a link to its judgment page, an unset level said so", async () => {
    mockTodoGroup.mockResolvedValue({ data: { count: 2, items: [row("1"), row("2", { grievance_level: "" })] } });
    renderWithProviders(<WangsiGrievancesPage />);
    const link = await screen.findByTestId("wangsi-row-1");
    expect(link).toHaveAttribute("href", "/judgment/j1");
    expect(screen.getByTestId("wangsi-row-2")).toHaveAttribute("href", "/judgment/j2");
    expect(mockTodoGroup).toHaveBeenCalledWith("wangsi", 0);
    expect(screen.getAllByText("常熟县城隍")).toHaveLength(2);
    expect(screen.getByText("@2026-11-01T08:00:00Z")).toBeInTheDocument();
    const rows = screen.getAllByRole("row").slice(1);
    expect(rows[1]).toHaveTextContent("judgment.wangsi.unset");
    expect(rows[0]).not.toHaveTextContent("judgment.wangsi.unset");
  });

  it("pages ten at a time by offset", async () => {
    mockTodoGroup.mockResolvedValue({ data: { count: 12, items: Array.from({ length: 10 }, (_, i) => row(String(i + 1))) } });
    renderWithProviders(<WangsiGrievancesPage />);
    await screen.findByTestId("wangsi-row-1");
    fireEvent.click(screen.getByRole("button", { name: "pagination.last" }));
    await waitFor(() => expect(mockTodoGroup).toHaveBeenLastCalledWith("wangsi", 10));
  });

  it("says there is nothing pending when the group is empty", async () => {
    mockTodoGroup.mockResolvedValue({ data: { count: 0, items: [] } });
    renderWithProviders(<WangsiGrievancesPage />);
    expect(await screen.findByText("judgment.wangsi.error.no_grievance_filed")).toBeInTheDocument();
  });

  it("refuses without wangsi.execute, and reads nothing", async () => {
    mockUser.permissions = ["judgment.read"];
    renderWithProviders(<WangsiGrievancesPage />);
    await waitFor(() => expect(screen.queryByTestId("wangsi-row-1")).toBeNull());
    expect(mockTodoGroup).not.toHaveBeenCalled();
  });
});

describe("枉死申诉 in the desk door", () => {
  const viewer = (perms: string[], civilization?: string): Viewer => ({
    role: "JUDGE",
    isAdmin: false,
    hasPermission: (c) => perms.includes(c),
    menuPaths: new Set(),
    civilization,
  });
  const tab = (v: Viewer) => doorTabs("desk", v).some((p) => p.path === "/judgment/wangsi");

  it("is a desk page for wangsi.execute, in Diyu or with no hall; never in another civilization's hall", () => {
    expect(PAGES.find((p) => p.path === "/judgment/wangsi")?.door).toBe("desk");
    expect(tab(viewer(["wangsi.execute"], "CHINESE"))).toBe(true);
    expect(tab(viewer(["wangsi.execute"]))).toBe(true);
    expect(tab(viewer(["wangsi.execute"], "EGYPTIAN"))).toBe(false);
    expect(tab(viewer(["judgment.read"], "CHINESE"))).toBe(false);
  });
});
