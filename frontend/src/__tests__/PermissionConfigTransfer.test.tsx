/**
 * 权限页的「导出配置 / 导入配置…」(更多 ⋯ 菜单里的两项,一个三步弹层)。
 *
 * 钉住:入口只对 ADMIN 出现;非法文件在客户端就被拦下、不发请求;合法文件点「下一步」先预演
 * (dry_run:true,不失效缓存)、第 2 步显示摘要,确认后才真导入(dry_run:false),第 3 步显示结果、
 * 让三组权限查询失效;有跳过项才出现「下载跳过明细」;「覆盖」在界面上不存在;失败显示后端给的原因。
 */
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { permApi } from "@soulledger/core/api";
import { PermissionConfigTransfer, parsePermissionConfig, MAX_IMPORT_BYTES } from "@/src/components/permissions/PermissionConfigTransfer";
import { saveBlob } from "@/src/lib/saveBlob";

jest.mock("@soulledger/core/api", () => ({
  permApi: { exportConfig: jest.fn(), importConfig: jest.fn() },
}));
jest.mock("@/src/lib/saveBlob", () => ({ saveBlob: jest.fn() }));
jest.mock("@/src/contexts/I18nContext", () => ({
  useI18n: () => ({
    t: (key: string, params?: Record<string, string>) => (params ? `${key}:${Object.values(params).join(",")}` : key),
    locale: "en",
    hydrated: true,
  }),
}));
const showToast = jest.fn();
jest.mock("@/src/contexts/ToastContext", () => ({ useToast: () => ({ showToast }) }));
let mockRole = "ADMIN";
jest.mock("@/src/contexts/TenantContext", () => ({
  useTenant: () => ({ user: { id: 1, role: mockRole, tenant: { code: "CN_DIYU", display_name: "x" } } }),
}));

const exportConfig = permApi.exportConfig as jest.Mock;
const importConfig = permApi.importConfig as jest.Mock;

const DOC = {
  version: "1.0",
  permissions: [{ codename: "a.read", name: "A", category: "a" }],
  roles: [{ name: "R", display_name: "R" }],
  role_permissions: [{ role: "R", permission: "a.read", conditions: {} }],
};

const STATS = {
  permissions: { created: 1, skipped: 2 },
  roles: { created: 0, skipped: 1 },
  role_permissions: { created: 1, skipped: 0 },
  field_permissions: { created: 0, skipped: 0 },
  data_scopes: { created: 0, skipped: 0 },
  skipped_details: [
    { section: "roles", key: "R", reason: "already_exists" },
    { section: "permissions", key: 'a "q".read', reason: "already_exists" },
    { section: "permissions", key: "b.read", reason: "already_exists" },
  ],
};
const NOTHING_SKIPPED = {
  ...STATS,
  permissions: { created: 1, skipped: 0 },
  roles: { created: 0, skipped: 0 },
  skipped_details: [],
};

function setup() {
  const client = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
  const invalidate = jest.spyOn(client, "invalidateQueries");
  render(
    <QueryClientProvider client={client}>
      <PermissionConfigTransfer />
    </QueryClientProvider>,
  );
  return { invalidate };
}

function pick(body: string, size = body.length) {
  const file = Object.assign(new File([body], "p.json", { type: "application/json" }), {
    text: async () => body,
  });
  Object.defineProperty(file, "size", { value: size });
  fireEvent.change(screen.getByLabelText("permissions.config.choose_file"), { target: { files: [file] } });
}

const openMenu = () => fireEvent.click(screen.getByRole("button", { name: "permissions.config.more" }));
const openImport = () => {
  openMenu();
  fireEvent.click(screen.getByRole("menuitem", { name: "permissions.config.import" }));
};
const nextButton = () => screen.getByRole("button", { name: "permissions.config.next" });
const cell = (label: string) => screen.getByText(label).nextElementSibling?.textContent;

/** 选好文件、点「下一步」,停在第 2 步。 */
async function toSummary() {
  openImport();
  pick(JSON.stringify(DOC));
  await waitFor(() => expect(nextButton()).toBeEnabled());
  fireEvent.click(nextButton());
  await screen.findByText("permissions.config.will.add");
}

