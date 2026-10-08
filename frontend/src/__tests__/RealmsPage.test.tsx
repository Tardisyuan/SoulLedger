/**
 * app/realms/page.tsx —— 文明切换(墨底选中段)、左侧路线图(`RouteMap`,与详情行程条同一份布局)、
 * 右侧树表(在押 / 容量 / 永恒;满写「■ 满」、≥ 90% 写「◐ 将满」,字形加字、不靠警示色)、
 * 杜阿特画成「主干后分过 / 不过」(不过那栏虚线、终点是虚线框)、缺形状字段才退化为「示意」;
 * 容量只有持 `realms.manage` 的人能行内改(`PATCH /realms/{id}/` 只收 capacity),
 * 不持有的人看到的仍是只读表。
 */
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { ReactNode } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { Realm } from "@soulledger/core/api";
import RealmsPage from "@/app/realms/page";
import { realmsApi } from "@soulledger/core/api";
import { I18nProvider } from "@/src/contexts/I18nContext";

jest.mock("@soulledger/core/api", () => ({
  realmsApi: { list: jest.fn(), occupancy: jest.fn(), setCapacity: jest.fn() },
}));
let mockPermissions = ["realms.read"];
jest.mock("@/src/contexts/TenantContext", () => ({
  useTenant: () => ({ user: { id: 1, role: "JUDGE", permissions: mockPermissions, tenant: { code: "CN_DIYU" } } }),
}));
jest.mock("@/src/components/layout/MenuGloss", () => ({ MenuGloss: () => null }));

const base = { realm_type: "NEUTRAL", tier: 1, is_eternal: false, name: "" };
const R = (id: string, civilization: string, extra: Partial<Realm> = {}): Realm =>
  ({ ...base, id, realm_code: id, civilization, ...extra }) as Realm;

const REALMS: Realm[] = [
  R("DY_COURT_01_QINGUANG", "CHINESE", { order: 1, kind: "HALL" }),
  R("DY_COURT_05_YANLUO", "CHINESE", { order: 5, kind: "HALL" }),
  R("DY_00_PURGATORY", "CHINESE", { capacity: 2 }),
  R("SUB_GATE", "CHINESE", { parent_realm: "DY_COURT_05_YANLUO", capacity: 10, kind: "GATE" }),
  R("DY_01_HEAVEN", "CHINESE", { is_eternal: true, realm_type: "BLISS" }),
  R("EG_DUAT_ENTRY", "EGYPTIAN", { is_judgment_hall: false, order: 1 }),
  R("EG_HALL_TWO_TRUTHS", "EGYPTIAN", { is_judgment_hall: true, order: 3 }),
  R("EG_AARU", "EGYPTIAN", { is_judgment_hall: false, order: 5, fork: "PASS" }),
  R("EG_ANNIHILATION", "EGYPTIAN", { is_judgment_hall: false, order: 4, fork: "FAIL" }),
];

const mockedList = realmsApi.list as jest.Mock;
const mockedOcc = realmsApi.occupancy as jest.Mock;
const mockedSet = realmsApi.setCapacity as jest.Mock;

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const Wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>
      <I18nProvider>{children}</I18nProvider>
    </QueryClientProvider>
  );
  return render(<RealmsPage />, { wrapper: Wrapper });
}

beforeEach(() => {
  mockPermissions = ["realms.read"];
  mockedSet.mockReset();
  mockedList.mockResolvedValue({ data: { results: REALMS, count: REALMS.length } });
  mockedOcc.mockResolvedValue({ data: [{ realm_id: "DY_00_PURGATORY", count: 2 }, { realm_id: "SUB_GATE", count: 3 }] });
});

it("opens on the first civilization with realms and draws its line, not a schematic", async () => {
  renderPage();
  const topo = (await screen.findByTestId("realm-topology")).querySelector("[data-route-topology]")!;
  expect(topo.getAttribute("data-route-topology")).toBe("line");
  expect(topo.getAttribute("data-schematic")).toBe("false");
  expect(screen.getByRole("button", { name: /地府/ })).toHaveAttribute("aria-pressed", "true");
  expect(topo).toHaveTextContent("第一殿");
});

