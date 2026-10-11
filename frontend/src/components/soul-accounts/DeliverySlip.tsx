"use client";

import type { CSSProperties, ReactNode } from "react";
import { createPortal } from "react-dom";
import type { CredentialSlip } from "@soulledger/core/api";
import { formatSoulCode, soulCodeQrPayload } from "@soulledger/core/domain/soulCode";
import { BrandMark } from "@/src/components/brand/BrandMark";
import { QrCode } from "@/src/components/print/QrCode";
import { Seal } from "@/src/components/plaque/Seal";
import { SlipFrame, SlipRule, type SlipCiv } from "@/src/components/soul-accounts/DeliverySlipArt";
import { useI18n } from "@/src/contexts/I18nContext";
import { civSkinOf } from "@/src/lib/civSkin";

const SEP = " · ";
const LABEL: CSSProperties = { fontSize: 11, lineHeight: "16px", letterSpacing: ".1em", fontWeight: 500 };
const EYEBROW: CSSProperties = { fontSize: 11, lineHeight: "16px", letterSpacing: ".24em", fontWeight: 500 };
const HEADLINE: CSSProperties = { fontFamily: "var(--font-title)", fontWeight: 600, fontSize: 24, lineHeight: "28px" };
const MONO = "var(--font-mono)";
const abs = (left: number, top: number, extra: CSSProperties = {}): CSSProperties => ({ position: "absolute", left, top, ...extra });

/** 语言包里「A · B」的整句,画稿拆成两段(眉题 + 标题、标签 + 提示)。没有分隔符就整句当后一段。 */
function splitOnce(text: string): [string, string] {
  const i = text.indexOf(SEP);
  return i < 0 ? ["", text] : [text.slice(0, i), text.slice(i + SEP.length)];
}

/** 「■ 首次登录必须改密码。改完以后……」:第一句加粗,其余照排。 */
function boldFirstSentence(text: string): ReactNode {
  const m = /^([\s\S]*?[。.])\s*([\s\S]*)$/.exec(text);
  if (!m) return text;
  return (
    <>
      <b>{m[1]}</b>
      {m[2]}
    </>
  );
}

/**
 * 登录交付单(第二十批 §三 F2;第二十四批第二稿按文明重做):A4 竖版一页,上联 105 mm 交给灵魂,剪切线,下面是存根。
 * 版面是 794 × 1123 px 的绝对定位稿(= 210 × 297 mm),坐标取自 `DeliverySlipCiv.dc.html`。
 * 内容全部来自 `print-slip` 的返回,**没有密码** —— 密码处是一个空框,官员当面写,或只口头告诉。
 *
 * 文明由 `home_tenant.code` 的前缀决定;四种之外的殿是中性版(实心带 + 单线框,殿印位置放品牌标)。
 * `color` 为真时,匾额带、框、分隔线、殿印取文明色(`data-slip-ink`,颜色在 `app/print-slip-ink.css`);
 * 正文、二维码、编号、密码框、签收线任何时候都是纯黑。
 *
 * 屏幕上不显示、不占位;只在打印媒体下出现(`app/print.css` 的 `[data-print-slip]`)。挂在 `document.body` 上:
 * print.css 会把不属于文书的东西都收掉,交付单于是单独成页。打印前由调用方挂载、打印后卸载。
 */
