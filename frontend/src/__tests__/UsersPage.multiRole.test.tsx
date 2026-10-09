/**
 * app/users/page.tsx — one officer, several roles (2026-10-09), and the batch
 * activate / deactivate that had a backend and no client.
 *
 * Pinned:
 * - each row shows the primary role and every additional role as its own chip; the
 *   additional ones are marked (`data-extra-role`) and a row without any has none;
 *   a custom role is labelled by the role table's display_name;
 * - 「设置角色」 opens a dialog with the primary role and a checkbox list of the OTHER
 *   roles — never ADMIN, never SOUL, never the primary itself — pre-ticked from the
 *   user, and saves `{role, extra_roles}` through `usersApi.assignRoles`;
 * - an ADMIN primary disables the additional list and saves `extra_roles: []`
 *   (the server refuses ADMIN combined with anything);
 * - ticking rows raises the batch bar; 启用所选 / 停用所选 send exactly the ticked ids
 *   and the selection empties on success; a filter change empties it too;
 * - ABSENCE: without `user.manage` there is no checkbox column, no 设置角色 button and
 *   no bar — the page offers a non-admin nothing to click.
 */
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import UsersPage from "@/app/users/page";
import { usersApi, permApi } from "@soulledger/core/api";

jest.mock("@soulledger/core/api", () => ({
  usersApi: {
    list: jest.fn(),
    delete: jest.fn(),
    activate: jest.fn(),
    deactivate: jest.fn(),
    assignRoles: jest.fn(),
    batchActivate: jest.fn(),
    batchDeactivate: jest.fn(),
  },
  permApi: { roles: { list: jest.fn() } },
  PAGE_SIZE: 20,
}));

const mockToast = jest.fn();
jest.mock("@/src/components/ui/Toast", () => ({
  showToast: (...args: unknown[]) => mockToast(...args),
}));

jest.mock("@/src/contexts/I18nContext", () => ({
  useI18n: () => ({
    t: (key: string, params?: Record<string, string>) => (params ? `${key}:${Object.values(params).join(",")}` : key),
    locale: "zh-Hans",
    hydrated: true,
  }),
}));

let mockUser: Record<string, unknown> = { id: 1, username: "yama", role: "ADMIN", tenant: null, permissions: ["user.manage"] };
jest.mock("@/src/contexts/TenantContext", () => ({ useTenant: () => ({ user: mockUser }) }));
jest.mock("next/navigation", () => ({
  useRouter: () => ({ replace: jest.fn() }),
  useSearchParams: () => new URLSearchParams(),
}));
jest.mock("@/src/components/layout/MenuGloss", () => ({ MenuGloss: () => null }));

const mockUsers = usersApi.list as jest.Mock;
const mockRoles = permApi.roles.list as jest.Mock;
const mockAssign = usersApi.assignRoles as jest.Mock;
const mockBatchActivate = usersApi.batchActivate as jest.Mock;
const mockBatchDeactivate = usersApi.batchDeactivate as jest.Mock;

const role = (over: Record<string, unknown>) => ({
  id: 0,
  name: "",
  display_name: "",
  description: "",
  scope: "GLOBAL",
  organization: null,
  organization_name: null,
  user_count: 1,
  is_builtin: true,
  version: 1,
  ...over,
});
const user = (over: Record<string, unknown>) => ({
  id: 0,
  username: "",
  email: "x@example.com",
  role: "VIEWER",
  extra_roles: [],
  tenant: null,
  is_active: true,
  ...over,
});

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <UsersPage />
    </QueryClientProvider>
  );
}
const rowOf = (username: string) => {
  const tr = screen.getByText(username).closest("tr");
  if (!tr) throw new Error(`no row for ${username}`);
  return tr as HTMLElement;
};