it("the route map marks an eternal stop with ≡ and its legend says what that means", async () => {
  mockedList.mockResolvedValue({
    data: { results: [...REALMS, R("DY_COURT_06_ETERNAL", "CHINESE", { order: 6, kind: "HALL", is_eternal: true })], count: 10 },
  });
  renderPage();
  const map = (await screen.findByTestId("realm-topology")).querySelector("[data-route-topology]")!;
  const eternal = map.querySelectorAll('[data-eternal="true"]');
  expect(eternal).toHaveLength(1);
  expect(map.querySelector('[data-station="DY_COURT_06_ETERNAL"]')!.querySelector('[data-eternal="true"]')).not.toBeNull();
  expect(map.querySelector('[data-station="DY_COURT_01_QINGUANG"]')!.querySelector('[data-eternal="true"]')).toBeNull();
  expect(within(map as HTMLElement).getByTestId("map-legend-eternal")).toHaveTextContent("不出狱、不轮回");
});

it("nests children under their parent in the tree table", async () => {
  renderPage();
  const tree = await screen.findByTestId("realm-tree");
  const rows = Array.from(tree.querySelectorAll("[data-realm-row]"));
  const i = rows.findIndex((r) => r.getAttribute("data-realm-row") === "DY_COURT_05_YANLUO");
  expect(rows[i + 1].getAttribute("data-realm-row")).toBe("SUB_GATE");
  expect(rows[i + 1].getAttribute("data-depth")).toBe("1");
  expect(rows[i + 1]).toHaveTextContent("门");
});

it("marks a realm at capacity with ■ 满 — glyph and word, not the warning colour; one under capacity with neither", async () => {
  mockedOcc.mockResolvedValue({
    data: [{ realm_id: "DY_00_PURGATORY", count: 2 }, { realm_id: "SUB_GATE", count: 3 }],
  });
  renderPage();
  const tree = await screen.findByTestId("realm-tree");
  const full = tree.querySelector('[data-realm-row="DY_00_PURGATORY"]')!;
  const held = within(full as HTMLElement).getByTestId("realm-held");
  await waitFor(() => expect(held).toHaveTextContent("2 / 2"));
  expect(held).toHaveTextContent("■ 满");
  expect(held.querySelector('[data-load="full"]')).not.toBeNull();
  // 满不是错误,也不是「可撤回的风险」:不用警示色(规范 v3)。
  expect(held.innerHTML).not.toContain("--color-warning");
  const gate = within(tree.querySelector('[data-realm-row="SUB_GATE"]') as HTMLElement).getByTestId("realm-held");
  expect(gate).toHaveTextContent("3 / 10");
  expect(gate).not.toHaveTextContent("满");
  expect(gate.querySelector("[data-load]")).toBeNull();
  // 永恒
  expect(tree.querySelector('[data-realm-row="DY_01_HEAVEN"]')).toHaveTextContent("≡ 永恒");
  expect(tree.querySelector('[data-realm-row="SUB_GATE"]')).not.toHaveTextContent("永恒");
});

it("marks ≥ 90% as ◐ 将满, and 89% as nothing", async () => {
  mockedList.mockResolvedValue({
    data: { results: [...REALMS, R("NEAR", "CHINESE", { capacity: 10 }), R("UNDER", "CHINESE", { capacity: 100 })], count: 11 },
  });
  mockedOcc.mockResolvedValue({ data: [{ realm_id: "NEAR", count: 9 }, { realm_id: "UNDER", count: 89 }] });
  renderPage();
  const tree = await screen.findByTestId("realm-tree");
  const cell = (code: string) => within(tree.querySelector(`[data-realm-row="${code}"]`) as HTMLElement).getByTestId("realm-held");
  await waitFor(() => expect(cell("NEAR")).toHaveTextContent("◐ 将满"));
  expect(cell("NEAR").querySelector('[data-load="near"]')).not.toBeNull();
  expect(cell("UNDER")).toHaveTextContent("89 / 100");
  expect(cell("UNDER").querySelector("[data-load]")).toBeNull();
});

it("folds the tree into two-line cards for the phone, with the same rows in the same order", async () => {
  renderPage();
  const tree = await screen.findByTestId("realm-tree");
  const cards = screen.getByTestId("realm-cards");
  const order = (root: Element, attr: string) => Array.from(root.querySelectorAll(`[${attr}]`)).map((r) => r.getAttribute(attr));
  expect(order(cards, "data-realm-card")).toEqual(order(tree, "data-realm-row"));
  expect(cards.querySelector('[data-realm-card="SUB_GATE"]')).toHaveTextContent("SUB_GATE · 门");
  // Read-only: a card is not a button.
  expect(within(cards).queryByRole("button")).toBeNull();
});

