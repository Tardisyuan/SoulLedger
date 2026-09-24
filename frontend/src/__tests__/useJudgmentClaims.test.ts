/**
 * The queue's claim-family hooks (`@soulledger/core/hooks/useJudgments`):
 * claim / release / reassign / defer / undefer / batch, and the group counts.
 *
 * What is held here: each hook calls the one API function it names with the
 * arguments it was given, invalidates `judgmentKeys.all` whether the server
 * accepted or refused (a refusal is news too — someone else has the case), and
 * raises NO toast, because the caller branches on the refusal's `code`.
 */
import { renderHook, waitFor, act } from "@testing-library/react";
import { createElement } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  useBatchJudgments,
  useClaimJudgment,
  useDeferJudgment,
  useJudgmentQueueCounts,
  useReassignJudgment,
  useReleaseJudgment,
  useUndeferJudgment,
} from "@soulledger/core/hooks/useJudgments";
import { judgmentApi } from "@soulledger/core/api";

const mockNotify = jest.fn();

jest.mock("@soulledger/core/api", () => ({
  judgmentApi: {
    claim: jest.fn().mockResolvedValue({ data: {} }),
    release: jest.fn().mockResolvedValue({ data: {} }),
    reassign: jest.fn().mockResolvedValue({ data: {} }),
    defer: jest.fn().mockResolvedValue({ data: {} }),
    undefer: jest.fn().mockResolvedValue({ data: {} }),
    batch: jest.fn().mockResolvedValue({ data: { operation: "claim", count: 0, ids: [] } }),
    queueCounts: jest
      .fn()
      .mockResolvedValue({ data: { mine: 1, unclaimed: 2, others: 3, deferred: 4, total: 10 } }),
  },
}));

// Same `requireActual` spread as useJudgments.test.ts, for the same reason:
// the module also carries the web adapter jest.setup.js installed.
jest.mock("@soulledger/core/platform", () => ({
  ...jest.requireActual("@soulledger/core/platform"),
  notify: (...args: unknown[]) => mockNotify(...args),
}));

function createWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  jest.spyOn(queryClient, "invalidateQueries");
  return {
    queryClient,
    wrapper: function Wrapper({ children }: { children: React.ReactNode }) {
      return createElement(QueryClientProvider, { client: queryClient }, children);
    },
  };
}

beforeEach(() => {
  jest.clearAllMocks();
});

describe("useJudgmentQueueCounts", () => {
  it("fetches the counts with the list's filters", async () => {
    const { wrapper } = createWrapper();
    const { result } = renderHook(() => useJudgmentQueueCounts({ court: "第一殿" }), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(judgmentApi.queueCounts).toHaveBeenCalledWith({ court: "第一殿" });
    expect(result.current.data).toEqual({ mine: 1, unclaimed: 2, others: 3, deferred: 4, total: 10 });
  });
});

const cases: Array<{
  name: string;
  hook: () => { mutate: (_vars: never) => void; isSuccess: boolean; isError: boolean };
  vars: unknown;
  api: keyof typeof judgmentApi;
  args: unknown[];
}> = [
  { name: "useClaimJudgment", hook: useClaimJudgment as never, vars: "j-1", api: "claim", args: ["j-1"] },
  { name: "useReleaseJudgment", hook: useReleaseJudgment as never, vars: "j-1", api: "release", args: ["j-1"] },
  {
    name: "useReassignJudgment",
    hook: useReassignJudgment as never,
    vars: { id: "j-1", to: 7 },
    api: "reassign",
    args: ["j-1", 7],
  },
  {
    name: "useDeferJudgment",
    hook: useDeferJudgment as never,
    vars: { id: "j-1", reason: "待补证" },
    api: "defer",
    args: ["j-1", "待补证"],
  },
  { name: "useUndeferJudgment", hook: useUndeferJudgment as never, vars: "j-1", api: "undefer", args: ["j-1"] },
  {
    name: "useBatchJudgments",
    hook: useBatchJudgments as never,
    vars: { operation: "claim", ids: ["a", "b"] },
    api: "batch",
    args: [{ operation: "claim", ids: ["a", "b"] }],
  },
];

describe.each(cases)("$name", ({ hook, vars, api, args }) => {
  it("calls its API function and invalidates the judgment family, without a toast", async () => {
    const { queryClient, wrapper } = createWrapper();
    const { result } = renderHook(() => hook(), { wrapper });
    await act(async () => {
      result.current.mutate(vars as never);
    });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(judgmentApi[api]).toHaveBeenCalledWith(...args);
    expect(queryClient.invalidateQueries).toHaveBeenCalledWith(
      expect.objectContaining({ queryKey: ["judgments"] })
    );
    expect(mockNotify).not.toHaveBeenCalled();
  });

  it("still invalidates when the server refuses — the refusal is news", async () => {
    (judgmentApi[api] as jest.Mock).mockRejectedValueOnce(
      Object.assign(new Error("409"), { response: { status: 409, data: { code: "already_claimed" } } })
    );
    const { queryClient, wrapper } = createWrapper();
    const { result } = renderHook(() => hook(), { wrapper });
    await act(async () => {
      result.current.mutate(vars as never);
    });
    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(queryClient.invalidateQueries).toHaveBeenCalledWith(
      expect.objectContaining({ queryKey: ["judgments"] })
    );
    expect(mockNotify).not.toHaveBeenCalled();
  });
});
