/**
 * 五门在 Web 上的那一半:点门去哪个网址、进站第一页。
 *
 * 门本身(哪几门、顺序、角色看到哪几门、旧页落到哪一门、门内看到哪几页)在 `@soulledger/core/domain/doors`,
 * 与官员 App 的底栏共用一份(用户 2026-11-13,Q8)。这里只留路由:壳(`AppLayout` 的 `DoorRail` / `DoorTabs`)
 * 与测试仍从这个文件读,所以下面把那一份原样转出。
 */
import { DOOR_NAV_KEY, DOOR_ORDER, DOOR_RAIL_KEY, doorTabs, doorsFor, type DoorId, type DoorNavKey, type Viewer } from "@soulledger/core/domain/doors";

export * from "@soulledger/core/domain/doors";

/** 每一门的首页(点门去哪儿)。 */
const HOME: Readonly<Record<DoorId, string>> = {
  desk: "/desk",
  register: "/souls",
  statutes: "/corpus",
  office: "/desk/overview",
  mortal: "/moderation",
};

/** 每一门的首页、中文门上的字(`caseDesk.rail.<key>_glyph`)与门名的键(`nav.doors.<nav>.label` / `.title`)。 */
export const DOORS = Object.fromEntries(DOOR_ORDER.map((d) => [d, { home: HOME[d], key: DOOR_RAIL_KEY[d], nav: DOOR_NAV_KEY[d] }])) as Record<
  DoorId,
  { home: string; key: string; nav: DoorNavKey }
>;

/** 进站第一页。ADMIN / JUDGE 照旧走「默认视图」(`defaultView.ts`),这里只管没有「审」的三个角色。 */
const LANDING: Readonly<Record<string, string>> = {
  GUARDIAN: "/judgment/capture-due",
  VIEWER: "/souls",
  MODERATOR: "/moderation",
};
export const landingFor = (role: string | undefined): string | null => (role ? (LANDING[role] ?? null) : null);

/** 点一扇门去哪儿:门的首页看得见就是首页,否则门里第一页。 */
export function doorHref(door: DoorId, v: Viewer, doors: readonly DoorId[] = doorsFor(v)): string {
  const tabs = doorTabs(door, v, doors);
  return tabs.find((p) => p.path === HOME[door])?.path ?? tabs[0]?.path ?? HOME[door];
}
