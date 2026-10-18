/**
 * 跨域审判的结束与取消(第四十批 W-a),以及原审判被它挡住时的那句话。
 *
 * - 入口只给 `can_end` 的人;没有就一个按钮都不画(不是禁用)。
 * - 结束:结论两选一、没有默认值;说明必填。取消:理由必填。
 * - `CrossJudgmentBlockedNotice`:标题、召集信息、「去跨域审判」链接;取不到会审时只写标题与链接。
 */
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { CrossJudgmentEndControls } from "@/src/components/cross-judgments/CrossJudgmentEndControls";
import { CrossJudgmentBlockedNotice, isCrossJudgmentOpen } from "@/src/components/judgment/CrossJudgmentBlockedNotice";
import { tZh } from "./support/zhBundle";

jest.mock("@soulledger/core/api", () => ({ crossTenantJudgmentsApi: { conclude: jest.fn(), cancel: jest.fn() } }));
const { crossTenantJudgmentsApi } = jest.requireMock("@soulledger/core/api") as {
  crossTenantJudgmentsApi: { conclude: jest.Mock; cancel: jest.Mock };
};
jest.mock("@/src/contexts/I18nContext", () => ({
  useI18n: () => ({
    t: (key: string, params?: Record<string, string>) =>
      Object.entries(params ?? {}).reduce((s, [k, v]) => s.replace(`{{${k}}}`, v), tZh(key)),
    formatDate: (v: string) => v.slice(5, 10),
    locale: "zh-Hans",
    hydrated: true,
  }),
}));
const mockShowToast = jest.fn();
jest.mock("@/src/contexts/ToastContext", () => ({ useToast: () => ({ showToast: mockShowToast }) }));

const judgment = (over: Record<string, unknown> = {}) => ({
  id: "cj1",
  title: "三殿会审",
  status: "ACTIVE",
  can_end: true,
  create_time: "2026-10-12T08:00:00Z",
  participants: [
    { id: "p1", role: "CO_JUDGE", sentence_submitted_at: "2026-10-13T00:00:00Z" },
    { id: "p2", role: "ADVISOR", sentence_submitted_at: null },
    { id: "p3", role: "CO_JUDGE", sentence_submitted_at: null },
  ],
  ...over,
});

function renderControls(j = judgment()) {
  const client = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <CrossJudgmentEndControls judgment={j as never} />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  jest.clearAllMocks();
  crossTenantJudgmentsApi.conclude.mockResolvedValue({ data: {} });
  crossTenantJudgmentsApi.cancel.mockResolvedValue({ data: {} });
});

describe("结束 / 取消跨域审判", () => {
  it("不能做的人一个入口都没有", () => {
    renderControls(judgment({ can_end: false }));
    expect(screen.queryByRole("button", { name: tZh("crossJudgments.end") })).toBeNull();
    expect(screen.queryByRole("button", { name: tZh("common.row_actions") })).toBeNull();
  });

  it("结束:没选结论或没写说明不可提交;都有了才带着结论与说明调用", async () => {
    renderControls();
    fireEvent.click(screen.getByTestId("cross-end"));
    const submit = (await screen.findAllByRole("button", { name: tZh("crossJudgments.end") })).at(-1)!;
    expect(submit).toBeDisabled();
    expect(screen.getByRole("radio", { name: tZh("crossJudgments.end_pass") })).not.toBeChecked();
    expect(screen.getByRole("radio", { name: tZh("crossJudgments.end_fail") })).not.toBeChecked();

    fireEvent.click(screen.getByRole("radio", { name: tZh("crossJudgments.end_fail") }));
    expect(submit).toBeDisabled();
    fireEvent.change(screen.getByLabelText(tZh("crossJudgments.end_note"), { exact: false }), {
      target: { value: "  意见不一  " },
    });
    fireEvent.click(submit);
    await waitFor(() =>
      expect(crossTenantJudgmentsApi.conclude).toHaveBeenCalledWith("cj1", { conclusion_type: "FAIL", note: "意见不一" }),
    );
  });

  it("取消在 ⋯ 里;没写理由不可点,写了带理由调用", async () => {
    renderControls();
    fireEvent.click(screen.getByRole("button", { name: tZh("common.row_actions") }));
    fireEvent.click(await screen.findByRole("menuitem", { name: tZh("crossJudgments.cancel") }));
    const confirm = await screen.findByTestId("cross-cancel-confirm");
    expect(confirm).toBeDisabled();
    expect(screen.getByRole("button", { name: tZh("crossJudgments.cancel_keep") })).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText(tZh("crossJudgments.cancel_reason"), { exact: false }), {
      target: { value: "原审判已撤回" },
    });
    fireEvent.click(confirm);
    await waitFor(() => expect(crossTenantJudgmentsApi.cancel).toHaveBeenCalledWith("cj1", "原审判已撤回"));
  });

  it("审批流程还在走:没有「结束」,换成一行说明;取消还在", () => {
    renderControls(judgment({ workflow: { status: "IN_PROGRESS", at: null, segments: [] } }));
    expect(screen.queryByTestId("cross-end")).toBeNull();
    expect(screen.queryByRole("button", { name: tZh("crossJudgments.end") })).toBeNull();
    expect(screen.getByTestId("cross-end-flow-running")).toHaveTextContent(tZh("crossJudgments.workflow_running"));
    expect(screen.getByRole("button", { name: tZh("common.row_actions") })).toBeInTheDocument();
  });

  it("没有审批流程或流程已结束:有「结束」,没有那行说明", () => {
    const { unmount } = renderControls(judgment({ workflow: null }));
    expect(screen.getByTestId("cross-end")).toBeInTheDocument();
    expect(screen.queryByTestId("cross-end-flow-running")).toBeNull();
    unmount();
    renderControls(judgment({ workflow: { status: "COMPLETED", at: null, segments: [] } }));
    expect(screen.getByTestId("cross-end")).toBeInTheDocument();
    expect(screen.queryByTestId("cross-end-flow-running")).toBeNull();
  });
});

describe("原审判被跨域审判挡住", () => {
  it("只有进行中的才挡", () => {
    expect(isCrossJudgmentOpen({ status: "PROPOSED" })).toBe(true);
    expect(isCrossJudgmentOpen({ status: "ACTIVE" })).toBe(true);
    expect(isCrossJudgmentOpen({ status: "CONCLUDED" })).toBe(false);
    expect(isCrossJudgmentOpen({ status: "CANCELLED" })).toBe(false);
    expect(isCrossJudgmentOpen(undefined)).toBe(false);
  });

  it("写标题、召集信息(顾问与已填站的算入席)和去会审的链接", () => {
    render(<CrossJudgmentBlockedNotice crossId="cj1" cross={judgment() as never} />);
    expect(screen.getByText(tZh("judgment.close_blocked_title"))).toBeInTheDocument();
    expect(screen.getByText(/三殿会审 · 10-12/)).toHaveTextContent("2 / 3");
    expect(screen.getByRole("link", { name: tZh("judgment.close_blocked_link") })).toHaveAttribute("href", "/cross-judgments/cj1");
  });

  it("取不到会审时只写标题与链接,不写空的召集信息", () => {
    render(<CrossJudgmentBlockedNotice crossId="cj1" />);
    expect(screen.getByRole("alert")).toHaveTextContent(tZh("judgment.close_blocked_title"));
    expect(screen.queryByText(/召集/)).toBeNull();
    expect(screen.getByRole("link")).toHaveAttribute("href", "/cross-judgments/cj1");
  });
});
