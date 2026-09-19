/**
 * 受刑计划的三张表单(docs/ARCHITECTURE-sentence-plan.md §4.1、§2.1;N2=(a)、N3=(a)):
 * 计划面板上的「提出请求」(情况 2.1 / 2.2)、原审判上的「开联审」、联审详情的「请文明入席」。
 *
 * 与 SentencePlanPanels.test.tsx 同一套:`usePermissions` 真跑,`useTenant` 打桩,文案是真的 zh-Hans 包,
 * 只替换 API 模块。每个「看得到」都配一个「别人看不到」;每个请求体都整体断言(多发一个字段也算错)。
 */
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { ReactNode } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { SentencePlanCard } from "@/src/components/sentence-plan/SentencePlanCard";
import { OpenCrossJudgment } from "@/src/components/cross-judgments/OpenCrossJudgment";
import { CrossJudgmentSeatForm } from "@/src/components/cross-judgments/CrossJudgmentSeatForm";
import type { CrossTenantJudgment } from "@soulledger/core/api";
import { tZh } from "./support/zhBundle";

jest.mock("@soulledger/core/api/sentence-plans", () => ({
  sentencePlansApi: { list: jest.fn(), file: jest.fn(), decide: jest.fn(), withdraw: jest.fn(), cancel: jest.fn() },
}));
const { sentencePlansApi: planApi } = jest.requireMock("@soulledger/core/api/sentence-plans") as {
  sentencePlansApi: Record<string, jest.Mock>;
};

jest.mock("@soulledger/core/api", () => ({
  ...jest.requireActual("@soulledger/core/api"),
  crossTenantJudgmentsApi: { create: jest.fn(), participate: jest.fn() },
  realmsApi: { list: jest.fn() },
}));
const { crossTenantJudgmentsApi: cjApi, realmsApi } = jest.requireMock("@soulledger/core/api") as {
  crossTenantJudgmentsApi: Record<string, jest.Mock>;
  realmsApi: Record<string, jest.Mock>;
};

const mockPush = jest.fn();
jest.mock("next/navigation", () => ({ useRouter: () => ({ push: mockPush }) }));

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
/** 灵魂在原属受第 1 站;埃及第 2 站、欧洲第 3 站都还没开始 —— 埃及是情况 2.2。 */
const plan = (over: Record<string, unknown> = {}) => ({
  id: "p1", soul: "s1", soul_name: "张三", tenant: 1, tenant_code: "CN_DIYU", cycle: 0, status: "ACTIVE",
  origin_judgment_id: null, cross_judgment_id: null, completed_at: null, cancel_reason: "",
  nodes: [node(1, "CN_DIYU", "ACTIVE"), node(2, "EG_DUAT", "PENDING"), node(3, "EU_HEAVEN_HELL", "PENDING")],
  requests: [], create_time: "2026-09-01T00:00:00Z", update_time: "2026-09-10T00:00:00Z", ...over,
});
const page = (results: unknown[]) => ({ data: { count: results.length, next: null, previous: null, results } });
const http = (status: number, data?: unknown) => Object.assign(new Error(`HTTP ${status}`), { response: { status, data } });

function renderWith(ui: React.ReactElement) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  const Wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  return render(ui, { wrapper: Wrapper });
}

const FILE = () => tZh("sentence_plan.file.open");

beforeEach(() => {
  jest.clearAllMocks();
  planApi.list.mockResolvedValue(page([plan()]));
  planApi.file.mockResolvedValue({ data: {} });
  realmsApi.list.mockResolvedValue({
    data: { results: [{ realm_code: "EG_AARU", is_eternal: false }, { realm_code: "EG_ANNIHILATION", is_eternal: true }] },
  });
});

// ── 提出请求 ──────────────────────────────────────────────────────────────

