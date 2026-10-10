import { EnumBadge } from "soulledger";

// DataGrid 的 enum 列单元格:tone + 符号 + 本地化文案,title 留原始枚举值(IDENTIFIER_POLICY)。
export const Tones = () => (
  <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
    <EnumBadge value={{ tone: "neutral", glyph: "○", label: "草稿", title: "DRAFT" }} />
    <EnumBadge value={{ tone: "info", glyph: "◐", label: "审理中", title: "JUDGING" }} />
    <EnumBadge value={{ tone: "success", glyph: "✓", label: "已通过", title: "PASSED" }} />
    <EnumBadge value={{ tone: "warning", glyph: "↻", label: "待重审", title: "RETRY" }} />
    <EnumBadge value={{ tone: "error", glyph: "✕", label: "已驳回", title: "FAILED" }} />
  </div>
);

// 没有符号时只显示文字(文明列)。
export const NoGlyph = () => (
  <div style={{ display: "flex", gap: 8 }}>
    <EnumBadge value={{ tone: "neutral", label: "中华", title: "cn" }} />
    <EnumBadge value={{ tone: "neutral", label: "欧洲", title: "eu" }} />
  </div>
);
