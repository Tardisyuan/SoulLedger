import { GlobalSearch, SoulLedgerProvider } from "soulledger";

const MENUS = [
  { id: 1, name: "概览", path: "/dashboard", icon: null, order: 1, component: null, roles: [], is_active: true, parent: null, children: [] },
  { id: 2, name: "审判台", path: "/judgment", icon: null, order: 2, component: null, roles: [], is_active: true, parent: null, children: [] },
] as never[];

// 匾上的全局搜索入口(⌘K / Ctrl K 或点击打开);桌面宽度下是带快捷键的搜索框。
// 打开后的面板需要交互且读接口,静态预览只呈现关闭态。
export const Closed = () => (
  <SoulLedgerProvider civ="cn">
    <GlobalSearch menus={MENUS} />
  </SoulLedgerProvider>
);
