import { describe, expect, it } from "vitest";

import {
  fetchFailureOf,
  problemDetail,
  problemFieldCodes,
  problemFieldErrors,
  problemFieldMessages,
  problemOf,
  responseCode,
  responseData,
  responseStatus,
} from "../client";

/** Design 第四十批 O-c:「无权查看或已不存在」只给 404 / 403;没有回应是网络,别的回应是可以重试的错误。 */
describe("fetchFailureOf", () => {
  it("reads 404 and 403 as gone, and nothing else", () => {
    expect(fetchFailureOf({ response: { status: 404 } })).toBe("gone");
    expect(fetchFailureOf({ response: { status: 403 } })).toBe("gone");
    for (const status of [400, 401, 409, 429, 500, 503]) expect(fetchFailureOf({ response: { status } })).toBe("other");
  });

  it("reads no answer at all as the network", () => {
    expect(fetchFailureOf(new Error("Network Error"))).toBe("network");
    expect(fetchFailureOf(null)).toBe("network");
    expect(fetchFailureOf(undefined)).toBe("network");
  });
});

/** `responseCode` 的同族:状态码、整个响应体、旧式 `{error}` 一句。 */
describe("responseStatus / responseData / problemDetail", () => {
  const refused = {
    response: { status: 409, data: { type: "about:blank", title: "Conflict", status: 409, code: "x", detail: "Nope.", count: 3 } },
  };

  it("read what an answered failure carries", () => {
    expect(responseStatus(refused)).toBe(409);
    expect(responseCode(refused)).toBe("x");
    expect(responseData<{ count: number }>(refused)?.count).toBe(3);
    expect(problemDetail(refused)).toBe("Nope.");
  });

  it("read nothing when there was no answer, or the body is not a problem", () => {
    for (const none of [new Error("Network Error"), null, undefined, "nope"]) {
      expect(responseStatus(none)).toBeNull();
      expect(responseData(none)).toBeUndefined();
      expect(problemDetail(none)).toBeUndefined();
      expect(problemOf(none)).toBeNull();
    }
    expect(responseStatus({ response: { status: "409" } })).toBeNull();
    // The pre-2026-11-14 shapes are not problems: nothing reads `error`, or a bare field dict, any more.
    expect(problemDetail({ response: { status: 400, data: { error: "Old shape." } } })).toBeUndefined();
    expect(problemFieldErrors({ response: { status: 400, data: { reason: ["Old shape."] } } })).toEqual({});
    expect(responseData({ response: { status: 500, data: null } })).toBeUndefined();
  });
});

describe("validation problems", () => {
  const invalid = {
    response: {
      status: 400,
      data: {
        type: "about:blank", title: "Bad Request", status: 400, code: "invalid", detail: "Pick one.",
        errors: [
          { field: "reason", code: "blank", detail: "May not be blank." },
          { field: "reason", code: "max_length", detail: "Too long." },
          { field: "items.1.name", code: "required", detail: "Required." },
          { code: "pick_one", detail: "Pick one." },
        ],
      },
    },
  };

  it("map fields to their first message, their codes, and every message", () => {
    expect(problemFieldErrors(invalid)).toEqual({ reason: "May not be blank.", "items.1.name": "Required." });
    expect(problemFieldCodes(invalid)).toEqual({ reason: ["blank", "max_length"], "items.1.name": ["required"] });
    expect(problemFieldMessages(invalid)).toEqual({
      reason: ["May not be blank.", "Too long."],
      "items.1.name": ["Required."],
      non_field_errors: ["Pick one."],
    });
  });
});
