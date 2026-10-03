import { DomainNumber } from "soulledger";
import type { ReactNode } from "react";

const Row = ({ label, children }: { label: string; children: ReactNode }) => (
  <div style={{ display: "flex", justifyContent: "space-between", gap: 16, width: 240 }}>
    <span className="text-xs text-[oklch(var(--color-ink-subtle))]">{label}</span>
    {children}
  </div>
);

// Karmic balance on /souls: signed + toned. Zero is a recorded fact — bare `0`, neutral, never `+0`.
export const SignedToned = () => (
  <div style={{ display: "grid", gap: 8 }}>
    <Row label="王守仁"><DomainNumber value={812} signed toned /></Row>
    <Row label="Dante Alighieri"><DomainNumber value={-145} signed toned /></Row>
    <Row label="Σωκράτης"><DomainNumber value={0} signed toned /></Row>
  </div>
);

// Counts have no valence: no sign, no colour.
export const Count = () => (
  <div style={{ display: "grid", gap: 8 }}>
    <Row label="引用次数"><DomainNumber value={37} /></Row>
    <Row label="在押灵魂"><DomainNumber value={1204} /></Row>
    <Row label="待审"><DomainNumber value={0} /></Row>
  </div>
);

export const Missing = () => (
  <div style={{ display: "grid", gap: 8 }}>
    <Row label="引用次数">
      <DomainNumber value={null as unknown as number} missingReason="本次响应不带引用计数。" />
    </Row>
    <Row label="业力余额">
      <DomainNumber value={null as unknown as number} signed toned missingKind="inapplicable" missingReason="埃及灵魂不计业力余额" />
    </Row>
  </div>
);
