import { ActionsMenu } from "soulledger";

const noop = () => {};
const cell = { display: "flex", justifyContent: "flex-end", width: 280, padding: "8px 12px", border: "1px solid oklch(var(--color-line))" } as const;

// 表格操作列:一个行内主动作 + 「⋯」收纳其余(含全部破坏性动作)。菜单点击才展开,此处为收起态。
export const PrimaryAndOverflow = () => (
  <div style={cell}>
    <ActionsMenu
      menuLabel="更多操作"
      primary={{ label: "查看", onSelect: noop }}
      items={[
        { key: "edit", label: "编辑", onSelect: noop },
        { key: "restore", label: "恢复", onSelect: noop },
        { key: "delete", label: "永久删除", tone: "danger", onSelect: noop },
      ]}
    />
  </div>
);

// 只有 ⋯(回收站里无主动作的行)。
export const OverflowOnly = () => (
  <div style={cell}>
    <ActionsMenu menuLabel="更多操作" items={[{ key: "hard-delete", label: "永久删除", tone: "danger", onSelect: noop }]} />
  </div>
);

// 主动作被禁用(没有权限时)。
export const PrimaryDisabled = () => (
  <div style={cell}>
    <ActionsMenu menuLabel="更多操作" primary={{ label: "落判", onSelect: noop, disabled: true }} items={[{ key: "view", label: "查看", onSelect: noop }]} />
  </div>
);
