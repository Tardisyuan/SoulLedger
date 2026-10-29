import { describe, expect, it } from "vitest";

import { fetchFailureOf } from "../client";

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
