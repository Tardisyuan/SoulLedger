/**
 * @jest-environment node
 *
 * 五门(`src/lib/doors.ts`,Design 第三十批 第 4 步 + 用户 2026-11-13 的决定):角色看到哪几门、旧页落到哪一门、
 * 门内看到哪几页(菜单决定)、进站第一页。表里的每一页都得是 `app/` 下真有的页 —— 指着不存在页面的一行
 * 会画出一个点了 404 的门内页签。
 */
import { DOOR_ORDER, PAGES, ROLE_DOORS, doorHref, doorTabs, doorsFor, landingFor, pageOf, type Viewer } from "@/src/lib/doors";
import { routeForView } from "@/src/lib/defaultView";
import { pageRoutes } from "./support/appRoutes";

const viewer = (over: Partial<Viewer> & { menu?: string[]; perms?: string[] } = {}): Viewer => ({
  role: over.role,
  extraRoles: over.extraRoles,
  isAdmin: over.isAdmin ?? over.role === "ADMIN",
  hasPermission: (c) => over.role === "ADMIN" || (over.perms ?? []).includes(c),
  menuPaths: new Set(over.menu ?? []),
});

describe("角色看到哪几门", () => {
  it("照 Design 的表,守卫只有「册」(用户决定),灵魂一门都没有", () => {
    expect(ROLE_DOORS).toEqual({
      ADMIN: ["desk", "register", "statutes", "office", "mortal"],
      JUDGE: ["desk", "register", "statutes"],
      GUARDIAN: ["register"],
      VIEWER: ["register", "statutes"],
      MODERATOR: ["mortal"],
    });
    expect(doorsFor(viewer({ role: "SOUL", menu: [] }))).toEqual([]);
  });

  it("兼任的角色合起来,按门栏的顺序", () => {
    expect(doorsFor(viewer({ role: "MODERATOR", extraRoles: ["VIEWER"] }))).toEqual(["register", "statutes", "mortal"]);
  });

  it("菜单不决定门:判官菜单里有界域,也没有「司」", () => {
    expect(doorsFor(viewer({ role: "JUDGE", menu: ["/realms", "/souls"] }))).toEqual(["desk", "register", "statutes"]);
  });

  it("认不出的角色按菜单推", () => {
    expect(doorsFor(viewer({ role: "CUSTOM", menu: ["/corpus", "/moderation"] }))).toEqual(["statutes", "mortal"]);
  });
});

describe("旧页落到哪一门", () => {
  it("表里每一页都是 app/ 下真有的页,且不重复", () => {
    const routes = new Set(pageRoutes().map((p) => p.route));
    expect(PAGES.filter((p) => !routes.has(p.path)).map((p) => p.path)).toEqual([]);
    expect(new Set(PAGES.map((p) => p.path)).size).toBe(PAGES.length);
    expect(PAGES.length).toBeGreaterThanOrEqual(40);
    for (const p of PAGES) expect(DOOR_ORDER).toContain(p.door);
  });

  it("子路由按最长前缀落:卷宗进册、审判台进审、年报进册、总簿进司;「我」的页不属于任何门", () => {
    expect(pageOf("/souls/42")?.door).toBe("register");
    expect(pageOf("/judgment/abc")?.door).toBe("desk");
    expect(pageOf("/judgment/appeals/7")?.path).toBe("/judgment/appeals");
    expect(pageOf("/dashboard/annual")?.door).toBe("register");
    expect(pageOf("/desk/overview")?.door).toBe("office");
    expect(pageOf("/desk")?.door).toBe("desk");
    expect(pageOf("/audit/logins")?.path).toBe("/audit");
    expect(pageOf("/profile")).toBeNull();
    expect(pageOf("/deskish")).toBeNull();
  });
});

describe("门内看到哪几页:菜单决定", () => {
  it("只列菜单里有的;不是菜单项的按读码", () => {
    const judge = viewer({ role: "JUDGE", perms: ["judgment.read"], menu: ["/soul-inbox", "/judgment", "/judgment/appeals"] });
    expect(doorTabs("desk", judge).map((p) => p.path)).toEqual(["/desk", "/soul-inbox", "/judgment", "/judgment/queue", "/judgment/appeals"]);
    // Absence: 殿信箱 drops out when the menu no longer grants it.
    const noInbox = viewer({ role: "JUDGE", perms: ["judgment.read"], menu: ["/judgment"] });
    expect(doorTabs("desk", noInbox).map((p) => p.path)).not.toContain("/soul-inbox");
  });

  it("菜单管理在 司 · 权限 下", () => {
    const admin = viewer({ role: "ADMIN", menu: ["/permissions", "/menus", "/users"] });
    const tabs = doorTabs("office", admin);
    expect(tabs.find((p) => p.path === "/menus")?.section).toBe("permissions");
    expect(tabs[0].path).toBe("/desk/overview");
  });

  it("守卫:待发勾魂牒落在「册」里;没有「审」", () => {
    const guard = viewer({ role: "GUARDIAN", perms: ["judgment.read"], menu: ["/souls", "/judgment/capture-due", "/judgment"] });
    expect(doorsFor(guard)).toEqual(["register"]);
    expect(doorTabs("register", guard).map((p) => p.path)).toEqual(["/souls", "/judgment/capture-due"]);
    expect(doorTabs("desk", guard)).toEqual([]);
  });

  it("判官的待发勾魂牒仍在「审」的来源里", () => {
    const judge = viewer({ role: "JUDGE", menu: ["/judgment/capture-due"] });
    expect(doorTabs("desk", judge).map((p) => p.path)).toEqual(["/judgment/capture-due"]);
    expect(doorTabs("register", judge)).toEqual([]);
  });

  it("点门去门的首页;首页看不见就去门里第一页", () => {
    const guard = viewer({ role: "GUARDIAN", menu: ["/judgment/capture-due"] });
    expect(doorHref("register", guard)).toBe("/judgment/capture-due");
    expect(doorHref("register", viewer({ role: "VIEWER", menu: ["/souls"] }))).toBe("/souls");
  });
});

describe("进站第一页", () => {
  it("没有「审」的三个角色各去自己的门;管理员与判官照旧", () => {
    expect(landingFor("GUARDIAN")).toBe("/judgment/capture-due");
    expect(landingFor("VIEWER")).toBe("/souls");
    expect(landingFor("MODERATOR")).toBe("/moderation");
    expect(landingFor("JUDGE")).toBeNull();
    expect(routeForView(null, { role: "MODERATOR", permissions: [] })).toBe("/moderation");
    expect(routeForView("operator", { role: "GUARDIAN", permissions: ["judgment.read"] })).toBe("/judgment/capture-due");
    expect(routeForView(null, { role: "JUDGE", permissions: ["judgment.read"] })).toBe("/desk");
    expect(routeForView(null, { role: "ADMIN" })).toBe("/desk/overview");
  });
});
