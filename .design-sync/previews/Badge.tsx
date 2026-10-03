import { Badge } from "soulledger";

export const Tones = () => (
  <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
    <Badge tone="neutral" glyph="○">草稿</Badge>
    <Badge tone="info" glyph="◐">审理中</Badge>
    <Badge tone="success" glyph="✓">已通过</Badge>
    <Badge tone="warning" glyph="↻">待重审</Badge>
    <Badge tone="error" glyph="✕">已驳回</Badge>
    <Badge tone="accent" glyph="◇">会审</Badge>
    <Badge tone="ink" glyph="■">已归档</Badge>
  </div>
);

export const WithoutGlyph = () => (
  <div style={{ display: "flex", gap: 8 }}>
    <Badge>中华</Badge>
    <Badge>欧洲</Badge>
    <Badge>埃及</Badge>
    <Badge>希腊</Badge>
  </div>
);
