/**
 * 受刑计划的三处 Web 界面(docs/ARCHITECTURE-sentence-plan.md §9 阶段 4):
 * 「受刑请求」收件箱、灵魂详情的计划面板、联审详情的各站。
 *
 * 与 SoulInboxPage.test.tsx 同一套:`RequirePermission` / `usePermissions` 真跑,`useTenant`
 * 打桩(角色、租户、码名由各条测试给),文案是真的 zh-Hans 包,只替换 API 模块。
 * 断言「看得到」的地方都同时断言「别人看不到」—— 按钮出现在错的人面前,正是要守的缺陷。
 */
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { ReactNode } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import SentenceRequestsPage from "@/app/sentence-requests/page";
import { SentencePlanCard } from "@/src/components/sentence-plan/SentencePlanCard";
import { CrossJudgmentStops } from "@/src/components/cross-judgments/CrossJudgmentStops";
import type { CrossTenantJudgment } from "@soulledger/core/api";
import { tZh } from "./support/zhBundle";

jest.mock("@soulledger/core/api/sentence-plans", () => ({
  sentencePlansApi: { list: jest.fn(), decide: jest.fn(), withdraw: jest.fn(), cancel: jest.fn() },
}));
const { sentencePlansApi: planApi } = jest.requireMock("@soulledger/core/api/sentence-plans") as {
  sentencePlansApi: Record<string, jest.Mock>;
};

jest.mock("@soulledger/core/api", () => ({
  ...jest.requireActual("@soulledger/core/api"),
  crossTenantJudgmentsApi: { sentence: jest.fn(), order: jest.fn() },
  realmsApi: { list: jest.fn() },
}));
const { crossTenantJudgmentsApi: cjApi, realmsApi } = jest.requireMock("@soulledger/core/api") as {
  crossTenantJudgmentsApi: Record<string, jest.Mock>;
  realmsApi: Record<string, jest.Mock>;
};

type MockUser = { id: number; username: string; role: string; permissions: string[]; tenant: { code: string } };
let mockUser: MockUser | null = null;
jest.mock("@/src/contexts/TenantContext", () => ({ useTenant: () => ({ user: mockUser }) }));

const mockI18n = { t: tZh, formatDateTime: (v: string) => `dt(${v})`, locale: "zh-Hans", hydrated: true };
jest.mock("@/src/contexts/I18nContext", () => ({
  ...jest.requireActual("@/src/contexts/I18nContext"),
  useI18n: () => mockI18n,
}));

const mockShowToast = jest.fn();
jest.mock("@/src/contexts/ToastContext", () => ({ useToast: () => ({ showToast: mockShowToast }) }));

const as = (role: string, tenant: string, ...permissions: string[]) =>
  (mockUser = { id: 2, username: "op", role, permissions, tenant: { code: tenant } });
const JUDGE = ["judgment.read", "judgment.execute", "cross_judgment.read", "cross_judgment.create"];

const node = (order: number, tenant_code: string, status: string, over: Record<string, unknown> = {}) => ({
  id: `n${order}`, order, tenant_code, is_home: order === 1, status, realm_code: "EU_PURGATORY",
  sentence_years: 5, is_eternal: false, memory_reset: "NONE", disposition_id: null, dispatch_record_id: null,
  added_by_judgment_id: null, added_by_request_id: null, removed_by_request_id: null, reason: "",
  activated_at: null, completed_at: null, ...over,
});
const request = (over: Record<string, unknown> = {}) => ({
  id: "r1", from_tenant_code: "EU_HEAVEN_HELL", kind: "AMEND", status: "PENDING",
  changes: { remove: ["n3"] }, requested_by_judgment_id: null, reason: "另案已抵", decision_reason: "",
  decided_at: null, create_time: "2026-09-10T00:00:00Z", ...over,
});
const plan = (over: Record<string, unknown> = {}) => ({
  id: "p1", soul: "s1", soul_name: "张三", tenant: 1, tenant_code: "CN_DIYU", cycle: 0, status: "ACTIVE",
  origin_judgment_id: null, cross_judgment_id: null, completed_at: null, cancel_reason: "",
  nodes: [node(1, "CN_DIYU", "COMPLETED"), node(2, "EG_DUAT", "ACTIVE"), node(3, "EU_HEAVEN_HELL", "PENDING")],
  requests: [request()], create_time: "2026-09-01T00:00:00Z", update_time: "2026-09-10T00:00:00Z", ...over,
});
const page = (results: unknown[]) => ({ data: { count: results.length, next: null, previous: null, results } });
const http = (status: number, data?: unknown) => Object.assign(new Error(`HTTP ${status}`), { response: { status, data } });

