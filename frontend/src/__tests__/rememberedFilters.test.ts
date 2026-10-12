import { readFilters, writeFilters } from "@/src/lib/rememberedFilters";

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
