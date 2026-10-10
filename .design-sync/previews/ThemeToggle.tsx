import { ThemeToggle } from "soulledger";

// 页首匾上的明/暗切换:仅图标,44 × 44 点击区;图标随当前主题变化(此处为跟随系统的初始态)。
export const Default = () => <ThemeToggle />;

// 放在匾内的位置:与右侧其它工具并排。
export const InToolbar = () => (
  <div
    className="text-sm text-[oklch(var(--color-ink-muted))]"
    style={{ display: "flex", alignItems: "center", gap: 8, padding: "0 12px", height: 52, width: 320, border: "1px solid oklch(var(--color-line))" }}
  >
    <span style={{ flex: 1 }}>审判 / 审判台</span>
    <ThemeToggle />
  </div>
);
