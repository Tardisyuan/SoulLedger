/**
 * 审判详情上与受刑计划有关的两件事(docs/ARCHITECTURE-sentence-plan.md §4.1 情况 1、§2.1):
 *
 * * 加减项审判(kind=AMENDMENT)结案时带改动:`conclude/` 收 `plan_changes`,系统据此生成一条请求;
 *   不带改动就一个字段都不发(不生成请求,D8)。别的 kind 一律不发(服务端 400 invalid_changes)。
 * * 原属的、未结案的 ORIGINAL 审判上「开联审」:只给原属判官。
 *
 * 真页面、真 QueryClient,只替换 HTTP 层;`React.use` 垫片与 JudgmentDetailPage.notesDraft.test.tsx 同一个。
 */
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { tZh } from "./support/zhBundle";

const ID = "j-1";

jest.mock("react", () => {
  const actual = jest.requireActual("react");
  return {
    ...actual,
    use: <T,>(value: Promise<T> | T): T => {
      if (value && typeof (value as { then?: unknown }).then === "function") {
        return { id: ID } as unknown as T;
      }
      return value as T;
    },
  };
});

import JudgmentDetailPage from "@/app/judgment/[id]/page";
import { PLACEMENT_REFUSALS } from "@/src/components/judgment/JudgmentPlacement";

jest.mock("@soulledger/core/api", () => ({
  judgmentApi: { get: jest.fn(), conclude: jest.fn() },
  soulsApi: { get: jest.fn() },
  realmsApi: { list: jest.fn() },
  crossTenantJudgmentsApi: { create: jest.fn() },
  workflowApi: { flowPreview: jest.fn() },
}));
const { judgmentApi, soulsApi, realmsApi, workflowApi } = jest.requireMock("@soulledger/core/api") as Record<
  string,
  Record<string, jest.Mock>
>;
jest.mock("@soulledger/core/api/sentence-plans", () => ({ sentencePlansApi: { get: jest.fn() } }));
const { sentencePlansApi: planApi } = jest.requireMock("@soulledger/core/api/sentence-plans") as {
  sentencePlansApi: Record<string, jest.Mock>;
};
jest.mock("next/navigation", () => ({ useRouter: () => ({ push: jest.fn() }), useSearchParams: () => null }));

const mockI18n = {
  t: tZh,
  formatDate: (v: unknown) => String(v),
  formatDateTime: (v: unknown) => String(v),
  locale: "zh-Hans",
  hydrated: true,
};
jest.mock("@/src/contexts/I18nContext", () => ({
  ...jest.requireActual("@/src/contexts/I18nContext"),
  useI18n: () => mockI18n,
}));
const mockShowToast = jest.fn();
jest.mock("@/src/contexts/ToastContext", () => ({ useToast: () => ({ showToast: mockShowToast }) }));

type MockUser = { id: number; username: string; role: string; permissions: string[]; tenant: { code: string } };
let mockUser: MockUser | null = null;
jest.mock("@/src/contexts/TenantContext", () => ({ useTenant: () => ({ user: mockUser }) }));
const JUDGE = ["judgment.read", "judgment.execute", "cross_judgment.read", "cross_judgment.create"];
const as = (tenant: string, ...permissions: string[]) =>
  (mockUser = { id: 2, username: "op", role: "JUDGE", permissions, tenant: { code: tenant } });

