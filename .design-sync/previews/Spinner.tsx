import { Spinner } from "soulledger";

// 三档尺寸;按钮内为 sm,整块区域加载为 lg。
export const Sizes = () => (
  <div style={{ display: "flex", gap: 24, alignItems: "center" }}>
    <Spinner size="sm" />
    <Spinner size="md" />
    <Spinner size="lg" />
  </div>
);

// 带 label:朗读「加载中」,工作流详情页的用法。
export const WithLabel = () => (
  <div style={{ display: "flex", gap: 8, alignItems: "center", fontSize: 14 }}>
    <Spinner label="正在加载审判流程" />
    <span>正在加载审判流程…</span>
  </div>
);
