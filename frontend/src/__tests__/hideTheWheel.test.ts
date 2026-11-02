import { hideTheWheel, type SidebarMenu } from "@/src/hooks/useSidebarMenus";

const leaf = (name: string, path: string) => ({ name, path }) as SidebarMenu;
const group = (name: string, children: SidebarMenu[]) => ({ name, path: "", children }) as unknown as SidebarMenu;
const menus = [
  group("灵魂业务", [leaf("灵魂管理", "/souls")]),
  group("轮回", [leaf("处置", "/disposition"), leaf("转生登记簿", "/rebirths")]),
  group("流程协作", [leaf("审批流程", "/workflow"), leaf("转生申请", "/rebirth-applications")]),
];
const paths = (m: SidebarMenu[]) => m.flatMap((g) => (g.children as SidebarMenu[]).map((c) => c.path));

describe("hideTheWheel", () => {
  it.each(["EUROPEAN", "EGYPTIAN"])("%s: no rebirth door, no wheel group, disposition still reachable", (civ) => {
    const out = hideTheWheel(menus, civ);
    expect(out.map((g) => g.name)).toEqual(["灵魂业务", "流程协作"]);
    expect(paths(out)).toEqual(["/souls", "/disposition", "/workflow"]);
  });

  it.each(["CHINESE", "GREEK", undefined])("%s keeps the menu as it is", (civ) => {
    expect(hideTheWheel(menus, civ)).toBe(menus);
  });
});