beforeEach(() => {
  jest.clearAllMocks();
  mockUser = { id: 1, username: "yama", role: "ADMIN", tenant: null, permissions: ["user.manage"] };
  mockRoles.mockResolvedValue({
    data: [
      role({ id: 1, name: "ADMIN" }),
      role({ id: 2, name: "JUDGE" }),
      role({ id: 3, name: "VIEWER" }),
      role({ id: 4, name: "SOUL" }),
      role({ id: 5, name: "CLERK", display_name: "书记", is_builtin: false }),
    ],
  });
  mockUsers.mockResolvedValue({
    data: {
      count: 3,
      next: null,
      previous: null,
      results: [
        user({ id: 1, username: "yama", role: "ADMIN" }),
        user({ id: 2, username: "multi1", role: "VIEWER", extra_roles: ["JUDGE", "CLERK"] }),
        user({ id: 3, username: "single1", role: "VIEWER" }),
      ],
    },
  });
  mockAssign.mockResolvedValue({ data: user({ id: 2 }) });
  mockBatchActivate.mockResolvedValue({ data: { updated: 2 } });
  mockBatchDeactivate.mockResolvedValue({ data: { updated: 2 } });
});

describe("role chips", () => {
  it("shows the primary role and each additional role as its own chip, and marks the additional ones", async () => {
    const { container } = renderPage();
    await screen.findByText("multi1");
    const row = rowOf("multi1");
    const extras = row.querySelectorAll("[data-extra-role]");
    expect([...extras].map((e) => e.getAttribute("data-extra-role"))).toEqual(["JUDGE", "CLERK"]);
    // A custom role reads as the role table's display name, a built-in through the bundles.
    expect(within(row).getByText("书记")).toBeInTheDocument();
    expect(row.querySelector('[data-enum-state="known"][title="VIEWER"]')).not.toBeNull();
    expect(row.querySelector('[data-enum-state="known"][title="JUDGE"]')).not.toBeNull();
    expect(container.querySelectorAll('[data-enum-state="unrecognized"]')).toHaveLength(0);
  });

  it("a user without additional roles has no additional chip", async () => {
    renderPage();
    await screen.findByText("single1");
    expect(rowOf("single1").querySelectorAll("[data-extra-role]")).toHaveLength(0);
  });
});

describe("the roles dialog", () => {
  const openFor = async (username: string) => {
    renderPage();
    await screen.findByText(username);
    fireEvent.click(within(rowOf(username)).getByRole("button", { name: "users.edit_roles" }));
    return await screen.findByRole("dialog");
  };

  it("offers every other role except ADMIN and SOUL, pre-ticks the user's, and saves role + extra_roles", async () => {
    const dialog = await openFor("multi1");
    await within(dialog).findByRole("checkbox", { name: "书记" });
    const names = within(dialog).getAllByRole("checkbox").map((c) => c.closest("label")?.textContent);
    // ADMIN (never additional), SOUL (not a post) and the primary VIEWER itself are absent.
    expect(names).toEqual(["users.roles.JUDGE", "书记"]);
    expect(within(dialog).getByRole("checkbox", { name: "users.roles.JUDGE" })).toBeChecked();
    expect(within(dialog).getByRole("checkbox", { name: "书记" })).toBeChecked();

    fireEvent.click(within(dialog).getByRole("checkbox", { name: "users.roles.JUDGE" })); // untick one
    fireEvent.click(within(dialog).getByRole("button", { name: "common.save" }));

    await waitFor(() => expect(mockAssign).toHaveBeenCalledTimes(1));
    expect(mockAssign).toHaveBeenCalledWith("2", { role: "VIEWER", extra_roles: ["CLERK"] });
    await waitFor(() => expect(mockToast).toHaveBeenCalledWith("users.roles_dialog.saved", "success"));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  });

  it("changing the primary role removes it from the additional list it was in", async () => {
    const dialog = await openFor("multi1");
    await within(dialog).findByRole("checkbox", { name: "书记" });
    fireEvent.change(within(dialog).getByLabelText("users.roles_dialog.primary"), { target: { value: "JUDGE" } });
    // JUDGE is now the primary: its box is gone, VIEWER's has appeared (unticked).
    expect(within(dialog).queryByRole("checkbox", { name: "users.roles.JUDGE" })).toBeNull();
    expect(within(dialog).getByRole("checkbox", { name: "users.roles.VIEWER" })).not.toBeChecked();
    fireEvent.click(within(dialog).getByRole("button", { name: "common.save" }));
    await waitFor(() => expect(mockAssign).toHaveBeenCalled());
    expect(mockAssign).toHaveBeenCalledWith("2", { role: "JUDGE", extra_roles: ["CLERK"] });
  });

  it("an ADMIN primary disables the additional list and saves an empty one", async () => {
    const dialog = await openFor("yama");
    await within(dialog).findByText("users.roles_dialog.admin_locked");
    for (const box of within(dialog).getAllByRole("checkbox")) expect(box).toBeDisabled();
    fireEvent.click(within(dialog).getByRole("button", { name: "common.save" }));
    await waitFor(() => expect(mockAssign).toHaveBeenCalled());
    expect(mockAssign).toHaveBeenCalledWith("1", { role: "ADMIN", extra_roles: [] });
  });

  it("a refused save says so and keeps the dialog open", async () => {
    mockAssign.mockRejectedValue(new Error("403"));
    const dialog = await openFor("single1");
    await within(dialog).findByRole("checkbox", { name: "书记" });
    fireEvent.click(within(dialog).getByRole("checkbox", { name: "书记" }));
    fireEvent.click(within(dialog).getByRole("button", { name: "common.save" }));
    await waitFor(() => expect(mockToast).toHaveBeenCalledWith("users.roles_dialog.error", "error"));
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });
});

