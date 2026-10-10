import { MfaRequiredBanner, SoulLedgerProvider } from "soulledger";

// 角色要求两步验证、而本人还没设置时,出现在工具条下面的警示条;设置完成后自己消失。
// 它读登录用户,所以预览用 provider 的 civ + mfaRequired 造一个这样的用户。
export const Required = () => (
  <SoulLedgerProvider civ="cn" mfaRequired>
    <MfaRequiredBanner />
  </SoulLedgerProvider>
);

// 放在页面里的位置:工具条之下、正文之上,占一整行,不盖住任何按钮。
export const InPage = () => (
  <SoulLedgerProvider civ="cn" mfaRequired>
    <div style={{ border: "1px solid oklch(var(--color-line))" }}>
      <div
        style={{ height: 52, display: "flex", alignItems: "center", padding: "0 16px", borderBottom: "1px solid oklch(var(--color-line))" }}
        className="text-sm text-[oklch(var(--color-ink-muted))]"
      >
        审判 / 审判台
      </div>
      <MfaRequiredBanner />
      <div style={{ padding: 24 }} className="text-sm text-[oklch(var(--color-ink))]">
        待审 12 件
      </div>
    </div>
  </SoulLedgerProvider>
);
