/**
 * 列菜单(Design 第二十八批 W1):`useColumnVisibility` + `ColumnMenu` + DataGrid 的 `hiddenColumns`。
 *
 * 钉住的列不能隐藏;隐藏的偏好记在本浏览器、重挂后还在;「恢复默认」清掉它;
 * 导出请求不看这份偏好;窄屏(< md)菜单不出现、偏好也不生效 —— 窄屏没有菜单可以把列找回来。
 */
import { fireEvent, render, screen, within } from "@testing-library/react";
import { DataGrid } from "@/components/ui/data-grid/DataGrid";
import { ColumnMenu, useColumnVisibility } from "@/components/ui/data-grid/ColumnMenu";
import { ExportCsvButton } from "@/src/components/ExportCsvButton";
import type { DataGridColumn } from "@/components/ui/data-grid/columns";

jest.mock("@/src/contexts/I18nContext", () => ({
  useI18n: () => ({ t: (key: string) => (key === "common.export" ? "导出" : key), locale: "zh-Hans", hydrated: true }),
}));
jest.mock("@/src/contexts/ToastContext", () => ({ useToast: () => ({ showToast: jest.fn() }) }));
jest.mock("@/src/lib/saveBlob", () => ({ saveBlob: jest.fn() }));

interface Row {
  id: string;
  name: string;
  civ: string;
  state: string;
}
const rows: Row[] = [{ id: "1", name: "沈青梧", civ: "地府", state: "审判中" }];
const columns: DataGridColumn<Row>[] = [
  { type: "text", key: "name", header: "名称", value: (r) => r.name, pinned: true },
  { type: "text", key: "civ", header: "文明", value: (r) => r.civ },
  { type: "text", key: "state", header: "状态", value: (r) => r.state },
];
const KEY = "soulledger.test.columns";
const exportCsv = jest.fn().mockResolvedValue({ data: new Blob(["x"]) });

function Harness() {
  const visibility = useColumnVisibility(KEY, columns);
  return (
    <>
      <ColumnMenu
        columns={columns.map((c) => ({ key: c.key, header: String(c.header), pinned: c.pinned }))}
        visibility={visibility}
        buttonLabel={`列 · ${visibility.shown}/${visibility.total}`}
        pinnedLabel="不能隐藏"
        resetLabel="恢复默认"
      />
      <ExportCsvButton fetchCsv={() => exportCsv({ state: "x" })} page="灵魂" />
      <DataGrid<Row> columns={columns} hiddenColumns={visibility.hidden} data={rows} keyExtractor={(r) => r.id} caption="灵魂" />
    </>
  );
}

function mockViewport(wide: boolean) {
  window.matchMedia = jest.fn().mockImplementation(() => ({
    matches: wide,
    addEventListener: jest.fn(),
    removeEventListener: jest.fn(),
  })) as unknown as typeof window.matchMedia;
}

const openMenu = () => fireEvent.click(screen.getByRole("button", { name: /^列 · / }));
const headers = () => screen.queryAllByRole("columnheader").map((h) => h.textContent);

beforeEach(() => {
  localStorage.clear();
  exportCsv.mockClear();
  mockViewport(true);
});
afterEach(() => {
  // jsdom has no matchMedia; the hook's fallback for that is "wide".
  delete (window as { matchMedia?: unknown }).matchMedia;
});