it("draws the Duat as a trunk, then 过 / 不过: the fail column dashed, its end a dashed box, uncounted", async () => {
  renderPage();
  await screen.findByTestId("realm-topology");
  fireEvent.click(screen.getByRole("button", { name: /埃及/ }));
  const topo = screen.getByTestId("realm-topology").querySelector("[data-route-topology]")! as HTMLElement;
  expect(topo.getAttribute("data-route-topology")).toBe("fork_two");
  expect(topo.getAttribute("data-schematic")).toBe("false");
  expect(topo).toHaveTextContent("埃及 · 主干后分过 / 不过");
  expect(within(topo).queryByTestId("topology-schematic")).toBeNull();
  const pass = topo.querySelector('[data-fork="PASS"]')! as HTMLElement;
  const fail = topo.querySelector('[data-fork="FAIL"]')! as HTMLElement;
  expect(pass).toHaveTextContent("✓ 过 · 心轻于羽");
  expect(pass.getAttribute("data-terminal")).toBeNull();
  expect(pass.className).not.toContain("border-dashed");
  expect(pass.querySelector(".border-dashed")).toBeNull();
  expect(fail).toHaveTextContent("✕ 不过 · 心重于羽");
  expect(fail.getAttribute("data-terminal")).toBe("dashed");
  expect(fail.className).toContain("border-dashed");
  expect(fail.querySelector("ol.border-dashed [data-station]")).not.toBeNull();
  expect(fail).toHaveTextContent("≡ 吞噬即终结");
  // 第二次死亡不是地方:不计在押(过那条路的站照常写 0)。
  expect(pass.textContent).toMatch(/0/);
  expect(fail.textContent).not.toMatch(/\d/);
});

it("draws a station with souls as a solid mark and an empty one as an outline, with the count beside it", async () => {
  mockedOcc.mockResolvedValue({ data: [{ realm_id: "DY_COURT_05_YANLUO", count: 4 }] });
  renderPage();
  const topo = (await screen.findByTestId("realm-topology")) as HTMLElement;
  await waitFor(() => expect(topo.querySelector('[data-station="DY_COURT_05_YANLUO"] [data-mark="held"]')).not.toBeNull());
  expect(topo.querySelector('[data-station="DY_COURT_05_YANLUO"]')).toHaveTextContent("4");
  expect(topo.querySelector('[data-station="DY_COURT_01_QINGUANG"] [data-mark="empty"]')).not.toBeNull();
  expect(topo.querySelector('[data-station="DY_COURT_01_QINGUANG"] [data-mark="held"]')).toBeNull();
  // Not clickable: the map is a picture of the data, not a control.
  expect(within(topo).queryByRole("button")).toBeNull();
});

it("writes — rather than 0 on the map when occupancy fails", async () => {
  mockedOcc.mockRejectedValue(new Error("500"));
  renderPage();
  const topo = (await screen.findByTestId("realm-topology")) as HTMLElement;
  await waitFor(() => expect(topo.querySelector('[data-station="DY_COURT_01_QINGUANG"]')).toHaveTextContent("—"));
  expect(topo.querySelector('[data-station="DY_COURT_01_QINGUANG"]')!.textContent).not.toMatch(/0$/);
});

it("the tree table puts the second death at 不计 — the same fail-road rule as the topology, not a realm code", async () => {
  mockPermissions = ["realms.read", "realms.manage"];
  // Held and full would show if the row were counted; renamed so no realm code can be what decides it.
  mockedList.mockResolvedValue({
    data: { results: [...REALMS, R("EG_RENAMED_END", "EGYPTIAN", { order: 6, fork: "FAIL", capacity: 1 })], count: REALMS.length + 1 },
  });
  mockedOcc.mockResolvedValue({ data: [{ realm_id: "EG_RENAMED_END", count: 4 }, { realm_id: "EG_AARU", count: 1 }] });
  renderPage();
  await screen.findByTestId("realm-topology");
  fireEvent.click(screen.getByRole("button", { name: /埃及/ }));
  const tree = screen.getByTestId("realm-tree");
  const cell = (code: string) => within(tree.querySelector(`[data-realm-row="${code}"]`) as HTMLElement).getByTestId("realm-held");
  for (const code of ["EG_ANNIHILATION", "EG_RENAMED_END"]) {
    expect(cell(code)).toHaveTextContent("— · 不是地方");
    expect(cell(code)).not.toHaveTextContent(/\d|满/);
    expect(within(cell(code)).queryByRole("button")).toBeNull();
  }
  expect(tree.querySelector('[data-realm-row="EG_RENAMED_END"]')!.getAttribute("data-full")).toBeNull();
  // The pass road is a place: counted, and editable.
  expect(cell("EG_AARU")).toHaveTextContent("1");
  expect(cell("EG_AARU")).not.toHaveTextContent("不是地方");
  expect(within(cell("EG_AARU")).getByRole("button")).toBeInTheDocument();
});

