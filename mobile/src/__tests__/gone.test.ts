/** 「这条已经不在了」(第四十批 O-c): where 「回到{from}」 points, and which rows a gone detail greys. */
import { fromRouteOf, landingGoneKey } from "../gone";

describe("fromRouteOf", () => {
  it("is the route under this one", () => {
    expect(fromRouteOf({ index: 2, routes: [{ key: "t", name: "Tabs" }, { key: "i", name: "CircleInbox" }, { key: "p", name: "CirclePost" }] })).toBe("CircleInbox");
  });

  it("inside the tabs, the tab on show; Life before the tabs hold a state of their own", () => {
    const tabs = { key: "t", name: "Tabs", state: { index: 3, routes: [{ key: "l", name: "Life" }, { key: "a", name: "Applications" }, { key: "w", name: "Letters" }, { key: "c", name: "Circle" }] } };
    expect(fromRouteOf({ index: 1, routes: [tabs, { key: "p", name: "CirclePost" }] } as never)).toBe("Circle");
    expect(fromRouteOf({ index: 1, routes: [{ key: "t", name: "Tabs" }, { key: "d", name: "ApplicationDetail" }] })).toBe("Life");
  });

  it("nothing under it, or no state at all, is null (the caller's fallback names the list)", () => {
    expect(fromRouteOf({ index: 0, routes: [{ key: "p", name: "CirclePost" }] })).toBeNull();
    expect(fromRouteOf(undefined)).toBeNull();
  });
});

describe("landingGoneKey", () => {
  it("keys the two details that can be gone, and nothing else", () => {
    expect(landingGoneKey({ screen: "ApplicationDetail", id: "a1" })).toBe("application:a1");
    expect(landingGoneKey({ screen: "CirclePost", id: "p1", comment: "c1" })).toBe("post:p1");
    expect(landingGoneKey({ screen: "Conversation", id: "x" })).toBeNull();
    expect(landingGoneKey(null)).toBeNull();
  });
});