describe("batch activate / deactivate", () => {
  const tick = async () => {
    renderPage();
    await screen.findByText("multi1");
    fireEvent.click(screen.getByLabelText("users.batch.select_row:multi1"));
    fireEvent.click(screen.getByLabelText("users.batch.select_row:single1"));
  };

  it("raises a bar that counts the ticked rows, and 启用所选 sends exactly those ids", async () => {
    await tick();
    const bar = screen.getByRole("region", { name: "users.batch.region" });
    expect(within(bar).getByText("users.batch.selected:2")).toBeInTheDocument();
    fireEvent.click(within(bar).getByRole("button", { name: "users.batch.activate" }));
    await waitFor(() => expect(mockBatchActivate).toHaveBeenCalledWith(["2", "3"]));
    expect(mockBatchDeactivate).not.toHaveBeenCalled();
    await waitFor(() => expect(mockToast).toHaveBeenCalledWith("users.batch.done:2", "success"));
    // Selection empties on success: the bar is gone.
    await waitFor(() => expect(screen.queryByRole("region", { name: "users.batch.region" })).toBeNull());
  });

  it("停用所选 goes to the deactivate endpoint", async () => {
    await tick();
    fireEvent.click(screen.getByRole("button", { name: "users.batch.deactivate" }));
    await waitFor(() => expect(mockBatchDeactivate).toHaveBeenCalledWith(["2", "3"]));
    expect(mockBatchActivate).not.toHaveBeenCalled();
  });

  it("a failed batch toasts, and keeps the selection", async () => {
    mockBatchDeactivate.mockRejectedValue(new Error("500"));
    await tick();
    fireEvent.click(screen.getByRole("button", { name: "users.batch.deactivate" }));
    await waitFor(() => expect(mockToast).toHaveBeenCalledWith("users.batch.failed", "error"));
    expect(screen.getByRole("region", { name: "users.batch.region" })).toBeInTheDocument();
  });

  it("changing the filter empties the selection", async () => {
    await tick();
    expect(screen.getByRole("region", { name: "users.batch.region" })).toBeInTheDocument();
    fireEvent.change(screen.getByPlaceholderText("users.search_placeholder"), { target: { value: "multi" } });
    await waitFor(() => expect(screen.queryByRole("region", { name: "users.batch.region" })).toBeNull());
  });
});

describe("a user without user.manage", () => {
  it("sees the list and nothing to click: no checkboxes, no 设置角色, no bar", async () => {
    mockUser = { id: 9, username: "judge9", role: "JUDGE", tenant: null, permissions: ["soul.read"] };
    renderPage();
    await screen.findByText("multi1");
    expect(screen.queryAllByRole("checkbox")).toHaveLength(0);
    expect(screen.queryByRole("button", { name: "users.edit_roles" })).toBeNull();
    expect(screen.queryByRole("region", { name: "users.batch.region" })).toBeNull();
    // The chips are read-only information and stay.
    expect(rowOf("multi1").querySelectorAll("[data-extra-role]")).toHaveLength(2);
  });
});
