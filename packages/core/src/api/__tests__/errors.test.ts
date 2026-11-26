/** The shape-only reads of a failed request (./errors.ts): plain objects count, as the officer app's tests throw them. */
import { describe, expect, it } from "vitest";

import { answered, errorCode, errorStatus } from "../errors";

describe("errorStatus / errorCode / answered", () => {
  it("reads a plain refusal", () => {
    const e = { response: { status: 409, data: { code: "closed" } } };
    expect(answered(e)).toBe(true);
    expect(errorStatus(e)).toBe(409);
    expect(errorCode(e)).toBe("closed");
  });

  it.each([null, undefined, new Error("Network Error"), { response: null }, "x"])("no answer: %p", (e) => {
    expect(answered(e)).toBe(false);
    expect(errorStatus(e)).toBeUndefined();
    expect(errorCode(e)).toBeUndefined();
  });

  it("an answer without a body, or a code that is not a string, has no code", () => {
    expect(errorCode({ response: { status: 500 } })).toBeUndefined();
    expect(errorCode({ response: { status: 500, data: null } })).toBeUndefined();
    expect(errorCode({ response: { status: 400, data: { code: 7 } } })).toBeUndefined();
    expect(answered({ response: { status: 500 } })).toBe(true);
  });
});
