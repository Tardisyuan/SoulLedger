/**
 * /permissions (E-11a / 11b) on the per-cell endpoints:
 * POST /perm/role-permissions/changes/ and /impact/, DELETE /perm/roles/{id}/.
 *
 * The real page with a real QueryClient; only `permApi` is stubbed. Pinned:
 *
 * - PermCell states — granted, not, unsaved ＋ / −, failed !, conflict ◇ — each
 *   carried by a glyph and an accessible description, not colour alone;
 * - the save sends exactly the pending cells, with the versions it loaded;
 * - a partial save keeps ONLY the refused cells pending, says 「已存 N 项，失败 M
 *   项」, names the reason (admin_only_permission), and 定位 focuses the cell;
 * - the impact check's conflict names the workflow step that would lose its
 *   last approver and marks the causing cell ◇;
 * - 只看差异, 放弃, ⌘S, and the 393 px role-first flow;
 * - the roles table opens a drawer with the code read-only; a refused delete
 *   lists the referencing workflows.
 */
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import PermissionsPage from "@/app/permissions/page";
import { permApi, type Permission, type Role } from "@soulledger/core/api";

jest.mock("@soulledger/core/api", () => ({
  permApi: {
    list: jest.fn(),
    roles: { list: jest.fn(), update: jest.fn(), delete: jest.fn(), copy: jest.fn() },
    rolePermissions: jest.fn(),
    applyChanges: jest.fn(),
    impact: jest.fn(),
  },
}));

jest.mock("@/src/contexts/I18nContext", () => ({
  useI18n: () => ({
    t: (key: string, params?: Record<string, string>) =>
      params ? `${key}:${Object.values(params).join(",")}` : key,
    locale: "en",
    hydrated: true,
  }),
}));

const mockShowToast = jest.fn();
jest.mock("@/src/contexts/ToastContext", () => ({ useToast: () => ({ showToast: mockShowToast }) }));
jest.mock("@/src/contexts/TenantContext", () => ({
  useTenant: () => ({ user: { id: 1, username: "admin", role: "ADMIN", tenant: null, permissions: [] } }),
}));
jest.mock("@/src/components/layout/MenuGloss", () => ({ MenuGloss: () => null }));

const api = permApi as unknown as {
  list: jest.Mock;
  roles: { list: jest.Mock; update: jest.Mock; delete: jest.Mock; copy: jest.Mock };
  rolePermissions: jest.Mock;
  applyChanges: jest.Mock;
  impact: jest.Mock;
};

const PERMS: Permission[] = [
  { id: 1, codename: "soul.read", name: "读灵魂", category: "soul" } as Permission,
  { id: 2, codename: "soul.update", name: "改灵魂", category: "soul" } as Permission,
  { id: 3, codename: "recycle_bin.hard_delete", name: "彻底删除", category: "system" } as Permission,
];
const role = (over: Partial<Role>) =>
  ({ id: 0, name: "", display_name: "", scope: "GLOBAL", organization: null, organization_name: null, user_count: 0, member_count: 0,
     permission_count: 0, workflow_template_count: 0, is_builtin: false, version: 1, update_time: "2026-09-01T00:00:00Z", ...over }) as Role;
const ADMIN = role({ id: 1, name: "ADMIN", display_name: "管理员", is_builtin: true, version: 4 });
const JUDGE = role({ id: 2, name: "JUDGE", display_name: "判官", is_builtin: true, version: 7, member_count: 14, permission_count: 2 });
const CLERK = role({ id: 3, name: "YIN_CLERK", display_name: "殿司", version: 2, member_count: 9, permission_count: 1, workflow_template_count: 2 });
let GRANTS: Record<string, number[]>;

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <PermissionsPage />
    </QueryClientProvider>
  );
}

