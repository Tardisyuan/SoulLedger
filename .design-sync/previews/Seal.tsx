import { Seal } from "soulledger";

export const Civilizations = () => (
  <div style={{ display: "flex", gap: 16, alignItems: "center" }}>
    <Seal size={64} civ="cn" court="酆都" />
    <Seal size={64} civ="eu" court="Inferno" />
    <Seal size={64} civ="eg" court="Duat" />
    <Seal size={64} civ="gr" court="Hades" />
  </div>
);

export const Sizes = () => (
  <div style={{ display: "flex", gap: 16, alignItems: "center" }}>
    <Seal size={72} civ="cn" />
    <Seal size={52} civ="cn" />
    <Seal size={32} civ="cn" />
  </div>
);
