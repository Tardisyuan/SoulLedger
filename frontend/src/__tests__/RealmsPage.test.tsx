/**
 * app/realms/page.tsx —— 文明切换、左侧拓扑(与详情行程条同一个组件)、右侧树表
 * (在押 / 容量 / 永恒;满额用警示色并写「已满」)、杜阿特退化为「示意」;
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
  R("EG_DUAT_ENTRY", "EGYPTIAN", { is_judgment_hall: false }),
  R("EG_HALL_TWO_TRUTHS", "EGYPTIAN", { is_judgment_hall: true }),
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

it("nests children under their parent in the tree table", async () => {
  renderPage();
  const tree = await screen.findByTestId("realm-tree");
  const rows = Array.from(tree.querySelectorAll("[data-realm-row]"));
  const i = rows.findIndex((r) => r.getAttribute("data-realm-row") === "DY_COURT_05_YANLUO");
  expect(rows[i + 1].getAttribute("data-realm-row")).toBe("SUB_GATE");
  expect(rows[i + 1].getAttribute("data-depth")).toBe("1");
  expect(rows[i + 1]).toHaveTextContent("门");
});

it("marks a realm at capacity in the warning colour AND in words; one under capacity in neither", async () => {
  renderPage();
  const tree = await screen.findByTestId("realm-tree");
  const full = tree.querySelector('[data-realm-row="DY_00_PURGATORY"]')!;
  const held = within(full as HTMLElement).getByTestId("realm-held");
  expect(held).toHaveTextContent("2 / 2");
  expect(held).toHaveTextContent("已满");
  expect(held.className).toContain("--color-warning");
  const gate = within(tree.querySelector('[data-realm-row="SUB_GATE"]') as HTMLElement).getByTestId("realm-held");
  expect(gate).toHaveTextContent("3 / 10");
  expect(gate).not.toHaveTextContent("已满");
  expect(gate.className).not.toContain("--color-warning");
  // 永恒
  expect(tree.querySelector('[data-realm-row="DY_01_HEAVEN"]')).toHaveTextContent("是");
});

it("falls back to the labelled schematic line for the Duat, whose rows carry no hour", async () => {
  renderPage();
  await screen.findByTestId("realm-topology");
  fireEvent.click(screen.getByRole("button", { name: /杜阿特/ }));
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

  it("warns 已满 while editing below occupancy, and says so after saving", async () => {
    mockedSet.mockResolvedValue({ data: { ...REALMS[3], capacity: 1, held: 3, is_full: true } });
    renderPage();
    const row = await editRow("SUB_GATE");
    fireEvent.change(within(row).getByRole("spinbutton"), { target: { value: "1" } });
    expect(within(row).getByTestId("capacity-full-warning")).toHaveTextContent("谁都不挪");
    fireEvent.click(within(row).getByRole("button", { name: "保存" }));
    expect(await screen.findByTestId("capacity-saved")).toHaveTextContent("已满(3 / 1)");
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
