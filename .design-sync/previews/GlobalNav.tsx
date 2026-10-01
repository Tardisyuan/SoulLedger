import { useState } from "react";
import { GlobalNav, SoulLedgerProvider } from "soulledger";

function menu(id: number, name: string, path: string, icon: string | null, children: unknown[] = [], dir = false) {
  return {
    id, name, path, icon, order: id, component: null, roles: [], is_active: true, parent: null,
    children, ...(dir ? { menu_type: "DIRECTORY" as const } : {}),
  };
}

const MENUS = [
  menu(1, "概览", "/dashboard", "LayoutDashboard"),
  menu(2, "灵魂", "/souls", "Users"),
  menu(3, "审判", "", "Scale", [menu(31, "审判台", "/judgment", null), menu(32, "会审", "/cross-judgments", null)], true),
  menu(4, "轮回", "/disposition", "RefreshCw"),
  menu(5, "系统设置", "", "Settings", [menu(51, "菜单", "/menus", null), menu(52, "权限", "/permissions", null), menu(53, "用户", "/users", null)], true),
  menu(6, "审计", "/audit", "ScrollText"),
] as never[];

const PATHS = ["/dashboard", "/souls", "/judgment", "/cross-judgments", "/disposition", "/menus", "/permissions", "/users", "/audit"];
const USER = { display_name: "崔判官", username: "cui", role: "JUDGE" } as never;

function Nav({ collapsed, currentId, path }: { collapsed: boolean; currentId: number; path: string }) {
  const [openId, setOpenId] = useState<number | null>(currentId);
  return (
    <SoulLedgerProvider pathname={path} civ="cn">
      <div style={{ height: 560, display: "flex" }}>
        <GlobalNav
          menus={MENUS}
          allMenuPaths={PATHS}
          currentId={currentId}
          openId={openId as number}
          onToggle={(id) => setOpenId((o) => (o === id ? null : id))}
          collapsed={collapsed}
          user={USER}
        />
      </div>
    </SoulLedgerProvider>
  );
}

export const Expanded = () => <Nav collapsed={false} currentId={3} path="/judgment" />;
export const Collapsed = () => <Nav collapsed currentId={2} path="/souls" />;
