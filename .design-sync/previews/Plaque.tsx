import { Plaque, SoulLedgerProvider } from "soulledger";

export const Chinese = () => (
  <SoulLedgerProvider civ="cn">
    <Plaque title="审判台" meta="待审 12 · 今日已判 4" />
  </SoulLedgerProvider>
);
export const European = () => (
  <SoulLedgerProvider civ="eu">
    <Plaque title="Judgment" meta="12 pending" />
  </SoulLedgerProvider>
);
export const Egyptian = () => (
  <SoulLedgerProvider civ="eg">
    <Plaque title="称心之厅" />
  </SoulLedgerProvider>
);
export const Greek = () => (
  <SoulLedgerProvider civ="gr">
    <Plaque title="冥府名册" />
  </SoulLedgerProvider>
);
export const Neutral = () => <Plaque title="登录" />;