describe("计划面板:提出请求(情况 2.1 / 2.2)", () => {
  async function openForm() {
    renderWith(<SentencePlanCard soulId="s1" />);
    fireEvent.click(await screen.findByRole("button", { name: FILE() }));
    return screen.findByRole("dialog");
  }

  it("执行地判官看得到;原属判官、没有 judgment.execute 的都看不到", async () => {
    as("JUDGE", "EG_DUAT", ...JUDGE);
    const { unmount } = renderWith(<SentencePlanCard soulId="s1" />);
    expect(await screen.findByRole("button", { name: FILE() })).toBeInTheDocument();
    unmount();

    // 原属是决定方:既没有按钮,也没有「灵魂就在本文明」那句(灵魂此刻正在原属受第 1 站)。
    as("JUDGE", "CN_DIYU", ...JUDGE);
    const home = renderWith(<SentencePlanCard soulId="s1" />);
    await screen.findByText(tZh("sentence_plan.stop", { order: "3" }));
    expect(screen.queryByRole("button", { name: FILE() })).toBeNull();
    expect(screen.queryByText(tZh("sentence_plan.file.soul_is_here"))).toBeNull();
    home.unmount();

    as("GUARDIAN", "EG_DUAT", "judgment.read");
    renderWith(<SentencePlanCard soulId="s1" />);
    await screen.findByText(tZh("sentence_plan.stop", { order: "3" }));
    expect(screen.queryByRole("button", { name: FILE() })).toBeNull();
  });

  it.each([
    ["已有待决定的请求", { requests: [{ id: "r1", from_tenant_code: "EU_HEAVEN_HELL", kind: "AMEND", status: "PENDING", changes: {}, requested_by_judgment_id: null, reason: "", decision_reason: "", decided_at: null, create_time: "2026-09-10T00:00:00Z" }] }],
    ["计划挂在永久刑期上", { status: "HELD" }],
    ["计划已完成", { status: "COMPLETED" }],
  ])("%s:不给按钮", async (_label, over) => {
    as("JUDGE", "EG_DUAT", ...JUDGE);
    planApi.list.mockResolvedValue(page([plan(over)]));
    renderWith(<SentencePlanCard soulId="s1" />);
    await screen.findByText(tZh("sentence_plan.stop", { order: "3" }));
    expect(screen.queryByRole("button", { name: FILE() })).toBeNull();
  });

  it("灵魂此刻就在本文明:不给按钮,告诉他开加减项审判(情况 1)", async () => {
    as("JUDGE", "EG_DUAT", ...JUDGE);
    planApi.list.mockResolvedValue(page([plan({
      nodes: [node(1, "CN_DIYU", "COMPLETED"), node(2, "EG_DUAT", "ACTIVE"), node(3, "EU_HEAVEN_HELL", "PENDING")],
    })]));
    renderWith(<SentencePlanCard soulId="s1" />);
    expect(await screen.findByText(tZh("sentence_plan.file.soul_is_here"))).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: FILE() })).toBeNull();
  });

  it("加减项:只列本文明的界域、只能减未开始的站;请求体逐字", async () => {
    as("JUDGE", "EG_DUAT", ...JUDGE);
    const dialog = await openForm();
    const submit = within(dialog).getByRole("button", { name: tZh("sentence_plan.file.submit") });
    expect(submit).toBeDisabled();

    // 减:第 1 站在受刑中,不可减;第 2、3 站未开始。
    const boxes = within(dialog).getAllByRole("checkbox");
    expect(boxes).toHaveLength(2);
    fireEvent.click(boxes[1]);

    fireEvent.click(within(dialog).getByRole("button", { name: tZh("sentence_plan.file.add_stop") }));
    await waitFor(() => expect(realmsApi.list).toHaveBeenCalledWith({ civilization: "EGYPTIAN" }));
    const realm = within(dialog).getByLabelText(tZh("sentence_plan.cross.realm"));
    await within(realm).findByRole("option", { name: "芦苇原" });
    fireEvent.change(realm, { target: { value: "EG_AARU" } });
    const years = within(dialog).getByLabelText(tZh("sentence_plan.cross.years"), { exact: false });
    fireEvent.change(years, { target: { value: "x" } });
    expect(submit).toBeDisabled();
    fireEvent.change(years, { target: { value: "7" } });
    const reasons = within(dialog).getAllByLabelText(tZh("sentence_plan.file.reason"));
    fireEvent.change(reasons[0], { target: { value: "补一站" } });
    fireEvent.change(reasons[1], { target: { value: "另案" } });
    fireEvent.click(submit);

    await waitFor(() => expect(planApi.file).toHaveBeenCalledTimes(1));
    expect(planApi.file).toHaveBeenCalledWith("p1", {
      kind: "AMEND",
      changes: { add: [{ realm_code: "EG_AARU", sentence_years: 7, reason: "补一站" }], remove: ["n3"] },
      reason: "另案",
    });
    await waitFor(() => expect(mockShowToast).toHaveBeenCalledWith(tZh("sentence_plan.file.submitted"), "success"));
  });

  it("永久界域给出提示;留空刑期发 null", async () => {
    as("JUDGE", "EG_DUAT", ...JUDGE);
    const dialog = await openForm();
    fireEvent.click(within(dialog).getByRole("button", { name: tZh("sentence_plan.file.add_stop") }));
    const realm = within(dialog).getByLabelText(tZh("sentence_plan.cross.realm"));
    await within(realm).findByRole("option", { name: "湮灭" });
    expect(within(dialog).queryByText(tZh("sentence_plan.cross.eternal_hint"))).toBeNull();
    fireEvent.change(realm, { target: { value: "EG_ANNIHILATION" } });
    expect(within(dialog).getByText(tZh("sentence_plan.cross.eternal_hint"))).toBeInTheDocument();
    fireEvent.click(within(dialog).getByRole("button", { name: tZh("sentence_plan.file.submit") }));
    await waitFor(() =>
      expect(planApi.file).toHaveBeenCalledWith("p1", {
        kind: "AMEND", changes: { add: [{ realm_code: "EG_ANNIHILATION", sentence_years: null, reason: "" }] }, reason: "",
      })
    );
  });

  it("重开审判:不带改动,理由必填", async () => {
    as("JUDGE", "EG_DUAT", ...JUDGE);
    const dialog = await openForm();
    fireEvent.change(within(dialog).getByLabelText(tZh("sentence_plan.file.kind")), { target: { value: "REOPEN" } });
    expect(within(dialog).queryByRole("checkbox")).toBeNull();
    const submit = within(dialog).getByRole("button", { name: tZh("sentence_plan.file.submit") });
    expect(submit).toBeDisabled();
    fireEvent.change(within(dialog).getByLabelText(tZh("sentence_plan.file.reason_reopen"), { exact: false }), {
      target: { value: "新证据" },
    });
    fireEvent.click(submit);
    await waitFor(() =>
      expect(planApi.file).toHaveBeenCalledWith("p1", { kind: "REOPEN", changes: undefined, reason: "新证据" })
    );
  });

  it("重审中的计划不给重开审判这个选项(409 plan_in_retrial)", async () => {
    as("JUDGE", "EG_DUAT", ...JUDGE);
    planApi.list.mockResolvedValue(page([plan({ status: "RETRIAL" })]));
    const dialog = await openForm();
    const kinds = within(within(dialog).getByLabelText(tZh("sentence_plan.file.kind"))).getAllByRole("option");
    expect(kinds.map((o) => (o as HTMLOptionElement).value)).toEqual(["AMEND"]);
  });

  it("拒绝码翻成对应的话,对话框不关、填的还在", async () => {
    as("JUDGE", "EG_DUAT", ...JUDGE);
    planApi.file.mockRejectedValue(http(400, { error: "Realm …", code: "foreign_realm" }));
    const dialog = await openForm();
    fireEvent.click(within(dialog).getAllByRole("checkbox")[0]);
    fireEvent.click(within(dialog).getByRole("button", { name: tZh("sentence_plan.file.submit") }));
    await waitFor(() => expect(mockShowToast).toHaveBeenCalledWith(tZh("sentence_plan.errors.foreign_realm"), "error"));
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(within(screen.getByRole("dialog")).getAllByRole("checkbox")[0]).toBeChecked();
  });
});

