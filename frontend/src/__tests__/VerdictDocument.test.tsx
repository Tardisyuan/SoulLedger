/**
 * 判决文书(v4 第七批 S15):每文明的字在 `packages/core/src/domain/__tests__/verdictDocument.test.ts` 对真语言包测;
 * 这里只测组件:何时有文书、地府中文竖排、打印走浏览器打印并且只印这一份、下载 PDF 取后端的真 PDF
 * (失败时退回浏览器打印),以及 PDF 打印页那一份何时告诉无头 Chromium「好了」。
 * 打印出来的版面(一页 A4、墨色)要在浏览器的打印预览里看,规则见 printLayout.test.tsx。
 */
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { VerdictDocument, VerdictPrintSheet, type VerdictDocumentProps } from "@/src/components/judgment/VerdictDocument";
import { saveBlob } from "@/src/lib/saveBlob";

let mockLocale = "zh-Hans";
let mockReady = true;
jest.mock("@/src/contexts/I18nContext", () => ({
  useI18n: () => ({ t: (k: string) => k, locale: mockLocale, ready: mockReady }),
}));
const mockShowToast = jest.fn();
jest.mock("@/src/contexts/ToastContext", () => ({ useToast: () => ({ showToast: mockShowToast }) }));
const mockPdf = jest.fn();
jest.mock("@soulledger/core/api/judgment", () => ({
  judgmentApi: { verdictDocumentPdf: (...args: unknown[]) => mockPdf(...args) },
}));
jest.mock("@/src/lib/saveBlob", () => ({ saveBlob: jest.fn() }));

const judgment: VerdictDocumentProps["judgment"] = {
  id: "0b6f7c1e-5d0a-4d47-9a61-3a1f2b9e8c10",
  civilization: "CHINESE",
  verdict: "PASSED",
  is_final: true,
  case_number: "DY-2026-0412",
  soul_name: "李青竹",
  court: "第一殿",
  judge_name: "秦广王",
  judge_name_en: "King Qinguang",
  merit_score: 30,
  demerit_score: 30,
  offence: "",
  fail_reasons: [],
  fail_reason_note: "",
  greek_account: "",
  greek_curability: "",
  concluded_at_local: "2026-11-06T14:40:00+08:00",
  cited_deadly_sins: [],
};

beforeEach(() => {
  mockLocale = "zh-Hans";
  mockReady = true;
  mockPdf.mockReset();
  mockShowToast.mockReset();
  (saveBlob as jest.Mock).mockReset();
  window.print = jest.fn();
  delete document.body.dataset.verdictReady;
});

it("renders nothing for a case that is not concluded, or concluded without a final verdict", () => {
  const open = render(<VerdictDocument judgment={{ ...judgment, is_final: false }} />);
  expect(open.container).toBeEmptyDOMElement();
  open.unmount();
  const retry = render(<VerdictDocument judgment={{ ...judgment, verdict: "RETRY" }} />);
  expect(retry.container).toBeEmptyDOMElement();
});

it("lays the Diyu document out vertically in Chinese only, and offers no way to undo the stamp", () => {
  const { container, unmount } = render(<VerdictDocument judgment={judgment} />);
  const paper = container.querySelector("[data-verdict-paper]")!;
  expect(paper).toHaveAttribute("data-civ", "cn");
  expect(paper).toHaveAttribute("data-vertical");
  expect(paper.querySelector("[data-doc-verdict]")).toHaveTextContent("verdict_doc.cn.verdict.balanced");
  expect(screen.getAllByRole("button").map((b) => b.textContent)).toEqual(["doc.download_pdf", "print.button"]);
  // 屏幕上的卡不随整页案卷一起印。
  expect(container.querySelector("[data-verdict-doc]")).toHaveAttribute("data-print-hide");
  unmount();
  mockLocale = "en";
  const en = render(<VerdictDocument judgment={judgment} />);
  expect(en.container.querySelector("[data-verdict-paper]")).not.toHaveAttribute("data-vertical");
});

it("picks the Republic set for a Greek case stamped REPUBLIC", () => {
  const { container } = render(
    <VerdictDocument judgment={{ ...judgment, civilization: "GREEK", verdict: "FAILED", greek_account: "REPUBLIC", greek_curability: "INCURABLE" }} />
  );
  expect(container.querySelector("[data-verdict-paper]")).toHaveAttribute("data-account", "gr_er");
  expect(container.querySelector("[data-doc-verdict]")).toHaveTextContent("verdict_doc.gr_er.verdict.incurable");
});

