/**
 * 五门(Design 第三十批 第 4 步,用户 2026-11-13 拍板):审 案卷 · 册 名册 · 律 律令 · 司 殿司 · 人 人间。
 * 「我」不是门,是门栏底部的头像(窄屏、官员 App 是底栏最后一格)。
 *
 * 门的定义只有这一份(用户 2026-11-13,Q8):Web(`frontend/src/lib/doors.ts` → `DoorRail` / `DoorTabs`)
 * 与官员 App 的底栏(`mobile-officer/src/kit.tsx` 的 `TabBar` / `PageSwitch`)读同一份。纯数据加纯函数:
 *
 * 1. **角色看到哪几门**(`ROLE_DOORS`):门是固定的,按角色给,没有的门不出现(不画灰)。
 *    与 Design 表的不同(用户决定):守卫只有「册」—— 待发勾魂牒在册里(`alt`)。
 *    认不出的角色(管理员新建的)按菜单推:它看得到哪一门里的页,就有哪一门。
 * 2. **Web 的旧页落到哪一门**(`PAGES`,Design 第 3 节的对照表):每一页一个门、一个分节;门内的二级导航(`doorTabs`)
 *    就是这张表里、该门、**该用户菜单里有的**页 —— 菜单管理照旧决定一个角色在门内看到哪几页,只是不再决定门本身。
 *    不是菜单项的几页(案卷台、总簿、分诊)按自己的读码给(`gate`)。
 *    旧网址一个不改:对照表里的页都还在原地,只是换了门(哪一页被并进卷宗、总簿,等那一页做好再跳转)。
 * 3. **官员 App 的页落到哪一门**(`OFFICER_APP_DOORS`):同样的门、同样的顺序,只画有页的门。
 *
 * 留在各端的:点门去哪个网址、进站第一页(Web 的路由,`frontend/src/lib/doors.ts`);App 每页要哪几个权限码、
 * 底栏怎么画(`kit.tsx`)。
 */

export type DoorId = "desk" | "register" | "statutes" | "office" | "mortal";

/** 门栏上的顺序。 */
export const DOOR_ORDER: readonly DoorId[] = ["desk", "register", "statutes", "office", "mortal"];

/** 门上的字:Web 门栏的键(`caseDesk.rail.<key>`,沿用第 2 步的键)。 */
export const DOOR_RAIL_KEY: Readonly<Record<DoorId, string>> = {
  desk: "desk",
  register: "souls",
  statutes: "corpus",
  office: "hall",
  mortal: "moderation",
};

export const ROLE_DOORS: Readonly<Record<string, readonly DoorId[]>> = {
  ADMIN: ["desk", "register", "statutes", "office", "mortal"],
  JUDGE: ["desk", "register", "statutes"],
  GUARDIAN: ["register"],
  VIEWER: ["register", "statutes"],
  MODERATOR: ["mortal"],
};

/** 不是菜单项、按读码给的页。`admin` = 只给管理员(总簿)。 */
export type Gate = { permission: string } | "admin";

export type DoorPage = {
  path: string;
  door: DoorId;
  /** 门内的分节(`doors.section.*`);同一节的页挨着画,节与节之间一道细线。 */
  section: string;
  /** 主门不在这个人的门里、而这一门在时,落到这一门(守卫的待发勾魂牒、调拨)。 */
  alt?: DoorId;
  /** 不是菜单项:按这个给,不看菜单。 */
  gate?: Gate;
  /** 不是菜单项的页的标签键。菜单项的标签取菜单自己的(`menuGlossParts`)。 */
  labelKey?: string;
};

/**
 * Design 第 3 节的对照表(40 行),按门、按节排;节内顺序就是门内二级导航的顺序。
 * 不在表里的页(个人资料、通知、欢迎、关于)不属于任何门 —— 门栏底部的「我」点亮。
 * 子路由(`/souls/[id]`、`/audit/logins` …)按最长前缀落到表里的页上(`pageOf`)。
 */
