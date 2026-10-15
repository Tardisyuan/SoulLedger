/**
 * 案卷附件(Design 第二十八批 W4):src/components/judgment/CaseAttachments.tsx + CaseAttachmentsPrintList.tsx。
 * 真 QueryClient、真 hook;只替换 HTTP 层。服务端的规则(类型、大小、结案后不能删)有 pytest 管着,
 * 这里断言的是界面怎么说:按钮有没有、提示写在哪一行、取消和重试是不是真的动了请求。
 */
import { render, screen, fireEvent, waitFor, within, act } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { judgmentApi } from "@soulledger/core/api";
import { CaseAttachments } from "@/src/components/judgment/CaseAttachments";
import { CaseAttachmentsPrintList } from "@/src/components/judgment/CaseAttachmentsPrintList";

jest.mock("@soulledger/core/api", () => ({
  ...jest.requireActual("@soulledger/core/api"),
  judgmentApi: { attachments: jest.fn(), uploadAttachment: jest.fn(), deleteAttachment: jest.fn(), attachmentLink: jest.fn() },
}));
jest.mock("@/src/contexts/I18nContext", () => ({
  ...jest.requireActual("@/src/contexts/I18nContext"),
  useI18n: () => ({ t: (k: string, p?: Record<string, string>) => (p ? `${k}|${JSON.stringify(p)}` : k), formatDateTime: (v: unknown) => `at:${String(v)}`, locale: "zh-Hans", hydrated: true }),
}));

const api = judgmentApi as unknown as Record<"attachments" | "uploadAttachment" | "deleteAttachment" | "attachmentLink", jest.Mock>;
const MB = 1024 * 1024;
const item = (id: string, over: Record<string, unknown> = {}) => ({
  id, name: `${id}.pdf`, byte_size: 2 * MB, content_type: "application/pdf", uploader: 1, uploader_name: "崔判官",
  created_at: "2026-10-12T02:02:00Z", can_delete: true, ...over,
});
const list = (items: ReturnType<typeof item>[], over: Record<string, unknown> = {}) => ({
  items, count: items.length, total_bytes: items.reduce((n, i) => n + i.byte_size, 0),
  max_count: 30, max_total_bytes: 100 * MB, max_file_bytes: 20 * MB, concluded: false, ...over,
});
const file = (name: string, size = 1000, type = "application/pdf") => {
  const f = new File(["x"], name, { type });
  Object.defineProperty(f, "size", { value: size });
  return f;
};

function renderIt(canWrite = true, ui = <CaseAttachments judgmentId="j-1" canWrite={canWrite} />) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={qc}>{ui}</QueryClientProvider>);
}
const pick = (...files: File[]) => fireEvent.change(screen.getByTestId("attachments-input"), { target: { files } });

beforeEach(() => jest.resetAllMocks());

test("rows show tile, name, size, uploader, time, download and — for the uploader before conclusion — delete", async () => {
  api.attachments.mockResolvedValue(list([item("a", { name: "现场照片-01.jpg", content_type: "image/jpeg" }), item("b", { can_delete: false, name: "契约.pdf" })]));
  renderIt();
  const a = await screen.findByTestId("attachment-a");
  expect(a).toHaveTextContent("JPG");
  expect(a).toHaveTextContent("现场照片-01.jpg");
  expect(a).toHaveTextContent("2.0 MB");
  expect(a).toHaveTextContent("崔判官");
  expect(a).toHaveTextContent("at:2026-10-12T02:02:00Z");
  expect(within(a).getByRole("button", { name: "case.attachments.download" })).toBeInTheDocument();
  expect(within(a).getByRole("button", { name: "common.delete" })).toBeInTheDocument();
  const b = screen.getByTestId("attachment-b");
  expect(within(b).getByRole("button", { name: "case.attachments.download" })).toBeInTheDocument();
  expect(within(b).queryByRole("button", { name: "common.delete" })).not.toBeInTheDocument();
  expect(screen.getByTestId("attachments-summary")).toHaveTextContent('"count":"2"');
});