export function DeliverySlip({ slip, color = false }: { slip: CredentialSlip; color?: boolean }) {
  const { t, locale, formatDateTime } = useI18n();
  const tenant = slip.home_tenant;
  const hall = tenant.hall_names[locale] || tenant.display_name;
  const skin = civSkinOf(tenant.code) as SlipCiv;
  const realm = skin === "neutral" ? "" : t(`plaque.realm.${skin}`);
  const ink = color ? skin : "mono";
  const code = formatSoulCode(slip.soul_code);
  const until = formatDateTime(slip.expires_at);
  const printedAt = formatDateTime(slip.printed_at);
  const [titleSys, docTitle] = splitOnce(t("soul_accounts.credentials.slip.title"));
  const sys = titleSys || t("soul_app.app_name");
  const [pwLabel, pwHint] = splitOnce(t("soul_accounts.credentials.slip.password_box"));
  const zh = locale.startsWith("zh");
  const s = (key: string, params?: Record<string, string>) => t(`soul_accounts.credentials.slip.${key}`, params);

  return createPortal(
    <div data-print-doc="" data-print-slip="" data-testid="delivery-slip" data-slip-civ={skin} data-slip-color={color ? "" : undefined}>
      <div style={{ position: "relative", width: 794, height: 1123, overflow: "hidden", fontSize: 13, lineHeight: "20px" }}>
        <div data-slip-ink={ink} style={abs(24, 24, { width: 746, height: 357 })}>
          <SlipFrame civ={skin} />
        </div>

        <div
          data-slip-white=""
          style={abs(60, 38, { width: 686, height: 44, display: "flex", alignItems: "center", justifyContent: "space-between", gap: 24 })}
        >
          <div style={{ display: "flex", flexDirection: "column", minWidth: 0 }}>
            <span style={EYEBROW}>{realm || " "}</span>
            <span data-slip-hall="" style={{ ...HEADLINE, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
              {hall}
            </span>
          </div>
          <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", flex: "none" }}>
            <span style={EYEBROW}>{sys}</span>
            <span
              data-slip-doc-title=""
              style={{ ...HEADLINE, letterSpacing: zh ? ".3em" : ".06em", marginRight: zh ? "-.3em" : undefined }}
            >
              {docTitle}
            </span>
          </div>
        </div>

        <div style={abs(48, 116, { width: 460, height: 252, display: "flex", flexDirection: "column" })}>
          <div style={{ display: "grid", gridTemplateColumns: "96px minmax(0,1fr)", rowGap: 10, alignItems: "center" }}>
            <span style={LABEL}>{s("soul")}</span>
            <span style={{ fontWeight: 600, fontSize: 20, lineHeight: "28px", maxWidth: 290, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
              {slip.soul_name}
            </span>
            <span style={LABEL}>{s("soul_id")}</span>
            <span
              data-slip-code=""
              style={{ display: "flex", gap: 20, fontFamily: MONO, fontSize: 34, lineHeight: "44px", fontWeight: 600, letterSpacing: ".06em" }}
            >
              {code.split(" ").map((g, i) => (
                <span key={i}>{g}</span>
              ))}
            </span>
            <span style={LABEL}>{pwLabel || s("password_box")}</span>
            <span style={{ display: "flex", alignItems: "center", gap: 12 }}>
              <span data-slip-password-box="" style={{ width: 220, height: 40, flex: "none", boxSizing: "border-box", border: "1px solid black" }} />
              {pwLabel && <span style={{ fontSize: 11, lineHeight: "16px", textWrap: "balance" }}>{pwHint}</span>}
            </span>
          </div>
          <div style={{ marginTop: 10, display: "flex", flexDirection: "column" }}>
            <b>{s("valid_until", { time: until })}</b>
            <span>{boldFirstSentence(s("must_change"))}</span>
            <b>{s("personal")}</b>
          </div>
          <div data-slip-ink={ink} style={{ marginTop: "auto", height: 8 }}>
            <SlipRule civ={skin} />
          </div>
          <div style={{ marginTop: 6, display: "flex", gap: 24, fontSize: 12, lineHeight: "16px" }}>
            <span>{s("officer", { name: slip.officer_name })}</span>
            <span>{s("printed_at", { time: printedAt })}</span>
          </div>
        </div>

        <span data-slip-ink={ink} data-slip-seal-slot="" style={abs(448, 104, { display: "flex" })}>
          {skin === "neutral" ? (
            <BrandMark size={64} tone="ink" />
          ) : (
            <Seal size={64} civ={skin} glyphs={tenant.seal_glyphs} court={hall} />
          )}
        </span>

        <span aria-hidden="true" style={abs(536, 104, { height: 268, borderLeft: ".5px solid black" })} />
        {/* 二维码与编号永远纯黑,不随 data-slip-ink;二维码四周 26 的静区里没有墨。 */}
        <div data-slip-qr="" style={abs(565, 118, { width: 160, height: 160 })}>
          <QrCode text={soulCodeQrPayload(slip.soul_code)} size="160px" />
        </div>
        {/* Balanced, so the lines break between phrases and not inside 「扫码」 (seen in the first printed PDF). */}
        <span style={abs(540, 304, { width: 210, textAlign: "center", fontSize: 12, lineHeight: "16px", textWrap: "balance" })}>{s("qr_hint")}</span>

        <div style={abs(0, 387, { right: 0, display: "flex", alignItems: "center", gap: 8, fontSize: 12, lineHeight: "20px" })}>
          <span style={{ width: 32, borderTop: "1px dashed black" }} />
          <span>{s("cut")}</span>
          <span style={{ flex: 1, borderTop: "1px dashed black" }} />
        </div>

        <section
          style={abs(24, 429, { width: 746, boxSizing: "border-box", padding: "20px 24px 24px", border: ".5px solid black", display: "flex", flexDirection: "column" })}
        >
          <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 16, paddingBottom: 8 }}>
            <span style={{ fontWeight: 600, fontSize: 15, lineHeight: "24px" }}>{s("stub")}</span>
            <span data-slip-stub-hall="" style={{ fontSize: 12, lineHeight: "16px" }}>
              {realm ? `${realm}${SEP}${hall}` : hall}
            </span>
          </div>
          <div data-slip-ink={ink} style={{ height: 8 }}>
            <SlipRule civ={skin} />
          </div>
          <dl style={{ margin: "20px 0 0", display: "grid", gridTemplateColumns: "160px minmax(0,1fr)", gap: "8px 16px" }}>
            <dt>{s("soul")}</dt>
            <dd style={{ margin: 0 }}>{slip.soul_name}</dd>
            <dt>{s("soul_id")}</dt>
            <dd style={{ margin: 0, fontFamily: MONO, letterSpacing: ".06em" }}>{code}</dd>
            <dt>{s("stub_until")}</dt>
            <dd style={{ margin: 0, fontFamily: MONO }}>{until}</dd>
            <dt>{s("stub_printed")}</dt>
            <dd style={{ margin: 0 }}>
              {slip.officer_name} · <span style={{ fontFamily: MONO }}>{printedAt}</span>
            </dd>
          </dl>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 48, marginTop: 64 }}>
            {(["sign_soul", "sign_officer"] as const).map((k) => (
              <span key={k} style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                <span style={{ height: 40, borderBottom: "1px solid black" }} />
                <span style={{ fontSize: 12, lineHeight: "16px" }}>{s(k)}</span>
              </span>
            ))}
          </div>
          <span style={{ marginTop: 20, fontSize: 12, lineHeight: "16px" }}>{s("after_sign")}</span>
        </section>

        <div data-slip-foot="" style={{ position: "absolute", left: 40, right: 40, bottom: 24, display: "flex", alignItems: "center", gap: 8, fontSize: 11, lineHeight: "16px" }}>
          <BrandMark size={14} tone="ink" />
          <span>{sys}</span>
          <span style={{ fontFamily: MONO, marginLeft: 16 }}>{code}</span>
          <span style={{ marginLeft: "auto" }}>{t("print.page_label", { n: "1", m: "1" })}</span>
        </div>
      </div>
    </div>,
    document.body,
  );
}
