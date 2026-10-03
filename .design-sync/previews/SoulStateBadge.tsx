import { SoulStateBadge } from "soulledger";

// 灵魂生命周期六态,每态一个字形;「审判中」是唯一「还要处理」的,加 s2 底。
export const AllStates = () => (
  <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
    <SoulStateBadge state="ALIVE" />
    <SoulStateBadge state="JUDGING" />
    <SoulStateBadge state="DISPOSED" />
    <SoulStateBadge state="REINCARNATING" />
    <SoulStateBadge state="LOST" />
    <SoulStateBadge state="SETTLED" />
  </div>
);

// 全局搜索结果里的一行(GlobalSearch.tsx):魂名 + 文明,状态靠右。
export const InSearchResults = () => (
  <div style={{ width: 340 }}>
    {[
      ["王守仁", "中国", "JUDGING"],
      ["Dante Alighieri", "欧洲", "DISPOSED"],
      ["Σωκράτης", "希腊", "SETTLED"],
    ].map(([name, civ, s]) => (
      <div key={name} style={{ display: "flex", alignItems: "center", gap: 8, padding: "8px 0", borderBottom: "1px solid oklch(var(--color-rule))" }}>
        <span className="text-sm text-[oklch(var(--color-ink))]" style={{ flex: 1, minWidth: 0 }}>{name}</span>
        <span className="text-xs text-[oklch(var(--color-ink-subtle))]">{civ}</span>
        <SoulStateBadge state={s} className="shrink-0" />
      </div>
    ))}
  </div>
);

export const UnknownState = () => (
  <div style={{ display: "flex", gap: 8 }}>
    <SoulStateBadge state="WANDERING" />
    <SoulStateBadge state={null} />
  </div>
);