test("after conclusion the server marks nothing deletable, and no row grows a delete button", async () => {
  api.attachments.mockResolvedValue(list([item("a", { can_delete: false }), item("b", { can_delete: false })], { concluded: true }));
  renderIt();
  await screen.findByTestId("attachment-a");
  expect(screen.queryByRole("button", { name: "common.delete" })).not.toBeInTheDocument();
});

test("add button and drop zone exist before conclusion and are gone after; download and preview stay", async () => {
  api.attachments.mockResolvedValue(list([item("a")]));
  const open = renderIt();
  await screen.findByTestId("attachment-a");
  expect(screen.getByRole("button", { name: "case.attachments.add" })).toBeInTheDocument();
  expect(screen.getByTestId("attachments-drop")).toBeInTheDocument();
  open.unmount();
  api.attachments.mockResolvedValue(list([item("a")], { concluded: true }));
  renderIt();
  const row = await screen.findByTestId("attachment-a");
  expect(screen.queryByRole("button", { name: "case.attachments.add" })).not.toBeInTheDocument();
  expect(screen.queryByTestId("attachments-drop")).not.toBeInTheDocument();
  expect(screen.queryByTestId("attachments-input")).not.toBeInTheDocument();
  expect(within(row).getByRole("button", { name: "case.attachments.download" })).toBeInTheDocument();
});

test("the file input offers only JPEG, PNG and PDF, so phones convert HEIC themselves", async () => {
  api.attachments.mockResolvedValue(list([]));
  renderIt();
  const input = await screen.findByTestId("attachments-input");
  expect(input.getAttribute("accept")).toBe("image/jpeg,image/png,application/pdf");
});

test("a HEIC that arrives anyway (dragged from a Mac) is refused on its row before any upload", async () => {
  api.attachments.mockResolvedValue(list([]));
  renderIt();
  fireEvent.drop(await screen.findByTestId("attachments-drop"), { dataTransfer: { files: [file("IMG_0001.HEIC", 1000, "image/heic")] } });
  expect(await screen.findByTestId("upload-1")).toHaveTextContent("case.attachments.failed_type");
  expect(api.uploadAttachment).not.toHaveBeenCalled();
});

test("without write permission there is no add button, no drop zone, no file input and no delete", async () => {
  api.attachments.mockResolvedValue(list([item("a")]));
  renderIt(false);
  await screen.findByTestId("attachment-a");
  expect(screen.queryByRole("button", { name: "case.attachments.add" })).not.toBeInTheDocument();
  expect(screen.queryByTestId("attachments-drop")).not.toBeInTheDocument();
  expect(screen.queryByTestId("attachments-input")).not.toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "common.delete" })).not.toBeInTheDocument();
});

test("the drop zone is keyboard reachable and opens the picker on Enter and Space", async () => {
  api.attachments.mockResolvedValue(list([]));
  renderIt();
  const zone = await screen.findByTestId("attachments-drop");
  expect(zone).toHaveAttribute("tabindex", "0");
  expect(zone).toHaveAttribute("role", "button");
  const click = jest.spyOn(screen.getByTestId("attachments-input"), "click");
  fireEvent.keyDown(zone, { key: "Enter" });
  fireEvent.keyDown(zone, { key: " " });
  fireEvent.keyDown(zone, { key: "a" });
  expect(click).toHaveBeenCalledTimes(2);
});

