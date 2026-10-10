/**
 * 权限页的「导出配置 / 导入配置…」(更多 ⋯ 菜单里的两项,一个三步弹层)。
 *
 * 钉住:入口只对 ADMIN 出现;非法文件在客户端就被拦下、不发请求;合法文件点「下一步」先预演
 * (dry_run:true,不失效缓存)、第 2 步显示摘要,确认后才真导入(dry_run:false),第 3 步显示结果、
 * 让三组权限查询失效;有跳过项才出现「下载跳过明细」;失败显示后端给的原因。
 *
 * 覆盖(Design 第十六批):默认合并,表里只有「将新增 / 将跳过」;选了覆盖才重新预演
 * (`overwrite: true`),多出「将更新」与 danger 色的「将删除 N」,危险提示说明影响所有殿,要先输入
 * 确认词(= mode.overwrite 的文案,不是殿名)危险按钮才可点,真导入才带 `overwrite: true`;删除名单里有自己的权限(`removes_own_permissions`)时
 * 禁止覆盖。第 2 步有「上一步」,回第 1 步、文件名还在;第 3 步没有。
 */
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { permApi } from "@soulledger/core/api";
import { PermissionConfigTransfer, parsePermissionConfig, MAX_IMPORT_BYTES } from "@/src/components/permissions/PermissionConfigTransfer";
import zh from "@soulledger/core/messages/zh-Hans.json";
import en from "@soulledger/core/messages/en.json";
import egy from "@soulledger/core/messages/egy.json";
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
  updated: 0,
  removed: { role_permissions: 0, field_permissions: 0, data_scopes: 0, total: 0 },
  removes_own_permissions: false,
  skipped_details: [
    { section: "roles", key: "R", reason: "already_exists" },
    { section: "permissions", key: 'a "q".read', reason: "already_exists" },
    { section: "permissions", key: "b.read", reason: "already_exists" },
  ],
};
const OVERWRITE_STATS = {
  ...STATS,
  updated: 2,
  removed: { role_permissions: 3, field_permissions: 1, data_scopes: 1, total: 5 },
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
  it("previews first (dry run), imports only on confirm, and merges unless overwrite was chosen", async () => {
    importConfig.mockResolvedValue({ data: { message: "ok", overwrite_enabled: true, stats: STATS } });
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
    expect(importConfig.mock.calls[0][2]).toBe(false);
    expect("overwrite" in importConfig.mock.calls[0][0]).toBe(false);
    expect(invalidate).not.toHaveBeenCalled();
    const dialog = screen.getByRole("dialog").textContent ?? "";
    expect(dialog).toContain("permissions.config.import_title:2");
    expect(dialog).toContain("p.json"); // file name ...
    expect(dialog).toContain("· x"); // ... and the hall's name
    expect(cell("permissions.config.will.add")).toBe("2");
    expect(cell("permissions.config.will.skip")).toBe("3");
    // A merge never updates or deletes: those rows are not there (Design 第十六批).
    expect(screen.queryByText("permissions.config.will.update")).toBeNull();
    expect(screen.queryByText("permissions.config.will.remove")).toBeNull();
    expect(screen.queryByTestId("overwrite-warning")).toBeNull();
    expect(screen.queryByTestId("overwrite-action")).toBeNull();
    expect(screen.getByRole("radio", { name: "permissions.config.mode.merge" })).toBeChecked();
    expect(screen.getByRole("radio", { name: "permissions.config.mode.overwrite" })).not.toBeChecked();
    expect(screen.queryByText("permissions.config.download_skipped")).toBeNull();

    // 2 -> 3: the real import.
    fireEvent.click(screen.getByRole("button", { name: "permissions.config.confirm" }));
    await screen.findByText("permissions.config.did.add");
    expect(importConfig).toHaveBeenCalledTimes(2);
    expect(importConfig.mock.calls[1][1]).toBe(false);
    expect(importConfig.mock.calls[1][2]).toBe(false); // overwrite stays false on every path but the confirmed one
    expect(screen.getByRole("dialog").textContent).toContain("permissions.config.import_title:3");
    expect(screen.queryByText("permissions.config.did.update")).toBeNull();
    expect(screen.queryByRole("button", { name: "permissions.config.back" })).toBeNull(); // no back on step 3
    expect(cell("permissions.config.did.skip")).toBe("3");
    const keys = invalidate.mock.calls.map((c) => JSON.stringify((c[0] as { queryKey: unknown }).queryKey));
    expect(keys).toEqual(expect.arrayContaining(['["permissions"]', '["roles"]', '["role-permissions"]']));
    // The only button left is Done.
    expect(screen.queryByRole("button", { name: "common.cancel" })).toBeNull();
    expect(screen.getByRole("button", { name: "permissions.config.done" })).toBeInTheDocument();
  });

  it("offers the skipped-details download when something was skipped, and writes a CSV", async () => {
    importConfig.mockResolvedValue({ data: { message: "ok", overwrite_enabled: true, stats: STATS } });
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
    importConfig.mockResolvedValue({ data: { message: "ok", overwrite_enabled: true, stats: NOTHING_SKIPPED } });
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

const radio = (mode: "merge" | "overwrite") => screen.getByRole("radio", { name: `permissions.config.mode.${mode}` });
const dangerButton = () => screen.getByTestId("overwrite-action");
const nameField = () => screen.getByLabelText("permissions.config.overwrite.confirm_hint");
// The mocked t() echoes the key, so the confirm word in these tests is the key of the mode label.
const CONFIRM_WORD = "permissions.config.mode.overwrite";

/** 第 2 步,选「覆盖」:预演换成 overwrite: true。 */
async function toOverwrite(stats: object = OVERWRITE_STATS) {
  importConfig.mockResolvedValueOnce({ data: { message: "ok", overwrite_enabled: true, stats: STATS } });
  await toSummary();
  importConfig.mockResolvedValueOnce({ data: { message: "ok", overwrite_enabled: true, stats } });
  fireEvent.click(radio("overwrite"));
  await screen.findByTestId("overwrite-warning");
}

describe("import: overwrite", () => {
  it("choosing it re-previews with overwrite: true and adds the update and danger delete rows", async () => {
    setup();
    await toOverwrite();
    expect(importConfig).toHaveBeenCalledTimes(2);
    expect(importConfig.mock.calls[1][1]).toBe(true); // still a dry run
    expect(importConfig.mock.calls[1][2]).toBe(true);
    expect(radio("overwrite")).toBeChecked();
    expect(cell("permissions.config.will.update")).toBe("2");
    expect(cell("permissions.config.will.remove")).toBe("5"); // removed.total: gone afterwards, not "deleted first"
    const row = screen.getByText("permissions.config.will.remove").closest("[data-row-danger]");
    expect(row).not.toBeNull();
    // The merge rows are still there next to them.
    expect(cell("permissions.config.will.add")).toBe("2");
    expect(cell("permissions.config.will.skip")).toBe("3");
    // The danger sentence carries the count and says every hall is affected; "including your own" is NOT there.
    const warning = screen.getByTestId("overwrite-warning").textContent ?? "";
    expect(warning).toContain("permissions.config.overwrite.warning:5");
    expect(warning).not.toContain("warning_own");
    expect(warning).toContain("permissions.config.overwrite.all_halls:x");
    // Nothing real has been sent.
    expect(importConfig.mock.calls.every((c) => c[1] === true)).toBe(true);
  });

  it("the danger button needs the confirm word typed (not the hall name); only then does the real import carry overwrite: true", async () => {
    const { invalidate } = setup();
    await toOverwrite();
    expect(dangerButton()).toBeDisabled();
    expect(screen.queryByRole("button", { name: "permissions.config.confirm" })).toBeNull(); // no plain confirm in this mode
    fireEvent.change(nameField(), { target: { value: "x" } }); // the hall's name no longer unlocks it
    expect(dangerButton()).toBeDisabled();
    fireEvent.click(dangerButton());
    expect(importConfig).toHaveBeenCalledTimes(2); // a disabled button sends nothing
    fireEvent.change(nameField(), { target: { value: ` ${CONFIRM_WORD} ` } });
    expect(dangerButton()).toBeEnabled();

    importConfig.mockResolvedValueOnce({ data: { message: "ok", overwrite_enabled: true, stats: OVERWRITE_STATS } });
    fireEvent.click(dangerButton());
    await screen.findByText("permissions.config.did.remove");
    expect(importConfig).toHaveBeenCalledTimes(3);
    expect(importConfig.mock.calls[2][1]).toBe(false);
    expect(importConfig.mock.calls[2][2]).toBe(true);
    expect(cell("permissions.config.did.remove")).toBe("5");
    expect(cell("permissions.config.did.update")).toBe("2");
    expect(invalidate).toHaveBeenCalled();
  });

  it("is refused when the removal list holds the caller's own permissions: warning says so, no way to confirm", async () => {
    setup();
    await toOverwrite({ ...OVERWRITE_STATS, removes_own_permissions: true });
    const warning = screen.getByTestId("overwrite-warning").textContent ?? "";
    expect(warning).toContain("permissions.config.overwrite.warning_own:5");
    expect(warning).toContain("permissions.config.overwrite.blocked_own");
    expect(screen.queryByLabelText("permissions.config.overwrite.confirm_hint")).toBeNull(); // nothing to type
    expect(dangerButton()).toBeDisabled();
    fireEvent.click(dangerButton());
    expect(importConfig.mock.calls.every((c) => c[1] === true)).toBe(true);
    // Merge is still available from here.
    importConfig.mockResolvedValueOnce({ data: { message: "ok", overwrite_enabled: true, stats: STATS } });
    fireEvent.click(radio("merge"));
    await waitFor(() => expect(screen.queryByTestId("overwrite-warning")).toBeNull());
    expect(importConfig.mock.calls.at(-1)?.[2]).toBe(false);
  });

  it("switching back to merge drops the extra rows and the warning", async () => {
    setup();
    await toOverwrite();
    importConfig.mockResolvedValueOnce({ data: { message: "ok", overwrite_enabled: true, stats: STATS } });
    fireEvent.click(radio("merge"));
    await waitFor(() => expect(screen.queryByTestId("overwrite-warning")).toBeNull());
    expect(screen.queryByText("permissions.config.will.update")).toBeNull();
    expect(screen.queryByText("permissions.config.will.remove")).toBeNull();
    expect(screen.queryByTestId("overwrite-action")).toBeNull();
    expect(screen.getByRole("button", { name: "permissions.config.confirm" })).toBeEnabled();
  });

  it("stays on merge when the overwrite preview fails", async () => {
    setup();
    importConfig.mockResolvedValueOnce({ data: { message: "ok", overwrite_enabled: true, stats: STATS } });
    await toSummary();
    importConfig.mockRejectedValueOnce({ response: { data: { error: "nope" } } });
    fireEvent.click(radio("overwrite"));
    expect((await screen.findByRole("alert")).textContent).toContain("nope");
    expect(radio("merge")).toBeChecked();
    expect(screen.queryByTestId("overwrite-action")).toBeNull();
  });
});

describe("import: the server's overwrite switch (overwrite_enabled)", () => {
  // Off (false) or absent: exactly the merge-only flow -- no radio, no warning, no confirm field,
  // and every request carries overwrite: false. Not a disabled "overwrite" option.
  it.each([["false", { overwrite_enabled: false }], ["missing", {}]])("%s: no mode radios, no confirm field, overwrite stays false", async (_n, flag) => {
    setup();
    importConfig.mockResolvedValue({ data: { message: "ok", ...flag, stats: STATS } });
    await toSummary();
    expect(screen.queryByRole("radio")).toBeNull();
    expect(screen.queryByLabelText("permissions.config.overwrite.confirm_hint")).toBeNull();
    expect(screen.queryByTestId("overwrite-warning")).toBeNull();
    expect(screen.queryByText("permissions.config.mode.overwrite")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "permissions.config.confirm" }));
    await waitFor(() => expect(importConfig).toHaveBeenCalledTimes(2));
    expect(importConfig.mock.calls.map((c) => c[2])).toEqual([false, false]);
  });

  it("a 403 overwrite_disabled (switched off after the preview) shows its own sentence and falls back to merge", async () => {
    setup();
    importConfig.mockResolvedValueOnce({ data: { message: "ok", overwrite_enabled: true, stats: STATS } });
    await toSummary();
    importConfig.mockRejectedValueOnce({ response: { status: 403, data: { error: "Overwrite import is disabled.", code: "overwrite_disabled" } } });
    fireEvent.click(radio("overwrite"));
    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain("permissions.config.errors.overwrite_disabled");
    expect(alert.textContent).not.toContain("Overwrite import is disabled");
    expect(screen.queryByRole("radio")).toBeNull();
    expect(screen.queryByTestId("overwrite-action")).toBeNull();
  });
});

describe("import: overwrite confirm word in the language packs", () => {
  it.each([["zh-Hans", zh], ["en", en], ["egy", egy]] as const)("%s: confirm_hint contains that language's mode.overwrite", (_n, pack) => {
    const c = pack.permissions.config;
    expect(c.mode.overwrite.length).toBeGreaterThan(0);
    expect(c.overwrite.confirm_hint).toContain(c.mode.overwrite);
  });

  it("all_halls sits directly above the confirm field", async () => {
    setup();
    await toOverwrite();
    const sentence = screen.getByText("permissions.config.overwrite.all_halls:x");
    expect(sentence.nextElementSibling?.contains(nameField())).toBe(true);
  });
});

describe("import: back", () => {
  it("step 2 has Back (left of the confirm button); it returns to step 1 with the file name still shown", async () => {
    importConfig.mockResolvedValue({ data: { message: "ok", overwrite_enabled: true, stats: STATS } });
    setup();
    await toSummary();
    const back = screen.getByRole("button", { name: "permissions.config.back" });
    const confirm = screen.getByRole("button", { name: "permissions.config.confirm" });
    expect(back.compareDocumentPosition(confirm) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    fireEvent.click(back);
    expect(screen.getByRole("dialog").textContent).toContain("permissions.config.import_title:1");
    expect(screen.getByRole("dialog").textContent).toContain("p.json");
    expect(nextButton()).toBeEnabled(); // the parsed file is still there: Next works without re-choosing
    expect(importConfig).toHaveBeenCalledTimes(1); // going back sends nothing
  });

  it("step 1 has no Back, and going back from overwrite returns to a merge preview next time", async () => {
    setup();
    openImport();
    expect(screen.queryByRole("button", { name: "permissions.config.back" })).toBeNull();
    pick(JSON.stringify(DOC));
    await waitFor(() => expect(nextButton()).toBeEnabled());
    expect(screen.queryByRole("button", { name: "permissions.config.back" })).toBeNull();
    importConfig.mockResolvedValueOnce({ data: { message: "ok", overwrite_enabled: true, stats: STATS } });
    fireEvent.click(nextButton());
    await screen.findByText("permissions.config.will.add");
    importConfig.mockResolvedValueOnce({ data: { message: "ok", overwrite_enabled: true, stats: OVERWRITE_STATS } });
    fireEvent.click(radio("overwrite"));
    await screen.findByTestId("overwrite-warning");
    fireEvent.click(screen.getByRole("button", { name: "permissions.config.back" }));
    importConfig.mockResolvedValueOnce({ data: { message: "ok", overwrite_enabled: true, stats: STATS } });
    fireEvent.click(nextButton());
    await screen.findByText("permissions.config.will.add");
    expect(importConfig.mock.calls.at(-1)?.[2]).toBe(false);
    expect(radio("merge")).toBeChecked();
    expect(screen.queryByTestId("overwrite-warning")).toBeNull();
  });
});
