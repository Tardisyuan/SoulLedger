import { useState } from "react";
import { act, renderHook } from "@testing-library/react";

import { parseUrlFilters, useUrlFilters, type UrlFieldRule } from "@/src/lib/useUrlFilters";

let mockSearch = "";
jest.mock("next/navigation", () => ({ useSearchParams: () => new URLSearchParams(mockSearch) }));

const KEY = "soulledger.test.url-filters";
const FIELDS = {
  state: ["ALIVE", "SETTLED"],
  q: "text",
  ordering: /^-?name$/,
} satisfies Record<string, UrlFieldRule>;

const usePage = () => {
  const [state, setState] = useState("");
  const [q, setQ] = useState("");
  const [ordering, setOrdering] = useState("");
  const [page, setPage] = useState(1);
  useUrlFilters({
    storageKey: KEY,
    fields: FIELDS,
    remember: ["state", "ordering"],
    values: { state, q, ordering },
    page,
    restore: (v, p) => {
      setState(v.state);
      setQ(v.q);
      setOrdering(v.ordering);
      setPage(p);
    },
  });
  return { state, q, ordering, page, setState, setQ, setPage };
};

const address = () => new URLSearchParams(window.location.search);

beforeEach(() => {
  jest.useFakeTimers();
  mockSearch = "";
  localStorage.clear();
  window.history.replaceState(null, "", "/list");
});
afterEach(() => {
  jest.useRealTimers();
  window.history.replaceState(null, "", "/");
});

describe("useUrlFilters", () => {
  it.each([["plain", false], ["StrictMode", true]])("(%s) the address wins over what is stored", (_, reactStrictMode) => {
    localStorage.setItem(KEY, JSON.stringify({ state: "ALIVE", ordering: "-name" }));
    mockSearch = "state=SETTLED&page=3";
    const { result } = renderHook(usePage, { reactStrictMode });
    expect(result.current).toMatchObject({ state: "SETTLED", ordering: "", page: 3 });
  });

  it("the stored filters are used when the address names none, and then written into it", () => {
    localStorage.setItem(KEY, JSON.stringify({ state: "ALIVE", ordering: "-name" }));
    mockSearch = "soul=abc";
    window.history.replaceState(null, "", "/list?soul=abc");
    const { result } = renderHook(usePage);
    expect(result.current).toMatchObject({ state: "ALIVE", ordering: "-name", page: 1 });
    act(() => jest.advanceTimersByTime(300));
    expect(address().get("state")).toBe("ALIVE");
    expect(address().get("ordering")).toBe("-name");
    // A parameter the hook does not own stays.
    expect(address().get("soul")).toBe("abc");
  });

  it("values the rules do not accept are ignored, from the address and from storage", () => {
    mockSearch = "state=BOGUS&ordering=drop%20table&q=%20%20&page=-3";
    expect(parseUrlFilters(mockSearch, FIELDS)).toEqual({ values: { state: "", q: "", ordering: "" }, page: 1, named: false });
    for (const raw of ["0", "abc", "2.5", "9999999"]) expect(parseUrlFilters(`page=${raw}`, FIELDS).page).toBe(1);
    expect(parseUrlFilters(`q=${"x".repeat(201)}`, FIELDS).values.q).toBe("");

    localStorage.setItem(KEY, JSON.stringify({ state: "GONE" }));
    const { result } = renderHook(usePage);
    expect(result.current).toMatchObject({ state: "", ordering: "", q: "", page: 1 });
  });

  it("the page number round-trips through the address; page 1 is left out", () => {
    const { result } = renderHook(usePage);
    act(() => result.current.setPage(4));
    act(() => jest.advanceTimersByTime(300));
    expect(address().get("page")).toBe("4");
    expect(parseUrlFilters(window.location.search, FIELDS).page).toBe(4);
    act(() => result.current.setPage(1));
    act(() => jest.advanceTimersByTime(300));
    expect(address().has("page")).toBe(false);
  });

  it("typing replaces the entry once, after the pause; clearing the filters cleans the query", () => {
    const replace = jest.spyOn(window.history, "replaceState");
    const push = jest.spyOn(window.history, "pushState");
    const { result } = renderHook(usePage);
    for (const text of ["a", "al", "ali"]) {
      act(() => result.current.setQ(text));
      act(() => jest.advanceTimersByTime(100));
    }
    expect(replace).not.toHaveBeenCalled();
    act(() => jest.advanceTimersByTime(300));
    expect(replace).toHaveBeenCalledTimes(1);
    expect(address().get("q")).toBe("ali");
    act(() => result.current.setState("SETTLED"));
    act(() => jest.advanceTimersByTime(300));
    expect(Object.fromEntries(address())).toEqual({ q: "ali", state: "SETTLED" });

    act(() => {
      result.current.setQ("");
      result.current.setState("");
    });
    act(() => jest.advanceTimersByTime(300));
    expect(window.location.search).toBe("");
    expect(localStorage.getItem(KEY)).toBeNull();
    expect(push).not.toHaveBeenCalled();
    replace.mockRestore();
    push.mockRestore();
  });

  it("only the remembered fields are stored", () => {
    const { result } = renderHook(usePage);
    act(() => {
      result.current.setQ("alice");
      result.current.setState("SETTLED");
    });
    expect(JSON.parse(localStorage.getItem(KEY)!)).toEqual({ state: "SETTLED" });
  });

  it("a change of address from outside (a link, back) is read again", () => {
    const { result, rerender } = renderHook(usePage);
    mockSearch = "state=ALIVE&page=2";
    rerender();
    expect(result.current).toMatchObject({ state: "ALIVE", page: 2 });
  });
});
