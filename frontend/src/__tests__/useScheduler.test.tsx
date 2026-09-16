/**
 * The scheduler hooks: refresh cadence, what a write invalidates, and how a
 * failed write is read.
 *
 * The cadence tests drive a REAL QueryClient on fake timers and count requests,
 * rather than reading `options.refetchInterval` back. A function that returns
 * the right number while TanStack never calls it — or calls it with the wrong
 * `data` — would pass a read-back and fail here.
 */
import { act, renderHook, waitFor } from "@testing-library/react";
import { createElement, type ReactNode } from "react";
import { QueryClient, QueryClientProvider, focusManager } from "@tanstack/react-query";
import {
  SCHEDULER_POLL_FAST_MS,
  SCHEDULER_POLL_SLOW_MS,
  classifySchedulerError,
  schedulerPollInterval,
  useRebuildSchedules,
  useRunScheduledJob,
  useScheduledJobs,
  useTaskRuns,
  useUpdateScheduledJob,
} from "@soulledger/core/hooks/useScheduler";
import { schedulerKeys } from "@soulledger/core/query_keys";

jest.mock("@soulledger/core/api", () => ({
  schedulerApi: {
    jobs: jest.fn(),
    runs: jest.fn(),
    updateJob: jest.fn(),
    runJob: jest.fn(),
    rebuild: jest.fn(),
  },
}));

const { schedulerApi } = jest.requireMock("@soulledger/core/api") as {
  schedulerApi: Record<"jobs" | "runs" | "updateJob" | "runJob" | "rebuild", jest.Mock>;
};

const job = (id: number, status: string | null) => ({
  id,
  last_run: status === null ? null : { id: id * 10, status },
});

function wrapperFor(client: QueryClient) {
  return ({ children }: { children: ReactNode }) => createElement(QueryClientProvider, { client }, children);
}

function newClient() {
  return new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
}

beforeEach(() => {
  jest.clearAllMocks();
  focusManager.setFocused(undefined);
});

describe("schedulerPollInterval", () => {
  it("polls slowly only while the socket is up and nothing is in flight", () => {
    expect(schedulerPollInterval(true, ["SUCCESS", "FAILURE", null, undefined])).toBe(SCHEDULER_POLL_SLOW_MS);
    expect(schedulerPollInterval(true, [])).toBe(SCHEDULER_POLL_SLOW_MS);
  });

  it("polls fast when the socket is down, whatever the rows say", () => {
    expect(schedulerPollInterval(false, ["SUCCESS"])).toBe(SCHEDULER_POLL_FAST_MS);
  });

  it.each(["PENDING", "RUNNING"])("polls fast while a run is %s", (status) => {
    expect(schedulerPollInterval(true, ["SUCCESS", status])).toBe(SCHEDULER_POLL_FAST_MS);
  });

  it("the two cadences are the ones the user chose", () => {
    expect([SCHEDULER_POLL_FAST_MS, SCHEDULER_POLL_SLOW_MS]).toEqual([5_000, 60_000]);
  });
});

describe("useScheduledJobs cadence, counted in requests", () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  async function mountWith(rows: unknown[], realtimeConnected: boolean) {
    schedulerApi.jobs.mockResolvedValue({ data: rows });
    const client = newClient();
    const hook = renderHook((props: { realtimeConnected: boolean }) => useScheduledJobs(props), {
      wrapper: wrapperFor(client),
      initialProps: { realtimeConnected },
    });
    await act(async () => {
      await Promise.resolve();
    });
    expect(schedulerApi.jobs).toHaveBeenCalledTimes(1);
    return hook;
  }

  async function advance(ms: number) {
    await act(async () => {
      jest.advanceTimersByTime(ms);
      await Promise.resolve();
    });
  }

  it("connected and idle: nothing at 5 s, one refetch by 60 s", async () => {
    await mountWith([job(1, "SUCCESS")], true);
    await advance(SCHEDULER_POLL_FAST_MS + 100);
    expect(schedulerApi.jobs).toHaveBeenCalledTimes(1);
    await advance(SCHEDULER_POLL_SLOW_MS);
    expect(schedulerApi.jobs).toHaveBeenCalledTimes(2);
  });

  it("connected with a RUNNING row: refetches at 5 s", async () => {
    await mountWith([job(1, "SUCCESS"), job(2, "RUNNING")], true);
    await advance(SCHEDULER_POLL_FAST_MS + 100);
    expect(schedulerApi.jobs).toHaveBeenCalledTimes(2);
  });

  it("switches to 5 s the moment the socket drops", async () => {
    const hook = await mountWith([job(1, "SUCCESS")], true);
    hook.rerender({ realtimeConnected: false });
    await advance(SCHEDULER_POLL_FAST_MS + 100);
    expect(schedulerApi.jobs).toHaveBeenCalledTimes(2);
  });

  it("does not poll at all while the tab is hidden", async () => {
    await mountWith([job(1, "RUNNING")], false);
    act(() => focusManager.setFocused(false));
    await advance(SCHEDULER_POLL_FAST_MS * 4);
    expect(schedulerApi.jobs).toHaveBeenCalledTimes(1);
  });
});