beforeEach(() => {
  jest.clearAllMocks();
  mockRole = "ADMIN";
});

describe("entry points", () => {
  it("puts export and import (with the ellipsis) in the more menu, not on the toolbar", () => {
    setup();
    expect(screen.queryByRole("button", { name: "permissions.config.export" })).toBeNull();
    expect(screen.queryByRole("button", { name: "permissions.config.import" })).toBeNull();
    openMenu();
    expect(screen.getByRole("menuitem", { name: "permissions.config.export" })).toBeInTheDocument();
    expect(screen.getByRole("menuitem", { name: "permissions.config.import" })).toBeInTheDocument();
  });

  it("shows nothing at all to anyone else (no disabled stub)", () => {
    mockRole = "MODERATOR";
    setup();
    expect(screen.queryByRole("button")).toBeNull();
  });
});

describe("export", () => {
  it("saves the file named with tenant and date", async () => {
    exportConfig.mockResolvedValue({ data: "{}" });
    setup();
    openMenu();
    fireEvent.click(screen.getByRole("menuitem", { name: "permissions.config.export" }));
    await waitFor(() => expect(saveBlob).toHaveBeenCalled());
    const [, name, type] = (saveBlob as jest.Mock).mock.calls[0];
    expect(name).toMatch(/^permissions_CN_DIYU_\d{4}-\d{2}-\d{2}\.json$/);
    expect(type).toContain("application/json");
  });

  it("toasts when the export fails", async () => {
    exportConfig.mockRejectedValue(new Error("x"));
    setup();
    openMenu();
    fireEvent.click(screen.getByRole("menuitem", { name: "permissions.config.export" }));
    await waitFor(() => expect(showToast).toHaveBeenCalledWith("permissions.config.export_error", "error"));
    expect(saveBlob).not.toHaveBeenCalled();
  });
});

describe("import: client-side checks", () => {
  it.each([
    ["not JSON", "{oops", undefined, "not_json"],
    ["a JSON list", "[]", undefined, "bad_structure"],
    ["an object with no known section", '{"x":1}', undefined, "bad_structure"],
    ["a section that is not a list", '{"roles":{}}', undefined, "bad_structure"],
    ["all sections empty", '{"roles":[]}', undefined, "empty"],
    ["an oversized file", "{}", MAX_IMPORT_BYTES + 1, "too_large"],
  ])("blocks %s before any request", async (_label, body, size, code) => {
    setup();
    openImport();
    pick(body, size);
    expect((await screen.findByRole("alert")).textContent).toContain(`permissions.config.errors.${code}`);
    expect(nextButton()).toBeDisabled();
    expect(importConfig).not.toHaveBeenCalled();
  });

  it("parse keeps counts and drops a file-supplied overwrite and dry_run", () => {
    const out = parsePermissionConfig(JSON.stringify({ ...DOC, overwrite: true, dry_run: true }), 10);
    if ("error" in out) throw new Error(out.error);
    expect(out.counts).toMatchObject({ permissions: 1, roles: 1, role_permissions: 1, field_permissions: 0 });
    expect("overwrite" in out.document).toBe(false);
    expect("dry_run" in out.document).toBe(false);
  });
});

