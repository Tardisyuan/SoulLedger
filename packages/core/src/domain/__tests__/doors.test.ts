/**
 * 五门的定义只有这一份(用户 2026-11-13,Q8):Web 的门栏与官员 App 的底栏都读 `domain/doors.ts`。
 * 这里守表自己的形状,和两端之间的关系(官员 App 的门是 Web 的门的子集、同一个顺序,不画的门写明在表里)。
 * Web 的表对不对得上 `app/` 下的页,在 `frontend/src/__tests__/doors.test.ts`;App 的底栏画出来什么样,在
 * `mobile-officer/src/__tests__/tabs.test.tsx`。
 */
import { describe, expect, it } from "vitest";

import {
  DOOR_ICON,
  DOOR_NAV_KEY,
  DOOR_ORDER,
  DOOR_RAIL_KEY,
  OFFICER_APP_DOORS,
  OFFICER_APP_ME,
  PAGES,
  ROLE_DOORS,
  doorFor,
  doorTabs,
  doorsFor,
  officerDoors,
  pageOf,
  type Viewer,
} from "../doors";

const viewer = (over: Partial<Viewer> & { menu?: string[]; perms?: string[] } = {}): Viewer => ({
  role: over.role,
  extraRoles: over.extraRoles,
  isAdmin: over.isAdmin ?? false,
  hasPermission: (c) => (over.perms ?? []).includes(c),
  menuPaths: new Set(over.menu ?? []),
});

describe("表的形状", () => {
  it("门不重复;角色的门、页的门、借住的门都是这五门里的", () => {
    expect(new Set(DOOR_ORDER).size).toBe(DOOR_ORDER.length);
    for (const doors of Object.values(ROLE_DOORS)) for (const d of doors) expect(DOOR_ORDER).toContain(d);
    for (const p of PAGES) {
      expect(DOOR_ORDER).toContain(p.door);
      if (p.alt) {
        expect(DOOR_ORDER).toContain(p.alt);
        expect(p.alt).not.toBe(p.door);
      }
    }
    expect(Object.keys(DOOR_RAIL_KEY).sort()).toEqual([...DOOR_ORDER].sort());
  });

  it("每一门(和「我」)有门名的键和一个图标;官员 App 的门键是同一套键", () => {
    expect(Object.keys(DOOR_NAV_KEY).sort()).toEqual([...DOOR_ORDER].sort());
    const navKeys = [...Object.values(DOOR_NAV_KEY), "me"];
    expect(new Set(navKeys).size).toBe(navKeys.length);
    expect(Object.keys(DOOR_ICON).sort()).toEqual([...navKeys].sort());
    for (const paths of Object.values(DOOR_ICON)) {
      expect(paths.length).toBeGreaterThan(0);
      for (const d of paths) expect(d).toMatch(/^M[\d.\s,a-zA-Z-]+$/);
    }
    for (const d of officerDoors()) expect(navKeys).toContain(d.key);
  });

  it("一页只在表里出现一次;每一门至少有一页;不是菜单项的页自带标签键", () => {
    expect(new Set(PAGES.map((p) => p.path)).size).toBe(PAGES.length);
    for (const d of DOOR_ORDER) expect(PAGES.filter((p) => p.door === d)).not.toEqual([]);
    expect(PAGES.filter((p) => p.gate && !p.labelKey).map((p) => p.path)).toEqual([]);
  });
});

describe("纯函数", () => {
  it("门按 DOOR_ORDER 出,不按角色表里写的顺序;认不出的角色按看得见的页推", () => {
    expect(doorsFor(viewer({ role: "MODERATOR", extraRoles: ["VIEWER"] }))).toEqual(["register", "statutes", "mortal"]);
    expect(doorsFor(viewer({ role: "CUSTOM", menu: ["/moderation", "/corpus"] }))).toEqual(["statutes", "mortal"]);
    expect(doorsFor(viewer({ role: "CUSTOM", menu: [] }))).toEqual([]);
  });

  it("最长前缀;只按整段路径认", () => {
    expect(pageOf("/judgment/appeals/7")?.path).toBe("/judgment/appeals");
    expect(pageOf("/desk/overview")?.door).toBe("office");
    expect(pageOf("/deskish")).toBeNull();
  });

  it("借住:主门不在而 alt 在,落到 alt,排在那一门自己的页后面、并进它最后一节", () => {
    const due = PAGES.find((p) => p.path === "/judgment/capture-due")!;
    expect(doorFor(due, ["desk", "register"])).toBe("desk");
    expect(doorFor(due, ["register"])).toBe("register");
    expect(doorFor(due, ["mortal"])).toBeNull();
    const guard = viewer({ role: "GUARDIAN", menu: ["/judgment/capture-due", "/souls"] });
    const tabs = doorTabs("register", guard);
    expect(tabs.map((p) => p.path)).toEqual(["/souls", "/judgment/capture-due"]);
    expect(tabs[1].section).toBe("register");
  });

  it("不是菜单项的页按读码,不看菜单;总簿只给管理员", () => {
    const paths = (v: Viewer, door: "desk" | "office") => doorTabs(door, v, [door]).map((p) => p.path);
    expect(paths(viewer({ perms: ["judgment.read"] }), "desk")).toEqual(["/desk", "/judgment/queue"]);
    expect(paths(viewer({ menu: ["/desk"] }), "desk")).toEqual([]);
    expect(paths(viewer({ isAdmin: true }), "office")).toEqual(["/desk/overview"]);
    expect(paths(viewer({ perms: ["judgment.read"] }), "office")).toEqual([]);
  });
});

describe("官员 App 的底栏与 Web 的门是同一份", () => {
  const drawn = DOOR_ORDER.filter((d) => OFFICER_APP_DOORS[d]);

  it("审 · 册 · 我,按门的顺序,「我」在最后", () => {
    expect(officerDoors().map((d) => d.key)).toEqual(["desk", "roll", "me"]);
    expect(officerDoors().slice(-1)[0]).toBe(OFFICER_APP_ME);
    expect(officerDoors().slice(0, -1)).toEqual(drawn.map((d) => OFFICER_APP_DOORS[d]));
  });

  it("画出来的门判官在 Web 上都有;判官在 Web 上有而 App 不画的只有「律」", () => {
    for (const d of drawn) expect(ROLE_DOORS.JUDGE).toContain(d);
    expect(ROLE_DOORS.JUDGE.filter((d) => !OFFICER_APP_DOORS[d])).toEqual(["statutes"]);
  });

  it("每一页只在一格里;画出来的门都有页;键不重复", () => {
    const pages = officerDoors().flatMap((d) => d.pages);
    expect([...pages].sort()).toEqual(["me", "notices", "queue", "search", "todo"]);
    for (const d of officerDoors()) expect(d.pages.length).toBeGreaterThan(0);
    expect(new Set(officerDoors().map((d) => d.key)).size).toBe(officerDoors().length);
  });
});