function renderWith(ui: React.ReactElement) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  const Wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  return render(ui, { wrapper: Wrapper });
}

beforeEach(() => {
  jest.clearAllMocks();
  planApi.list.mockResolvedValue(page([plan()]));
  planApi.decide.mockResolvedValue({ data: plan() });
  planApi.withdraw.mockResolvedValue({ data: plan() });
  planApi.cancel.mockResolvedValue({ data: plan({ status: "CANCELLED" }) });
});

// ── 收件箱 ────────────────────────────────────────────────────────────────

describe("受刑请求收件箱", () => {
  it("没有 judgment.read 就拒绝整页,也不问接口", () => {
    as("GUARDIAN", "CN_DIYU", "soul.read", "dispatch.read");
    renderWith(<SentenceRequestsPage />);
    expect(screen.getByText(tZh("permission.denied_title"))).toBeInTheDocument();
    expect(planApi.list).not.toHaveBeenCalled();
  });

  it("只列待决定的:按 pending_request=true 取", async () => {
    as("JUDGE", "CN_DIYU", ...JUDGE);
    renderWith(<SentenceRequestsPage />);
    await screen.findByText("张三");
    expect(planApi.list).toHaveBeenCalledWith(expect.objectContaining({ pending_request: true }));
    expect(screen.getByText(tZh("sentence_plan.request_remove", { order: "3" }))).toBeInTheDocument();
    expect(screen.getByText("另案已抵")).toBeInTheDocument();
  });

  it("原属判官批准:有批准 / 驳回、没有撤回;批准带上理由", async () => {
    as("JUDGE", "CN_DIYU", ...JUDGE);
    renderWith(<SentenceRequestsPage />);
    const row = (await screen.findByText("张三")).closest("li") as HTMLElement;
    expect(within(row).queryByRole("button", { name: tZh("sentence_plan.withdraw") })).toBeNull();
    fireEvent.click(within(row).getByRole("button", { name: tZh("sentence_plan.accept") }));
    const dialog = await screen.findByRole("dialog");
    fireEvent.change(within(dialog).getByLabelText(tZh("sentence_plan.decision_reason")), { target: { value: " 同意 " } });
    fireEvent.click(within(dialog).getByRole("button", { name: tZh("sentence_plan.accept") }));
    await waitFor(() => expect(planApi.decide).toHaveBeenCalledWith("p1", "r1", { decision: "ACCEPT", reason: "同意" }));
    await waitFor(() => expect(mockShowToast).toHaveBeenCalledWith(tZh("sentence_plan.accepted"), "success"));
  });

  it("驳回走同一个接口,decision=REJECT", async () => {
    as("JUDGE", "CN_DIYU", ...JUDGE);
    renderWith(<SentenceRequestsPage />);
    const row = (await screen.findByText("张三")).closest("li") as HTMLElement;
    fireEvent.click(within(row).getByRole("button", { name: tZh("sentence_plan.reject") }));
    const dialog = await screen.findByRole("dialog");
    fireEvent.click(within(dialog).getByRole("button", { name: tZh("sentence_plan.reject") }));
    await waitFor(() => expect(planApi.decide).toHaveBeenCalledWith("p1", "r1", { decision: "REJECT", reason: "" }));
  });

  it("提出方只能撤回,不能批准", async () => {
    as("JUDGE", "EU_HEAVEN_HELL", ...JUDGE);
    renderWith(<SentenceRequestsPage />);
    const row = (await screen.findByText("张三")).closest("li") as HTMLElement;
    expect(within(row).queryByRole("button", { name: tZh("sentence_plan.accept") })).toBeNull();
    expect(within(row).queryByRole("button", { name: tZh("sentence_plan.reject") })).toBeNull();
    fireEvent.click(within(row).getByRole("button", { name: tZh("sentence_plan.withdraw") }));
    const dialog = await screen.findByRole("alertdialog");
    fireEvent.click(within(dialog).getByRole("button", { name: tZh("sentence_plan.withdraw") }));
    await waitFor(() => expect(planApi.withdraw).toHaveBeenCalledWith("p1", "r1"));
  });

  it("第三个文明、或没有 judgment.execute:一个按钮都没有", async () => {
    as("JUDGE", "EG_DUAT", ...JUDGE);
    const { unmount } = renderWith(<SentenceRequestsPage />);
    let row = (await screen.findByText("张三")).closest("li") as HTMLElement;
    expect(within(row).queryAllByRole("button")).toHaveLength(0);
    unmount();

    as("MODERATOR", "CN_DIYU", "judgment.read");
    renderWith(<SentenceRequestsPage />);
    row = (await screen.findByText("张三")).closest("li") as HTMLElement;
    expect(within(row).queryAllByRole("button")).toHaveLength(0);
  });

  it("409 open_judgment:说清原因,对话框不关,理由还在", async () => {
    as("JUDGE", "CN_DIYU", ...JUDGE);
    planApi.decide.mockRejectedValue(http(409, { code: "open_judgment", open_judgment_ids: ["j1"] }));
    renderWith(<SentenceRequestsPage />);
    const row = (await screen.findByText("张三")).closest("li") as HTMLElement;
    fireEvent.click(within(row).getByRole("button", { name: tZh("sentence_plan.accept") }));
    const dialog = await screen.findByRole("dialog");
    fireEvent.change(within(dialog).getByLabelText(tZh("sentence_plan.decision_reason")), { target: { value: "同意" } });
    fireEvent.click(within(dialog).getByRole("button", { name: tZh("sentence_plan.accept") }));
    await waitFor(() => expect(mockShowToast).toHaveBeenCalledWith(tZh("sentence_plan.errors.open_judgment"), "error"));
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(within(screen.getByRole("dialog")).getByLabelText(tZh("sentence_plan.decision_reason"))).toHaveValue("同意");
  });

  it("不认识的拒绝码落到通用失败,不把键名印出来", async () => {
    as("JUDGE", "CN_DIYU", ...JUDGE);
    planApi.decide.mockRejectedValue(http(400, { code: "something_new" }));
    renderWith(<SentenceRequestsPage />);
    const row = (await screen.findByText("张三")).closest("li") as HTMLElement;
    fireEvent.click(within(row).getByRole("button", { name: tZh("sentence_plan.accept") }));
    fireEvent.click(within(await screen.findByRole("dialog")).getByRole("button", { name: tZh("sentence_plan.accept") }));
    await waitFor(() => expect(mockShowToast).toHaveBeenCalledWith(tZh("sentence_plan.errors.failed"), "error"));
  });

  it("没有待决定的请求时说清楚", async () => {
    as("JUDGE", "CN_DIYU", ...JUDGE);
    planApi.list.mockResolvedValue(page([]));
    renderWith(<SentenceRequestsPage />);
    expect(await screen.findByText(tZh("sentence_plan.inbox_empty"))).toBeInTheDocument();
  });
});

