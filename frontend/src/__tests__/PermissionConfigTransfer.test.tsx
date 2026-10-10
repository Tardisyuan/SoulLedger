/**
 * 权限页的「导出配置 / 导入配置」。
 *
 * 钉住:入口只对 ADMIN 出现;非法文件在客户端就被拦下、不发请求;合法文件先显示条目数、
 * 确认后才调接口,且请求里 overwrite 恒为 false(界面没有覆盖选项,文件里自带的 overwrite 也不转发);
 * 成功显示后端 stats、并让三组权限查询失效;失败显示后端给的原因。
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

const openImport = () => fireEvent.click(screen.getByRole("button", { name: "permissions.config.import" }));

beforeEach(() => {
  jest.clearAllMocks();
  mockRole = "ADMIN";
});

describe("entry points", () => {
  it("shows both buttons to an ADMIN", () => {
    setup();
    expect(screen.getByRole("button", { name: "permissions.config.export" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "permissions.config.import" })).toBeInTheDocument();
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
    fireEvent.click(screen.getByRole("button", { name: "permissions.config.export" }));
    await waitFor(() => expect(saveBlob).toHaveBeenCalled());
    const [, name, type] = (saveBlob as jest.Mock).mock.calls[0];
    expect(name).toMatch(/^permissions_CN_DIYU_\d{4}-\d{2}-\d{2}\.json$/);
    expect(type).toContain("application/json");
  });

  it("toasts when the export fails", async () => {
    exportConfig.mockRejectedValue(new Error("x"));
    setup();
    fireEvent.click(screen.getByRole("button", { name: "permissions.config.export" }));
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
    expect(screen.getByRole("button", { name: "permissions.config.confirm" })).toBeDisabled();
    expect(importConfig).not.toHaveBeenCalled();
  });

  it("parse keeps counts and drops a file-supplied overwrite", () => {
    const out = parsePermissionConfig(JSON.stringify({ ...DOC, overwrite: true }), 10);
    if ("error" in out) throw new Error(out.error);
    expect(out.counts).toMatchObject({ permissions: 1, roles: 1, role_permissions: 1, field_permissions: 0 });
    expect("overwrite" in out.document).toBe(false);
  });
});

describe("import: confirm and result", () => {
  it("shows the summary, calls only after confirm, never asks for overwrite, then shows the stats", async () => {
    importConfig.mockResolvedValue({
      data: { message: "ok", stats: { permissions: 1, roles: 0, role_permissions: 1, field_permissions: 0, data_scopes: 0 } },
    });
    const { invalidate } = setup();
    openImport();
    pick(JSON.stringify({ ...DOC, overwrite: true }));
    expect((await screen.findByRole("status")).textContent).toBe("permissions.config.summary:1,1,1,0,0");
    expect(importConfig).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "permissions.config.confirm" }));
    await waitFor(() => expect(importConfig).toHaveBeenCalledTimes(1));
    const sent = importConfig.mock.calls[0][0];
    expect(sent.roles).toEqual(DOC.roles);
    expect("overwrite" in sent).toBe(false); // permApi.importConfig adds overwrite:false itself
    await waitFor(() => expect(screen.getByRole("status").textContent).toContain("permissions.config.result:1,0,1,0,0"));
    const keys = invalidate.mock.calls.map((c) => JSON.stringify((c[0] as { queryKey: unknown }).queryKey));
    expect(keys).toEqual(expect.arrayContaining(['["permissions"]', '["roles"]', '["role-permissions"]']));
  });

  it("shows the backend's reason when the import is refused", async () => {
    importConfig.mockRejectedValue({ response: { data: { error: "Body must be a JSON object" } } });
    setup();
    openImport();
    pick(JSON.stringify(DOC));
    await screen.findByRole("status"); // parsed: the confirm button is enabled only after this
    fireEvent.click(screen.getByRole("button", { name: "permissions.config.confirm" }));
    expect((await screen.findByRole("alert")).textContent).toContain("Body must be a JSON object");
  });

  it("flattens a serializer-style 400", async () => {
    importConfig.mockRejectedValue({ response: { data: { permissions: [{ name: ["required"] }] } } });
    setup();
    openImport();
    pick(JSON.stringify(DOC));
    await screen.findByRole("status"); // parsed: the confirm button is enabled only after this
    fireEvent.click(screen.getByRole("button", { name: "permissions.config.confirm" }));
    expect((await screen.findByRole("alert")).textContent).toContain("permissions:");
  });
});
