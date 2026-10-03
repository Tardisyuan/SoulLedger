import { DomainText } from "soulledger";
import type { ReactNode } from "react";

const Row = ({ label, children }: { label: string; children: ReactNode }) => (
  <div style={{ display: "grid", gridTemplateColumns: "72px 1fr", gap: 12, alignItems: "baseline" }}>
    <span className="text-xs text-[oklch(var(--color-ink-subtle))]">{label}</span>
    <span className="text-sm text-[oklch(var(--color-ink))]">{children}</span>
  </div>
);

// The judgment detail header: free text, or a typed missing value in its place.
export const WithValue = () => (
  <div style={{ width: 300, display: "grid", gap: 10 }}>
    <Row label="灵魂"><DomainText value="王守仁" /></Row>
    <Row label="审理殿"><DomainText value="第五殿 · 阎罗王" /></Row>
    <Row label="去处"><DomainText value="枉死城" /></Row>
  </div>
);

export const Empty = () => (
  <div style={{ width: 300, display: "grid", gap: 10 }}>
    <Row label="审判官"><DomainText value="" /></Row>
    <Row label="去处"><DomainText value={null} missingKind="inapplicable" missingReason="尚未判决,去处不适用" /></Row>
  </div>
);
