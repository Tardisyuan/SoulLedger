/**
 * 评议 on the judgment page (src/components/judgment/JudgmentComments.tsx + the core hooks).
 * Real QueryClient, real hooks; only the HTTP layer is stubbed.
 */
import { render, screen, fireEvent, waitFor, act } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { judgmentApi } from "@soulledger/core/api";
import { JudgmentComments } from "@/src/components/judgment/JudgmentComments";

jest.mock("@soulledger/core/api", () => ({
  ...jest.requireActual("@soulledger/core/api"),
  judgmentApi: { comments: jest.fn(), addComment: jest.fn() },
}));
jest.mock("@/src/contexts/I18nContext", () => ({
  ...jest.requireActual("@/src/contexts/I18nContext"),
  useI18n: () => ({ t: (k: string, p?: Record<string, string>) => (p ? `${k}|${JSON.stringify(p)}` : k), formatDateTime: (v: unknown) => `at:${String(v)}`, locale: "zh-Hans", hydrated: true }),
}));

const comments = judgmentApi.comments as jest.Mock;
const addComment = judgmentApi.addComment as jest.Mock;
const row = (id: string, body: string, name = "阎罗") => ({ id, author: "u", author_name: name, body, created_at: "2026-10-10T01:00:00Z" });

const titleButton = () => screen.getByRole("button", { name: /officer_app\.comment\.title/ });

/** Renders, waits for the list to load (the title grows its count), and opens the section if it is shut. */
async function renderIt(canWrite = true) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={qc}>
      <JudgmentComments id="j-1" canWrite={canWrite} />
    </QueryClientProvider>
  );
  await waitFor(() => expect(comments).toHaveBeenCalled());
  await act(async () => {}); // let the load settle: it decides whether the section starts open
  if (titleButton().getAttribute("aria-expanded") === "false") fireEvent.click(titleButton());
}

beforeEach(() => jest.resetAllMocks());

test("lists author, time and body, oldest first", async () => {
  comments.mockResolvedValue({ data: [row("c1", "第一条"), row("c2", "第二条", "判官乙")] });
  await renderIt();
  expect(await screen.findByText("第一条")).toBeInTheDocument();
  expect(screen.getByText("第二条")).toBeInTheDocument();
  expect(screen.getByTestId("comment-c1")).toHaveTextContent("阎罗 · at:2026-10-10T01:00:00Z");
  expect(screen.queryByText("officer_app.comment.empty")).not.toBeInTheDocument();
});

test("empty list shows the empty state and no items", async () => {
  comments.mockResolvedValue({ data: [] });
  await renderIt();
  expect(await screen.findByText("officer_app.comment.empty")).toBeInTheDocument();
  expect(screen.queryByRole("listitem")).not.toBeInTheDocument();
});

test("a failed load says so, not 'empty'", async () => {
  comments.mockRejectedValue(new Error("500"));
  await renderIt();
  expect(await screen.findByRole("alert")).toBeInTheDocument();
  expect(screen.queryByText("officer_app.comment.empty")).not.toBeInTheDocument();
});

test("without write permission there is no input and no send button", async () => {
  comments.mockResolvedValue({ data: [row("c1", "只读")] });
  await renderIt(false);
  expect(await screen.findByText("只读")).toBeInTheDocument();
  expect(screen.queryByTestId("comment-input")).not.toBeInTheDocument();
  expect(screen.queryByText("officer_app.comment.send")).not.toBeInTheDocument();
});

test("blank text cannot be sent; the box is capped at the server's 2000", async () => {
  comments.mockResolvedValue({ data: [] });
  await renderIt();
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
  await renderIt();
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
  await renderIt();
  const input = (await screen.findByTestId("comment-input")) as HTMLTextAreaElement;
  fireEvent.change(input, { target: { value: "别丢" } });
  fireEvent.submit(input.closest("form") as HTMLFormElement);
  expect(await screen.findByText("officer_app.comment.failed")).toBeInTheDocument();
  expect(input.value).toBe("别丢");
});