const judgment = (over: Record<string, unknown> = {}) => ({
  id: ID, soul: "s-1", soul_name: "李四", civilization: "EGYPTIAN", judge: null, judge_name: null,
  court: "", evidence_json: {}, confession: "", verdict: null, notes: "", citations: [], is_final: false,
  created_at: "2026-09-12T00:00:00Z", concluded_at: null, kind: "ORIGINAL", amends_plan_id: null, ...over,
});
const node = (order: number, tenant_code: string, status: string) => ({
  id: `n${order}`, order, tenant_code, is_home: order === 1, status, realm_code: "EU_PURGATORY",
  sentence_years: 5, is_eternal: false, memory_reset: "NONE", disposition_id: null, dispatch_record_id: null,
  added_by_judgment_id: null, added_by_request_id: null, removed_by_request_id: null, reason: "",
  activated_at: null, completed_at: null,
});
/** 灵魂此刻在埃及受第 2 站(所以埃及开的是加减项审判);欧洲第 3 站未开始。 */
const plan = {
  id: "p1", soul: "s-1", soul_name: "李四", tenant: 1, tenant_code: "CN_DIYU", cycle: 0, status: "ACTIVE",
  origin_judgment_id: null, cross_judgment_id: null, completed_at: null, cancel_reason: "",
  nodes: [node(1, "CN_DIYU", "COMPLETED"), node(2, "EG_DUAT", "ACTIVE"), node(3, "EU_HEAVEN_HELL", "PENDING")],
  requests: [], create_time: "", update_time: "",
};
const AMENDMENT = { kind: "AMENDMENT", amends_plan_id: "p1" };

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <JudgmentDetailPage params={Promise.resolve({ id: ID })} />
    </QueryClientProvider>
  );
}

/** 原审一律带审批流程(d4d2bb27,2026-10-29),确认层那一键是「落判并发起」;加减项审判不强制,仍是「盖印并结案」。 */
async function conclude(button = "judgment.desk.stamp") {
  const passed = (await screen.findAllByRole("radio")).find((r) => (r as HTMLInputElement).value === "PASSED")!;
  fireEvent.click(passed);
  // v3:主按钮进盖印确认层,层里那一键才发 conclude/。
  fireEvent.click(screen.getByRole("button", { name: tZh("judgment.desk.to_confirm") }));
  fireEvent.click(await screen.findByRole("button", { name: tZh(button) }));
  await waitFor(() => expect(judgmentApi.conclude).toHaveBeenCalledTimes(1));
  return judgmentApi.conclude.mock.calls[0];
}

beforeEach(() => {
  jest.clearAllMocks();
  as("EG_DUAT", ...JUDGE);
  judgmentApi.get.mockResolvedValue({ data: judgment(AMENDMENT) });
  judgmentApi.conclude.mockResolvedValue({ data: judgment({ ...AMENDMENT, is_final: true, verdict: "PASSED" }) });
  soulsApi.get.mockResolvedValue({ data: { id: "s-1", name: "李四", tenant_code: "EG_DUAT", home_tenant: { code: "CN_DIYU", display_name: "地府" } } });
  planApi.get.mockResolvedValue({ data: plan });
  // 本域没有可跳过的站:确认层不进选站那一步(与 JudgmentDesk.test 同一份默认)。
  workflowApi.flowPreview.mockResolvedValue({ data: { name: "十殿审判流程", nothing_to_pick: true, stations: [], foreign: [] } });
  realmsApi.list.mockResolvedValue({ data: { results: [{ realm_code: "EG_AARU", is_eternal: false }] } });
});