const cell = (roleName: string, codename: string) => screen.getByRole("checkbox", { name: `${roleName} — ${codename}` });
const stateOf = (el: HTMLElement) => el.querySelector("[data-cell-state]")?.getAttribute("data-cell-state");
/** What is drawn in the square — the state is never colour alone. */
const glyphOf = (el: HTMLElement) => el.querySelector("[data-cell-state]")?.textContent;
const unsavedBar = () => screen.queryByRole("region", { name: "permissions.matrix.unsaved_region" });
async function ready() {
  await screen.findByText(/^permissions\.matrix\.showing/);
  await waitFor(() => expect(cell("JUDGE", "soul.read")).toHaveAttribute("aria-checked", "true"));
}
async function flushImpact() {
  await act(async () => {
    await new Promise((r) => setTimeout(r, 350));
  });
}
/** Save; a removal is tier 2, so the confirm dialog comes first. */
function save() {
  fireEvent.click(within(unsavedBar() as HTMLElement).getByRole("button", { name: "permissions.matrix.save_button" }));
  const dialog = screen.queryByRole("dialog");
  if (dialog) fireEvent.click(within(dialog).getByRole("button", { name: "permissions.matrix.confirm_submit" }));
}

beforeEach(() => {
  jest.clearAllMocks();
  GRANTS = { ADMIN: [1, 2, 3], JUDGE: [1, 2], YIN_CLERK: [1] };
  api.list.mockResolvedValue({ data: PERMS });
  api.roles.list.mockResolvedValue({ data: [ADMIN, JUDGE, CLERK] });
  api.rolePermissions.mockImplementation(async (name: string) => ({
    data: { role: name, permissions: [], details: (GRANTS[name] ?? []).map((id) => PERMS[id - 1]) },
  }));
  api.impact.mockResolvedValue({ data: { required_codenames: [], conflicts: [] } });
});

describe("PermCell states", () => {
  it("granted is a filled block, not is an empty box; toggles become ＋ / − with a description", async () => {
    renderPage();
    await ready();
    expect(stateOf(cell("JUDGE", "soul.read"))).toBe("on");
    expect(stateOf(cell("YIN_CLERK", "soul.update"))).toBe("off");
    expect(unsavedBar()).toBeNull();

    fireEvent.click(cell("YIN_CLERK", "soul.update"));
    fireEvent.click(cell("JUDGE", "soul.read"));
    expect(stateOf(cell("YIN_CLERK", "soul.update"))).toBe("grant");
    expect(stateOf(cell("JUDGE", "soul.read"))).toBe("revoke");
    expect(glyphOf(cell("YIN_CLERK", "soul.update"))).toBe("＋");
    expect(glyphOf(cell("JUDGE", "soul.read"))).toBe("−");
    expect(glyphOf(cell("YIN_CLERK", "soul.read"))).toBe("");
    expect(cell("YIN_CLERK", "soul.update")).toHaveAccessibleDescription("permissions.matrix.state.grant");
    expect(cell("JUDGE", "soul.read")).toHaveAccessibleDescription("permissions.matrix.state.revoke");
    // A plain cell carries no description.
    expect(cell("YIN_CLERK", "soul.read")).not.toHaveAccessibleDescription();

    const bar = unsavedBar() as HTMLElement;
    expect(within(bar).getByText("permissions.matrix.pending_cells:2")).toBeInTheDocument();
    expect(within(bar).getByText("＋1 · −1")).toBeInTheDocument();
  });

  it("放弃 puts every cell back", async () => {
    renderPage();
    await ready();
    fireEvent.click(cell("YIN_CLERK", "soul.update"));
    fireEvent.click(within(unsavedBar() as HTMLElement).getByRole("button", { name: "permissions.matrix.discard" }));
    expect(stateOf(cell("YIN_CLERK", "soul.update"))).toBe("off");
    expect(unsavedBar()).toBeNull();
  });
});

