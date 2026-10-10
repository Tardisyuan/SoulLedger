import { Collapse } from "soulledger";

const box = { width: 340, border: "1px solid oklch(var(--color-line))" } as const;
const trigger = {
  display: "flex", width: "100%", justifyContent: "space-between", padding: "10px 12px",
  background: "oklch(var(--color-surface-1))", border: 0, borderBottom: "1px solid oklch(var(--color-line))", cursor: "pointer",
} as const;

// 详情页「判词历史」整节折叠:展开态。触发按钮由调用方渲染,带 aria-expanded / aria-controls。
export const Open = () => (
  <div style={box} className="text-sm text-[oklch(var(--color-ink))]">
    <button type="button" style={trigger} aria-expanded aria-controls="hist-open" className="text-sm text-[oklch(var(--color-ink))]">
      <span>判词历史</span><span aria-hidden="true">▾</span>
    </button>
    <Collapse open id="hist-open">
      <ul style={{ margin: 0, padding: "8px 12px", listStyle: "none" }} className="text-sm">
        <li className="font-mono tabular-nums">1529-01-09  王守仁 · 转生人道</li>
        <li className="font-mono tabular-nums">1529-02-14  初审 · 待重审</li>
      </ul>
    </Collapse>
  </div>
);

// 同一节收起态:内容不渲染,只剩触发按钮。
export const Closed = () => (
  <div style={box} className="text-sm text-[oklch(var(--color-ink))]">
    <button type="button" style={{ ...trigger, borderBottom: 0 }} aria-expanded={false} aria-controls="hist-closed" className="text-sm text-[oklch(var(--color-ink))]">
      <span>判词历史</span><span aria-hidden="true">▸</span>
    </button>
    <Collapse open={false} id="hist-closed">
      <p className="px-3 py-2 text-sm">收起时不会渲染</p>
    </Collapse>
  </div>
);
