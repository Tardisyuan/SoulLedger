import { TreeName } from "soulledger";

const row = { display: "flex", alignItems: "center", padding: "8px 12px", borderBottom: "1px solid oklch(var(--color-line))" } as const;

// 菜单管理 / 组织页的名称格:一张平表里用缩进 + └ 肘线表达层级,深度 0 不画肘线。
export const MenuHierarchy = () => (
  <div className="text-sm text-[oklch(var(--color-ink))]" style={{ width: 320, border: "1px solid oklch(var(--color-line))" }}>
    <div style={row}><TreeName depth={0}>系统设置</TreeName></div>
    <div style={row}><TreeName depth={1}>菜单</TreeName></div>
    <div style={row}><TreeName depth={1}>权限</TreeName></div>
    <div style={row}><TreeName depth={2}>角色授权</TreeName></div>
    <div style={row}><TreeName depth={0}>审判</TreeName></div>
    <div style={row}><TreeName depth={1}>审判台</TreeName></div>
  </div>
);

// 组织页(界域拓扑):名称后面可以带别的内容,例如文明徽标。
export const OrganizationDepths = () => (
  <div className="text-sm text-[oklch(var(--color-ink))]" style={{ width: 320, border: "1px solid oklch(var(--color-line))" }}>
    <div style={row}><TreeName depth={0}><span className="font-medium">酆都</span></TreeName></div>
    <div style={row}><TreeName depth={1}><span>十殿阎罗</span><span className="text-xs text-[oklch(var(--color-ink-subtle))]">中华</span></TreeName></div>
    <div style={row}><TreeName depth={2}><span>第五殿 · 森罗殿</span></TreeName></div>
    <div style={row}><TreeName depth={3}><span>业镜司</span></TreeName></div>
  </div>
);
