/**
 * 发帖 / 改帖 / 发评论成功后,按服务端给的 `screening` 告诉本人词表做了什么
 * (打码 / 送审 / 隐藏);干净就照旧(发帖「已发布」、改帖「已保存」、评论不提示)。
 */
import { renderHook, act, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import React from "react";
import { useCreatePost, useUpdatePost, useCreateComment } from "@soulledger/core/hooks/useSocial";
import { socialApi } from "@soulledger/core/api";

const mockNotify = jest.fn();

jest.mock("@soulledger/core/api", () => ({
  socialApi: { createPost: jest.fn(), updatePost: jest.fn(), createComment: jest.fn() },
}));
jest.mock("@soulledger/core/platform", () => ({
  ...jest.requireActual("@soulledger/core/platform"),
  notify: (...args: unknown[]) => mockNotify(...args),
}));

function wrapper() {
  const qc = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
  return ({ children }: { children: React.ReactNode }) => React.createElement(QueryClientProvider, { client: qc }, children);
}

beforeEach(() => mockNotify.mockClear());

const CASES: Array<[string, string | null, string | null]> = [
  ["masked", "social.screening.masked", "info"],
  ["pending_review", "social.screening.pending_review", "info"],
  ["hidden", "social.screening.hidden", "info"],
];

describe.each([
  ["useCreatePost", useCreatePost, "createPost", { content: "x" }, "social.post_created"],
  ["useUpdatePost", useUpdatePost, "updatePost", { id: "p", data: { content: "x" } }, "social.post_updated"],
  ["useCreateComment", useCreateComment, "createComment", { post: "p", content: "x" }, null],
] as const)("%s", (_name, hook, api, vars, cleanKey) => {
  const run = async (screening: string | null | undefined) => {
    (socialApi as unknown as Record<string, jest.Mock>)[api].mockResolvedValueOnce({ data: { screening } });
    const { result } = renderHook(() => hook(), { wrapper: wrapper() });
    await act(async () => {
      (result.current as unknown as { mutate: jest.Mock }).mutate(vars);
    });
    await waitFor(() => expect((result.current as { isSuccess: boolean }).isSuccess).toBe(true));
  };

  it.each(CASES)("%s: tells the author, and says nothing else", async (outcome, key, kind) => {
    await run(outcome);
    expect(mockNotify).toHaveBeenCalledTimes(1);
    expect(mockNotify).toHaveBeenCalledWith(key, kind);
  });

  it("clean / absent: the plain success message, or nothing for a comment", async () => {
    // "quarantined" stands for an outcome this build has never heard of: no empty toast.
    for (const s of ["clean", null, undefined, "quarantined"]) {
      mockNotify.mockClear();
      await run(s);
      if (cleanKey) expect(mockNotify).toHaveBeenCalledWith(cleanKey, "success");
      else expect(mockNotify).not.toHaveBeenCalled();
    }
  });
});