describe("saving", () => {
  it("sends exactly the pending cells with the versions it loaded (⌘S works too)", async () => {
    api.applyChanges.mockResolvedValue({
      data: { saved: 1, unchanged: 0, refused: 0, failed: 0, versions: { YIN_CLERK: 3 },
        results: [{ index: 0, role: "YIN_CLERK", permission_id: 2, codename: "soul.update", action: "grant", status: "saved", code: null, detail: null }] },
    });
    renderPage();
    await ready();
    fireEvent.click(cell("YIN_CLERK", "soul.update"));
    fireEvent.keyDown(document, { key: "s", metaKey: true });
    await waitFor(() =>
      expect(api.applyChanges).toHaveBeenCalledWith([{ role: "YIN_CLERK", permission_id: 2, action: "grant" }], { YIN_CLERK: 2 })
    );
    await waitFor(() => expect(unsavedBar()).toBeNull());
    expect(stateOf(cell("YIN_CLERK", "soul.update"))).toBe("on");
  });

  it("a partial save keeps only the refused cell pending, names why, and 定位 focuses it", async () => {
    api.applyChanges.mockResolvedValue({
      data: { saved: 1, unchanged: 0, refused: 1, failed: 0, versions: { JUDGE: 8, YIN_CLERK: 3 },
        results: [
          { index: 0, role: "JUDGE", permission_id: 3, codename: "recycle_bin.hard_delete", action: "grant", status: "refused", code: "admin_only_permission", detail: "x" },
          { index: 1, role: "YIN_CLERK", permission_id: 2, codename: "soul.update", action: "grant", status: "saved", code: null, detail: null },
        ] },
    });
    renderPage();
    await ready();
    fireEvent.click(cell("JUDGE", "recycle_bin.hard_delete"));
    fireEvent.click(cell("YIN_CLERK", "soul.update"));
    save();

    const banner = await screen.findByRole("alert");
    expect(within(banner).getByText(/permissions\.matrix\.partial_title:1,1/)).toBeInTheDocument();
    expect(within(banner).getByText("permissions.matrix.refused.admin_only_permission")).toBeInTheDocument();
    // The refused cell: still pending, marked !, reason in its description.
    const refused = cell("JUDGE", "recycle_bin.hard_delete");
    expect(stateOf(refused)).toBe("failed");
    expect(glyphOf(refused)).toBe("!");
    expect(refused).toHaveAccessibleDescription(/permissions\.matrix\.refused\.admin_only_permission/);
    // The saved one is simply granted now — no mark, not pending.
    expect(stateOf(cell("YIN_CLERK", "soul.update"))).toBe("on");
    expect(within(unsavedBar() as HTMLElement).getByText("permissions.matrix.pending_cells:1")).toBeInTheDocument();

    const raf = jest.spyOn(window, "requestAnimationFrame").mockImplementation((cb) => {
      cb(0);
      return 0;
    });
    // jsdom has no layout: every element's offsetParent is null. Give the grid cell one.
    Object.defineProperty(refused, "offsetParent", { configurable: true, get: () => document.body });
    refused.scrollIntoView = jest.fn();
    fireEvent.click(within(banner).getByRole("button", { name: "permissions.matrix.locate" }));
    expect(refused).toHaveFocus();
    raf.mockRestore();
  });

  it("the ADMIN column is locked: 始终 in every cell, ticked, never toggled, the reason on hover and focus", async () => {
    GRANTS = { ADMIN: [1], JUDGE: [1, 2], YIN_CLERK: [1] }; // a missing row changes nothing: ADMIN holds it anyway
    renderPage();
    await ready();
    for (const codename of ["soul.read", "soul.update", "recycle_bin.hard_delete"]) {
      const locked = cell("ADMIN", codename);
      expect(stateOf(locked)).toBe("lock");
      expect(glyphOf(locked)).toBe("permissions.matrix.lock_word");
      expect(locked).toHaveAttribute("aria-checked", "true");
      expect(locked).toHaveAttribute("aria-disabled", "true");
      // Focusable (not `disabled`), so the explanation is reachable from the keyboard too.
      expect(locked).not.toBeDisabled();
      expect(locked).toHaveAccessibleDescription(/permissions\.matrix\.lock_word · ADMIN.*permissions\.matrix\.lock_hint/);
      expect(locked.getAttribute("title")).toMatch(/permissions\.matrix\.lock_hint/);
      fireEvent.click(locked);
    }
    expect(unsavedBar()).toBeNull();
    expect(api.impact).not.toHaveBeenCalled();
    // The legend names it with the same word.
    expect(screen.getByText("permissions.matrix.legend.lock")).toBeInTheDocument();
  });

  it("a grant the server forbids is 「! 禁授」 from the start, untickable, distinct from a refused 「!」", async () => {
    const MOD = role({ id: 4, name: "MODERATOR", display_name: "殿主", is_builtin: true, version: 3 });
    const USER_MANAGE = { id: 4, codename: "user.manage", name: "用户管理", category: "system" } as Permission;
    api.list.mockResolvedValue({ data: [...PERMS, USER_MANAGE] });
    api.roles.list.mockResolvedValue({ data: [ADMIN, JUDGE, CLERK, MOD] });
    GRANTS = { ADMIN: [1, 2, 3, 4], JUDGE: [1, 2], YIN_CLERK: [1], MODERATOR: [1] };
    const all = [...PERMS, USER_MANAGE];
    api.rolePermissions.mockImplementation(async (name: string) => ({
      data: { role: name, permissions: [], details: (GRANTS[name] ?? []).map((id) => all[id - 1]) },
    }));
    renderPage();
    await ready();
    const denied = cell("MODERATOR", "user.manage");
    expect(stateOf(denied)).toBe("deny");
    expect(glyphOf(denied)).toBe("! permissions.matrix.deny_word");
    expect(denied).toHaveAttribute("aria-checked", "false");
    expect(denied).toHaveAccessibleDescription(/permissions\.matrix\.deny_hint:用户管理 role_forbidden_permission/);
    fireEvent.click(denied);
    expect(unsavedBar()).toBeNull();
    // Absence: the same codename is an ordinary cell for another role, and MODERATOR's other rows are ordinary too.
    expect(stateOf(cell("JUDGE", "user.manage"))).toBe("off");
    expect(stateOf(cell("MODERATOR", "soul.read"))).toBe("on");
    expect(screen.getByText("permissions.matrix.legend.deny")).toBeInTheDocument();
  });
});

