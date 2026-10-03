import { DomainEnum } from "soulledger";
import type { ReactNode } from "react";

// A detail-page field list, the way /judgment/[id] lays out enums. The raw member
// travels in `title` (hover) — never in the text — so the hint column shows it here.
const Row = ({ label, raw, children }: { label: string; raw: string; children: ReactNode }) => (
  <div style={{ display: "grid", gridTemplateColumns: "72px 1fr auto", gap: 12, alignItems: "baseline" }}>
    <span className="text-xs text-[oklch(var(--color-ink-subtle))]">{label}</span>
    <span className="text-sm text-[oklch(var(--color-ink))]">{children}</span>
    <span className="font-mono text-2xs text-[oklch(var(--color-ink-tertiary))]">title={raw}</span>
  </div>
);

export const Recognised = () => (
  <div style={{ width: 340, display: "grid", gap: 10 }}>
    <Row label="文明" raw="CHINESE"><DomainEnum namespace="souls.civilizations" value="CHINESE" /></Row>
    <Row label="审判方式" raw="HEART_WEIGHING"><DomainEnum namespace="judgment.methods" value="HEART_WEIGHING" /></Row>
    <Row label="去处类型" raw="PURGATORY"><DomainEnum namespace="realms.types" value="PURGATORY" /></Row>
    <Row label="判决" raw="passed"><DomainEnum namespace="judgment.verdicts" value="passed" /></Row>
  </div>
);

export const UnknownMember = () => (
  <div style={{ width: 340, display: "grid", gap: 10 }}>
    <Row label="状态" raw="JUDGING"><DomainEnum namespace="souls.states" value="JUDGING" /></Row>
    <Row label="状态" raw="ASCENDED"><DomainEnum namespace="souls.states" value="ASCENDED" /></Row>
  </div>
);

export const Absent = () => (
  <div style={{ width: 340, display: "grid", gap: 10 }}>
    <Row label="判决" raw="(null)"><DomainEnum namespace="judgment.verdicts" value={null as unknown as string} /></Row>
    <Row label="去处类型" raw="(null)">
      <DomainEnum namespace="realms.types" value={null as unknown as string} missingKind="inapplicable" missingReason="存活灵魂尚无去处" />
    </Row>
  </div>
);