describe("import: the three steps", () => {
  it("previews first (dry run), imports only on confirm, never offers overwrite", async () => {
    importConfig.mockResolvedValue({ data: { message: "ok", stats: STATS } });
    const { invalidate } = setup();
    openImport();
    expect(screen.getByRole("dialog").textContent).toContain("permissions.config.import_title:1");
    pick(JSON.stringify({ ...DOC, overwrite: true }));
    await waitFor(() => expect(nextButton()).toBeEnabled());
    expect(importConfig).not.toHaveBeenCalled();

    // 1 -> 2: preview. Same document, dry run, no cache invalidation.
    fireEvent.click(nextButton());
    await screen.findByText("permissions.config.will.add");
    expect(importConfig).toHaveBeenCalledTimes(1);
    expect(importConfig.mock.calls[0][1]).toBe(true);
    expect("overwrite" in importConfig.mock.calls[0][0]).toBe(false);
    expect(invalidate).not.toHaveBeenCalled();
    const dialog = screen.getByRole("dialog").textContent ?? "";
    expect(dialog).toContain("permissions.config.import_title:2");
    expect(dialog).toContain("p.json"); // file name ...
    expect(dialog).toContain("· x"); // ... and the hall's name
    expect(cell("permissions.config.will.add")).toBe("2");
    expect(cell("permissions.config.will.update")).toBe("0");
    expect(cell("permissions.config.will.skip")).toBe("3");
    expect(screen.queryByText("permissions.config.download_skipped")).toBeNull();
    expect(dialog).not.toMatch(/overwrite/i);

    // 2 -> 3: the real import.
    fireEvent.click(screen.getByRole("button", { name: "permissions.config.confirm" }));
    await screen.findByText("permissions.config.did.add");
    expect(importConfig).toHaveBeenCalledTimes(2);
    expect(importConfig.mock.calls[1][1]).toBe(false);
    expect(screen.getByRole("dialog").textContent).toContain("permissions.config.import_title:3");
    expect(cell("permissions.config.did.skip")).toBe("3");
    const keys = invalidate.mock.calls.map((c) => JSON.stringify((c[0] as { queryKey: unknown }).queryKey));
    expect(keys).toEqual(expect.arrayContaining(['["permissions"]', '["roles"]', '["role-permissions"]']));
    // The only button left is Done.
    expect(screen.queryByRole("button", { name: "common.cancel" })).toBeNull();
    expect(screen.getByRole("button", { name: "permissions.config.done" })).toBeInTheDocument();
  });

  it("offers the skipped-details download when something was skipped, and writes a CSV", async () => {
    importConfig.mockResolvedValue({ data: { message: "ok", stats: STATS } });
    setup();
    await toSummary();
    fireEvent.click(screen.getByRole("button", { name: "permissions.config.confirm" }));
    fireEvent.click(await screen.findByRole("button", { name: "permissions.config.download_skipped" }));
    const [content, name] = (saveBlob as jest.Mock).mock.calls[0];
    expect(name).toMatch(/^permissions_skipped_CN_DIYU_\d{4}-\d{2}-\d{2}\.csv$/);
    expect(content).toContain('section,key,reason\r\n"roles","R","already_exists"');
    expect(content).toContain('"a ""q"".read"'); // quotes are escaped
  });

  it("has no download link when nothing was skipped", async () => {
    importConfig.mockResolvedValue({ data: { message: "ok", stats: NOTHING_SKIPPED } });
    setup();
    await toSummary();
    fireEvent.click(screen.getByRole("button", { name: "permissions.config.confirm" }));
    await screen.findByText("permissions.config.did.add");
    expect(cell("permissions.config.did.skip")).toBe("0");
    expect(screen.queryByRole("button", { name: "permissions.config.download_skipped" })).toBeNull();
  });

  it("shows the backend's reason when the preview is refused, and stays on step 1", async () => {
    importConfig.mockRejectedValue({ response: { data: { error: "Body must be a JSON object" } } });
    setup();
    openImport();
    pick(JSON.stringify(DOC));
    await waitFor(() => expect(nextButton()).toBeEnabled());
    fireEvent.click(nextButton());
    expect((await screen.findByRole("alert")).textContent).toContain("Body must be a JSON object");
    expect(screen.getByRole("dialog").textContent).toContain("permissions.config.import_title:1");
  });

  it("flattens a serializer-style 400", async () => {
    importConfig.mockRejectedValue({ response: { data: { permissions: [{ name: ["required"] }] } } });
    setup();
    openImport();
    pick(JSON.stringify(DOC));
    await waitFor(() => expect(nextButton()).toBeEnabled());
    fireEvent.click(nextButton());
    expect((await screen.findByRole("alert")).textContent).toContain("permissions:");
  });
});