// ── 计划面板 ──────────────────────────────────────────────────────────────

describe("灵魂详情的受刑计划面板", () => {
  it("列出各站与状态,只把灵魂所在那一站标为当前", async () => {
    as("JUDGE", "CN_DIYU", ...JUDGE);
    renderWith(<SentencePlanCard soulId="s1" />);
    const stops = await screen.findAllByRole("listitem", { current: "step" });
    expect(stops).toHaveLength(1);
    expect(stops[0]).toHaveAttribute("data-node-order", "2");
    expect(within(stops[0]).getByText(tZh("sentence_plan.node_states.ACTIVE"))).toBeInTheDocument();
    expect(planApi.list).toHaveBeenCalledWith(expect.objectContaining({ soul: "s1" }));
    expect(screen.getByText(tZh("sentence_plan.plan_states.ACTIVE"))).toBeInTheDocument();
    expect(screen.getByText(tZh("sentence_plan.node_states.COMPLETED"))).toBeInTheDocument();
    expect(screen.getByText(tZh("sentence_plan.node_states.PENDING"))).toBeInTheDocument();
    // 没有一个状态以原始枚举成员出现在屏幕上。
    for (const raw of ["ACTIVE", "COMPLETED", "PENDING", "AMEND"]) expect(screen.queryByText(raw)).toBeNull();
  });

  it("两站之间(灵魂在原属)没有当前站,并说明", async () => {
    as("JUDGE", "CN_DIYU", ...JUDGE);
    planApi.list.mockResolvedValue(page([plan({ nodes: [node(1, "CN_DIYU", "COMPLETED"), node(2, "EG_DUAT", "PENDING")], requests: [] })]));
    renderWith(<SentencePlanCard soulId="s1" />);
    expect(await screen.findByText(tZh("sentence_plan.between_stops"))).toBeInTheDocument();
    expect(screen.queryAllByRole("listitem", { current: "step" })).toHaveLength(0);
  });

  it("撤销:原属且持有 sentence_plan.cancel 才有按钮;理由必填;带理由调用", async () => {
    as("MODERATOR", "CN_DIYU", "judgment.read", "sentence_plan.cancel");
    renderWith(<SentencePlanCard soulId="s1" />);
    fireEvent.click(await screen.findByRole("button", { name: tZh("sentence_plan.cancel") }));
    const dialog = await screen.findByRole("dialog");
    const confirm = within(dialog).getByRole("button", { name: tZh("sentence_plan.cancel") });
    expect(confirm).toBeDisabled();
    fireEvent.change(within(dialog).getByLabelText(new RegExp(tZh("sentence_plan.cancel_reason").replace(/[()（）]/g, "."))), {
      target: { value: "  赦免  " },
    });
    expect(confirm).toBeEnabled();
    fireEvent.click(confirm);
    await waitFor(() => expect(planApi.cancel).toHaveBeenCalledWith("p1", "赦免"));
  });

  it("执行地、没有码名、计划已结束:都没有撤销按钮", async () => {
    as("MODERATOR", "EG_DUAT", "judgment.read", "sentence_plan.cancel");
    const first = renderWith(<SentencePlanCard soulId="s1" />);
    await screen.findByText("另案已抵");
    expect(screen.queryByRole("button", { name: tZh("sentence_plan.cancel") })).toBeNull();
    first.unmount();

    as("JUDGE", "CN_DIYU", ...JUDGE);
    const second = renderWith(<SentencePlanCard soulId="s1" />);
    await screen.findByText("另案已抵");
    expect(screen.queryByRole("button", { name: tZh("sentence_plan.cancel") })).toBeNull();
    second.unmount();

    as("MODERATOR", "CN_DIYU", "judgment.read", "sentence_plan.cancel", "judgment.execute");
    planApi.list.mockResolvedValue(page([plan({ status: "CANCELLED", cancel_reason: "赦免", requests: [request({ status: "WITHDRAWN" })] })]));
    renderWith(<SentencePlanCard soulId="s1" />);
    expect(await screen.findByText(tZh("sentence_plan.plan_states.CANCELLED"))).toBeInTheDocument();
    expect(screen.getByText(tZh("sentence_plan.cancel_reason_shown", { reason: "赦免" }))).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: tZh("sentence_plan.cancel") })).toBeNull();
    expect(screen.queryByRole("button", { name: tZh("sentence_plan.withdraw") })).toBeNull();
  });

  it("没有计划:说没有", async () => {
    as("JUDGE", "CN_DIYU", ...JUDGE);
    planApi.list.mockResolvedValue(page([]));
    renderWith(<SentencePlanCard soulId="s1" />);
    expect(await screen.findByText(tZh("sentence_plan.none"))).toBeInTheDocument();
  });
});

