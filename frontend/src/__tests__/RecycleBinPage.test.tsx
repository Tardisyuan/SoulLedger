/**
 * app/recycle-bin/page.tsx after 第三类 D 组答复:
 * - 行尾只留「恢复」(规则 15 的例外);
 * - 彻底删除收进 ⋯ 菜单,而那个菜单只对今天就持有 `recycle_bin.hard_delete`
 *   的人出现 —— 这是后端强制的同一个码名;
 * - 删除于 / 删除人 各占一列,数据来自 API 已有字段。
 */
import { fireEvent, render, screen, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import RecycleBinPage from "@/app/recycle-bin/page";
import { recycleBinApi, type RecycleBinEntry } from "@soulledger/core/api";

jest.mock("@soulledger/core/api", () => ({
  recycleBinApi: { list: jest.fn(), restore: jest.fn(), hardDelete: jest.fn() },
}));

let mockUser: { role: string; permissions: string[] } = { role: "JUDGE", permissions: [] };
jest.mock("@/src/contexts/TenantContext", () => ({
  useTenant: () => ({ user: mockUser }),
}));

jest.mock("@/src/contexts/I18nContext", () => ({
  useI18n: () => ({
    t: (key: string, params?: Record<string, string>) =>
      params ? `${key}(${Object.values(params).join(",")})` : key,
    formatDateTime: (v: string) => v,
    locale: "en",
    hydrated: true,
  }),
}));

jest.mock("@/src/contexts/ToastContext", () => ({ useToast: () => ({ showToast: jest.fn() }) }));

const row = (over: Partial<RecycleBinEntry> = {}): RecycleBinEntry => ({
  entity_type: "MENU",
  kind: "reference",
  id: 7,
  label: "旧菜单",
  deleted_at: "2026-09-01T10:00:00Z",
  deleted_by: "yama",
  delete_reason: "",
  cascade_id: "c-7",
  dependent_count: 0,
  retention_days: 30,
  hard_delete_eligible: true,
  ...over,
});

function renderPage() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <RecycleBinPage />
    </QueryClientProvider>
  );
}

const READ_RESTORE = ["recycle_bin.read", "recycle_bin.restore"];

beforeEach(() => {
  jest.clearAllMocks();
  (recycleBinApi.list as jest.Mock).mockResolvedValue({ data: { results: [row()], count: 1 } });
});

describe("RecycleBinPage hard-delete gate", () => {
  it("gives a caller without recycle_bin.hard_delete no ⋯ menu and no hard-delete control at all", async () => {
    mockUser = { role: "JUDGE", permissions: READ_RESTORE };
    renderPage();

    await screen.findByText("旧菜单");
    expect(screen.getByRole("button", { name: "recycle_bin.restore" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "souls.detail.more_actions" })).not.toBeInTheDocument();
    expect(screen.queryByText("recycle_bin.hard_delete")).not.toBeInTheDocument();
  });

  it("puts hard delete behind ⋯ for a holder, not on the row", async () => {
    mockUser = { role: "JUDGE", permissions: [...READ_RESTORE, "recycle_bin.hard_delete"] };
    renderPage();

    await screen.findByText("旧菜单");
    // Not on the row until the menu opens.
    expect(screen.queryByText("recycle_bin.hard_delete")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "souls.detail.more_actions" }));
    const menu = screen.getByRole("menu");
    fireEvent.click(within(menu).getByRole("menuitem", { name: "recycle_bin.hard_delete" }));

    expect(await screen.findByText("recycle_bin.hard_delete_confirm_title")).toBeInTheDocument();
  });

  it("disables the item and says why while the row is inside its retention window", async () => {
    mockUser = { role: "JUDGE", permissions: [...READ_RESTORE, "recycle_bin.hard_delete"] };
    (recycleBinApi.list as jest.Mock).mockResolvedValue({
      data: { results: [row({ hard_delete_eligible: false, retention_days: 30 })], count: 1 },
    });
    renderPage();

    await screen.findByText("旧菜单");
    fireEvent.click(screen.getByRole("button", { name: "souls.detail.more_actions" }));
    const item = within(screen.getByRole("menu")).getByRole("menuitem");
    expect(item).toBeDisabled();
    expect(item).toHaveTextContent("recycle_bin.hard_delete_not_yet_eligible(30)");
  });

  it("offers no ⋯ on a domain row even to a holder — only reference rows can be hard-deleted", async () => {
    mockUser = { role: "JUDGE", permissions: [...READ_RESTORE, "recycle_bin.hard_delete"] };
    (recycleBinApi.list as jest.Mock).mockResolvedValue({
      data: { results: [row({ kind: "domain", entity_type: "SOUL" })], count: 1 },
    });
    renderPage();

    await screen.findByText("旧菜单");
    expect(screen.queryByRole("button", { name: "souls.detail.more_actions" })).not.toBeInTheDocument();
  });
});

describe("RecycleBinPage columns", () => {
  it("shows 删除人 in its own column, and a missing deleter as a missing value", async () => {
    mockUser = { role: "JUDGE", permissions: READ_RESTORE };
    (recycleBinApi.list as jest.Mock).mockResolvedValue({
      data: { results: [row(), row({ id: 8, label: "无主", deleted_by: null, cascade_id: "c-8" })], count: 2 },
    });
    renderPage();

    await screen.findByText("旧菜单");
    expect(screen.getByRole("columnheader", { name: "recycle_bin.col_deleted_by" })).toBeInTheDocument();
    const [, first, second] = screen.getAllByRole("row");
    expect(within(first).getByText("yama")).toBeInTheDocument();
    expect(second.querySelector("[data-missing]")).not.toBeNull();
    expect(second).not.toHaveTextContent("null");
  });
});
