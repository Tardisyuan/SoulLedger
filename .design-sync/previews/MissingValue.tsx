import { MissingValue } from "soulledger";
import type { ReactNode } from "react";

const Row = ({ label, children }: { label: string; children: ReactNode }) => (
  <div style={{ display: "grid", gridTemplateColumns: "88px 1fr", gap: 12, alignItems: "baseline" }}>
    <span className="text-xs text-[oklch(var(--color-ink-subtle))]">{label}</span>
    <span className="text-sm">{children}</span>
  </div>
);

export const Unrecorded = () => (
  <div style={{ width: 300, display: "grid", gap: 10 }}>
    <Row label="主审判官"><MissingValue kind="unrecorded" /></Row>
    <Row label="提议人"><MissingValue kind="unrecorded" reason="提议人账号已删除,姓名无从取得" /></Row>
  </div>
);

export const Inapplicable = () => (
  <div style={{ width: 300, display: "grid", gap: 10 }}>
    <Row label="卒日"><MissingValue kind="inapplicable" reason="灵魂尚在阳世" /></Row>
    <Row label="业力余额"><MissingValue kind="inapplicable" reason="不适用 — 详见灵魂详情" /></Row>
  </div>
);

// The two kinds side by side in one table column: a dash and a word, never the same mark.
export const InAColumn = () => (
  <table className="text-sm" style={{ width: 300, borderCollapse: "collapse" }}>
    <thead>
      <tr className="text-xs text-[oklch(var(--color-ink-subtle))]">
        <th className="px-3 py-2 text-left font-normal">姓名</th>
        <th className="px-3 py-2 text-right font-normal">业力</th>
      </tr>
    </thead>
    <tbody>
      {[
        ["王守仁", <span key="a" className="font-mono tabular-nums">+812</span>],
        ["Ahmose", <MissingValue key="b" kind="inapplicable" reason="埃及灵魂不计业力余额" />],
        ["Σωκράτης", <MissingValue key="c" kind="unrecorded" reason="余额未提供 — 本角色不可见" />],
      ].map(([name, cell]) => (
        <tr key={name as string} className="border-t border-[oklch(var(--color-hairline))]">
          <td className="px-3 py-2 text-[oklch(var(--color-ink))]">{name}</td>
          <td className="px-3 py-2 text-right">{cell}</td>
        </tr>
      ))}
    </tbody>
  </table>
);