test("a dropped file uploads, shows progress, and the list is refetched afterwards", async () => {
  api.attachments.mockResolvedValue(list([]));
  let finish!: () => void;
  api.uploadAttachment.mockImplementation((_id: string, _body: FormData, opts: { onProgress: (_fraction: number) => void }) => {
    opts.onProgress(0.62);
    return new Promise((resolve) => { finish = () => resolve(item("new")); });
  });
  renderIt();
  await screen.findByTestId("attachments-drop");
  fireEvent.drop(screen.getByTestId("attachments-drop"), { dataTransfer: { files: [file("现场照片-02.jpg", 1000, "image/jpeg")] } });
  const row = await screen.findByTestId("upload-1");
  expect(within(row).getByRole("progressbar")).toHaveAttribute("aria-valuenow", "62");
  expect(row).toHaveTextContent('"pct":"62"');
  const calls = api.attachments.mock.calls.length;
  api.attachments.mockResolvedValue(list([item("new")]));
  await act(async () => finish());
  await waitFor(() => expect(screen.queryByTestId("upload-1")).not.toBeInTheDocument());
  await waitFor(() => expect(api.attachments.mock.calls.length).toBeGreaterThan(calls));
});

test("cancel aborts the request and drops the row", async () => {
  api.attachments.mockResolvedValue(list([]));
  let signal!: AbortSignal;
  api.uploadAttachment.mockImplementation((_i: string, _b: FormData, opts: { signal: AbortSignal }) => {
    signal = opts.signal;
    return new Promise((_, reject) => opts.signal.addEventListener("abort", () => reject(new Error("canceled"))));
  });
  renderIt();
  await screen.findByTestId("attachments-drop");
  pick(file("a.pdf"));
  const row = await screen.findByTestId("upload-1");
  expect(signal.aborted).toBe(false);
  fireEvent.click(within(row).getByRole("button", { name: "common.cancel" }));
  expect(signal.aborted).toBe(true);
  await waitFor(() => expect(screen.queryByTestId("upload-1")).not.toBeInTheDocument());
  expect(screen.queryByRole("alert")).not.toBeInTheDocument();
});

test.each([
  ["a type the client can already see is wrong", file("口供录音.m4a", 1000, "audio/mp4"), "case.attachments.failed_type"],
  ["over 20 MB", file("big.pdf", 21 * MB), 'case.attachments.too_large|{"max":"20"}'],
])("%s is refused on the file's own row, with no request and no dialog, leaving only Remove", async (_n, f, message) => {
  api.attachments.mockResolvedValue(list([]));
  renderIt();
  await screen.findByTestId("attachments-drop");
  pick(f);
  const row = await screen.findByTestId("upload-1");
  expect(row).toHaveTextContent(message);
  expect(api.uploadAttachment).not.toHaveBeenCalled();
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  expect(within(row).getByRole("button", { name: "case.attachments.remove" })).toBeInTheDocument();
  expect(within(row).queryByRole("button", { name: "common.retry" })).not.toBeInTheDocument();
  fireEvent.click(within(row).getByRole("button", { name: "case.attachments.remove" }));
  expect(screen.queryByTestId("upload-1")).not.toBeInTheDocument();
});

test("a case that would pass 100 MB, or 30 files, refuses on the row", async () => {
  api.attachments.mockResolvedValue(list([item("a", { byte_size: 95 * MB })]));
  renderIt();
  await screen.findByTestId("attachment-a");
  pick(file("six.pdf", 6 * MB));
  expect(await screen.findByTestId("upload-1")).toHaveTextContent("case.attachments.full");
  expect(api.uploadAttachment).not.toHaveBeenCalled();
});

test("the thirty-first file is refused on its row", async () => {
  api.attachments.mockResolvedValue(list(Array.from({ length: 30 }, (_, i) => item(`f${i}`, { byte_size: 1000 }))));
  renderIt();
  await screen.findByTestId("attachment-f0");
  pick(file("one-more.pdf"));
  expect(await screen.findByTestId("upload-1")).toHaveTextContent('case.attachments.too_many|{"max":"30"}');
  expect(api.uploadAttachment).not.toHaveBeenCalled();
});