describe("impact", () => {
  it("names the workflow step that would lose its last approver and marks the causing cell ◇", async () => {
    api.impact.mockResolvedValue({
      data: {
        required_codenames: ["soul.update"],
        conflicts: [{ template_id: "t1", template_name: "跨文明移交 · 两级", tenant_id: 1, civilization: "CHINESE", is_active: true,
          step_order: 2, step_name: "判官复核", approver_roles: ["JUDGE"],
          caused_by: [{ index: 0, role: "JUDGE", permission_id: 2, codename: "soul.update" }] }],
      },
    });
    renderPage();
    await ready();
    fireEvent.click(cell("JUDGE", "soul.update"));
    await flushImpact();
    expect(api.impact).toHaveBeenCalledWith([{ role: "JUDGE", permission_id: 2, action: "revoke" }]);
    const banner = await screen.findByRole("status");
    expect(within(banner).getByText(/跨文明移交 · 两级,2,判官复核/)).toBeInTheDocument();
    expect(within(banner).getByText(/判官「改灵魂」/)).toBeInTheDocument();
    expect(stateOf(cell("JUDGE", "soul.update"))).toBe("conflict");
    expect(glyphOf(cell("JUDGE", "soul.update"))).toBe("◇");
    // Toggled back: nothing pending, no stale conflict drawn.
    fireEvent.click(cell("JUDGE", "soul.update"));
    expect(screen.queryByRole("status")).toBeNull();
    expect(stateOf(cell("JUDGE", "soul.update"))).toBe("on");
  });

  it("counts in-flight workflows, and 保存 stays disabled until the acknowledgement is ticked", async () => {
    const cause = { index: 0, role: "JUDGE", permission_id: 2, codename: "soul.update" };
    api.impact.mockResolvedValue({
      data: {
        required_codenames: ["soul.update"],
        conflicts: [{ template_id: "t1", template_name: "跨文明移交 · 两级", tenant_id: 1, civilization: "CHINESE", is_active: true,
          step_order: 2, step_name: "判官复核", approver_roles: ["JUDGE"], caused_by: [cause] }],
        workflow_conflicts: [
          { workflow_id: "w1", workflow_name: "在途甲", tenant_id: 1, status: "IN_PROGRESS", node_order: 2,
            node_name: "判官复核", approver_roles: ["JUDGE"], caused_by: [cause] },
          { workflow_id: "w1", workflow_name: "在途甲", tenant_id: 1, status: "IN_PROGRESS", node_order: 3,
            node_name: "终审", approver_roles: ["JUDGE"], caused_by: [cause] },
        ],
      },
    });
    api.applyChanges.mockResolvedValue({
      data: { saved: 1, unchanged: 0, refused: 0, failed: 0, versions: { JUDGE: 8 },
        results: [{ index: 0, role: "JUDGE", permission_id: 2, codename: "soul.update", action: "revoke", status: "saved", code: null, detail: null }] },
    });
    renderPage();
    await ready();
    fireEvent.click(cell("JUDGE", "soul.update"));
    await flushImpact();
    const banner = await screen.findByRole("status");
    expect(within(banner).getByText(/conflict_workflow_line:.*在途甲,3,终审/)).toBeInTheDocument();
    // Two distinct flows: one template + one live workflow (two nodes of it).
    // The tick sits in the unsaved bar, not in the banner (第三类 F 组), with 「查看」 pointing back up.
    expect(within(banner).queryByRole("checkbox")).toBeNull();
    const bar = unsavedBar() as HTMLElement;
    const ack = within(bar).getByRole("checkbox", { name: "permissions.matrix.conflict_acknowledge:2,1" });
    expect(within(bar).getByRole("link", { name: "permissions.matrix.conflict_view" })).toHaveAttribute("href", `#${banner.id}`);
    const saveButton = within(unsavedBar() as HTMLElement).getByRole("button", { name: "permissions.matrix.save_button" });
    expect(saveButton).toBeDisabled();
    fireEvent.keyDown(document, { key: "s", metaKey: true });
    expect(api.applyChanges).not.toHaveBeenCalled();

    fireEvent.click(ack);
    expect(saveButton).toBeEnabled();
    save();
    await waitFor(() =>
      expect(api.applyChanges).toHaveBeenCalledWith([{ role: "JUDGE", permission_id: 2, action: "revoke" }], { JUDGE: 7 }, true)
    );
  });

  it("a changed edit asks again: the tick belongs to the edits it was given for", async () => {
    api.impact.mockResolvedValue({
      data: { required_codenames: ["soul.update"], conflicts: [], workflow_conflicts: [
        { workflow_id: "w1", workflow_name: "在途甲", tenant_id: 1, status: "PENDING", node_order: 1, node_name: "受理",
          approver_roles: ["JUDGE"], caused_by: [{ index: 0, role: "JUDGE", permission_id: 2, codename: "soul.update" }] },
      ] },
    });
    renderPage();
    await ready();
    fireEvent.click(cell("JUDGE", "soul.update"));
    await flushImpact();
    await screen.findByRole("status");
    fireEvent.click(within(unsavedBar() as HTMLElement).getByRole("checkbox"));
    fireEvent.click(cell("YIN_CLERK", "soul.update"));
    await flushImpact();
    await screen.findByRole("status");
    expect(within(unsavedBar() as HTMLElement).getByRole("checkbox")).not.toBeChecked();
    expect(within(unsavedBar() as HTMLElement).getByRole("button", { name: "permissions.matrix.save_button" })).toBeDisabled();
  });
});

