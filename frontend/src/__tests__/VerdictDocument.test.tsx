/**
 * 判决文书(v4 第七批 S15):每文明的字在 `packages/core/src/domain/__tests__/verdictDocument.test.ts` 对真语言包测;
 * 这里只测组件:何时有文书、地府中文竖排、打印 / 下载 PDF 走浏览器打印并且只印这一份。
 * 打印出来的版面(一页 A4、墨色)要在浏览器的打印预览里看,规则见 printLayout.test.tsx。
 */
import { act, fireEvent, render, screen } from "@testing-library/react";
import { VerdictDocument, type VerdictDocumentProps } from "@/src/components/judgment/VerdictDocument";

let mockLocale = "zh-Hans";
jest.mock("@/src/contexts/I18nContext", () => ({
  useI18n: () => ({ t: (k: string) => k, locale: mockLocale }),
}));
jest.mock("@/src/contexts/ToastContext", () => ({ useToast: () => ({ showToast: jest.fn() }) }));

const judgment: VerdictDocumentProps["judgment"] = {
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
  window.print = jest.fn();
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

it("prints one copy mounted under body, and for a PDF names the file after the case until printing ends", () => {
  document.title = "灵魂簿";
  render(<VerdictDocument judgment={judgment} />);
  expect(document.querySelector("[data-print-verdict-doc]")).toBeNull();

  let titleWhilePrinting = "";
  (window.print as jest.Mock).mockImplementation(() => {
    titleWhilePrinting = document.title;
  });
  fireEvent.click(screen.getByRole("button", { name: "doc.download_pdf" }));
  const copy = document.querySelector("[data-print-verdict-doc]")!;
  expect(copy.parentElement).toBe(document.body);
  expect(copy).toHaveAttribute("data-print-doc");
  expect(window.print).toHaveBeenCalledTimes(1);
  expect(titleWhilePrinting).toBe("DY-2026-0412");

  act(() => {
    window.dispatchEvent(new Event("afterprint"));
  });
  expect(document.querySelector("[data-print-verdict-doc]")).toBeNull();
  expect(document.title).toBe("灵魂簿");

  fireEvent.click(screen.getByRole("button", { name: "print.button" }));
  expect(titleWhilePrinting).toBe("灵魂簿");
});
