import { Breadcrumb, SoulLedgerProvider } from "soulledger";

function menu(id: number, name: string, path: string, children: unknown[] = [], dir = false) {
  return { id, name, path, icon: null, order: id, component: null, roles: [], is_active: true, parent: null, children, ...(dir ? { menu_type: "DIRECTORY" as const } : {}) };
}
const MENUS = [
  menu(1, "概览", "/dashboard"),
  menu(2, "灵魂", "/souls"),
  menu(3, "审判", "", [menu(31, "审判台", "/judgment"), menu(32, "会审", "/cross-judgments")], true),
  menu(5, "系统设置", "", [menu(51, "菜单", "/menus"), menu(52, "权限", "/permissions")], true),
] as never[];

const At = ({ path }: { path: string }) => (
  <SoulLedgerProvider pathname={path}>
    <div style={{ width: 480, display: "flex" }}>
      <Breadcrumb menus={MENUS} />
    </div>
  </SoulLedgerProvider>
);

export const TopLevel = () => <At path="/souls" />;
export const InGroup = () => <At path="/judgment" />;
export const Detail = () => <At path="/souls/a1f3c9e2-0000-4000-8000-000000000001" />;