describe("filters and 393 px", () => {
  it("只看差异 keeps only rows where the roles disagree", async () => {
    GRANTS = { ADMIN: [1, 2], JUDGE: [1, 2], YIN_CLERK: [1] };
    renderPage();
    await ready();
    fireEvent.click(screen.getByRole("button", { name: "permissions.matrix.only_differences" }));
    // soul.read: all three hold it → hidden. soul.update: CLERK does not → shown.
    expect(screen.queryByRole("checkbox", { name: "JUDGE — soul.read" })).toBeNull();
    expect(cell("JUDGE", "soul.update")).toBeInTheDocument();
  });

  it("on a phone you pick a role first, then toggle its rows", async () => {
    renderPage();
    await ready();
    const picker = screen.getByRole("combobox", { name: /permissions\.matrix\.role_picker/ });
    fireEvent.change(picker, { target: { value: "YIN_CLERK" } });
    const toggle = screen.getByRole("switch", { name: "改灵魂 soul.update" });
    expect(toggle).toHaveAttribute("aria-checked", "false");
    fireEvent.click(toggle);
    // Same cell as the grid's — one state, two layouts.
    expect(cell("YIN_CLERK", "soul.update")).toHaveAttribute("aria-checked", "true");
    expect(stateOf(cell("YIN_CLERK", "soul.update"))).toBe("grant");
  });
});

