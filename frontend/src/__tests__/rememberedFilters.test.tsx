import { useState } from "react";
import { act, renderHook } from "@testing-library/react";

import { readFilters, useRememberedFilters, writeFilters } from "@/src/lib/rememberedFilters";

const KEY = "soulledger.test.filters";
const FIELDS = ["state", "ordering"] as const;

beforeEach(() => localStorage.clear());

describe("rememberedFilters", () => {
  it("writes the non-empty values and reads them back", () => {
    writeFilters(KEY, { state: "SETTLED", ordering: "" });
    expect(JSON.parse(localStorage.getItem(KEY)!)).toEqual({ state: "SETTLED" });
    expect(readFilters(KEY, FIELDS)).toEqual({ state: "SETTLED" });
  });

  it("all empty removes the entry instead of leaving {} behind", () => {
    writeFilters(KEY, { state: "SETTLED" });
    writeFilters(KEY, { state: "", ordering: "" });
    expect(localStorage.getItem(KEY)).toBeNull();
  });

  it("reads only the named fields, and only strings", () => {
    localStorage.setItem(KEY, JSON.stringify({ state: 3, ordering: "-name", other: "x" }));
    expect(readFilters(KEY, FIELDS)).toEqual({ ordering: "-name" });
  });

  it.each(["not json", "null", "[]", '"a string"'])("a stored value of %s reads as nothing", (raw) => {
    localStorage.setItem(KEY, raw);
    expect(readFilters(KEY, FIELDS)).toEqual({});
  });

  it("a storage that throws is ignored on both sides", () => {
    const get = jest.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    const set = jest.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    expect(readFilters(KEY, FIELDS)).toEqual({});
    expect(() => writeFilters(KEY, { state: "SETTLED" })).not.toThrow();
    get.mockRestore();
    set.mockRestore();
  });
});

describe("useRememberedFilters", () => {
  const FIELDS2 = ["range", "kind"] as const;
  // A page whose default is not empty (the events page starts at 「近 7 天」).
  const usePage = () => {
    const [range, setRange] = useState("7d");
    const [kind, setKind] = useState("");
    useRememberedFilters(KEY, FIELDS2, { range, kind }, (saved) => {
      if (saved.range) setRange(saved.range);
      if (saved.kind) setKind(saved.kind);
    });
    return { range, kind, setRange };
  };
  // RTL's own flag, not a <StrictMode> wrapper: with the wrapper the effects ran once here and the test
  // stayed green on the broken hook (measured 2026-10-23).

  it.each([["plain", false], ["StrictMode", true]])("(%s) a stored value survives the non-empty default", (_, reactStrictMode) => {
    localStorage.setItem(KEY, JSON.stringify({ range: "30d", kind: "A" }));
    const { result } = renderHook(usePage, { reactStrictMode });
    expect(result.current).toMatchObject({ range: "30d", kind: "A" });
    expect(JSON.parse(localStorage.getItem(KEY)!)).toEqual({ range: "30d", kind: "A" });
  });

  it("nothing is written until a value changes; a change back to the default is written too", () => {
    const { result } = renderHook(usePage, { reactStrictMode: true });
    expect(localStorage.getItem(KEY)).toBeNull();
    act(() => result.current.setRange("30d"));
    expect(JSON.parse(localStorage.getItem(KEY)!)).toEqual({ range: "30d" });
    act(() => result.current.setRange("7d"));
    expect(JSON.parse(localStorage.getItem(KEY)!)).toEqual({ range: "7d" });
  });
});
