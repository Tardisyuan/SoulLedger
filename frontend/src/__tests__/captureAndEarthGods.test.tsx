/**
 * Design 第五十七批 S-3 / S-4 / S-6 / S-7:勾魂卡的三步与原地撤销、待发勾魂牒的「超 N 天」、
 * 办转世选了人道才出现的「下一世部洲」、以土地公名义登记死亡的请求与失败那一句。
 */
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { Disposition, Soul } from "@soulledger/core/api";
import { tZh } from "./support/zhBundle";

const mockShowToast = jest.fn();
const mockList = jest.fn();
const mockDue = jest.fn();
const mockIssue = jest.fn();
const mockCancel = jest.fn();
const mockCapture = jest.fn();
const mockTudiList = jest.fn();
const mockRegister = jest.fn();

jest.mock("@/src/contexts/I18nContext", () => ({
  ...jest.requireActual("@/src/contexts/I18nContext"),
  useI18n: () => ({
    t: tZh,
    tf: (_k: string, f: string) => f,
    locale: "zh-Hans",
    hydrated: true,
    formatDate: (v: string) => v.slice(0, 10),
    formatDateTime: (v: string) => v.slice(0, 16).replace("T", " "),
  }),
}));
jest.mock("@/src/contexts/ToastContext", () => ({ useToast: () => ({ showToast: mockShowToast }) }));
jest.mock("@/src/components/ui/Toast", () => ({
  ...jest.requireActual("@/src/components/ui/Toast"),
  showToast: (...a: unknown[]) => mockShowToast(...a),
}));
jest.mock("@/src/contexts/TenantContext", () => ({
  useTenant: () => ({
    user: { id: 1, username: "judge", role: "JUDGE", tenant: null, permissions: ["reincarnation.reborn", "soul.die"] },
  }),
}));
jest.mock("@soulledger/core/api", () => ({
  ...jest.requireActual("@soulledger/core/api"),
  captureWarrantsApi: {
    list: (...a: unknown[]) => mockList(...a),
    due: (...a: unknown[]) => mockDue(...a),
    issue: (...a: unknown[]) => mockIssue(...a),
    cancel: (...a: unknown[]) => mockCancel(...a),
    capture: (...a: unknown[]) => mockCapture(...a),
    handOver: jest.fn(),
  },
  tudiGodsApi: {
    list: (...a: unknown[]) => mockTudiList(...a),
    registerDeath: (...a: unknown[]) => mockRegister(...a),
  },
}));

import { CapturePanel, daysOverdue } from "@/src/components/souls/detail/CapturePanel";
import { SoulActionsCard } from "@/src/components/souls/detail/SoulActionsCard";
import { TudiRegisterDeathDialog } from "@/src/components/tudi-gods/TudiRegisterDeathDialog";

const wrap = (node: React.ReactNode) =>
  render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>{node}</QueryClientProvider>);

const SOUL = {
  id: "s1",
  name: "钱谦益",
  civilization: "CHINESE",
  current_state: "ALIVE",
  fated_death_date: { year: 1664, month: 6, day: 17 },
  birth_continent: "NANZHAN",
} as unknown as Soul;

const warrant = (status: string, extra: Record<string, unknown> = {}) => ({
  id: `w-${status}`, soul: "s1", status, escort: "NIUTOU_MAMIAN", city_god: "cg1", city_god_name: "常熟县城隍",
  issued_at: "2026-10-27T22:00:00Z", captured_at: status === "ISSUED" ? null : "2026-10-27T22:10:00Z",
  handed_over_at: status === "HANDED_OVER" ? "2026-10-28T08:00:00Z" : null, judgment: null, cancel_reason: "", ...extra,
});

beforeEach(() => {
  jest.clearAllMocks();
  mockList.mockResolvedValue({ data: { results: [], count: 0, next: null, previous: null } });
  mockDue.mockResolvedValue({ data: [] });
});

describe("daysOverdue", () => {
  const now = new Date(2026, 9, 28, 15, 0);
  it("按本地日期数天;当天与将来是 0;认不出的日期是 0", () => {
    expect(daysOverdue("2026-10-26", now)).toBe(2);
    expect(daysOverdue("2026-10-28", now)).toBe(0);
    expect(daysOverdue("2026-11-01", now)).toBe(0);
    expect(daysOverdue("1664-06-17", now)).toBeGreaterThan(100_000);
    expect(daysOverdue("-005-01-01", now)).toBe(0);
  });
});