test("a server refusal (sniffed type) shows its message on the row and offers no retry", async () => {
  api.attachments.mockResolvedValue(list([]));
  api.uploadAttachment.mockRejectedValue({ response: { status: 400, data: { code: "bad_type" } } });
  renderIt();
  await screen.findByTestId("attachments-drop");
  pick(file("fake.pdf"));
  const row = await screen.findByTestId("upload-1");
  await waitFor(() => expect(row).toHaveTextContent("case.attachments.failed_type"));
  expect(within(row).queryByRole("button", { name: "common.retry" })).not.toBeInTheDocument();
  expect(within(row).getByRole("button", { name: "case.attachments.remove" })).toBeInTheDocument();
});

test("a dropped connection leaves a failed row with Retry and Remove; Retry sends the same file again", async () => {
  api.attachments.mockResolvedValue(list([]));
  api.uploadAttachment.mockRejectedValueOnce(new Error("Network Error"));
  renderIt();
  await screen.findByTestId("attachments-drop");
  const f = file("卷宗扫描.pdf");
  pick(f);
  const row = await screen.findByTestId("upload-1");
  await waitFor(() => expect(row).toHaveTextContent("case.attachments.failed_network"));
  expect(within(row).getByRole("button", { name: "common.retry" })).toBeInTheDocument();
  expect(within(row).getByRole("button", { name: "case.attachments.remove" })).toBeInTheDocument();
  api.uploadAttachment.mockResolvedValueOnce(item("ok"));
  fireEvent.click(within(row).getByRole("button", { name: "common.retry" }));
  await waitFor(() => expect(api.uploadAttachment).toHaveBeenCalledTimes(2));
  expect((api.uploadAttachment.mock.calls[1][1] as FormData).get("file")).toBe(f);
  await waitFor(() => expect(screen.queryByTestId("upload-1")).not.toBeInTheDocument());
});

test("delete asks first; confirming calls the API for that attachment only", async () => {
  api.attachments.mockResolvedValue(list([item("a"), item("b")]));
  api.deleteAttachment.mockResolvedValue(undefined);
  renderIt();
  const a = await screen.findByTestId("attachment-a");
  fireEvent.click(within(a).getByRole("button", { name: "common.delete" }));
  expect(api.deleteAttachment).not.toHaveBeenCalled();
  const dialog = await screen.findByRole("alertdialog");
  expect(dialog).toHaveTextContent("case.attachments.delete_title");
  expect(dialog).toHaveTextContent('"name":"a.pdf"');
  fireEvent.click(within(dialog).getByRole("button", { name: "common.delete" }));
  await waitFor(() => expect(api.deleteAttachment).toHaveBeenCalledWith("j-1", "a"));
  expect(api.deleteAttachment).toHaveBeenCalledTimes(1);
});

test("cancelling the confirmation deletes nothing", async () => {
  api.attachments.mockResolvedValue(list([item("a")]));
  renderIt();
  fireEvent.click(within(await screen.findByTestId("attachment-a")).getByRole("button", { name: "common.delete" }));
  fireEvent.click(within(await screen.findByRole("alertdialog")).getByRole("button", { name: "common.cancel" }));
  expect(api.deleteAttachment).not.toHaveBeenCalled();
});

test("a delete the server refuses because the case just concluded says so on the row", async () => {
  api.attachments.mockResolvedValue(list([item("a")]));
  api.deleteAttachment.mockRejectedValue({ response: { status: 403, data: { code: "concluded" } } });
  renderIt();
  fireEvent.click(within(await screen.findByTestId("attachment-a")).getByRole("button", { name: "common.delete" }));
  fireEvent.click(within(await screen.findByRole("alertdialog")).getByRole("button", { name: "common.delete" }));
  expect(await within(screen.getByTestId("attachment-a")).findByRole("alert")).toHaveTextContent("case.attachments.delete_concluded");
});