// ── 开联审 ────────────────────────────────────────────────────────────────

describe("原审判上开联审", () => {
  it("挂上这份审判,建好后去联审详情", async () => {
    as("JUDGE", "CN_DIYU", ...JUDGE);
    cjApi.create.mockResolvedValue({ data: { id: "cj9" } });
    renderWith(<OpenCrossJudgment judgmentId="j1" soulName="张三" />);
    fireEvent.click(screen.getByRole("button", { name: tZh("sentence_plan.cross.open") }));
    const dialog = await screen.findByRole("dialog");
    const confirm = within(dialog).getByRole("button", { name: tZh("sentence_plan.cross.open") });
    expect(confirm).toBeDisabled();
    fireEvent.change(within(dialog).getByLabelText(tZh("sentence_plan.cross.title_label"), { exact: false }), {
      target: { value: " 张三联审 " },
    });
    fireEvent.change(within(dialog).getByLabelText(tZh("sentence_plan.cross.description_label"), { exact: false }), {
      target: { value: "定外地各站" },
    });
    fireEvent.click(confirm);
    await waitFor(() =>
      expect(cjApi.create).toHaveBeenCalledWith({ title: "张三联审", description: "定外地各站", judgment: "j1" })
    );
    await waitFor(() => expect(mockPush).toHaveBeenCalledWith("/cross-judgments/cj9"));
  });

  it("服务端的字段错误原样给出(这份审判已有联审)", async () => {
    as("JUDGE", "CN_DIYU", ...JUDGE);
    cjApi.create.mockRejectedValue(http(400, { judgment: ["This judgment already has a cross-tenant judgment."] }));
    renderWith(<OpenCrossJudgment judgmentId="j1" soulName="张三" />);
    fireEvent.click(screen.getByRole("button", { name: tZh("sentence_plan.cross.open") }));
    const dialog = await screen.findByRole("dialog");
    fireEvent.change(within(dialog).getByLabelText(tZh("sentence_plan.cross.title_label"), { exact: false }), { target: { value: "t" } });
    fireEvent.change(within(dialog).getByLabelText(tZh("sentence_plan.cross.description_label"), { exact: false }), { target: { value: "d" } });
    fireEvent.click(within(dialog).getByRole("button", { name: tZh("sentence_plan.cross.open") }));
    await waitFor(() =>
      expect(mockShowToast).toHaveBeenCalledWith("This judgment already has a cross-tenant judgment.", "error")
    );
    expect(mockPush).not.toHaveBeenCalled();
  });
});