// ── 联审各站 ──────────────────────────────────────────────────────────────

const seat = (id: string, tenant: string, order: number | null, over: Record<string, unknown> = {}) => ({
  id, judgment: "cj1", participant_tenant: 0, participant_tenant_code: tenant, participant_actor: null,
  participant_actor_name: null, role: order === null ? "ADVISOR" : "CO_JUDGE", joined_at: "2026-09-01T00:00:00Z",
  node_order: order, sentence_realm_code: "", sentence_years: null, sentence_is_eternal: false,
  sentence_memory_reset: "", sentence_notes: "", sentence_submitted_at: null, ...over,
});
const bench = (over: Partial<CrossTenantJudgment> = {}): CrossTenantJudgment => ({
  id: "cj1", title: "联审", description: "", initiating_tenant: 1, initiating_tenant_code: "CN_DIYU",
  status: "PROPOSED", concluded_at: null, conclusion_type: null, judgment: "j1", create_time: "", update_time: "",
  participants: [seat("eg", "EG_DUAT", 2), seat("eu", "EU_HEAVEN_HELL", 3), seat("gr", "GR_HADES", null)],
  ...over,
});

describe("联审详情的各站", () => {
  beforeEach(() => {
    realmsApi.list.mockResolvedValue({
      data: { results: [
        { id: "r1", realm_code: "EG_HALL_TWO_TRUTHS", civilization: "EGYPTIAN", is_eternal: false },
        { id: "r2", realm_code: "EG_ANNIHILATION", civilization: "EGYPTIAN", is_eternal: true },
      ], count: 2 },
    });
    cjApi.sentence.mockResolvedValue({ data: bench() });
    cjApi.order.mockResolvedValue({ data: bench() });
  });

  it("第 1 站是原属;顾问不带站;只有本席位的文明看到填写表单", async () => {
    as("JUDGE", "EG_DUAT", ...JUDGE);
    const { container } = renderWith(<CrossJudgmentStops judgment={bench()} />);
    const stops = container.querySelectorAll("li[data-stop]");
    expect([...stops].map((s) => s.getAttribute("data-stop"))).toEqual(["1", "2", "3"]);
    expect(container.querySelector('li[data-participant-id="gr"]')).toBeNull();
    const forms = screen.getAllByRole("form", { name: tZh("sentence_plan.cross.fill_title") });
    expect(forms).toHaveLength(1);
    expect(container.querySelector('li[data-participant-id="eg"]')).toContainElement(forms[0]);
    await waitFor(() => expect(realmsApi.list).toHaveBeenCalledWith({ civilization: "EGYPTIAN" }));
  });

  it("填写:本文明界域,刑期留空即未记录(null)", async () => {
    as("JUDGE", "EG_DUAT", ...JUDGE);
    renderWith(<CrossJudgmentStops judgment={bench()} />);
    const form = screen.getByRole("form", { name: tZh("sentence_plan.cross.fill_title") });
    const submit = within(form).getByRole("button", { name: tZh("sentence_plan.cross.submit") });
    expect(submit).toBeDisabled();
    await screen.findByRole("option", { name: "真理大厅" });
    fireEvent.change(within(form).getByLabelText(tZh("sentence_plan.cross.realm")), { target: { value: "EG_HALL_TWO_TRUTHS" } });
    fireEvent.click(submit);
    await waitFor(() =>
      expect(cjApi.sentence).toHaveBeenCalledWith("cj1", {
        participant: "eg", realm_code: "EG_HALL_TWO_TRUTHS", sentence_years: null, notes: "",
      })
    );
  });

  it("填写:刑期不是非负整数就不让提交", async () => {
    as("JUDGE", "EG_DUAT", ...JUDGE);
    renderWith(<CrossJudgmentStops judgment={bench()} />);
    const form = screen.getByRole("form", { name: tZh("sentence_plan.cross.fill_title") });
    await screen.findByRole("option", { name: "真理大厅" });
    fireEvent.change(within(form).getByLabelText(tZh("sentence_plan.cross.realm")), { target: { value: "EG_HALL_TWO_TRUTHS" } });
    fireEvent.change(within(form).getByLabelText(tZh("sentence_plan.cross.years")), { target: { value: "-3" } });
    expect(within(form).getByRole("button", { name: tZh("sentence_plan.cross.submit") })).toBeDisabled();
    expect(within(form).getByText(tZh("sentence_plan.cross.years_invalid"))).toBeInTheDocument();
    fireEvent.change(within(form).getByLabelText(tZh("sentence_plan.cross.years")), { target: { value: "12" } });
    fireEvent.click(within(form).getByRole("button", { name: tZh("sentence_plan.cross.submit") }));
    await waitFor(() => expect(cjApi.sentence).toHaveBeenCalledWith("cj1", expect.objectContaining({ sentence_years: 12 })));
  });

  it("选了永久界域:提示只能排最后", async () => {
    as("JUDGE", "EG_DUAT", ...JUDGE);
    renderWith(<CrossJudgmentStops judgment={bench()} />);
    const form = screen.getByRole("form", { name: tZh("sentence_plan.cross.fill_title") });
    await screen.findByRole("option", { name: "湮灭" });
    expect(within(form).queryByText(tZh("sentence_plan.cross.eternal_hint"))).toBeNull();
    fireEvent.change(within(form).getByLabelText(tZh("sentence_plan.cross.realm")), { target: { value: "EG_ANNIHILATION" } });
    expect(within(form).getByText(tZh("sentence_plan.cross.eternal_hint"))).toBeInTheDocument();
  });

  it("发起方重排:下移再保存,按新顺序提交全部带节点的席位", async () => {
    as("JUDGE", "CN_DIYU", ...JUDGE);
    renderWith(<CrossJudgmentStops judgment={bench()} />);
    expect(screen.queryAllByRole("form")).toHaveLength(0);
    fireEvent.click(screen.getByRole("button", { name: tZh("sentence_plan.cross.move_down", { order: "2" }) }));
    fireEvent.click(screen.getByRole("button", { name: tZh("sentence_plan.cross.save_order") }));
    await waitFor(() => expect(cjApi.order).toHaveBeenCalledWith("cj1", ["eu", "eg"]));
  });

  it("永久刑期被挪离最后:警告,且不让保存", () => {
    as("JUDGE", "CN_DIYU", ...JUDGE);
    const eternal = { sentence_submitted_at: "2026-09-02T00:00:00Z", sentence_is_eternal: true, sentence_realm_code: "EU_HELL_9TH" };
    renderWith(<CrossJudgmentStops judgment={bench({ participants: [seat("eg", "EG_DUAT", 2), seat("eu", "EU_HEAVEN_HELL", 3, eternal)] })} />);
    expect(screen.queryByRole("alert")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: tZh("sentence_plan.cross.move_up", { order: "3" }) }));
    expect(screen.getByRole("alert")).toHaveTextContent(tZh("sentence_plan.cross.eternal_not_last"));
    expect(screen.getByRole("button", { name: tZh("sentence_plan.cross.save_order") })).toBeDisabled();
  });

  it("非发起方、或已开庭:没有重排按钮", () => {
    as("JUDGE", "EG_DUAT", ...JUDGE);
    const first = renderWith(<CrossJudgmentStops judgment={bench()} />);
    expect(screen.queryByRole("button", { name: tZh("sentence_plan.cross.move_down", { order: "2" }) })).toBeNull();
    first.unmount();
    as("JUDGE", "CN_DIYU", ...JUDGE);
    renderWith(<CrossJudgmentStops judgment={bench({ status: "ACTIVE" })} />);
    expect(screen.queryByRole("button", { name: tZh("sentence_plan.cross.move_down", { order: "2" }) })).toBeNull();
  });

  it("没有 cross_judgment.create 或联审已结束:不给填写表单", () => {
    as("VIEWER", "EG_DUAT", "cross_judgment.read");
    const first = renderWith(<CrossJudgmentStops judgment={bench()} />);
    expect(screen.queryAllByRole("form")).toHaveLength(0);
    first.unmount();
    as("JUDGE", "EG_DUAT", ...JUDGE);
    renderWith(<CrossJudgmentStops judgment={bench({ status: "CONCLUDED" })} />);
    expect(screen.queryAllByRole("form")).toHaveLength(0);
  });
});