test("clicking a row opens the right-hand drawer: an image inline", async () => {
  api.attachments.mockResolvedValue(list([item("a", { name: "现场.jpg", content_type: "image/jpeg" })]));
  api.attachmentLink.mockResolvedValue({ url: "/api/v1/case-attachments/a/?t=tok", name: "现场.jpg", content_type: "image/jpeg" });
  renderIt();
  fireEvent.click(within(await screen.findByTestId("attachment-a")).getByText("现场.jpg"));
  const preview = await screen.findByTestId("attachment-preview");
  const img = await within(preview).findByRole("img");
  expect(img.getAttribute("src")).toContain("/api/v1/case-attachments/a/?t=tok");
  expect(preview.querySelector("iframe")).toBeNull();
  expect(api.attachmentLink).toHaveBeenCalledWith("j-1", "a");
  expect(within(preview).getByRole("link", { name: "case.attachments.open_tab" })).toHaveAttribute("target", "_blank");
});

test("a PDF opens in the browser's own reader (an iframe), not an <img>", async () => {
  api.attachments.mockResolvedValue(list([item("p", { name: "契约.pdf" })]));
  api.attachmentLink.mockResolvedValue({ url: "/api/v1/case-attachments/p/?t=tok", name: "契约.pdf", content_type: "application/pdf" });
  renderIt();
  fireEvent.click(within(await screen.findByTestId("attachment-p")).getByText("契约.pdf"));
  const preview = await screen.findByTestId("attachment-preview");
  await waitFor(() => expect(preview.querySelector("iframe")).not.toBeNull());
  expect(preview.querySelector("iframe")?.getAttribute("src")).toContain("case-attachments/p/?t=tok");
  expect(within(preview).queryByRole("img")).not.toBeInTheDocument();
});

test("download fetches a fresh signed link and asks for it as an attachment", async () => {
  api.attachments.mockResolvedValue(list([item("a")]));
  api.attachmentLink.mockResolvedValue({ url: "/api/v1/case-attachments/a/?t=tok", name: "a.pdf", content_type: "application/pdf" });
  const click = jest.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
  renderIt();
  fireEvent.click(within(await screen.findByTestId("attachment-a")).getByRole("button", { name: "case.attachments.download" }));
  await waitFor(() => expect(click).toHaveBeenCalled());
  expect(api.attachmentLink).toHaveBeenCalledWith("j-1", "a");
  click.mockRestore();
});

test("the print list page carries name, size, uploader and time, is print-only, and is absent with no attachments", async () => {
  api.attachments.mockResolvedValue(list([item("a", { name: "现场.jpg", byte_size: 4 * MB })]));
  renderIt(true, <CaseAttachmentsPrintList judgmentId="j-1" enabled />);
  const page = await screen.findByTestId("attachments-print-list");
  expect(page).toHaveTextContent("case.attachments.print_title");
  expect(page).toHaveTextContent("现场.jpg");
  expect(page).toHaveTextContent("4.0 MB");
  expect(page).toHaveTextContent("崔判官");
  expect(page).toHaveTextContent("at:2026-10-12T02:02:00Z");
  expect(page.className).toMatch(/\bhidden\b/);
  expect(page.className).toMatch(/print:block/);
  expect(page.className).toMatch(/break-before-page/);
});

test("no print page when there is nothing to list, or the caller may not read", async () => {
  api.attachments.mockResolvedValue(list([]));
  const { unmount } = renderIt(true, <CaseAttachmentsPrintList judgmentId="j-1" enabled />);
  await waitFor(() => expect(api.attachments).toHaveBeenCalled());
  expect(screen.queryByTestId("attachments-print-list")).not.toBeInTheDocument();
  unmount();
  jest.resetAllMocks();
  renderIt(true, <CaseAttachmentsPrintList judgmentId="j-1" enabled={false} />);
  expect(api.attachments).not.toHaveBeenCalled();
  expect(screen.queryByTestId("attachments-print-list")).not.toBeInTheDocument();
});

test("the screen section is marked print-hidden so only the list page prints", async () => {
  api.attachments.mockResolvedValue(list([item("a")]));
  renderIt();
  expect(await screen.findByTestId("case-attachments")).toHaveAttribute("data-print-hide");
});
