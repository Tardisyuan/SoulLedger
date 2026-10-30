/**
 * `useDebouncedValue` (packages/core/src/hooks): the value a search box's query key reads.
 * One request per pause, not one per keystroke (2026-10-30 D1).
 */
import { act, renderHook } from "@testing-library/react";
import { SEARCH_DEBOUNCE_MS, useDebouncedValue } from "@soulledger/core/hooks/useDebouncedValue";

beforeEach(() => jest.useFakeTimers());
afterEach(() => jest.useRealTimers());

it("starts at the initial value — a page opened with a search does not wait a beat", () => {
  const { result } = renderHook(() => useDebouncedValue("souls", 300));
  expect(result.current).toBe("souls");
});

it("follows only after the value has stood still for the delay, and skips the values in between", () => {
  const seen: string[] = [];
  const { result, rerender } = renderHook(({ v }) => {
    const settled = useDebouncedValue(v, 300);
    seen.push(settled);
    return settled;
  }, { initialProps: { v: "" } });

  rerender({ v: "d" });
  act(() => void jest.advanceTimersByTime(200));
  rerender({ v: "de" });
  act(() => void jest.advanceTimersByTime(299));
  expect(result.current).toBe("");

  act(() => void jest.advanceTimersByTime(1));
  expect(result.current).toBe("de");
  expect(seen).not.toContain("d");
});

it("defaults to 300 ms", () => {
  expect(SEARCH_DEBOUNCE_MS).toBe(300);
  const { result, rerender } = renderHook(({ v }) => useDebouncedValue(v), { initialProps: { v: "a" } });
  rerender({ v: "ab" });
  act(() => void jest.advanceTimersByTime(299));
  expect(result.current).toBe("a");
  act(() => void jest.advanceTimersByTime(1));
  expect(result.current).toBe("ab");
});
