import { VerdictBadge } from "soulledger";

// 判决是领域枚举:ink 字 + 中性灰框,只有「待定」加 s2 底。不上任何文明色。
export const AllVerdicts = () => (
  <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
    <VerdictBadge verdict="PASSED" />
    <VerdictBadge verdict="FAILED" />
    <VerdictBadge verdict="PURGATORY" />
    <VerdictBadge verdict="RETRY" />
  </div>
);

// 审判列表里的一行:案号 + 魂名,判决徽章靠右。
export const InJudgmentRow = () => (
  <div style={{ width: 360, display: "grid", gap: 0 }}>
    {[
      ["CN-2026-0042", "王守仁", "PASSED"],
      ["CN-2026-0043", "严嵩", "FAILED"],
      ["CN-2026-0044", "海瑞", "PURGATORY"],
    ].map(([no, name, v]) => (
      <div key={no} style={{ display: "flex", alignItems: "center", gap: 12, padding: "8px 0", borderBottom: "1px solid oklch(var(--color-rule))" }}>
        <span className="font-mono text-xs tabular-nums text-[oklch(var(--color-ink-subtle))]">{no}</span>
        <span className="text-sm text-[oklch(var(--color-ink))]" style={{ flex: 1 }}>{name}</span>
        <VerdictBadge verdict={v} />
      </div>
    ))}
  </div>
);

export const UnknownVerdict = () => (
  <div style={{ display: "flex", gap: 8 }}>
    <VerdictBadge verdict="ABSTAIN" />
  </div>
);
