/**
 * ADMIN 更正结案:POST /souls/{id}/correct_settlement/ 必须带原因 —— 空原因不出门;
 * 后端 400 的 `error` 原样显示;成功后交给调用方重取(`onCorrected`)。
 */
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { soulsApi } from "@soulledger/core/api";
import { CorrectSettlementDialog, correctSettlementError } from "@/src/components/souls/detail/CorrectSettlementDialog";

jest.mock("@soulledger/core/api", () => ({
  ...jest.requireActual("@soulledger/core/api"),
  soulsApi: { correctSettlement: jest.fn() },
}));
jest.mock("@/src/contexts/I18nContext", () => ({
  useI18n: () => ({ t: (key: string) => key, locale: "zh-Hans", hydrated: true }),
}));
const mockShowToast = jest.fn();
jest.mock("@/src/contexts/ToastContext", () => ({ useToast: () => ({ showToast: mockShowToast }) }));

const correct = soulsApi.correctSettlement as jest.Mock;

function renderDialog() {
  const onClose = jest.fn();
  const onCorrected = jest.fn();
  const qc = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
  render(
    <QueryClientProvider client={qc}>
      <CorrectSettlementDialog soulId="soul-1" isOpen onClose={onClose} onCorrected={onCorrected} />
    </QueryClientProvider>
  );
  return { onClose, onCorrected };
}

const confirm = () => fireEvent.click(screen.getByRole("button", { name: "souls.detail.correct_settlement.confirm" }));
const reasonField = () => screen.getByLabelText(/souls\.detail\.correct_settlement\.reason/);

beforeEach(() => jest.clearAllMocks());

it("correctSettlementError keeps the backend's 400 sentence and nothing else", () => {
  expect(correctSettlementError({ response: { status: 400, data: { error: "Only a SETTLED soul can have its settlement corrected." } } }))
    .toBe("Only a SETTLED soul can have its settlement corrected.");
  expect(correctSettlementError({ response: { status: 403, data: { detail: "no" } } })).toBeNull();
  expect(correctSettlementError(new Error("network"))).toBeNull();
});

describe("CorrectSettlementDialog", () => {
  it("refuses an empty or whitespace reason without calling the API", async () => {
    const { onCorrected } = renderDialog();
    fireEvent.change(reasonField(), { target: { value: "   " } });
    confirm();
    expect(await screen.findByRole("alert")).toHaveTextContent("souls.detail.correct_settlement.reason_required");
    expect(correct).not.toHaveBeenCalled();
    expect(onCorrected).not.toHaveBeenCalled();
  });

  it("posts the trimmed reason, then refreshes and closes", async () => {
    correct.mockResolvedValue({ data: { id: "soul-1", current_state: "DISPOSED" } });
    const { onClose, onCorrected } = renderDialog();
    fireEvent.change(reasonField(), { target: { value: "  录错了灵魂 " } });
    confirm();
    await waitFor(() => expect(correct).toHaveBeenCalledWith("soul-1", "录错了灵魂"));
    await waitFor(() => expect(onCorrected).toHaveBeenCalledTimes(1));
    expect(onClose).toHaveBeenCalled();
    expect(mockShowToast).toHaveBeenCalledWith("souls.detail.correct_settlement.success", "success");
  });

  it("shows the backend's 400 under the reason and keeps the dialog open; other failures toast", async () => {
    correct.mockRejectedValueOnce({ response: { status: 400, data: { error: "Only a SETTLED soul can have its settlement corrected." } } });
    const { onClose, onCorrected } = renderDialog();
    fireEvent.change(reasonField(), { target: { value: "x" } });
    confirm();
    expect(await screen.findByRole("alert")).toHaveTextContent("Only a SETTLED soul can have its settlement corrected.");
    expect(onClose).not.toHaveBeenCalled();
    expect(onCorrected).not.toHaveBeenCalled();

    correct.mockRejectedValueOnce({ response: { status: 403, data: { detail: "forbidden" } } });
    confirm();
    await waitFor(() => expect(mockShowToast).toHaveBeenCalledWith("souls.detail.correct_settlement.failed", "error"));
  });
});
