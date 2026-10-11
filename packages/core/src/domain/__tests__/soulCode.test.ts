import { describe, expect, it } from "vitest";

import {
  acceptSoulCodeInput,
  formatSoulCode,
  groupSoulCode,
  parseSoulCodeQr,
  soulCodeQrPayload,
  spellSoulCode,
} from "../soulCode";

const CODE = "QU33Q9FW5F";

describe("grouping 3-4-3 (第二十批 §一.2)", () => {
  it("splits a full code and formats it with single spaces", () => {
    expect(groupSoulCode(CODE)).toEqual(["QU3", "3Q9F", "W5F"]);
    expect(formatSoulCode(CODE)).toBe("QU3 3Q9F W5F");
  });
  it("groups a partial code by what is there", () => {
    expect(groupSoulCode("QU33Q")).toEqual(["QU3", "3Q"]);
    expect(groupSoulCode("QU")).toEqual(["QU"]);
    expect(groupSoulCode("")).toEqual([]);
    expect(formatSoulCode("")).toBe("");
  });
  it("spells for screen readers: spaces inside a group, a full-width comma between", () => {
    expect(spellSoulCode(CODE)).toBe("Q U 3，3 Q 9 F，W 5 F");
    expect(spellSoulCode("QU33Q")).toBe("Q U 3，3 Q");
  });
});

describe("acceptSoulCodeInput (§二)", () => {
  it("uppercases and appends", () => {
    expect(acceptSoulCodeInput("QU", "3")).toEqual({ value: "QU3", problem: null });
    expect(acceptSoulCodeInput("", "q")).toEqual({ value: "Q", problem: null });
  });
  it("skips spaces, hyphens, full-width space and full-width minus", () => {
    for (const sep of [" ", "-", "　", "－"]) {
      expect(acceptSoulCodeInput("QU3", sep)).toEqual({ value: "QU3", problem: null });
    }
    expect(acceptSoulCodeInput("", "qu3 3q9f-w5f")).toEqual({ value: CODE, problem: null });
    expect(acceptSoulCodeInput("", "QU3　3Q9F－W5F")).toEqual({ value: CODE, problem: null });
  });
  it("refuses the five look-alikes with bad_char and names the character", () => {
    expect(acceptSoulCodeInput("QU", "O")).toEqual({ value: "QU", problem: { kind: "bad_char", char: "O" } });
    expect(acceptSoulCodeInput("QU", "o")).toEqual({ value: "QU", problem: { kind: "bad_char", char: "O" } });
    for (const c of ["0", "1", "I", "L"]) {
      expect(acceptSoulCodeInput("", c).problem).toEqual({ kind: "bad_char", char: c });
    }
  });
  it("refuses other symbols with bad_symbol", () => {
    expect(acceptSoulCodeInput("QU", "@")).toEqual({ value: "QU", problem: { kind: "bad_symbol", char: "@" } });
    expect(acceptSoulCodeInput("", "é").problem?.kind).toBe("bad_symbol");
  });
  it("takes nothing of a paste that holds one bad character", () => {
    expect(acceptSoulCodeInput("QU", "3Q9O")).toEqual({ value: "QU", problem: { kind: "bad_paste", char: "O" } });
    expect(acceptSoulCodeInput("", "QU3 3Q9F W5@")).toEqual({ value: "", problem: { kind: "bad_paste", char: "@" } });
  });
  it("accepts a clean paste and caps at 10", () => {
    expect(acceptSoulCodeInput("", "qu3 3q9f w5f")).toEqual({ value: CODE, problem: null });
    expect(acceptSoulCodeInput("", CODE + "ABC")).toEqual({ value: CODE, problem: null });
    expect(acceptSoulCodeInput(CODE, "A")).toEqual({ value: CODE, problem: null });
  });
  it("a bad character does not clear what is already there, and a good one afterwards still lands", () => {
    const bad = acceptSoulCodeInput("QU3", "0");
    expect(bad.value).toBe("QU3");
    expect(acceptSoulCodeInput(bad.value, "3")).toEqual({ value: "QU33", problem: null });
  });
  it("normalizes a grouped prev", () => {
    expect(acceptSoulCodeInput("QU3 3Q", "9")).toEqual({ value: "QU33Q9", problem: null });
  });
});

describe("QR payload (§一.1)", () => {
  it("round-trips", () => {
    expect(soulCodeQrPayload(CODE)).toBe("SL1:QU33Q9FW5F");
    expect(parseSoulCodeQr("SL1:QU33Q9FW5F")).toBe(CODE);
  });
  it("accepts nothing else", () => {
    for (const t of [
      "SL1:QU33Q9FW5",       // 9 chars
      "SL1:QU33Q9FW5FA",     // 11 chars
      "SL1:qu33q9fw5f",      // lower case
      "SL2:QU33Q9FW5F",      // wrong version
      "sl1:QU33Q9FW5F",      // lower-case prefix
      "QU33Q9FW5F",          // no prefix
      "SL1:QU33Q9FW5O",      // O is not in the alphabet
      "SL1:QU3 3Q9F W5F",    // grouped
      " SL1:QU33Q9FW5F",     // leading space
      "SL1:QU33Q9FW5F\n",    // trailing newline
      "https://example.com/SL1:QU33Q9FW5F",
      "",
    ]) {
      expect(parseSoulCodeQr(t)).toBeNull();
    }
  });
});