it("falls back to the labelled schematic line for a Duat whose rows carry no order or fork", async () => {
  mockedList.mockResolvedValue({
    data: { results: REALMS.map((r) => (r.civilization === "EGYPTIAN" ? { ...r, order: null, fork: null } : r)), count: REALMS.length },
  });
  renderPage();
  await screen.findByTestId("realm-topology");
  fireEvent.click(screen.getByRole("button", { name: /埃及/ }));
  const topo = screen.getByTestId("realm-topology").querySelector("[data-route-topology]")!;
  expect(topo.getAttribute("data-schematic")).toBe("true");
  expect(within(topo as HTMLElement).getByTestId("topology-schematic")).toHaveTextContent("示意");
});

it("says a civilization with no realms is unconfigured rather than drawing an empty map", async () => {
  renderPage();
  await screen.findByTestId("realm-topology");
  fireEvent.click(screen.getByRole("button", { name: /希腊/ }));
  expect(screen.getByText("此文明尚未配置界域")).toBeInTheDocument();
  expect(screen.queryByTestId("realm-topology")).toBeNull();
});

it("shows a typed miss, not a zero, when occupancy fails to load", async () => {
  mockedOcc.mockRejectedValue(new Error("500"));
  renderPage();
  const tree = await screen.findByTestId("realm-tree");
  await screen.findAllByText("—");
  const held = within(tree.querySelector('[data-realm-row="DY_00_PURGATORY"]') as HTMLElement).getByTestId("realm-held");
  expect(held.querySelector('[data-missing="unrecorded"]')).not.toBeNull();
  expect(held).not.toHaveTextContent("0");
});

it("is read-only without realms.manage and says why", async () => {
  renderPage();
  await screen.findByTestId("realm-tree");
  expect(screen.getByText(/只有持 realms.manage 的人能改容量/)).toBeInTheDocument();
  // The old reason is no longer true — there IS a write route now.
  expect(screen.queryByText(/没有写入路由/)).toBeNull();
  expect(screen.queryByRole("button", { name: /改容量|的容量/ })).toBeNull();
  expect(screen.queryByRole("spinbutton")).toBeNull();
});