export const PAGES: readonly DoorPage[] = [
  // 审 · 案卷台第一页、书信第二页(殿信箱,用户决定);概览数字收进案卷台顶行,旧的仪表盘仍在这里。
  { path: "/desk", door: "desk", section: "desk", gate: { permission: "judgment.read" }, labelKey: "officer_app.desk.title" },
  { path: "/soul-inbox", door: "desk", section: "desk" },
  { path: "/dashboard", door: "desk", section: "desk" },
  // 审 · 来源(案卷台的 chip 也去这几页)。转生申请是第七个来源(用户决定)。
  { path: "/judgment", door: "desk", section: "sources" },
  // 这一页叫「审判队列」(第三十六批 第一节第 2 条:标题、面包屑、门内标签同一个名字);「分诊」是案卷台上另一个来源。
  { path: "/judgment/queue", door: "desk", section: "sources", gate: { permission: "judgment.read" }, labelKey: "breadcrumb.menu.judgment" },
  { path: "/judgment/appeals", door: "desk", section: "sources" },
  { path: "/cross-judgments", door: "desk", section: "sources" },
  { path: "/city-god-cases", door: "desk", section: "sources" },
  { path: "/judgment/capture-due", door: "desk", section: "sources", alt: "register" },
  { path: "/rebirth-applications", door: "desk", section: "sources" },
  // 册 · 名册与卷宗的几页(功过、事件、轮回、受刑)、年报。
  { path: "/souls", door: "register", section: "register" },
  { path: "/ledger", door: "register", section: "register" },
  { path: "/events", door: "register", section: "register" },
  { path: "/disposition", door: "register", section: "register" },
  { path: "/rebirths", door: "register", section: "register" },
  { path: "/sentence-plans", door: "register", section: "register" },
  { path: "/sentence-requests", door: "register", section: "register" },
  { path: "/dashboard/annual", door: "register", section: "register" },
  // 律
  { path: "/corpus", door: "statutes", section: "statutes" },
  { path: "/workflow", door: "statutes", section: "statutes" },
  // 司 · 总簿
  { path: "/desk/overview", door: "office", section: "ledger", gate: "admin", labelKey: "zongbu.title" },
  { path: "/halls", door: "office", section: "ledger" },
  { path: "/admin/stats", door: "office", section: "ledger" },
  // 司 · 殿司
  { path: "/tenants", door: "office", section: "hall" },
  { path: "/realms", door: "office", section: "hall" },
  { path: "/actors", door: "office", section: "hall" },
  { path: "/city-gods", door: "office", section: "hall" },
  { path: "/death-sync/tudi-gods", door: "office", section: "hall" },
  { path: "/organizations", door: "office", section: "hall" },
  { path: "/dispatch", door: "office", section: "hall", alt: "register" },
  // 司 · 用户、权限(菜单管理在权限下,用户决定保留)、审计与回收站
  { path: "/users", door: "office", section: "users" },
  { path: "/soul-credentials", door: "office", section: "users" },
  { path: "/permissions", door: "office", section: "permissions" },
  { path: "/menus", door: "office", section: "permissions" },
  { path: "/audit", door: "office", section: "audit" },
  { path: "/audit/sessions", door: "office", section: "audit" },
  { path: "/recycle-bin", door: "office", section: "audit" },
  // 司 · 系统
  { path: "/death-sync", door: "office", section: "system" },
  { path: "/scheduler", door: "office", section: "system" },
  { path: "/admin/assistant", door: "office", section: "system" },
  // 人间(朋友圈审核员)
  { path: "/moderation", door: "mortal", section: "mortal" },
  { path: "/social", door: "mortal", section: "mortal" },
  { path: "/social/follows", door: "mortal", section: "mortal" },
];

const under = (pathname: string, path: string) => pathname === path || pathname.startsWith(path + "/");

/** 这条网址落在表里哪一页上(最长前缀)。 */
export function pageOf(pathname: string): DoorPage | null {
  let best: DoorPage | null = null;
  for (const page of PAGES) if (under(pathname, page.path) && (!best || page.path.length > best.path.length)) best = page;
  return best;
}

/** 这一页在这个人的门里落在哪一门:主门在就是主门,不在而 `alt` 在就是 `alt`,都不在是 null。 */
export function doorFor(page: DoorPage, doors: readonly DoorId[]): DoorId | null {
  if (doors.includes(page.door)) return page.door;
  return page.alt && doors.includes(page.alt) ? page.alt : null;
}