describe("default open state and the 3-comment window", () => {
  const at = (id: string, when: string) => ({ ...row(id, `body-${id}`), created_at: when });
  const mount = (concludedAt?: string | null) => {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={qc}>
        <JudgmentComments id="j-1" canWrite concludedAt={concludedAt} />
      </QueryClientProvider>
    );
  };

  test("no comments: shut by default, title says 0, the box appears only after opening", async () => {
    comments.mockResolvedValue({ data: [] });
    mount(null);
    await waitFor(() => expect(titleButton()).toHaveTextContent("officer_app.comment.title · 0"));
    expect(titleButton()).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByTestId("comment-input")).not.toBeInTheDocument();
    fireEvent.click(titleButton());
    expect(titleButton()).toHaveAttribute("aria-expanded", "true");
    expect(await screen.findByTestId("comment-input")).toBeInTheDocument();
  });

  test("with comments: open by default; the reader can still shut it", async () => {
    comments.mockResolvedValue({ data: [row("c1", "有")] });
    mount(null);
    expect(await screen.findByText("有")).toBeInTheDocument();
    expect(titleButton()).toHaveAttribute("aria-expanded", "true");
    fireEvent.click(titleButton());
    expect(titleButton()).toHaveAttribute("aria-expanded", "false");
  });

  test("four comments: only the latest three, plus a row that expands the rest", async () => {
    comments.mockResolvedValue({ data: ["1", "2", "3", "4"].map((n) => at(`c${n}`, `2026-10-0${n}T01:00:00Z`)) });
    mount(null);
    expect(await screen.findByTestId("comment-c4")).toBeInTheDocument();
    expect(screen.queryByTestId("comment-c1")).not.toBeInTheDocument();
    expect(screen.getAllByTestId(/^comment-c/)).toHaveLength(3);
    const more = screen.getByTestId("comments-show-rest");
    expect(more).toHaveTextContent('officer_app.comment.show_rest|{"n":"1"}');
    fireEvent.click(more);
    expect(screen.getByTestId("comment-c1")).toBeInTheDocument();
    expect(screen.queryByTestId("comments-show-rest")).not.toBeInTheDocument();
  });

  test("three comments: no expand row", async () => {
    comments.mockResolvedValue({ data: ["1", "2", "3"].map((n) => at(`c${n}`, `2026-10-0${n}T01:00:00Z`)) });
    mount(null);
    expect(await screen.findByTestId("comment-c3")).toBeInTheDocument();
    expect(screen.queryByTestId("comments-show-rest")).not.toBeInTheDocument();
  });

  test("the rule sits above the first comment written after conclusion, once, and nowhere else", async () => {
    comments.mockResolvedValue({ data: [at("a", "2026-10-01T01:00:00Z"), at("b", "2026-10-05T01:00:00Z"), at("c", "2026-10-06T01:00:00Z")] });
    mount("2026-10-03T00:00:00Z");
    await screen.findByTestId("comment-b");
    const rules = screen.getAllByTestId("comments-after-close");
    expect(rules).toHaveLength(1);
    expect(screen.getByTestId("comment-b")).toContainElement(rules[0]);
    expect(screen.getByTestId("comment-c")).not.toContainElement(rules[0]);
    expect(screen.getByTestId("comment-a").querySelector("[data-testid=comments-after-close]")).toBeNull();
    expect(rules[0]).toHaveTextContent("officer_app.comment.after_close");
    expect(rules[0].className).toMatch(/text-sm/);
    expect(rules[0].className).toMatch(/color-ink-muted/);
  });

  test("no rule while the case has no conclusion time", async () => {
    comments.mockResolvedValue({ data: [at("a", "2026-10-01T01:00:00Z")] });
    mount(null);
    await screen.findByTestId("comment-a");
    expect(screen.queryByTestId("comments-after-close")).not.toBeInTheDocument();
  });

  test("no rule when every comment predates the conclusion", async () => {
    comments.mockResolvedValue({ data: [at("a", "2026-10-01T01:00:00Z")] });
    mount("2026-10-09T00:00:00Z");
    await screen.findByTestId("comment-a");
    expect(screen.queryByTestId("comments-after-close")).not.toBeInTheDocument();
  });
});