describe("with realms.manage", () => {
  beforeEach(() => {
    mockPermissions = ["realms.read", "realms.manage"];
  });

  const editRow = async (code: string) => {
    const tree = await screen.findByTestId("realm-tree");
    const row = tree.querySelector(`[data-realm-row="${code}"]`) as HTMLElement;
    fireEvent.click(within(row).getByRole("button", { name: /的容量/ }));
    return row;
  };

  it("edits capacity inline and saves only the capacity", async () => {
    mockedSet.mockResolvedValue({ data: { ...REALMS[3], capacity: 12, held: 3, is_full: false } });
    renderPage();
    const row = await editRow("SUB_GATE");
    const input = within(row).getByRole("spinbutton", { name: "容量" });
    expect(input).toHaveValue(10);
    fireEvent.change(input, { target: { value: "12" } });
    expect(within(row).queryByTestId("capacity-full-warning")).toBeNull();
    fireEvent.click(within(row).getByRole("button", { name: "保存" }));
    await waitFor(() => expect(mockedSet).toHaveBeenCalledWith("SUB_GATE", 12));
    expect(await screen.findByTestId("capacity-saved")).toHaveTextContent("SUB_GATE 容量已保存");
    expect(screen.getByTestId("capacity-saved")).not.toHaveTextContent("已满");
  });

  it("warns ■ 已满 under the row while editing at or below occupancy, and says so after saving", async () => {
    mockedSet.mockResolvedValue({ data: { ...REALMS[3], capacity: 1, held: 3, is_full: true } });
    renderPage();
    const row = await editRow("SUB_GATE");
    fireEvent.change(within(row).getByRole("spinbutton"), { target: { value: "1" } });
    expect(screen.getByTestId("capacity-full-warning")).toHaveTextContent("■ 已满:在押 3。谁都不挪");
    expect(screen.queryByTestId("capacity-near-warning")).toBeNull();
    fireEvent.click(within(row).getByRole("button", { name: "保存" }));
    expect(await screen.findByTestId("capacity-saved")).toHaveTextContent("已满(3 / 1)");
  });

  it("says nothing under the row for a comfortable number, but always shows the keys", async () => {
    renderPage();
    const row = await editRow("SUB_GATE");
    fireEvent.change(within(row).getByRole("spinbutton"), { target: { value: "4" } });
    expect(screen.queryByTestId("capacity-near-warning")).toBeNull();
    expect(screen.queryByTestId("capacity-full-warning")).toBeNull();
    expect(screen.getByText("Enter 保存 · Esc 取消")).toBeInTheDocument();
  });

  it("puts the near-full percentage in words", async () => {
    mockedOcc.mockResolvedValue({ data: [{ realm_id: "SUB_GATE", count: 9 }] });
    renderPage();
    const tree = await screen.findByTestId("realm-tree");
    await waitFor(() => expect(within(tree.querySelector('[data-realm-row="SUB_GATE"]') as HTMLElement).getByTestId("realm-held")).toHaveTextContent("9 / 10"));
    const row = await editRow("SUB_GATE");
    fireEvent.change(within(row).getByRole("spinbutton"), { target: { value: "10" } });
    expect(screen.getByTestId("capacity-near-warning")).toHaveTextContent("◐ 将满：在押 9，改为 10 后占用 90%。");
    fireEvent.change(within(row).getByRole("spinbutton"), { target: { value: "11" } });
    expect(screen.queryByTestId("capacity-near-warning")).toBeNull();
  });

  it("saves on Enter and cancels on Esc", async () => {
    mockedSet.mockResolvedValue({ data: { ...REALMS[3], capacity: 12, held: 3, is_full: false } });
    renderPage();
    let row = await editRow("SUB_GATE");
    fireEvent.keyDown(within(row).getByRole("spinbutton"), { key: "Escape" });
    expect(within(row).queryByRole("spinbutton")).toBeNull();
    expect(mockedSet).not.toHaveBeenCalled();
    row = await editRow("SUB_GATE");
    fireEvent.change(within(row).getByRole("spinbutton"), { target: { value: "12" } });
    fireEvent.keyDown(within(row).getByRole("spinbutton"), { key: "Enter" });
    await waitFor(() => expect(mockedSet).toHaveBeenCalledWith("SUB_GATE", 12));
  });

  it("on the phone, a card opens the bottom sheet to edit, and saves only the capacity", async () => {
    mockedSet.mockResolvedValue({ data: { ...REALMS[3], capacity: 7, held: 3, is_full: false } });
    renderPage();
    const cards = await screen.findByTestId("realm-cards");
    fireEvent.click(within(cards).getByRole("button", { name: "改 SUB_GATE 的容量" }));
    const dialog = await screen.findByRole("dialog");
    // The table row stays read-only: the sheet is the editor.
    expect(within(screen.getByTestId("realm-tree")).queryByRole("spinbutton")).toBeNull();
    fireEvent.change(within(dialog).getByRole("spinbutton", { name: "容量" }), { target: { value: "7" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "保存" }));
    await waitFor(() => expect(mockedSet).toHaveBeenCalledTimes(1));
    expect(mockedSet.mock.calls[0][1]).toBe(7);
  });

  it("blank means not recorded (null); cancel sends nothing", async () => {
    mockedSet.mockResolvedValue({ data: { ...REALMS[3], capacity: null, held: 3, is_full: false } });
    renderPage();
    let row = await editRow("SUB_GATE");
    fireEvent.click(within(row).getByRole("button", { name: "取消" }));
    expect(within(row).queryByRole("spinbutton")).toBeNull();
    expect(mockedSet).not.toHaveBeenCalled();

    row = await editRow("SUB_GATE");
    fireEvent.change(within(row).getByRole("spinbutton"), { target: { value: "" } });
    fireEvent.click(within(row).getByRole("button", { name: "保存" }));
    await waitFor(() => expect(mockedSet).toHaveBeenCalledWith("SUB_GATE", null));
  });

  it("refuses a value that is not a whole non-negative number", async () => {
    renderPage();
    const row = await editRow("SUB_GATE");
    fireEvent.change(within(row).getByRole("spinbutton"), { target: { value: "-2" } });
    expect(within(row).getByRole("button", { name: "保存" })).toBeDisabled();
  });
});

it("reports a failed realm list as an error, not as 'no realms'", async () => {
  mockedList.mockRejectedValue(new Error("500"));
  renderPage();
  expect(await screen.findByRole("alert")).toBeInTheDocument();
  expect(screen.queryByText("还没有登记任何殿域。")).toBeNull();
});
