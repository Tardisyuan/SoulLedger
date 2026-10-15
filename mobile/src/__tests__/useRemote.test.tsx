/**
 * `useRemote`: another fetcher is another request. The old data goes at once, and an answer that arrives
 * late from the old fetcher is dropped instead of painted over the new one (the officer queue's two tabs
 * share one hook; a slow 「我手上」 answer used to land on 「待认领」).
 */
import { act, renderHook } from "@testing-library/react-native";

import { useRemote } from "../ui";

type Props = { f: () => Promise<string> };

const deferred = <T,>() => {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
};

describe("useRemote", () => {
  it("drops a late answer from the previous fetcher and clears the previous data", async () => {
    const slow = deferred<string>();
    const fast = deferred<string>();
    const a = () => slow.promise;
    const b = () => fast.promise;
    const { result, rerender } = renderHook(({ f }: Props) => useRemote(f), { initialProps: { f: a } });
    expect(result.current.loading).toBe(true);

    rerender({ f: b });
    await act(async () => fast.resolve("B"));
    expect(result.current.data).toBe("B");

    await act(async () => slow.resolve("A"));
    expect(result.current.data).toBe("B"); // the old answer did not overwrite it
    expect(result.current.loading).toBe(false);
  });

  it("clears the data when the fetcher changes, so the old list is not shown under the new one", async () => {
    const first = deferred<string>();
    const second = deferred<string>();
    const { result, rerender } = renderHook(({ f }: Props) => useRemote(f), { initialProps: { f: () => first.promise } });
    await act(async () => first.resolve("A"));
    expect(result.current.data).toBe("A");

    rerender({ f: () => second.promise });
    expect(result.current.data).toBeNull();
    expect(result.current.loading).toBe(true);
    await act(async () => second.resolve("B"));
    expect(result.current.data).toBe("B");
  });

  it("drops a late failure from the previous fetcher too", async () => {
    const slow = deferred<string>();
    const { result, rerender } = renderHook(({ f }: Props) => useRemote(f), { initialProps: { f: () => slow.promise } });
    rerender({ f: async () => "B" });
    await act(async () => {});
    await act(async () => slow.reject(new Error("late")));
    expect(result.current.error).toBeNull();
    expect(result.current.data).toBe("B");
  });

  it("reload re-reads with the same fetcher and keeps the data meanwhile", async () => {
    let n = 0;
    const f = jest.fn(async () => `v${++n}`);
    const { result } = renderHook(() => useRemote(f));
    await act(async () => {});
    expect(result.current.data).toBe("v1");
    await act(async () => {
      await result.current.reload();
    });
    expect(result.current.data).toBe("v2");
  });
});