describe("useTaskRuns", () => {
  it("keys the page under the runs root and passes the filters through", async () => {
    schedulerApi.runs.mockResolvedValue({ data: { count: 0, next: null, previous: null, results: [] } });
    const client = newClient();
    const { result } = renderHook(() => useTaskRuns({ job: 7, status: "FAILURE", page: 2 }, { realtimeConnected: true }), {
      wrapper: wrapperFor(client),
    });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(schedulerApi.runs).toHaveBeenCalledWith({ job: 7, status: "FAILURE", page: 2 });
    expect(client.getQueryData(schedulerKeys.runs.list({ job: 7, status: "FAILURE", page: 2 }))).toBeDefined();
  });

  it("does not fetch while disabled (the drawer is closed)", async () => {
    const client = newClient();
    renderHook(() => useTaskRuns({ job: 7 }, { realtimeConnected: true, enabled: false }), { wrapper: wrapperFor(client) });
    await act(async () => {
      await Promise.resolve();
    });
    expect(schedulerApi.runs).not.toHaveBeenCalled();
  });
});

describe("writes invalidate what they change", () => {
  function seeded() {
    const client = newClient();
    client.setQueryData(schedulerKeys.jobs, [{ id: 1, enabled: true }, { id: 2, enabled: true }]);
    client.setQueryData(schedulerKeys.runs.list({ job: 1 }), { results: [] });
    client.setQueryData(["souls", "list", undefined], { results: [] });
    return client;
  }
  const stale = (client: QueryClient, key: readonly unknown[]) => client.getQueryState(key)?.isInvalidated;

  it("a manual run invalidates the job rows AND the runs, and nothing else", async () => {
    schedulerApi.runJob.mockResolvedValue({ data: { id: 99, status: "PENDING" } });
    const client = seeded();
    const { result } = renderHook(() => useRunScheduledJob(), { wrapper: wrapperFor(client) });
    await act(async () => {
      await result.current.mutateAsync(1);
    });
    expect(schedulerApi.runJob).toHaveBeenCalledWith(1);
    expect(stale(client, schedulerKeys.jobs)).toBe(true);
    expect(stale(client, schedulerKeys.runs.list({ job: 1 }))).toBe(true);
    expect(stale(client, ["souls", "list", undefined])).toBe(false);
  });

  it("a PATCH writes the returned row into the list before the refetch", async () => {
    schedulerApi.updateJob.mockResolvedValue({ data: { id: 2, enabled: false } });
    const client = seeded();
    const { result } = renderHook(() => useUpdateScheduledJob(), { wrapper: wrapperFor(client) });
    await act(async () => {
      await result.current.mutateAsync({ id: 2, data: { enabled: false } });
    });
    expect(schedulerApi.updateJob).toHaveBeenCalledWith(2, { enabled: false });
    expect(client.getQueryData(schedulerKeys.jobs)).toEqual([
      { id: 1, enabled: true },
      { id: 2, enabled: false },
    ]);
    expect(stale(client, schedulerKeys.jobs)).toBe(true);
  });

  it("a rebuild invalidates the whole scheduler root", async () => {
    schedulerApi.rebuild.mockResolvedValue({ data: { created: 1, updated: 0, removed: 0, legacy_removed: 0 } });
    const client = seeded();
    const { result } = renderHook(() => useRebuildSchedules(), { wrapper: wrapperFor(client) });
    await act(async () => {
      await result.current.mutateAsync();
    });
    expect(stale(client, schedulerKeys.jobs)).toBe(true);
    expect(stale(client, schedulerKeys.runs.list({ job: 1 }))).toBe(true);
  });
});

describe("classifySchedulerError", () => {
  const http = (status: number, data?: unknown) => ({ response: { status, data } });

  it("reads the three statuses the run endpoint defines", () => {
    expect(classifySchedulerError(http(409, { detail: "x" }))).toEqual({ kind: "locked" });
    expect(classifySchedulerError(http(503, { detail: "x" }))).toEqual({ kind: "enqueue_failed" });
    expect(classifySchedulerError(http(403))).toEqual({ kind: "forbidden" });
  });

  it("keeps 400 field errors by field, list or bare string", () => {
    expect(classifySchedulerError(http(400, { cron: ["invalid crontab: bad"] }))).toEqual({
      kind: "invalid",
      fields: { cron: ["invalid crontab: bad"] },
    });
    expect(classifySchedulerError(http(400, { timezone: "Unknown zone" }))).toEqual({
      kind: "invalid",
      fields: { timezone: ["Unknown zone"] },
    });
  });

  it("falls back to other for a network error or an unknown status", () => {
    expect(classifySchedulerError(new Error("Network Error"))).toEqual({ kind: "other" });
    expect(classifySchedulerError(http(500))).toEqual({ kind: "other" });
    expect(classifySchedulerError(null)).toEqual({ kind: "other" });
  });
});