describe("列菜单", () => {
  it("按钮写「列 · 显示/总数」;钉住的列勾着、不可点,并标明不能隐藏", () => {
    render(<Harness />);
    expect(screen.getByRole("button", { name: "列 · 3/3" })).toBeInTheDocument();
    openMenu();
    const pinned = screen.getByRole("menuitemcheckbox", { name: /名称/ });
    expect(pinned).toHaveAttribute("aria-checked", "true");
    expect(pinned).toBeDisabled();
    expect(within(pinned).getByText("不能隐藏")).toBeInTheDocument();
    fireEvent.click(pinned);
    expect(headers()).toContain("名称");
    // 只有钉住的那一项标「不能隐藏」。
    expect(screen.getAllByText("不能隐藏")).toHaveLength(1);
  });

  it("隐藏一列:表头与单元格都没了,计数变,偏好写进本浏览器;重挂后还在", () => {
    const { unmount } = render(<Harness />);
    openMenu();
    fireEvent.click(screen.getByRole("menuitemcheckbox", { name: /文明/ }));
    expect(headers()).toEqual(["名称", "状态"]);
    expect(screen.queryByText("地府")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "列 · 2/3" })).toBeInTheDocument();
    expect(JSON.parse(localStorage.getItem(KEY)!)).toEqual({ hidden: "civ" });
    unmount();

    render(<Harness />);
    expect(headers()).toEqual(["名称", "状态"]);
    expect(screen.queryByText("地府")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "列 · 2/3" })).toBeInTheDocument();
  });

  it("再点一次把列找回来;「恢复默认」清掉全部隐藏并删掉存的偏好,没有隐藏时它不可选", () => {
    render(<Harness />);
    openMenu();
    expect(screen.getByRole("menuitem", { name: "恢复默认" })).toBeDisabled();
    fireEvent.click(screen.getByRole("menuitemcheckbox", { name: /文明/ }));
    fireEvent.click(screen.getByRole("menuitemcheckbox", { name: /状态/ }));
    expect(headers()).toEqual(["名称"]);
    fireEvent.click(screen.getByRole("menuitemcheckbox", { name: /状态/ }));
    expect(headers()).toEqual(["名称", "状态"]);
    fireEvent.click(screen.getByRole("menuitem", { name: "恢复默认" }));
    expect(headers()).toEqual(["名称", "文明", "状态"]);
    expect(localStorage.getItem(KEY)).toBeNull();
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
  });

  it("存的偏好里钉住的列和不存在的列被忽略", () => {
    localStorage.setItem(KEY, JSON.stringify({ hidden: "name,ghost,state" }));
    render(<Harness />);
    expect(headers()).toEqual(["名称", "文明"]);
    expect(screen.getByRole("button", { name: "列 · 2/3" })).toBeInTheDocument();
  });

  it("导出请求不看隐藏的列:隐藏前后发出的参数相同", async () => {
    render(<Harness />);
    fireEvent.click(screen.getByRole("button", { name: "导出" }));
    await screen.findByRole("button", { name: "导出" });
    openMenu();
    fireEvent.click(screen.getByRole("menuitemcheckbox", { name: /状态/ }));
    fireEvent.click(screen.getByRole("button", { name: "导出" }));
    await screen.findByRole("button", { name: "导出" });
    expect(exportCsv.mock.calls).toEqual([[{ state: "x" }], [{ state: "x" }]]);
  });

  it("键盘:↓ 在触发钮上打开并落到第一个可选项(跳过钉住的),Esc 关闭并把焦点还给触发钮", () => {
    render(<Harness />);
    const trigger = screen.getByRole("button", { name: /^列 · / });
    trigger.focus();
    fireEvent.keyDown(trigger, { key: "ArrowDown" });
    expect(screen.getByRole("menu")).toBeInTheDocument();
    expect(screen.getByRole("menuitemcheckbox", { name: /文明/ })).toHaveFocus();
    fireEvent.keyDown(document, { key: "ArrowDown" });
    expect(screen.getByRole("menuitemcheckbox", { name: /状态/ })).toHaveFocus();
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();
  });

  it("窄屏:没有菜单按钮,存着的隐藏偏好也不生效(列还在)", () => {
    mockViewport(false);
    localStorage.setItem(KEY, JSON.stringify({ hidden: "civ" }));
    render(<Harness />);
    expect(screen.queryByRole("button", { name: /^列 · / })).not.toBeInTheDocument();
    expect(headers()).toEqual(["名称", "文明", "状态"]);
  });

  it("DataGrid 的 hiddenColumns 不能藏钉住的列;不传就全显示", () => {
    const { rerender } = render(
      <DataGrid<Row> columns={columns} hiddenColumns={new Set(["name", "civ"])} data={rows} keyExtractor={(r) => r.id} caption="灵魂" />
    );
    expect(headers()).toEqual(["名称", "状态"]);
    rerender(<DataGrid<Row> columns={columns} data={rows} keyExtractor={(r) => r.id} caption="灵魂" />);
    expect(headers()).toEqual(["名称", "文明", "状态"]);
  });
});
