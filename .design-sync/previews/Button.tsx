import { Button } from "soulledger";

export const Variants = () => (
  <div style={{ display: "flex", gap: 12, flexWrap: "wrap", alignItems: "center" }}>
    <Button variant="primary">落判</Button>
    <Button>保存草稿</Button>
    <Button variant="ghost">取消</Button>
    <Button variant="warning">退回重审</Button>
    <Button variant="danger">✕ 永久删除</Button>
  </div>
);

export const Sizes = () => (
  <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
    <Button size="sm">小</Button>
    <Button size="md">中</Button>
    <Button size="lg">大</Button>
  </div>
);

export const States = () => (
  <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
    <Button variant="primary" loading>
      提交中
    </Button>
    <Button disabled>不可用</Button>
  </div>
);

export const Inverse = () => (
  <div style={{ display: "flex", gap: 12, alignItems: "center", padding: 12, background: "oklch(var(--color-ink))" }}>
    <span style={{ color: "oklch(var(--color-surface-1))", fontSize: 13 }}>已选 3 条</span>
    <Button variant="inverse" size="sm">
      批量回收
    </Button>
  </div>
);
