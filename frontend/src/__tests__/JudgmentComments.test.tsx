/**
 * 评议 on the judgment page (src/components/judgment/JudgmentComments.tsx + the core hooks).
 * Real QueryClient, real hooks; only the HTTP layer is stubbed.
 */
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { judgmentApi } from "@soulledger/core/api";
import { JudgmentComments } from "@/src/components/judgment/JudgmentComments";

jest.mock("@soulledger/core/api", () => ({
  ...jest.requireActual("@soulledger/core/api"),
  judgmentApi: { comments: jest.fn(), addComment: jest.fn() },
}));
jest.mock("@/src/contexts/I18nContext", () => ({
  ...jest.requireActual("@/src/contexts/I18nContext"),
  useI18n: () => ({ t: (k: string) => k, formatDateTime: (v: unknown) => `at:${String(v)}`, locale: "zh-Hans", hydrated: true }),
}));

const comments = judgmentApi.comments as jest.Mock;
const addComment = judgmentApi.addComment as jest.Mock;
const row = (id: string, body: string, name = "阎罗") => ({ id, author: "u", author_name: name, body, created_at: "2026-10-10T01:00:00Z" });

function renderIt(canWrite = true) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={qc}>
      <JudgmentComments id="j-1" canWrite={canWrite} />
    </QueryClientProvider>
  );
  fireEvent.click(screen.getByRole("button", { name: /officer_app\.comment\.title/ }));
}

beforeEach(() => jest.resetAllMocks());

test("lists author, time and body, oldest first", async () => {
  comments.mockResolvedValue({ data: [row("c1", "第一条"), row("c2", "第二条", "判官乙")] });
  renderIt();
  expect(await screen.findByText("第一条")).toBeInTheDocument();
  expect(screen.getByText("第二条")).toBeInTheDocument();
  expect(screen.getByTestId("comment-c1")).toHaveTextContent("阎罗 · at:2026-10-10T01:00:00Z");
  expect(screen.queryByText("officer_app.comment.empty")).not.toBeInTheDocument();
});

test("empty list shows the empty state and no items", async () => {
  comments.mockResolvedValue({ data: [] });
  renderIt();
  expect(await screen.findByText("officer_app.comment.empty")).toBeInTheDocument();
  expect(screen.queryByRole("listitem")).not.toBeInTheDocument();
});

test("a failed load says so, not 'empty'", async () => {
  comments.mockRejectedValue(new Error("500"));
  renderIt();
  expect(await screen.findByRole("alert")).toBeInTheDocument();
  expect(screen.queryByText("officer_app.comment.empty")).not.toBeInTheDocument();
});

test("without write permission there is no input and no send button", async () => {
  comments.mockResolvedValue({ data: [row("c1", "只读")] });
  renderIt(false);
  expect(await screen.findByText("只读")).toBeInTheDocument();
  expect(screen.queryByTestId("comment-input")).not.toBeInTheDocument();
  expect(screen.queryByText("officer_app.comment.send")).not.toBeInTheDocument();
});

test("blank text cannot be sent; the box is capped at the server's 2000", async () => {
  comments.mockResolvedValue({ data: [] });
  renderIt();
  const input = await screen.findByTestId("comment-input");
  expect(input).toHaveAttribute("maxlength", "2000");
  fireEvent.change(input, { target: { value: "   " } });
  expect(screen.getByText("officer_app.comment.send").closest("button")).toBeDisabled();
  fireEvent.submit(input.closest("form") as HTMLFormElement);
  expect(addComment).not.toHaveBeenCalled();
});

test("sends the trimmed text once, clears the box and refetches", async () => {
  comments.mockResolvedValue({ data: [] });
  let release!: () => void;
  addComment.mockReturnValue(new Promise((r) => (release = () => r({ data: row("c9", "新") }))));
  renderIt();
  const input = (await screen.findByTestId("comment-input")) as HTMLTextAreaElement;
  fireEvent.change(input, { target: { value: "  新  " } });
  const form = input.closest("form") as HTMLFormElement;
  fireEvent.submit(form);
  await waitFor(() => expect(addComment).toHaveBeenCalledTimes(1));
  fireEvent.submit(form); // double submit while pending
  expect(screen.getByText("officer_app.comment.send").closest("button")).toBeDisabled();
  expect(addComment).toHaveBeenCalledTimes(1);
  expect(addComment).toHaveBeenCalledWith("j-1", "新");
  comments.mockResolvedValue({ data: [row("c9", "新")] });
  release();
  await waitFor(() => expect(input.value).toBe(""));
  expect(await screen.findByTestId("comment-c9")).toBeInTheDocument();
});

test("a failed send keeps the text and shows the failure", async () => {
  comments.mockResolvedValue({ data: [] });
  addComment.mockRejectedValue(new Error("500"));
  renderIt();
  const input = (await screen.findByTestId("comment-input")) as HTMLTextAreaElement;
  fireEvent.change(input, { target: { value: "别丢" } });
  fireEvent.submit(input.closest("form") as HTMLFormElement);
  expect(await screen.findByText("officer_app.comment.failed")).toBeInTheDocument();
  expect(input.value).toBe("别丢");
});
