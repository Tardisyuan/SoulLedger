import { compareVersions, fetchVersionPolicy, isBelowMinimum } from "../appVersion";

describe("compareVersions", () => {
  test.each([
    ["1.2", "1.2.0", 0],
    ["1.2.0", "1.2", 0],
    ["1.10.0", "1.9.0", 1],
    ["1.9.0", "1.10.0", -1],
    ["0.1.0", "0.1.1", -1],
    ["2", "1.99.99", 1],
    ["1.0.0.1", "1.0.0", 1],
  ])("%s vs %s -> %i", (a, b, want) => {
    expect(compareVersions(a, b)).toBe(want);
  });

  test.each([["", "1.0.0"], ["1.0.0", ""], ["abc", "1.0.0"], ["1.0.0-beta", "1.0.0"], ["1..0", "1.0"], ["v1.2", "1.2"], ["1.2.3.4.5", "1"]])(
    "invalid %j vs %j -> null",
    (a, b) => {
      expect(compareVersions(a, b)).toBeNull();
    }
  );
});

describe("isBelowMinimum", () => {
  test.each([
    ["0.1.0", "0.2.0", true],
    ["1.9.0", "1.10.0", true],
    ["1.2", "1.2.0", false],
    ["1.10.0", "1.9.0", false],
    ["1.0.0", "", false], // not configured: never blocks
    ["", "1.0.0", false],
    [undefined, "1.0.0", false],
    ["1.0.0", null, false],
    ["garbage", "1.0.0", false],
    ["1.0.0", "garbage", false],
  ])("current %j, minimum %j -> %s", (current, minimum, want) => {
    expect(isBelowMinimum(current, minimum)).toBe(want);
  });
});

describe("fetchVersionPolicy", () => {
  const realFetch = global.fetch;
  afterEach(() => {
    global.fetch = realFetch;
  });
  const respond = (init: { ok?: boolean; body?: unknown }) =>
    (global.fetch = jest.fn(async () => ({ ok: init.ok ?? true, json: async () => init.body })) as unknown as typeof fetch);

  test("maps the body", async () => {
    const f = respond({ body: { min_supported: "1.2.0", latest: "1.3.0", store_url: "https://x.test/a" } });
    await expect(fetchVersionPolicy("officer", "ios")).resolves.toEqual({ minSupported: "1.2.0", latest: "1.3.0", storeUrl: "https://x.test/a" });
    expect(String((f as jest.Mock).mock.calls[0][0])).toMatch(/\/app-version\/\?app=officer&platform=ios$/);
  });

  test("every failure is null, never a throw", async () => {
    respond({ ok: false, body: {} });
    await expect(fetchVersionPolicy("soul", "android")).resolves.toBeNull();
    global.fetch = jest.fn(async () => {
      throw new Error("offline");
    }) as unknown as typeof fetch;
    await expect(fetchVersionPolicy("soul", "android")).resolves.toBeNull();
    global.fetch = jest.fn(async () => ({ ok: true, json: async () => { throw new Error("not json"); } })) as unknown as typeof fetch;
    await expect(fetchVersionPolicy("soul", "android")).resolves.toBeNull();
  });

  test("a malformed body yields empty strings, which never block", async () => {
    respond({ body: { min_supported: 5 } });
    const policy = await fetchVersionPolicy("soul", "ios");
    expect(policy).toEqual({ minSupported: "", latest: "", storeUrl: "" });
    expect(isBelowMinimum("0.1.0", policy!.minSupported)).toBe(false);
  });
});