describe("roles table (E-11b)", () => {
  it("a row opens the drawer: code read-only, counts, ⋯ holds copy and recycle; a referenced role's delete lists the workflows", async () => {
    api.roles.delete.mockRejectedValue(
      Object.assign(new Error("400"), {
        response: { status: 400, data: { error: "x", code: "role_referenced_by_workflow_templates",
          templates: [{ template_id: "t1", template_name: "跨文明移交 · 两级", tenant_id: 1, civilization: "CHINESE", is_active: true,
            steps: [{ step_order: 2, step_name: "殿司签收" }] }] } },
      })
    );
    renderPage();
    await ready();
    fireEvent.click(screen.getByRole("button", { name: "permissions.segments.roles" }));
    const row = (await screen.findByText("YIN_CLERK")).closest("tr") as HTMLElement;
    // No row-end edit / delete: the row's one control is the opener.
    expect(within(row).getAllByRole("button")).toHaveLength(1);
    fireEvent.click(within(row).getByRole("button", { name: "殿司" }));

    const drawer = await screen.findByRole("dialog");
    // The code is text, never an input.
    expect(within(drawer).getByText("YIN_CLERK")).toBeInTheDocument();
    expect(within(drawer).queryByDisplayValue("YIN_CLERK")).toBeNull();
    expect(within(drawer).getByText("permissions.roles.workflow_count:2")).toBeInTheDocument();
    // Copy and recycle live behind ⋯, not on the surface.
    expect(within(drawer).queryByRole("button", { name: "permissions.roles.copy" })).toBeNull();
    fireEvent.click(within(drawer).getByRole("button", { name: "permissions.roles.more" }));
    expect(within(drawer).getByRole("button", { name: "permissions.roles.copy" })).toBeInTheDocument();
    fireEvent.click(within(drawer).getByRole("button", { name: /permissions\.roles\.recycle$|permissions\.roles\.recycle[^_]/ }));

    const confirm = await screen.findByRole("dialog", { name: /permissions\.roles\.recycle_title/ });
    fireEvent.click(within(confirm).getByRole("button", { name: "permissions.roles.recycle_action" }));
    const alert = await within(confirm).findByRole("alert");
    expect(within(alert).getByText(/permissions\.roles\.refused\.role_referenced_by_workflow_templates/)).toBeInTheDocument();
    expect(within(alert).getByText("跨文明移交 · 两级")).toBeInTheDocument();
    expect(within(alert).getByText("#2 殿司签收")).toBeInTheDocument();
    expect(api.roles.delete).toHaveBeenCalledWith(3);
  });

  it("「说明」is edited in the drawer and saved with the same PUT as the name", async () => {
    api.roles.list.mockResolvedValue({ data: [ADMIN, JUDGE, { ...CLERK, description: "旧说明" }] });
    api.roles.update.mockResolvedValue({ data: {} });
    renderPage();
    await ready();
    fireEvent.click(screen.getByRole("button", { name: "permissions.segments.roles" }));
    const row = (await screen.findByText("YIN_CLERK")).closest("tr") as HTMLElement;
    fireEvent.click(within(row).getByRole("button", { name: "殿司" }));
    const drawer = await screen.findByRole("dialog");
    const field = within(drawer).getByRole("textbox", { name: "permissions.roles.description" });
    expect(field).toHaveValue("旧说明");
    const saveButton = within(drawer).getByRole("button", { name: "common.save" });
    expect(saveButton).toBeDisabled();
    fireEvent.change(field, { target: { value: "  各殿收发灵魂来信。 " } });
    expect(saveButton).not.toBeDisabled();
    fireEvent.click(saveButton);
    await waitFor(() =>
      expect(api.roles.update).toHaveBeenCalledWith(3, { name: "YIN_CLERK", display_name: "殿司", description: "各殿收发灵魂来信。" })
    );
  });
});
