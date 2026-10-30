/**
 * Tests for the soul lifecycle hooks in src/hooks/useSouls.ts that the
 * existing useSouls.test.ts does not reach: useSoul, useSoulLedger,
 * useAddSoulRecord.
 *
 * The failure mode these guard against is a mutation that succeeds on the
 * server but forgets to invalidate a cache key — the operator then sees the
 * pre-mutation state and no error. Each mutation below is asserted on the
 * exact set of keys it invalidates, and on the keys it must leave alone.
 */
import { renderHook, waitFor, act } from "@testing-library/react";
import { createElement } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  useSoul,
  useSoulLedger,
  useAddSoulRecord,
} from "@soulledger/core/hooks/useSouls";
import { soulsApi } from "@soulledger/core/api";

const mockShowToast = jest.fn();

jest.mock("@soulledger/core/api", () => ({
  soulsApi: {
    get: jest.fn().mockResolvedValue({ data: { id: "s1" } }),
    karma: jest.fn().mockResolvedValue({ data: { balance: 10 } }),
    die: jest.fn().mockResolvedValue({ data: {} }),
    transition: jest.fn().mockResolvedValue({ data: {} }),
    addRecord: jest.fn().mockResolvedValue({ data: {} }),
  },
}));

// The hooks under test now raise their toasts through `@soulledger/core/platform`'s
// `notify` port instead of `useToast()`. The assertions below are unchanged and
// still read `mockShowToast`; this block is what keeps pointing them at it.
//
// A `requireActual` spread rather than a bare object, and that matters: this
// module also exports the token readers and `onSessionSuspend`, and
// `jest.setup.js` has already installed the real web adapter through it.
// Replacing the whole module would take the adapter with it and break things
// that have nothing to do with toasts.
//
// Rest args, not `(message, kind, durationMs)`: forwarding a third `undefined`
// would make every `toHaveBeenCalledWith(msg, kind)` assertion below fail on an
// argument the hook never passed.
jest.mock("@soulledger/core/platform", () => ({
  ...jest.requireActual("@soulledger/core/platform"),
  notify: (...args: unknown[]) => mockShowToast(...args),
}));

// NO `jest.mock("@/src/contexts/I18nContext")`. The hook under test stopped
// importing it when `notify` began taking a message key — the strings below are
// keys because that is what the hook now passes, not because a stub echoed them.

function createWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  const invalidate = jest.spyOn(queryClient, "invalidateQueries");
  return {
    invalidate,
    wrapper: function Wrapper({ children }: { children: React.ReactNode }) {
      return createElement(QueryClientProvider, { client: queryClient }, children);
    },
  };
}

const keys = (invalidate: jest.SpyInstance): string[] =>
  invalidate.mock.calls.map(([arg]) => JSON.stringify((arg as { queryKey: unknown }).queryKey));

beforeEach(() => {
  jest.clearAllMocks();
});

// ── Queries ──────────────────────────────────────────────────────────

describe("useSoul", () => {
  it("fetches the soul and exposes the response body", async () => {
    const { wrapper } = createWrapper();

    const { result } = renderHook(() => useSoul("s1"), { wrapper });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(soulsApi.get).toHaveBeenCalledWith("s1");
    expect(result.current.data).toEqual({ id: "s1" });
  });

  it("does not fire a request for an empty id", () => {
    const { wrapper } = createWrapper();

    const { result } = renderHook(() => useSoul(""), { wrapper });

    expect(soulsApi.get).not.toHaveBeenCalled();
    expect(result.current.fetchStatus).toBe("idle");
  });

  it("surfaces a fetch failure as an error state", async () => {
    (soulsApi.get as jest.Mock).mockRejectedValueOnce(new Error("404"));
    const { wrapper } = createWrapper();

    const { result } = renderHook(() => useSoul("missing"), { wrapper });

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.data).toBeUndefined();
  });
});

describe("useSoulLedger", () => {
  it("fetches the karma ledger for the soul", async () => {
    const { wrapper } = createWrapper();

    const { result } = renderHook(() => useSoulLedger("s2"), { wrapper });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(soulsApi.karma).toHaveBeenCalledWith("s2");
    expect(result.current.data).toEqual({ balance: 10 });
  });

  it("stays idle without a soul id", () => {
    const { wrapper } = createWrapper();

    renderHook(() => useSoulLedger(""), { wrapper });

    expect(soulsApi.karma).not.toHaveBeenCalled();
  });
});

// ── Mutations ────────────────────────────────────────────────────────

describe("useAddSoulRecord", () => {
  it("refreshes the soul detail and its ledger — not the whole soul list", async () => {
    const { wrapper, invalidate } = createWrapper();
    const { result } = renderHook(() => useAddSoulRecord(), { wrapper });

    await act(async () => {
      result.current.mutate({ id: "s4", data: { merit: 5 } });
    });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(soulsApi.addRecord).toHaveBeenCalledWith("s4", { merit: 5 });
    expect(keys(invalidate)).toEqual(['["souls","detail","s4"]', '["souls","ledger","s4"]']);
    expect(keys(invalidate)).not.toContain('["souls"]');
  });

  it("toasts on failure", async () => {
    (soulsApi.addRecord as jest.Mock).mockRejectedValueOnce(new Error("500"));
    const { wrapper } = createWrapper();
    const { result } = renderHook(() => useAddSoulRecord(), { wrapper });

    await act(async () => {
      result.current.mutate({ id: "s4", data: {} });
    });
    await waitFor(() => expect(result.current.isError).toBe(true));

    expect(mockShowToast).toHaveBeenCalledWith("souls.detail.failed", "error");
  });
});
