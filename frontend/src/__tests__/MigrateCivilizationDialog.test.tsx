/**
 * 迁移文明(2026-11-16 用户决定;Design 第五十四批 H1):只给 SYSTEM_ADMIN,不出现在灵魂与 SYSTEM_ADMIN 的行上;
 * 当前文明那一格不可点;殿只列所选文明的、换文明就清空;原因没写不发请求;手上有事时换成清单,清空后换回表单;
 * 跨文明的保存错误用 `errors.cross_civilization` 整句。每条都断言有与没有。
 */
import { act, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { focusManager } from "@tanstack/react-query";
import UsersPage from "@/app/users/page";
import { usersApi, permApi } from "@soulledger/core/api";
import { MigrateCivilizationDialog } from "@/src/components/users/MigrateCivilizationDialog";
import { renderWithProviders } from "./support/render";

jest.mock("@soulledger/core/api", () => ({
  ...jest.requireActual("@soulledger/core/api"),
  usersApi: { list: jest.fn(), migrateOpenWork: jest.fn(), migrateCivilization: jest.fn() },
  permApi: { roles: { list: jest.fn() } },
  PAGE_SIZE: 20,
}));
jest.mock("@soulledger/core/hooks/useTenants", () => ({
  useTenantNames: () => ({
    data: [
      { id: 1, code: "CN_DIYU", display_name: "地府", civilization: "CHINESE", is_active: true },
      { id: 2, code: "EU_MINOS", display_name: "米诺斯之庭", civilization: "EUROPEAN", is_active: true },
      { id: 3, code: "GR_HADES", display_name: "哈迪斯", civilization: "GREEK", is_active: true },
      { id: 4, code: "EU_CLOSED", display_name: "关了的殿", civilization: "EUROPEAN", is_active: false },
    ],
  }),
}));
jest.mock("@/src/components/ui/Toast", () => ({ showToast: jest.fn() }));
jest.mock("@/src/contexts/I18nContext", () => require("./support/mocks").i18nMock({ params: "paren", locale: "zh-Hans", hydrated: true }));
const mockTenant = { user: { id: 1, username: "sys", role: "SYSTEM_ADMIN", tenant: null, permissions: ["user.manage"] } };
jest.mock("@/src/contexts/TenantContext", () => ({ useTenant: () => mockTenant }));
jest.mock("next/navigation", () => ({ useRouter: () => ({ replace: jest.fn() }), useSearchParams: () => new URLSearchParams() }));
jest.mock("@/src/components/layout/MenuGloss", () => ({ MenuGloss: () => null }));

const { showToast } = jest.requireMock("@/src/components/ui/Toast") as { showToast: jest.Mock };
const FREE = { claimed: 0, approvals: 0, dispatch: 0, cross: 0, kinds: {} };
const judge = { id: 7, username: "cuijue", email: "c@x", role: "JUDGE", tenant: { id: 1, code: "CN_DIYU", display_name: "地府", civilization: "CHINESE" } };

function dialog(user = judge) {
  return renderWithProviders(<MigrateCivilizationDialog user={user as never} onClose={jest.fn()} />, { i18n: false });
}
const cell = (civ: string) => screen.getByRole("radio", { name: new RegExp(`tenant\\.civilizations\\.${civ}`) });
const submit = () => screen.getByTestId("migrate-civ-submit");

afterEach(() => focusManager.setFocused(undefined));

beforeEach(() => {
  jest.clearAllMocks();
  (usersApi.migrateOpenWork as jest.Mock).mockResolvedValue({ data: FREE });
  (permApi.roles.list as jest.Mock).mockResolvedValue({ data: [] });
});

describe("表单", () => {
  it("当前文明不可点;殿只列所选文明里开着的殿,换文明清空;没选之前主按钮写「迁移」且不可点", async () => {
    dialog();
    await waitFor(() => expect(usersApi.migrateOpenWork).toHaveBeenCalledWith(7));
    expect(cell("CHINESE")).toBeDisabled();
    expect(cell("EUROPEAN")).not.toBeDisabled();
    expect(submit()).toBeDisabled();
    expect(submit()).toHaveTextContent("users.migrate_civ.menu");
    const hall = screen.getByLabelText(/users\.migrate_civ\.hall$/) as HTMLSelectElement;
    expect(hall).toBeDisabled();

    fireEvent.click(cell("EUROPEAN"));
    expect(hall).not.toBeDisabled();
    const options = Array.from(hall.options).map((o) => o.value);
    expect(options).toEqual(["", "EU_MINOS"]); // not the CN / GR halls, not the closed EU hall
    fireEvent.change(hall, { target: { value: "EU_MINOS" } });
    expect(submit()).toHaveTextContent("users.migrate_civ.submit(tenant.civilizations.EUROPEAN)");
    fireEvent.click(cell("GREEK"));
    expect(hall.value).toBe("");
    expect(submit()).toBeDisabled();
  });

  it("原因没写:不发请求,框下出 reason_required;写了才发,殿、文明、原因一起", async () => {
    (usersApi.migrateCivilization as jest.Mock).mockResolvedValue({ data: { ...judge, tenant: { id: 2, code: "EU_MINOS" } } });
    dialog();
    await waitFor(() => expect(usersApi.migrateOpenWork).toHaveBeenCalled());
    fireEvent.click(cell("EUROPEAN"));
    fireEvent.change(screen.getByLabelText(/users\.migrate_civ\.hall$/), { target: { value: "EU_MINOS" } });
    fireEvent.click(submit());
    expect(await screen.findByText("users.migrate_civ.reason_required")).toBeInTheDocument();
    expect(usersApi.migrateCivilization).not.toHaveBeenCalled();
    expect(document.activeElement?.id).toBe("migrate-civ-reason");

    fireEvent.change(screen.getByLabelText(/users\.migrate_civ\.reason/), { target: { value: "调往欧洲" } });
    expect(screen.queryByText("users.migrate_civ.reason_required")).not.toBeInTheDocument();
    fireEvent.click(submit());
    await waitFor(() =>
      expect(usersApi.migrateCivilization).toHaveBeenCalledWith(7, { civilization: "EUROPEAN", tenant: "EU_MINOS", reason: "调往欧洲" }, undefined)
    );
    await waitFor(() => expect(showToast).toHaveBeenCalledWith("users.migrate_civ.done(cuijue,tenant.civilizations.EUROPEAN,米诺斯之庭)", "info"));
  });

  it("文明管理员没有殿可选,完成用 done_no_hall", async () => {
    (usersApi.migrateCivilization as jest.Mock).mockResolvedValue({ data: {} });
    dialog({ ...judge, role: "ADMIN", tenant: null, civilization: "CHINESE" } as never);
    await waitFor(() => expect(usersApi.migrateOpenWork).toHaveBeenCalled());
    expect(screen.queryByLabelText(/users\.migrate_civ\.hall$/)).not.toBeInTheDocument();
    expect(cell("CHINESE")).toBeDisabled();
    fireEvent.click(cell("GREEK"));
    fireEvent.change(screen.getByLabelText(/users\.migrate_civ\.reason/), { target: { value: "r" } });
    fireEvent.click(submit());
    await waitFor(() => expect(usersApi.migrateCivilization).toHaveBeenCalledWith(7, { civilization: "GREEK", reason: "r" }, undefined));
    await waitFor(() => expect(showToast).toHaveBeenCalledWith("users.migrate_civ.done_no_hall(cuijue,tenant.civilizations.GREEK)", "info"));
  });

  it("跨文明的保存错误:整句 errors.cross_civilization,不是通用失败", async () => {
    (usersApi.migrateCivilization as jest.Mock).mockRejectedValue({
      response: { status: 400, data: { code: "invalid", errors: [{ field: "organization", code: "cross_civilization", detail: "x" }] } },
    });
    dialog();
    await waitFor(() => expect(usersApi.migrateOpenWork).toHaveBeenCalled());
    fireEvent.click(cell("EUROPEAN"));
    fireEvent.change(screen.getByLabelText(/users\.migrate_civ\.hall$/), { target: { value: "EU_MINOS" } });
    fireEvent.change(screen.getByLabelText(/users\.migrate_civ\.reason/), { target: { value: "r" } });
    fireEvent.click(submit());
    await waitFor(() => expect(showToast).toHaveBeenCalledWith("errors.cross_civilization", "error"));
    expect(showToast).not.toHaveBeenCalledWith("users.update_error", "error");
  });
});

describe("拒绝态", () => {
  it("只列件数不为 0 的项,各带「去看 ›」;文明格降色、主按钮不可点;清空后换回表单", async () => {
    (usersApi.migrateOpenWork as jest.Mock).mockResolvedValueOnce({ data: { claimed: 3, approvals: 1, dispatch: 0, cross: 1, kinds: {} } });
    dialog();
    expect(await screen.findByText("users.migrate_civ.blocked_title")).toBeInTheDocument();
    expect(screen.getByTestId("migrate-civ-blocked-claimed")).toHaveTextContent("users.migrate_civ.blocked.claimed(3)");
    expect(screen.getByTestId("migrate-civ-blocked-approvals")).toBeInTheDocument();
    expect(screen.getByTestId("migrate-civ-blocked-cross")).toBeInTheDocument();
    expect(screen.queryByTestId("migrate-civ-blocked-dispatch")).not.toBeInTheDocument();
    expect(within(screen.getByTestId("migrate-civ-blocked-claimed")).getByRole("link")).toHaveAttribute("href", "/judgment");
    expect(cell("EUROPEAN")).toBeDisabled();
    expect(screen.queryByLabelText(/users\.migrate_civ\.reason/)).not.toBeInTheDocument();
    expect(submit()).toBeDisabled();

    // Back from 「去看 ›」 (a new tab): the window regains focus, the list is asked again, and it is empty now.
    act(() => focusManager.setFocused(false));
    act(() => focusManager.setFocused(true));
    await waitFor(() => expect(screen.queryByText("users.migrate_civ.blocked_title")).not.toBeInTheDocument());
    expect(screen.getByLabelText(/users\.migrate_civ\.reason/)).toBeInTheDocument();
    expect(cell("EUROPEAN")).not.toBeDisabled();
  });
});

describe("入口", () => {
  const row = (over: Record<string, unknown>) => ({ id: 0, username: "", email: "x@example.com", role: "JUDGE", tenant: null, is_active: true, ...over });
  function menuLabels(name: string) {
    const tr = screen.getByText(name).closest("tr") as HTMLElement;
    fireEvent.click(within(tr).getByRole("button", { name: /^users\.row_menu/ }));
    const labels = screen.queryAllByRole("menuitem").map((i) => i.textContent);
    fireEvent.click(within(tr).getByRole("button", { name: /^users\.row_menu/ }));
    return labels;
  }
  beforeEach(() => {
    (usersApi.list as jest.Mock).mockResolvedValue({
      data: { count: 3, next: null, previous: null, results: [
        row({ id: 2, username: "cuijue" }), row({ id: 3, username: "soulx", role: "SOUL" }), row({ id: 1, username: "sys", role: "SYSTEM_ADMIN" }),
      ] },
    });
  });

  it("SYSTEM_ADMIN 在官员行上有「迁移文明」,灵魂与 SYSTEM_ADMIN 的行没有", async () => {
    mockTenant.user = { id: 1, username: "sys", role: "SYSTEM_ADMIN", tenant: null, permissions: ["user.manage"] };
    renderWithProviders(<UsersPage />, { i18n: false });
    await screen.findByText("cuijue");
    expect(menuLabels("cuijue")).toContain("users.migrate_civ.menu");
    expect(menuLabels("soulx")).not.toContain("users.migrate_civ.menu");
    expect(menuLabels("sys")).not.toContain("users.migrate_civ.menu");
  });

  it("文明管理员(无殿 ADMIN)没有这一项", async () => {
    mockTenant.user = { id: 9, username: "yama", role: "ADMIN", tenant: null, permissions: ["user.manage"] };
    renderWithProviders(<UsersPage />, { i18n: false });
    await screen.findByText("cuijue");
    expect(menuLabels("cuijue")).not.toContain("users.migrate_civ.menu");
  });
});
