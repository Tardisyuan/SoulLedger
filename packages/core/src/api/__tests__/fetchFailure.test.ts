import { describe, expect, it } from "vitest";

import { fetchFailureOf, responseData, responseError, responseStatus } from "../client";

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
describe("responseStatus / responseData / responseError", () => {
  const refused = { response: { status: 409, data: { code: "x", error: "Nope.", count: 3 } } };

  it("read what an answered failure carries", () => {
    expect(responseStatus(refused)).toBe(409);
    expect(responseData<{ count: number }>(refused)?.count).toBe(3);
    expect(responseError(refused)).toBe("Nope.");
  });

  it("read nothing when there was no answer, or the field is not the right type", () => {
    for (const none of [new Error("Network Error"), null, undefined, "nope"]) {
      expect(responseStatus(none)).toBeNull();
      expect(responseData(none)).toBeUndefined();
      expect(responseError(none)).toBeUndefined();
    }
    expect(responseStatus({ response: { status: "409" } })).toBeNull();
    expect(responseError({ response: { status: 400, data: { error: ["a list"] } } })).toBeUndefined();
    expect(responseData({ response: { status: 500, data: null } })).toBeUndefined();
  });
});
