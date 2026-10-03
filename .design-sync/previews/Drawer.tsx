import { Drawer, Badge } from "soulledger";

export const Open = () => (
  <Drawer isOpen onClose={() => {}} title="王守仁" hint="J / K 上下条 · Esc" onNext={() => {}} onPrev={() => {}}>
    <dl style={{ display: "grid", gridTemplateColumns: "80px 1fr", rowGap: 10, fontSize: 13 }}>
      <dt>文明</dt><dd>中华</dd>
      <dt>卒日</dt><dd style={{ fontFamily: "var(--font-mono)" }}>1529-01-09</dd>
      <dt>功德</dt><dd style={{ fontFamily: "var(--font-mono)" }}>812</dd>
      <dt>状态</dt><dd><Badge tone="info" glyph="◇">审判中</Badge></dd>
    </dl>
  </Drawer>
);

export const WithError = () => (
  <Drawer isOpen onClose={() => {}} title="Dante Alighieri" error="载入证据失败,请稍后重试。">
    <p style={{ fontSize: 13 }}>证据列表暂不可用。</p>
  </Drawer>
);
