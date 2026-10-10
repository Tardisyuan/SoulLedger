import { ConnectionStatus, SoulLedgerProvider } from "soulledger";

// 实时连接指示:红点 + 「已断开」+「重连」。预览里没有 WebSocket provider,状态恒为 disconnected,
// 这是唯一能静态呈现的状态;需要登录用户,故带 civ。
export const Disconnected = () => (
  <SoulLedgerProvider civ="cn">
    <ConnectionStatus />
  </SoulLedgerProvider>
);
