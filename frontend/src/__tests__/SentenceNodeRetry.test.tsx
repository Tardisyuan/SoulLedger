/**
 * 受刑计划面板上「重新发起调拨」(docs/ARCHITECTURE-sentence-plan.md D5):调拨被拒 / 取消后的那一站
 * 显示上次为什么没成,原属判官得到一个带确认的按钮。
 *
 * 与 SentencePlanPanels.test.tsx 同一套桩;断言「有」的地方都同时断言「别人没有」,
 * 并且断言按钮不在时接口一次都没调。
 */
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { ReactNode } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { SentencePlanCard } from "@/src/components/sentence-plan/SentencePlanCard";
import { tZh } from "./support/zhBundle";

jest.mock("@soulledger/core/api/sentence-plans", () => ({
  sentencePlansApi: { list: jest.fn(), retryDispatch: jest.fn() },
}));
const { sentencePlansApi: planApi } = jest.requireMock("@soulledger/core/api/sentence-plans") as {
  sentencePlansApi: Record<string, jest.Mock>;
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
const JUDGE = ["judgment.read", "judgment.execute"];

const node = (order: number, tenant_code: string, status: string, over: Record<string, unknown> = {}) => ({
  id: `n${order}`, order, tenant_code, is_home: order === 1, status, realm_code: "EU_PURGATORY",
  sentence_years: 5, is_eternal: false, memory_reset: "NONE", disposition_id: null, dispatch_record_id: null,
  added_by_judgment_id: null, added_by_request_id: null, removed_by_request_id: null, reason: "",
  activated_at: null, completed_at: null, last_refusal: null, ...over,
});
const REJECTED = { status: "REJECTED", reason: "名额已满", at: "2026-09-10T00:00:00Z" };
const plan = (over: Record<string, unknown> = {}) => ({
  id: "p1", soul: "s1", soul_name: "张三", tenant: 1, tenant_code: "CN_DIYU", cycle: 0, status: "ACTIVE",
  origin_judgment_id: null, cross_judgment_id: null, completed_at: null, cancel_reason: "",
  nodes: [node(1, "CN_DIYU", "COMPLETED"), node(2, "EG_DUAT", "PENDING", { last_refusal: REJECTED })],
  requests: [], create_time: "2026-09-01T00:00:00Z", update_time: "2026-09-10T00:00:00Z", ...over,
});
const page = (results: unknown[]) => ({ data: { count: results.length, next: null, previous: null, results } });
const http = (status: number, data?: unknown) => Object.assign(new Error(`HTTP ${status}`), { response: { status, data } });

function renderCard() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  const Wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  return render(<SentencePlanCard soulId="s1" />, { wrapper: Wrapper });
}
const retryButton = () => screen.queryByRole("button", { name: tZh("sentence_plan.retry_dispatch") });

beforeEach(() => {
  jest.clearAllMocks();
  planApi.list.mockResolvedValue(page([plan()]));
  planApi.retryDispatch.mockResolvedValue({ data: plan() });
});

describe("重新发起调拨", () => {
  it("原属判官:看到上次被拒的原因和按钮;确认后带计划与节点 id 调用,并提示成功", async () => {
    as("JUDGE", "CN_DIYU", ...JUDGE);
    renderCard();
    expect(await screen.findByText(tZh("sentence_plan.last_refusal_rejected", { reason: "名额已满" }))).toBeInTheDocument();
    fireEvent.click(retryButton() as HTMLElement);
    const dialog = await screen.findByRole("alertdialog");
    expect(planApi.retryDispatch).not.toHaveBeenCalled(); // 确认之前不发
    fireEvent.click(within(dialog).getByRole("button", { name: tZh("sentence_plan.retry_dispatch") }));
    await waitFor(() => expect(planApi.retryDispatch).toHaveBeenCalledWith("p1", "n2"));
    await waitFor(() => expect(mockShowToast).toHaveBeenCalledWith(tZh("sentence_plan.retried"), "success"));
  });

  it("取消的调拨说「已被取消」;没有理由的拒绝不带冒号", async () => {
    as("JUDGE", "CN_DIYU", ...JUDGE);
    planApi.list.mockResolvedValue(page([plan({ nodes: [node(1, "CN_DIYU", "COMPLETED"), node(2, "EG_DUAT", "PENDING", { last_refusal: { ...REJECTED, status: "CANCELLED", reason: null } })] })]));
    const first = renderCard();
    expect(await screen.findByText(tZh("sentence_plan.last_refusal_cancelled"))).toBeInTheDocument();
    first.unmount();
    planApi.list.mockResolvedValue(page([plan({ nodes: [node(1, "CN_DIYU", "COMPLETED"), node(2, "EG_DUAT", "PENDING", { last_refusal: { ...REJECTED, reason: null } })] })]));
    renderCard();
    expect(await screen.findByText(tZh("sentence_plan.last_refusal_rejected_bare"))).toBeInTheDocument();
  });

  it("服务端拒绝时显示它的原因,不显示成功", async () => {
    as("JUDGE", "CN_DIYU", ...JUDGE);
    planApi.retryDispatch.mockRejectedValue(http(409, { code: "open_judgment" }));
    renderCard();
    await screen.findByText(tZh("sentence_plan.last_refusal_rejected", { reason: "名额已满" }));
    fireEvent.click(retryButton() as HTMLElement);
    fireEvent.click(within(await screen.findByRole("alertdialog")).getByRole("button", { name: tZh("sentence_plan.retry_dispatch") }));
    await waitFor(() => expect(mockShowToast).toHaveBeenCalledWith(tZh("sentence_plan.errors.open_judgment"), "error"));
    expect(mockShowToast).not.toHaveBeenCalledWith(tZh("sentence_plan.retried"), "success");
  });

  it("执行地、没有 judgment.execute:只看得到原因,没有按钮", async () => {
    as("JUDGE", "EG_DUAT", ...JUDGE);
    const away = renderCard();
    await screen.findByText(tZh("sentence_plan.last_refusal_rejected", { reason: "名额已满" }));
    expect(retryButton()).toBeNull();
    away.unmount();

    as("GUARDIAN", "CN_DIYU", "judgment.read");
    renderCard();
    await screen.findByText(tZh("sentence_plan.last_refusal_rejected", { reason: "名额已满" }));
    expect(retryButton()).toBeNull();
    expect(planApi.retryDispatch).not.toHaveBeenCalled();
  });

  it("计划已结束,或这一站没有被拒过:没有按钮,也没有原因", async () => {
    as("JUDGE", "CN_DIYU", ...JUDGE);
    planApi.list.mockResolvedValue(page([plan({ status: "CANCELLED", cancel_reason: "赦免" })]));
    const closed = renderCard();
    await screen.findByText(tZh("sentence_plan.plan_states.CANCELLED"));
    expect(retryButton()).toBeNull();
    closed.unmount();

    planApi.list.mockResolvedValue(page([plan({ nodes: [node(1, "CN_DIYU", "COMPLETED"), node(2, "EG_DUAT", "PENDING")] })]));
    renderCard();
    await screen.findByText(tZh("sentence_plan.between_stops"));
    expect(retryButton()).toBeNull();
    expect(screen.queryByText(/上次调拨/)).toBeNull();
  });
});
