import { ConnectionBanner, SoulLedgerProvider } from "soulledger";

// 链路断开时钉在视口最顶部的 28px 警示条(position: fixed)。预览无 WebSocket,状态恒为 disconnected,
// 故显示「已断开」与「重连」;需要登录用户,故带 civ。
export const LinkDown = () => (
  <SoulLedgerProvider civ="cn">
    <ConnectionBanner />
  </SoulLedgerProvider>
);
