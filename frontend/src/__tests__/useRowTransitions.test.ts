import { act, renderHook } from "@testing-library/react";
import { ROW_EXIT_MS, useRowTransitions } from "@/src/hooks/useRowTransitions";

/**
 * What these hold, and why each one would go red for a different reason.
 *
 * The hook's whole risk is that it cries wolf. A row diff that does not know
 * when the *query* changed flags all twenty rows on the first load, on every
 * page turn and on every filter change — and an operator who sees the
 * highlight fire at moments they caused themselves stops reading it, at which
 * point the eight silent WebSocket events it exists to report are silent
 * again with extra steps. So the baseline cases below are not edge cases; they
 * are the feature.
 */

interface Row {
  id: string;
  state: string;
}

const key = (row: Row) => row.id;

const ALIVE: Row[] = [
  { id: "a", state: "ALIVE" },
  { id: "b", state: "ALIVE" },
];

describe("useRowTransitions", () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.runOnlyPendingTimers();
    jest.useRealTimers();
  });

  it("says nothing on the first load", () => {
    const { result } = renderHook(() => useRowTransitions(ALIVE, key, "page=1"));

    expect([...result.current.entered]).toEqual([]);
    expect([...result.current.changed]).toEqual([]);
    expect(result.current.leaving).toEqual([]);
  });

  it("says nothing when the query changes under it", () => {
    // A page turn. Every row is new to the screen and none of it happened to
    // the operator — this is the case a naive diff gets wrong.
    const { result, rerender } = renderHook(
      ({ data, resetKey }: { data: Row[]; resetKey: string }) =>
        useRowTransitions(data, key, resetKey),
      { initialProps: { data: ALIVE, resetKey: "page=1" } }
    );

    rerender({
      data: [
        { id: "c", state: "ALIVE" },
        { id: "d", state: "ALIVE" },
      ],
      resetKey: "page=2",
    });

    expect([...result.current.entered]).toEqual([]);
    expect([...result.current.changed]).toEqual([]);
    expect(result.current.leaving).toEqual([]);
  });

  it("flags a row whose contents changed while the query stood still", () => {
    // Somebody else concluded a case: same key, different state.
    const { result, rerender } = renderHook(
      ({ data }: { data: Row[] }) => useRowTransitions(data, key, "page=1"),
      { initialProps: { data: ALIVE } }
    );

    rerender({ data: [{ id: "a", state: "JUDGING" }, ALIVE[1]] });

    expect([...result.current.changed]).toEqual(["a"]);
    expect([...result.current.entered]).toEqual([]);
  });

  it("flags an arrival separately from a change", () => {
    const { result, rerender } = renderHook(
      ({ data }: { data: Row[] }) => useRowTransitions(data, key, "page=1"),
      { initialProps: { data: ALIVE } }
    );

    rerender({ data: [...ALIVE, { id: "c", state: "ALIVE" }] });

    expect([...result.current.entered]).toEqual(["c"]);
    expect([...result.current.changed]).toEqual([]);
  });

  it("keeps a departed row for the length of its exit, then drops it", () => {
    const { result, rerender } = renderHook(
      ({ data }: { data: Row[] }) => useRowTransitions(data, key, "page=1"),
      { initialProps: { data: ALIVE } }
    );

    rerender({ data: [ALIVE[0]] });

    // Still drawn, and still carrying the row's last known contents — that is
    // what the table renders during the fade.
    expect(result.current.leaving.map((row) => row.key)).toEqual(["b"]);
    expect(result.current.leaving[0].item).toEqual({ id: "b", state: "ALIVE" });

    act(() => {
      jest.advanceTimersByTime(ROW_EXIT_MS);
    });

    expect(result.current.leaving).toEqual([]);
  });

  it("clears the highlight on its own timer", () => {
    const { result, rerender } = renderHook(
      ({ data }: { data: Row[] }) => useRowTransitions(data, key, "page=1"),
      { initialProps: { data: ALIVE } }
    );

    rerender({ data: [{ id: "a", state: "JUDGING" }, ALIVE[1]] });
    expect([...result.current.changed]).toEqual(["a"]);

    // The highlight deliberately outlives the 240ms settle token — it is a
    // notice, not a transition, and has to survive the eye arriving late. If
    // this ever becomes a `settle`-length flash, this assertion is where it
    // shows up.
    act(() => {
      jest.advanceTimersByTime(500);
    });
    expect([...result.current.changed]).toEqual(["a"]);

    act(() => {
      jest.advanceTimersByTime(2000);
    });
    expect([...result.current.changed]).toEqual([]);
  });

  it("computes nothing when the table has not opted in", () => {
    // `undefined` data is how DataTable spells "no transitionKey was given".
    const { result, rerender } = renderHook(
      ({ data }: { data: Row[] | undefined }) => useRowTransitions(data, key, ""),
      { initialProps: { data: undefined as Row[] | undefined } }
    );

    rerender({ data: undefined });

    expect([...result.current.entered]).toEqual([]);
    expect([...result.current.changed]).toEqual([]);
    expect(result.current.leaving).toEqual([]);
  });

  it("does not leave timers running after unmount", () => {
    const { rerender, unmount } = renderHook(
      ({ data }: { data: Row[] }) => useRowTransitions(data, key, "page=1"),
      { initialProps: { data: ALIVE } }
    );

    rerender({ data: [{ id: "a", state: "JUDGING" }] });
    unmount();

    // `jest.getTimerCount()`, NOT a `console.error` spy.
    //
    // The spy was the first thing written here and it is worthless: React 18
    // removed the "setState on an unmounted component" warning, so a hook that
    // leaks every timer it ever armed produces no console output and the
    // assertion passes. Proven by mutation — deleting both `clearTimeout`
    // calls from the cleanup left this test green. Counting the timers asks
    // the question directly and goes red for that same mutation.
    //
    // Two were armed by the rerender above: the highlight timer and one exit
    // timer for row `b`.
    expect(jest.getTimerCount()).toBe(0);
  });
});