describe("勾魂卡(S-4)", () => {
  it("阳寿已到:▪ 发勾魂牒 → □ 拘到 → □ 交接城隍;鬼差默认选建议那位并写出规则;发的是那一位", async () => {
    mockDue.mockResolvedValue({ data: [{ id: "s1", suggested_escort: "NIUTOU_MAMIAN" }] });
    mockIssue.mockResolvedValue({ data: {} });
    wrap(<CapturePanel soul={SOUL} canAct />);
    expect(await screen.findByTestId("soul-capture-status")).toHaveTextContent("阳寿已到 · 1664-06-17");
    expect(screen.getByTestId("capture-steps")).toHaveTextContent("▪ 发勾魂牒→□ 拘到→□ 交接城隍");
    const select = (await screen.findByLabelText("鬼差")) as HTMLSelectElement;
    await waitFor(() => expect(select.value).toBe("NIUTOU_MAMIAN"));
    expect(select.selectedOptions[0].textContent).toBe("牛头马面 · 按功过建议");
    expect(screen.getByTestId("capture-escort-hint")).toHaveTextContent("功多于过，建议黑白无常；过多于功，建议牛头马面。");
    fireEvent.click(screen.getByRole("button", { name: "发勾魂牒" }));
    await waitFor(() => expect(mockIssue).toHaveBeenCalledWith({ soul: "s1", escort: "NIUTOU_MAMIAN" }));
  });

  it("已拘到:主按钮只有「交接城隍」;「撤销…」原地展开,理由必填,空着不发", async () => {
    mockList.mockResolvedValue({ data: { results: [warrant("CAPTURED")] } });
    mockCancel.mockResolvedValue({ data: {} });
    wrap(<CapturePanel soul={{ ...SOUL, current_state: "ALIVE" } as Soul} canAct />);
    expect(await screen.findByRole("button", { name: "交接城隍" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "拘到" })).toBeNull();
    expect(screen.getByTestId("capture-steps")).toHaveTextContent("■ 发勾魂牒→■ 拘到→▪ 交接城隍");
    fireEvent.click(screen.getByRole("button", { name: "撤销…" }));
    expect(screen.getByTestId("capture-cancel-form")).toBeInTheDocument();
    expect(screen.queryByRole("dialog")).toBeNull(); // 不叠弹层
    fireEvent.click(screen.getByRole("button", { name: "撤销勾魂牒" }));
    expect(await screen.findByText("请写明撤销理由")).toBeInTheDocument();
    expect(mockCancel).not.toHaveBeenCalled();
    fireEvent.change(screen.getByLabelText(/撤销理由/), { target: { value: "查无此人" } });
    fireEvent.click(screen.getByRole("button", { name: "撤销勾魂牒" }));
    await waitFor(() => expect(mockCancel).toHaveBeenCalledWith("w-CAPTURED", "查无此人"));
  });

  it("已交接:三步都过了,一行「日期 交某城隍 · 去初审 →」,链接按这位城隍筛好", async () => {
    mockList.mockResolvedValue({ data: { results: [warrant("HANDED_OVER")] } });
    wrap(<CapturePanel soul={{ ...SOUL, current_state: "JUDGING" } as Soul} canAct />);
    const line = await screen.findByTestId("capture-handed");
    expect(line).toHaveTextContent("2026-10-28 交常熟县城隍 · 去初审 →");
    expect(screen.getByRole("link", { name: "去初审 →" })).toHaveAttribute("href", "/city-god-cases?city_god=cg1");
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("已撤销:灰字一行理由;阳寿已到就能重新发牒", async () => {
    mockList.mockResolvedValue({ data: { results: [warrant("CANCELLED", { cancel_reason: "查无此人" })] } });
    wrap(<CapturePanel soul={SOUL} canAct />);
    expect(await screen.findByTestId("capture-cancelled")).toHaveTextContent("已撤销 · 查无此人");
    expect(await screen.findByRole("button", { name: "发勾魂牒" })).toBeInTheDocument();
  });
});

describe("下一世部洲(S-3)", () => {
  const disp = [{ id: "d1", is_executed: false, realm_name: "人间" } as unknown as Disposition];
  const card = (rebirthForm: "HUMAN" | "ANIMAL", soul: Partial<Soul> = {}, onChange = jest.fn()) =>
    wrap(
      <SoulActionsCard
        soul={{ ...SOUL, current_state: "DISPOSED", ...soul } as Soul}
        loading={false}
        actionLoading=""
        dispositions={disp}
        reincarnations={[]}
        rebirthForm={rebirthForm}
        nextContinent=""
        onNextContinentChange={onChange}
        onRebirthFormChange={jest.fn()}
        onDie={jest.fn()}
        onStartJudgment={jest.fn()}
        onReincarnate={jest.fn()}
      />
    );

  it("人道才出现,选填,默认「本世部洲 · 同本世」;选别的洲交给页面", () => {
    const onChange = jest.fn();
    card("HUMAN", {}, onChange);
    const select = screen.getByLabelText(/下一世部洲 · 选填/) as HTMLSelectElement;
    expect(select.selectedOptions[0].textContent).toBe("南瞻部洲 · 同本世");
    expect(Array.from(select.options).map((o) => o.value)).toEqual(["", "DONGSHENG", "XINIU", "BEIJULU"]);
    expect(screen.getByText("不选就沿用本世的部洲。")).toBeInTheDocument();
    fireEvent.change(select, { target: { value: "BEIJULU" } });
    expect(onChange).toHaveBeenCalledWith("BEIJULU");
  });

  it("本世部洲未登记写「不指定」;别的道不出现", () => {
    card("HUMAN", { birth_continent: "" } as Partial<Soul>);
    expect((screen.getByLabelText(/下一世部洲/) as HTMLSelectElement).selectedOptions[0].textContent).toBe("不指定");
  });

  it("畜生道没有这一项", () => {
    card("ANIMAL");
    expect(screen.queryByLabelText(/下一世部洲/)).toBeNull();
  });
});

describe("以土地公名义登记死亡(S-6)", () => {
  const TUDI = { id: "t1", name: "虞山土地", city_god: "cg1", city_god_name: "常熟县城隍", regions: [], officers: [] };

  it("从灵魂详情来:选土地公,标题下写土地公 · 上级城隍,发的是一条带幂等键的登记;「土地公所报」进 cause_of_death", async () => {
    mockTudiList.mockResolvedValue({ data: { results: [TUDI] } });
    mockRegister.mockResolvedValue({ data: { status: "PROCESSED", error_code: "" } });
    const onClose = jest.fn();
    wrap(<TudiRegisterDeathDialog soul={{ id: "s1", name: "钱谦益" }} onClose={onClose} />);
    await screen.findByRole("option", { name: "虞山土地" });
    fireEvent.change(screen.getByRole("combobox"), { target: { value: "t1" } });
    expect(screen.getByTestId("tudi-register-subtitle")).toHaveTextContent("虞山土地 · 常熟县城隍");
    expect(screen.getByText("登记后发给常熟县城隍初审，并进「待发勾魂牒」名单。")).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText(/死亡日期/), { target: { value: "1664-06-17" } });
    fireEvent.change(screen.getByLabelText(/死于何处/), { target: { value: "常熟 · 虞山" } });
    fireEvent.change(screen.getByLabelText(/土地公所报/), { target: { value: "病故于虞山" } });
    fireEvent.click(screen.getByTestId("tudi-register-submit"));
    await waitFor(() => expect(mockRegister).toHaveBeenCalled());
    const [id, body] = mockRegister.mock.calls[0];
    expect(id).toBe("t1");
    expect(body).toMatchObject({ soul_lookup: { soul_id: "s1" }, death_date: "1664-06-17", death_location: "常熟 · 虞山", cause_of_death: "病故于虞山" });
    expect(typeof body.idempotency_key).toBe("string");
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(mockShowToast).toHaveBeenCalledWith("已登记钱谦益的死亡", "success");
  });

  it("回来的登记是 FAILED:弹层不关,写出那个码的中文,不写码", async () => {
    mockRegister.mockResolvedValue({ data: { status: "FAILED", error_code: "SOUL_NOT_ALIVE" } });
    const onClose = jest.fn();
    wrap(<TudiRegisterDeathDialog soul={{ id: "s1", name: "钱谦益" }} tudi={TUDI as never} onClose={onClose} />);
    fireEvent.click(screen.getByTestId("tudi-register-submit"));
    const refusal = await screen.findByTestId("tudi-register-refusal");
    expect(refusal).toHaveTextContent("没有登记成功：灵魂已不在阳世");
    expect(refusal).not.toHaveTextContent("SOUL_NOT_ALIVE");
    expect(onClose).not.toHaveBeenCalled();
  });
});