describe("加减项审判结案带改动(情况 1)", () => {
  it("改动随裁决一起发,形状同请求的 changes", async () => {
    renderPage();
    const section = await screen.findByTestId("amendment-plan-changes");
    await waitFor(() => expect(planApi.get).toHaveBeenCalledWith("p1"));
    const boxes = await within(section).findAllByRole("checkbox");
    expect(boxes).toHaveLength(1); // 只有未开始的第 3 站
    fireEvent.click(boxes[0]);
    fireEvent.click(within(section).getByRole("button", { name: tZh("sentence_plan.file.add_stop") }));
    const realm = within(section).getByLabelText(tZh("sentence_plan.cross.realm"));
    await within(realm).findByRole("option", { name: "芦苇原" });
    fireEvent.change(realm, { target: { value: "EG_AARU" } });
    fireEvent.change(within(section).getByLabelText(tZh("sentence_plan.cross.years"), { exact: false }), {
      target: { value: "3" },
    });
    expect(await conclude()).toEqual([
      ID,
      {
        verdict: "PASSED", notes: "", create_workflow: false,
        plan_changes: { add: [{ realm_code: "EG_AARU", sentence_years: 3, reason: "" }], remove: ["n3"] },
      },
    ]);
  });

  it("没有改动:不发 plan_changes(不生成请求)", async () => {
    renderPage();
    await screen.findByTestId("amendment-plan-changes");
    expect(await conclude()).toEqual([ID, { verdict: "PASSED", notes: "", create_workflow: false }]);
  });

  it("改动里有一行没选界域:不进确认层、不结案,说明原因", async () => {
    renderPage();
    const section = await screen.findByTestId("amendment-plan-changes");
    // 计划是异步取来的,「再加一站」要等它到;此前靠渲染的先后碰巧已经到了。
    fireEvent.click(await within(section).findByRole("button", { name: tZh("sentence_plan.file.add_stop") }));
    fireEvent.click((await screen.findAllByRole("radio")).find((r) => (r as HTMLInputElement).value === "PASSED")!);
    fireEvent.click(screen.getByRole("button", { name: tZh("judgment.desk.to_confirm") }));
    await waitFor(() =>
      expect(mockShowToast).toHaveBeenCalledWith(tZh("sentence_plan.errors.invalid_changes"), "error")
    );
    expect(screen.queryByTestId("confirm-layer")).toBeNull();
    expect(judgmentApi.conclude).not.toHaveBeenCalled();
  });

  it("改动被拒(同一事务,什么都没写):拒绝码翻成对应的话", async () => {
    judgmentApi.conclude.mockRejectedValue(
      Object.assign(new Error("409"), { response: { status: 409, data: { error: "…", code: "eternal_not_last" } } })
    );
    renderPage();
    await screen.findByTestId("amendment-plan-changes");
    await conclude();
    await waitFor(() =>
      expect(mockShowToast).toHaveBeenCalledWith(tZh("sentence_plan.errors.eternal_not_last"), "error")
    );
  });
});

describe("原审判", () => {
  beforeEach(() => {
    judgmentApi.get.mockResolvedValue({ data: judgment() });
    soulsApi.get.mockResolvedValue({ data: { id: "s-1", name: "李四", tenant_code: "CN_DIYU", home_tenant: { code: "CN_DIYU", display_name: "地府" } } });
  });

  it("没有改动区,结案不带 plan_changes;原属判官看得到「开联审」", async () => {
    as("CN_DIYU", ...JUDGE);
    renderPage();
    expect(await screen.findByRole("button", { name: tZh("sentence_plan.cross.open") })).toBeInTheDocument();
    expect(screen.queryByTestId("amendment-plan-changes")).toBeNull();
    expect(planApi.get).not.toHaveBeenCalled();
    expect(await conclude("judgment.detail.conclude_with_workflow")).toEqual([ID, { verdict: "PASSED", notes: "", create_workflow: true }]);
  });

  it("别的文明、没有 cross_judgment.create、已结案:都没有「开联审」", async () => {
    as("EG_DUAT", ...JUDGE);
    const a = renderPage();
    await screen.findByRole("button", { name: tZh("judgment.desk.to_confirm") });
    expect(screen.queryByRole("button", { name: tZh("sentence_plan.cross.open") })).toBeNull();
    a.unmount();

    as("CN_DIYU", "judgment.read", "judgment.execute");
    const b = renderPage();
    await screen.findByRole("button", { name: tZh("judgment.desk.to_confirm") });
    expect(screen.queryByRole("button", { name: tZh("sentence_plan.cross.open") })).toBeNull();
    b.unmount();

    as("CN_DIYU", ...JUDGE);
    judgmentApi.get.mockResolvedValue({ data: judgment({ is_final: true, verdict: "PASSED" }) });
    renderPage();
    await screen.findByText(tZh("judgment.detail.final"));
    expect(screen.queryByRole("button", { name: tZh("sentence_plan.cross.open") })).toBeNull();
  });

  // 审计 1017 #10:已挂着联审(`cross_judgment_id`)就不给「开联审」,换成去那一场的链接 —— 没有开的权限也看得到。
  it("已有联审:没有「开联审」,只有去那场联审的链接", async () => {
    judgmentApi.get.mockResolvedValue({ data: judgment({ cross_judgment_id: "cj-9" }) });
    as("CN_DIYU", ...JUDGE);
    const a = renderPage();
    expect(await screen.findByRole("link", { name: tZh("sentence_plan.cross.view") })).toHaveAttribute("href", "/cross-judgments/cj-9");
    expect(screen.queryByRole("button", { name: tZh("sentence_plan.cross.open") })).toBeNull();
    a.unmount();

    as("CN_DIYU", "judgment.read", "judgment.execute");
    renderPage();
    expect(await screen.findByRole("link", { name: tZh("sentence_plan.cross.view") })).toHaveAttribute("href", "/cross-judgments/cj-9");
  });

  it("没有联审(null):照旧是「开联审」,没有链接", async () => {
    judgmentApi.get.mockResolvedValue({ data: judgment({ cross_judgment_id: null }) });
    as("CN_DIYU", ...JUDGE);
    renderPage();
    await screen.findByRole("button", { name: tZh("sentence_plan.cross.open") });
    expect(screen.queryByTestId("judgment-cross-link")).toBeNull();
  });
});

