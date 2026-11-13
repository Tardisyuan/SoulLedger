/**
 * @jest-environment node
 *
 * 五门在 Web 上(Design 第三十批 第 4 步 + 用户 2026-11-13 的决定):角色看到哪几门、旧页落到哪一门、
 * 门内看到哪几页(菜单决定)、进站第一页。门的定义在 `@soulledger/core/domain/doors`(与官员 App 共用,它自己的
 * vitest 在 `packages/core/src/domain/__tests__/doors.test.ts`);这里经 `src/lib/doors.ts` 读,并拿 `app/` 对表,两个方向:
 * 表里的每一页都得是真有的页(指着不存在页面的一行会画出一个点了 404 的门内页签);壳里的每一页都得落在某一门,
 * 或在下面写了理由的例外里(新页不进任何门,门栏上哪一门都不亮)。
 */
import { DOORS, DOOR_ORDER, PAGES, ROLE_DOORS, doorFor, doorHref, doorTabs, doorsFor, landingFor, pageOf, type Viewer } from "@/src/lib/doors";
import { routeForView } from "@/src/lib/defaultView";
import { isOutsideAppLayout, pageRoutes } from "./support/appRoutes";

const viewer = (over: Partial<Viewer> & { menu?: string[]; perms?: string[] } = {}): Viewer => ({
  role: over.role,
  extraRoles: over.extraRoles,
  isAdmin: over.isAdmin ?? over.role === "ADMIN",
  hasPermission: (c) => over.role === "ADMIN" || (over.perms ?? []).includes(c),
  menuPaths: new Set(over.menu ?? []),
});

describe("角色看到哪几门", () => {
  const as = (role: string) => doorsFor(viewer({ role, menu: [] }));

  it("管理员五门都有;判官没有「司」「人间」;守卫只有「册」(用户决定);版主只有「人间」;灵魂一门都没有", () => {
    expect(as("ADMIN")).toEqual(DOOR_ORDER);
    expect(as("JUDGE")).toEqual(expect.arrayContaining(["desk", "register", "statutes"]));
    for (const door of ["office", "mortal"]) expect(as("JUDGE")).not.toContain(door);
    expect(as("GUARDIAN")).toEqual(["register"]);
    expect(as("VIEWER")).toContain("register");
    expect(as("VIEWER")).not.toContain("desk");
    expect(as("MODERATOR")).toEqual(["mortal"]);
    expect(as("SOUL")).toEqual([]);
  });

  it("每一门都有角色能进,且只有管理员能进「司」", () => {
    const roles = Object.keys(ROLE_DOORS);
    for (const door of DOOR_ORDER) expect(roles.filter((r) => as(r).includes(door))).not.toEqual([]);
    expect(roles.filter((r) => as(r).includes("office"))).toEqual(["ADMIN"]);
  });

  it("每一门的首页是表里这一门自己的页", () => {
    for (const door of DOOR_ORDER) expect(PAGES.find((p) => p.path === DOORS[door].home)?.door).toBe(door);
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

  // 壳里不属于任何门的页,一页一个理由。加页时:它该进哪一门就进 `PAGES`,真的哪一门都不是才写在这里。
  const NO_DOOR: Readonly<Record<string, string>> = {
    "/profile": "「我」:门栏底部的头像点亮,不是门",
    "/notifications": "「我」:通知",
    "/welcome": "「我」:欢迎页,新账号第一次进来看一次",
    "/about": "「我」:关于",
  };
  // `(auth)` 路由组:还没登录时走的账号页(受邀、找回与重置密码、验证邮箱),没有登录的人没有门。按文件位置认,不抄名单。
  const isAuthGroup = (file: string) => file.startsWith("app/(auth)/");

  it("反过来:壳里每一个不带参数的页都落在某一门,或在写了理由的例外里", () => {
    const inShell = pageRoutes().filter((p) => !p.route.includes("[") && !isOutsideAppLayout(p.route) && !isAuthGroup(p.file));
    expect(inShell.length).toBeGreaterThan(PAGES.length); // the walk found the app
    expect(inShell.filter((p) => !pageOf(p.route) && !(p.route in NO_DOOR)).map((p) => p.route)).toEqual([]);
  });

  it("例外不留旧账:每一条都是真有的页,且确实不在任何门里", () => {
    const routes = new Set(pageRoutes().map((p) => p.route));
    expect(Object.keys(NO_DOOR).filter((r) => !routes.has(r) || pageOf(r) !== null)).toEqual([]);
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

  it("/judgment/queue 的门内标签是「审判队列」,不是「分诊」(第三十六批 第一节第 2 条)", () => {
    const page = pageOf("/judgment/queue");
    expect(page?.labelKey).toBe("breadcrumb.menu.judgment");
    expect(page?.labelKey).not.toBe("caseDesk.triage");
  });

  it("界域:管理员在 司 · 殿司;判官在「律」里只读,叫「冥界图」(第三十六批 第一节第 4 条)", () => {
    const realms = pageOf("/realms")!;
    const judge = viewer({ role: "JUDGE", menu: ["/realms", "/corpus"] });
    const admin = viewer({ role: "ADMIN", menu: ["/realms", "/corpus", "/tenants"] });
    expect(doorFor(realms, doorsFor(judge))).toBe("statutes");
    expect(doorTabs("statutes", judge).map((p) => p.path)).toEqual(["/corpus", "/realms"]);
    expect(realms.altLabelKey).toBe("overview.map.title");
    expect(doorFor(realms, doorsFor(admin))).toBe("office");
    expect(doorTabs("statutes", admin).map((p) => p.path)).not.toContain("/realms");
    expect(doorTabs("office", admin).find((p) => p.path === "/realms")?.section).toBe("hall");
  });

  it("朋友圈归「人间」:判官哪一门都不亮", () => {
    const judge = viewer({ role: "JUDGE", menu: ["/social", "/judgment"] });
    expect(pageOf("/social")?.door).toBe("mortal");
    expect(doorFor(pageOf("/social")!, doorsFor(judge))).toBeNull();
    expect(doorFor(pageOf("/social")!, doorsFor(viewer({ role: "MODERATOR" })))).toBe("mortal");
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
    // 进站第一页落在这个角色自己的门里(不然一进来门栏上哪一门都不亮);有「审」的角色不在这张表里。
    for (const role of Object.keys(ROLE_DOORS)) {
      const doors = ROLE_DOORS[role];
      const landing = landingFor(role);
      if (doors.includes("desk")) expect(landing).toBeNull();
      else expect(doorFor(pageOf(landing!)!, doors)).not.toBeNull();
    }
    expect(routeForView(null, { role: "MODERATOR", permissions: [] })).toBe("/moderation");
    expect(routeForView("operator", { role: "GUARDIAN", permissions: ["judgment.read"] })).toBe("/judgment/capture-due");
    expect(routeForView(null, { role: "JUDGE", permissions: ["judgment.read"] })).toBe("/desk");
    expect(routeForView(null, { role: "ADMIN" })).toBe("/desk/overview");
  });
});
