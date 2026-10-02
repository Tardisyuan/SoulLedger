/**
 * A5 发帖框的配图(2026-10-02,官员也能发图):「最多 N 张」读后端、逐张上传与进度、
 * 没传完 / 有失败时不能发、失败可重试或移除、传好的发出前可移除(服务端真删)、
 * 发帖带上按顺序的图片 id、离开发帖框而没发就删掉传好的。
 */
import { act, fireEvent, render, screen, within } from "@testing-library/react";

jest.mock("@/src/contexts/I18nContext", () => ({
  useI18n: () => ({ t: (k: string, p?: Record<string, string>) => (p ? `${k}:${Object.values(p).join(",")}` : k) }),
}));

const mockMutate = jest.fn();
let mockMax: number | undefined = 4;
jest.mock("@soulledger/core/hooks/useSocial", () => ({
  useCreatePost: () => ({ mutate: mockMutate, isPending: false }),
  usePostMediaLimits: () => ({ data: mockMax === undefined ? undefined : { max_per_post: mockMax, max_pending: 18, max_bytes: 5242880 } }),
}));

type Deferred = { resolve: (_v: unknown) => void; reject: (_e: unknown) => void; progress?: (_f: number) => void };
const pending: Deferred[] = [];
const mockUpload = jest.fn((_body: FormData, onProgress?: (_f: number) => void) =>
  new Promise((resolve, reject) => pending.push({ resolve, reject, progress: onProgress })),
);
const mockRemove = jest.fn((_id: string) => Promise.resolve());
jest.mock("@soulledger/core/api", () => ({
  socialApi: { uploadMedia: (...a: [FormData, ((_f: number) => void)?]) => mockUpload(...a), removeMedia: (id: string) => mockRemove(id) },
}));

import { PostComposer } from "@/src/components/social/PostComposer";

const uploaded = (id: string) => ({ id, url: `/api/v1/social-media/${id}/?t=s`, width: 64, height: 48, byte_size: 10, content_type: "image/png" });
const file = (name: string) => new File(["x"], name, { type: "image/png" });

function pick(...names: string[]) {
  fireEvent.change(screen.getByTestId("composer-media-input"), { target: { files: names.map(file) } });
}
const postButton = () => screen.getByRole("button", { name: "social.post" });
const rows = () => Array.from(document.querySelectorAll("[data-attachment]"));

beforeEach(() => {
  jest.clearAllMocks();
  pending.length = 0;
  mockMax = 4;
});

it("「最多 N 张」的 N 来自后端,不是常量", () => {
  mockMax = 7;
  render(<PostComposer />);
  expect(document.querySelector("[data-media-limit]")!.textContent).toBe("social.media.max:7");
});

it("上限还没取到:不显示 N,「配图」不可点", () => {
  mockMax = undefined;
  render(<PostComposer />);
  expect(document.querySelector("[data-media-limit]")).toBeNull();
  expect(screen.getByRole("button", { name: /social\.media\.add/ })).toBeDisabled();
});

it("逐张上传、显示进度;没传完不能发;传完发帖带按顺序的 id", async () => {
  render(<PostComposer />);
  pick("a.png", "b.png");
  expect(mockUpload).toHaveBeenCalledTimes(2);
  expect((mockUpload.mock.calls[0][0] as FormData).get("file")).toBeInstanceOf(File);
  expect(rows().map((r) => r.getAttribute("data-attachment"))).toEqual(["uploading", "uploading"]);
  expect(postButton()).toBeDisabled();

  act(() => pending[0].progress!(0.4));
  expect(within(rows()[0] as HTMLElement).getByRole("progressbar")).toHaveAttribute("aria-valuenow", "40");

  await act(async () => pending[1].resolve(uploaded("m2")));
  expect(postButton()).toBeDisabled(); // 还有一张在传
  await act(async () => pending[0].resolve(uploaded("m1")));
  expect(rows().map((r) => r.getAttribute("data-attachment"))).toEqual(["done", "done"]);
  expect(postButton()).toBeEnabled(); // 没有文字,只有图,也能发

  fireEvent.click(postButton());
  expect(mockMutate).toHaveBeenCalledWith(
    { content: "", visibility: "PUBLIC", media: ["m1", "m2"] },
    expect.anything(),
  );
});

it("纯文字帖不带 media 字段", () => {
  render(<PostComposer />);
  fireEvent.change(screen.getByRole("textbox"), { target: { value: "只有字" } });
  fireEvent.click(postButton());
  expect(mockMutate.mock.calls[0][0]).toEqual({ content: "只有字", visibility: "PUBLIC" });
});

it("失败:写出原因、不能发;重试再传一次;移除则不带它", async () => {
  render(<PostComposer />);
  fireEvent.change(screen.getByRole("textbox"), { target: { value: "有字" } });
  pick("a.png");
  await act(async () => pending[0].reject({ response: { status: 400, data: { code: "not_an_image" } } }));
  const row = rows()[0] as HTMLElement;
  expect(row.getAttribute("data-attachment")).toBe("failed");
  expect(row.textContent).toContain("soul_app.circle.media.errors.not_an_image");
  expect(postButton()).toBeDisabled();

  fireEvent.click(within(row).getByRole("button", { name: "soul_app.circle.media.retry" }));
  expect(mockUpload).toHaveBeenCalledTimes(2);
  await act(async () => pending[1].reject(new Error("network")));
  expect(rows()[0].textContent).not.toContain("errors.");

  fireEvent.click(within(rows()[0] as HTMLElement).getByRole("button", { name: /soul_app\.circle\.media\.remove/ }));
  expect(rows()).toHaveLength(0);
  expect(postButton()).toBeEnabled();
  expect(mockRemove).not.toHaveBeenCalled(); // 没传上去的,服务端没有东西可删
});

it("传好的发出前可移除:服务端删掉,发帖不带它", async () => {
  render(<PostComposer />);
  pick("a.png", "b.png");
  await act(async () => {
    pending[0].resolve(uploaded("m1"));
    pending[1].resolve(uploaded("m2"));
  });
  fireEvent.click(within(rows()[0] as HTMLElement).getByRole("button", { name: /remove/ }));
  expect(mockRemove).toHaveBeenCalledWith("m1");
  fireEvent.click(postButton());
  expect(mockMutate.mock.calls[0][0].media).toEqual(["m2"]);
});

it("超出余量的那几张不收,并说明上限", () => {
  mockMax = 2;
  render(<PostComposer />);
  pick("a.png", "b.png", "c.png");
  expect(mockUpload).toHaveBeenCalledTimes(2);
  expect(screen.getByText("soul_app.circle.media.limit:2")).toBeInTheDocument();
  expect(screen.getByRole("button", { name: /social\.media\.add/ })).toBeDisabled();
});

it("离开发帖框而没发:传好的删掉", async () => {
  const { unmount } = render(<PostComposer />);
  pick("a.png");
  await act(async () => pending[0].resolve(uploaded("m1")));
  unmount();
  expect(mockRemove).toHaveBeenCalledWith("m1");
});