// ── 入席 ──────────────────────────────────────────────────────────────────

const seat = (id: string, tenant: string, role: string, node_order: number | null) => ({
  id, judgment: "cj1", participant_tenant: 0, participant_tenant_code: tenant, participant_actor: null,
  participant_actor_name: null, role, joined_at: "2026-09-10T00:00:00Z", node_order, sentence_realm_code: "",
  sentence_years: null, sentence_is_eternal: false, sentence_memory_reset: "", sentence_notes: "",
  sentence_submitted_at: null,
});
const bench = (over: Partial<CrossTenantJudgment> = {}) =>
  ({
    id: "cj1", title: "联审", description: "", initiating_tenant: 1, initiating_tenant_code: "CN_DIYU",
    status: "PROPOSED", concluded_at: null, conclusion_type: null, judgment: "j1",
    participants: [seat("s-eg", "EG_DUAT", "CO_JUDGE", 2)], create_time: "", update_time: "", ...over,
  }) as unknown as CrossTenantJudgment;

describe("联审详情:请文明入席", () => {
  const SEAT = () => tZh("sentence_plan.cross.seat_submit");

  it("发起方按租户代码请入席;带站的角色取下一个站号", async () => {
    as("JUDGE", "CN_DIYU", ...JUDGE);
    cjApi.participate.mockResolvedValue({ data: bench() });
    renderWith(<CrossJudgmentSeatForm judgment={bench()} />);
    const tenant = screen.getByLabelText(tZh("sentence_plan.cross.seat_tenant"));
    // 自己(原属)与已入席的埃及不在可选之列。
    expect(within(tenant).getAllByRole("option").map((o) => (o as HTMLOptionElement).value)).toEqual([
      "", "EU_HEAVEN_HELL", "GR_HADES",
    ]);
    expect(screen.getByTestId("seat-stop")).toHaveTextContent(tZh("sentence_plan.cross.seat_order", { order: "3" }));
    fireEvent.change(tenant, { target: { value: "EU_HEAVEN_HELL" } });
    fireEvent.click(screen.getByRole("button", { name: SEAT() }));
    await waitFor(() =>
      expect(cjApi.participate).toHaveBeenCalledWith("cj1", {
        participant_tenant_code: "EU_HEAVEN_HELL", role: "CO_JUDGE", node_order: 3,
      })
    );
    await waitFor(() => expect(mockShowToast).toHaveBeenCalledWith(tZh("sentence_plan.cross.seated"), "success"));
  });

  it("顾问不带站(N3=(a)):不发 node_order", async () => {
    as("JUDGE", "CN_DIYU", ...JUDGE);
    cjApi.participate.mockResolvedValue({ data: bench() });
    renderWith(<CrossJudgmentSeatForm judgment={bench()} />);
    fireEvent.change(screen.getByLabelText(tZh("sentence_plan.cross.seat_role")), { target: { value: "ADVISOR" } });
    expect(screen.getByTestId("seat-stop")).toHaveTextContent(tZh("sentence_plan.cross.seat_advisor_hint"));
    fireEvent.change(screen.getByLabelText(tZh("sentence_plan.cross.seat_tenant")), { target: { value: "GR_HADES" } });
    fireEvent.click(screen.getByRole("button", { name: SEAT() }));
    await waitFor(() =>
      expect(cjApi.participate).toHaveBeenCalledWith("cj1", { participant_tenant_code: "GR_HADES", role: "ADVISOR" })
    );
  });

  it("没挂审判的联审(存量会议)不发站号", async () => {
    as("JUDGE", "CN_DIYU", ...JUDGE);
    cjApi.participate.mockResolvedValue({ data: bench() });
    renderWith(<CrossJudgmentSeatForm judgment={bench({ judgment: null, participants: [] })} />);
    expect(screen.queryByTestId("seat-stop")).toBeNull();
    fireEvent.change(screen.getByLabelText(tZh("sentence_plan.cross.seat_tenant")), { target: { value: "EG_DUAT" } });
    fireEvent.click(screen.getByRole("button", { name: SEAT() }));
    await waitFor(() =>
      expect(cjApi.participate).toHaveBeenCalledWith("cj1", { participant_tenant_code: "EG_DUAT", role: "CO_JUDGE" })
    );
  });

  it.each([
    ["参与方", () => as("JUDGE", "EG_DUAT", ...JUDGE), bench()],
    ["已开庭", () => as("JUDGE", "CN_DIYU", ...JUDGE), bench({ status: "ACTIVE" })],
    ["没有 cross_judgment.create", () => as("GUARDIAN", "CN_DIYU", "cross_judgment.read"), bench()],
  ])("%s:表单不出现", (_label, who, judgment) => {
    who();
    renderWith(<CrossJudgmentSeatForm judgment={judgment} />);
    expect(screen.queryByRole("button", { name: SEAT() })).toBeNull();
  });

  it("服务端拒绝原样给出", async () => {
    as("JUDGE", "CN_DIYU", ...JUDGE);
    cjApi.participate.mockRejectedValue(http(400, { error: "node_order 3 is already taken" }));
    renderWith(<CrossJudgmentSeatForm judgment={bench()} />);
    fireEvent.change(screen.getByLabelText(tZh("sentence_plan.cross.seat_tenant")), { target: { value: "GR_HADES" } });
    fireEvent.click(screen.getByRole("button", { name: SEAT() }));
    await waitFor(() => expect(mockShowToast).toHaveBeenCalledWith("node_order 3 is already taken", "error"));
  });
});
