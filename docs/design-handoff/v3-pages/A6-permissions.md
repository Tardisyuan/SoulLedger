# A6 · 权限矩阵 `/permissions` —— Design 稿规格（取回整理，2026-10-02）

- **1440 稿原件**（52 KB，内联样式的 HTML，可直接读）：`docs/design-handoff/v3-pages/raw/Permissions.dc.html`。里面的 `{{ … }}` 是稿件模板变量，`<sc-if>` / `<sc-for>` 是条件 / 循环，`x-import` / `dc-import` 是组件引用（GlobalNav、Breadcrumb、Plaque 等用代码现成的）。读它拿数值和结构。
- 用户 10-02 定：**矩阵行高 48px**（格内开关点击区仍 44），类别头 44，表头 56；其他表格仍 64。
- 未保存条 = 墨色反白（与批量条同一规则：`inverse` 按钮，警示用条字色 + ◐）。

## 393（`PermissionsMobile.dc.html`，摘要）

- 身份带收起态（48），题「权限」。
- 顶部控制区（`surface-1`，padding 12/16，下边 1px `line`，间距 8）：
  - 角色选择 48 高（圆角 4）：前缀 11px `ink-muted`「角色」+ 500「判官」+ 12px `ink-muted`「12 人」+ ▾。**先选一个角色，再列这一列的开关。**
  - 一行：筛选框 44（「⌕ 筛选」）+ 44 高「只看差异」切换。
- 列表（`surface-1`，上下 1px `line`）：
  - 类别头 36 高，`surface-2` 底，11px 0.1em `ink-muted` 600 的类别名 + 右侧等宽「已授 / 总数」（如「2 / 3」）。
  - 权限行最小 48 高，padding 2/16，上边 1px `line`：左边两行（500 权限名 / 等宽 11px `ink-muted` 权限码如 `souls.view`），右边 44×44 状态格：
    - 已授 `■`；未授 `□`（`ink-subtle`）；
    - 冲突 `◇`：1px 虚线 `ink` 边 + `0 0 0 2px ink` 强调环；
    - 待撤 `−`：17px 600，7% `ink` 底 + 2px `ink` 强调环；（待授 `＋` 同理）
    - 失败 `!`、始终、禁授 —— 见 1440 原件。
- 底部未保存条：高 64，`ink` 底、`surface-1` 字，padding 0 8 0 16：500「2 处待改 · ◐ 1 冲突」+ 右侧「放弃」（48 高文字按钮）+「保存」（48 高，`surface-1` 底、`ink` 字、600）。
- 再下面是 BottomBar。
