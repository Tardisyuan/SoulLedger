import type * as React from "react";
import { BottomBar, SoulLedgerProvider } from "soulledger";

function menu(id: number, name: string, path: string, children: unknown[] = [], dir = false) {
  return { id, name, path, icon: null, order: id, component: null, roles: [], is_active: true, parent: null, children, ...(dir ? { menu_type: "DIRECTORY" as const } : {}) };
}
const MENUS = [
  menu(1, "概览", "/dashboard"),
  menu(2, "灵魂", "/souls"),
  menu(3, "审判", "", [menu(31, "审判台", "/judgment"), menu(32, "会审", "/cross-judgments")], true),
  menu(4, "轮回", "/disposition"),
  menu(6, "审计", "/audit"),
  menu(7, "系统设置", "", [menu(51, "菜单", "/menus"), menu(52, "用户", "/users")], true),
] as never[];
const PATHS = ["/dashboard", "/souls", "/judgment", "/cross-judgments", "/disposition", "/audit", "/menus", "/users"];

// The bar is `position: fixed; bottom: 0`. A transformed box is the containing block for fixed
// children, so it sits at the bottom of this frame instead of the bottom of the preview page.
const Phone = ({ children }: { children: React.ReactNode }) => (
  <div style={{ position: "relative", width: 390, height: 120, transform: "translateZ(0)", background: "oklch(var(--color-canvas))", border: "1px solid oklch(var(--color-line))" }}>
    {children}
  </div>
);

// ≤ 768px 没有侧栏,用固定在底部的五格栏:前四项 + 「更多」;当前页的那格用文明主色。
export const Mobile = () => (
  <SoulLedgerProvider civ="cn" pathname="/souls">
    <Phone><BottomBar menus={MENUS} allMenuPaths={PATHS} currentId={2} /></Phone>
  </SoulLedgerProvider>
);

// 当前页在「更多」里(系统设置/审计):最后一格高亮。
export const CurrentInMore = () => (
  <SoulLedgerProvider civ="cn" pathname="/audit">
    <Phone><BottomBar menus={MENUS} allMenuPaths={PATHS} currentId={6} /></Phone>
  </SoulLedgerProvider>
);