export type Viewer = {
  role?: string;
  extraRoles?: readonly string[];
  isAdmin: boolean;
  hasPermission: (codename: string) => boolean;
  /** 这个人菜单里的页(摊平,`visible=false` 的已去掉)。 */
  menuPaths: ReadonlySet<string>;
};

/** 这个人能看见表里这一页吗:菜单项看菜单,不是菜单项的看它自己的读码。 */
export function canSee(page: DoorPage, v: Viewer): boolean {
  if (page.gate === "admin") return v.isAdmin;
  if (page.gate) return v.hasPermission(page.gate.permission);
  return v.menuPaths.has(page.path);
}

/** 门栏上的门,按 `DOOR_ORDER`。角色(含兼任的)认得就按表;一个都认不得,按菜单推。 */
export function doorsFor(v: Viewer): DoorId[] {
  const roles = [v.role, ...(v.extraRoles ?? [])].filter((r): r is string => !!r && r in ROLE_DOORS);
  const held = new Set<DoorId>(
    roles.length
      ? roles.flatMap((r) => ROLE_DOORS[r])
      : PAGES.filter((p) => canSee(p, v)).map((p) => p.door),
  );
  return DOOR_ORDER.filter((d) => held.has(d));
}

/** 门内的二级导航:落在这一门、这个人看得见的页,按表的顺序;借住进来的(`alt`)排在这一门自己的页后面。 */
export function doorTabs(door: DoorId, v: Viewer, doors: readonly DoorId[] = doorsFor(v)): DoorPage[] {
  const here = PAGES.filter((p) => doorFor(p, doors) === door && canSee(p, v));
  const own = here.filter((p) => p.door === door);
  // 借住的页不带原门的节名(守卫的「册」里不该出现「来源」),并进这一门最后一节。
  const lastSection = own[own.length - 1]?.section ?? door;
  return [...own, ...here.filter((p) => p.door !== door).map((p) => ({ ...p, section: lastSection }))];
}

/**
 * 官员 App 的页(`mobile-officer`):案卷台 `queue`、待办 `todo`、查询 `search`、我的 `me`、通知 `notices`。
 * 页的键不改:链接、推送、「问一问」都用它们。
 */
export type OfficerPage = "todo" | "queue" | "search" | "notices" | "me";
/** App 里门的键:语言包(`officer_app.doors.<key>.glyph` / `.label`)与 testID(`door-<key>`)。册在 App 里叫 `roll`。 */
export type OfficerDoorKey = "desk" | "roll" | "me";

/**
 * 官员 App 画哪几门、每门哪几页(第一页是点门去的那页)。与 Web 的不同都写在这张表里,不另起一套:
 * - 律 `null`:App 里没有律令的页(律条在案卷台上读)。
 * - 司、人间 `null`:殿司的管理页与朋友圈审核只在 Web。
 * - App 不按 `ROLE_DOORS` 给门,按权限码给页(`kit.tsx` 的 `TAB_CODES`):一门里有一页看得见就画这一门,
 *   所以守卫 / 访客(有 `soul.read`)有「册」,和 Web 一样;没有画灰的门。
 */
export const OFFICER_APP_DOORS: Readonly<Record<DoorId, { key: OfficerDoorKey; pages: readonly OfficerPage[] } | null>> = {
  desk: { key: "desk", pages: ["queue", "todo"] },
  register: { key: "roll", pages: ["search"] },
  statutes: null,
  office: null,
  mortal: null,
};
/** 底栏最后一格「我」(不是门):我的 + 通知,未读的点画在这一格上。人人都有。 */
export const OFFICER_APP_ME: { key: OfficerDoorKey; pages: readonly OfficerPage[] } = { key: "me", pages: ["me", "notices"] };

/** 官员 App 的底栏:有页的门按 `DOOR_ORDER`,再加「我」。 */
export const officerDoors = (): { key: OfficerDoorKey; pages: readonly OfficerPage[] }[] => [
  ...DOOR_ORDER.flatMap((d) => OFFICER_APP_DOORS[d] ?? []),
  OFFICER_APP_ME,
];