it("prints one copy mounted under body, and unmounts it once printing ends", () => {
  document.title = "灵魂簿";
  render(<VerdictDocument judgment={judgment} />);
  expect(document.querySelector("[data-print-verdict-doc]")).toBeNull();

  let titleWhilePrinting = "";
  (window.print as jest.Mock).mockImplementation(() => {
    titleWhilePrinting = document.title;
  });
  fireEvent.click(screen.getByRole("button", { name: "print.button · verdict_doc.cn.title" }));
  const copy = document.querySelector("[data-print-verdict-doc]")!;
  expect(copy.parentElement).toBe(document.body);
  expect(copy).toHaveAttribute("data-print-doc");
  expect(window.print).toHaveBeenCalledTimes(1);
  expect(titleWhilePrinting).toBe("灵魂簿");

  act(() => {
    window.dispatchEvent(new Event("afterprint"));
  });
  expect(document.querySelector("[data-print-verdict-doc]")).toBeNull();
  expect(mockPdf).not.toHaveBeenCalled();
});

it("downloads the server's PDF named after the case, in the reader's language, without opening the print dialog", async () => {
  mockLocale = "en";
  const pdf = new Blob(["%PDF-1.7"]);
  mockPdf.mockResolvedValue({ data: pdf });
  render(<VerdictDocument judgment={judgment} />);
  fireEvent.click(screen.getByRole("button", { name: "doc.download_pdf" }));
  await waitFor(() => expect(saveBlob).toHaveBeenCalledWith(pdf, "DY-2026-0412.pdf", "application/pdf"));
  expect(mockPdf).toHaveBeenCalledWith(judgment.id, "en");
  expect(window.print).not.toHaveBeenCalled();
  expect(mockShowToast).not.toHaveBeenCalled();
});

it("falls back to the browser's print, file named after the case, when the PDF service is unavailable", async () => {
  document.title = "灵魂簿";
  mockPdf.mockRejectedValue({ response: { status: 503 } });
  let titleWhilePrinting = "";
  (window.print as jest.Mock).mockImplementation(() => {
    titleWhilePrinting = document.title;
  });
  render(<VerdictDocument judgment={judgment} />);
  fireEvent.click(screen.getByRole("button", { name: "doc.download_pdf" }));
  await waitFor(() => expect(window.print).toHaveBeenCalledTimes(1));
  expect(mockShowToast).toHaveBeenCalledWith("doc.pdf_fallback", "info");
  expect(titleWhilePrinting).toBe("DY-2026-0412");
  expect(saveBlob).not.toHaveBeenCalled();
  act(() => {
    window.dispatchEvent(new Event("afterprint"));
  });
  expect(document.title).toBe("灵魂簿");
});

describe("VerdictPrintSheet (the page the headless renderer prints)", () => {
  const fonts = (ready: Promise<unknown>) => Object.defineProperty(document, "fonts", { value: { ready }, configurable: true });

  it("mounts one copy under body and marks the body ready only after the language bundle and the fonts", async () => {
    mockLocale = "en";
    mockReady = false;
    let fontsLoaded!: () => void;
    fonts(new Promise<void>((r) => (fontsLoaded = r)));
    const { rerender } = render(<VerdictPrintSheet judgment={judgment} />);
    const copy = document.querySelector("[data-print-verdict-doc]")!;
    expect(copy.parentElement).toBe(document.body);
    expect(copy.querySelector("[data-verdict-paper]")).toHaveAttribute("data-civ", "cn");
    expect(document.body.dataset.verdictReady).toBeUndefined();

    mockReady = true;
    rerender(<VerdictPrintSheet judgment={judgment} />);
    await act(async () => undefined);
    expect(document.body.dataset.verdictReady).toBeUndefined();

    await act(async () => fontsLoaded());
    expect(document.body.dataset.verdictReady).toBe("1");
  });

  it("never marks ready for a case with no document", async () => {
    fonts(Promise.resolve());
    render(<VerdictPrintSheet judgment={{ ...judgment, verdict: "RETRY" }} />);
    await act(async () => undefined);
    expect(document.querySelector("[data-print-verdict-doc]")).toBeNull();
    expect(document.body.dataset.verdictReady).toBeUndefined();
  });
});