describe("结案的拒绝(客户端审查 2026-10-29 #1 / #7)", () => {
  it("发落的每个拒绝码都有中文,含地府判无罪不发落(passed_has_no_destination,#4)", () => {
    expect(PLACEMENT_REFUSALS).toContain("passed_has_no_destination");
    for (const code of PLACEMENT_REFUSALS) {
      expect(tZh(`judgment.placement.errors.${code}`)).not.toBe(`judgment.placement.errors.${code}`);
    }
  });

  const refuse = (data: Record<string, unknown>) =>
    judgmentApi.conclude.mockRejectedValue(Object.assign(new Error("409"), { response: { status: 409, data } }));

  it("服务端说还不能结案(conclude_refusal):「落判」置灰并写出原因;能结案时没有这句", async () => {
    judgmentApi.get.mockResolvedValue({ data: judgment({ ...AMENDMENT, conclude_refusal: "duat_unfinished" }) });
    const a = renderPage();
    const toConfirm = await screen.findByRole("button", { name: tZh("judgment.desk.to_confirm") });
    expect(toConfirm).toBeDisabled();
    expect(screen.getByTestId("desk-held-reason")).toHaveTextContent(tZh("judgment.claim.duat_unfinished"));
    a.unmount();

    judgmentApi.get.mockResolvedValue({ data: judgment({ ...AMENDMENT, conclude_refusal: "" }) });
    renderPage();
    await screen.findByTestId("amendment-plan-changes");
    expect(screen.queryByTestId("desk-held-reason")).toBeNull();
  });

  it("候审未到被拒:走认领的那句译文,不是通用句", async () => {
    refuse({ error: "Charon ferries only the buried who can pay.", code: "unferried" });
    renderPage();
    await screen.findByTestId("amendment-plan-changes");
    await conclude();
    await waitFor(() => expect(mockShowToast).toHaveBeenCalledWith(tZh("judgment.claim.unferried"), "error"));
  });

  it("原审要走流程(approval_flow_required / weighing_flow_required):各有一句译文", async () => {
    refuse({ error: "An original judgment is concluded through its approval workflow", code: "approval_flow_required" });
    renderPage();
    await screen.findByTestId("amendment-plan-changes");
    await conclude();
    await waitFor(() =>
      expect(mockShowToast).toHaveBeenCalledWith(tZh("judgment.weighing.errors.approval_flow_required"), "error")
    );
    expect(tZh("judgment.weighing.errors.weighing_flow_required")).not.toBe("judgment.weighing.errors.weighing_flow_required");
  });

  it("认不出的码:通用句,不回显后端英文", async () => {
    refuse({ error: "Something went wrong in English", code: "no_such_code" });
    renderPage();
    await screen.findByTestId("amendment-plan-changes");
    await conclude();
    await waitFor(() => expect(mockShowToast).toHaveBeenCalledWith(tZh("judgment.detail.conclude_error"), "error"));
    expect(mockShowToast).not.toHaveBeenCalledWith("Something went wrong in English", "error");
  });
});
