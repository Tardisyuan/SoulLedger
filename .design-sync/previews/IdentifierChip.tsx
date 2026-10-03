import { IdentifierChip } from "soulledger";

// Normal case: one id, alone in a detail-page header. Reads short, copies whole.
export const Chip = () => (
  <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
    <span className="text-md font-medium text-[oklch(var(--color-ink))]">王守仁</span>
    <IdentifierChip id="a1f3c9e2-7b4d-4e18-9c3a-5f20d81b6e47" ariaLabel="复制灵魂 ID" />
  </div>
);

// Registered exception: repeated once per row, so no chrome — `#` sigil and a dotted underline.
export const InlineInRows = () => (
  <div style={{ width: 300, display: "grid", gap: 10 }}>
    {[
      ["王守仁", "a1f3c9e2-7b4d-4e18-9c3a-5f20d81b6e47"],
      ["Dante Alighieri", "b7d20c41-2e9f-4a6b-8d15-0c3e7f94a218"],
      ["Ahmose", "c90e6a77-5d1c-4f02-b6e8-9a4d3c71f05b"],
    ].map(([name, id]) => (
      <div key={id}>
        <p className="text-sm font-medium text-[oklch(var(--color-ink))]">{name}</p>
        <p className="text-xs text-[oklch(var(--color-ink-subtle))]">
          来源编号: <IdentifierChip id={id} variant="inline" />
        </p>
      </div>
    ))}
  </div>
);
