"use client";

import type { CSSProperties } from "react";
import { createPortal } from "react-dom";
import type { CredentialSlip } from "@soulledger/core/api";
import { formatSoulCode, soulCodeQrPayload } from "@soulledger/core/domain/soulCode";
import { BrandMark } from "@/src/components/brand/BrandMark";
import { QrCode } from "@/src/components/print/QrCode";
import { Seal } from "@/src/components/plaque/Seal";
import { SlipFrame, SlipRule, type SlipCiv } from "@/src/components/soul-accounts/DeliverySlipArt";
import type { SlipBundles, SlipLocale } from "@/src/components/soul-accounts/slipTexts";
import { useI18n } from "@/src/contexts/I18nContext";
import { civSkinOf } from "@/src/lib/civSkin";

const SEP = " · ";
const MONO = "var(--font-mono)";
const LABEL: CSSProperties = { fontSize: 11, lineHeight: "14px", letterSpacing: ".1em", fontWeight: 500 };
const SUB_LABEL: CSSProperties = { fontSize: 10, lineHeight: "12px", letterSpacing: ".06em" };
const SUB_TEXT: CSSProperties = { fontSize: 10, lineHeight: "13px" };
const EYEBROW: CSSProperties = { fontSize: 11, lineHeight: "16px", letterSpacing: ".2em", fontWeight: 500 };
const HEADLINE: CSSProperties = { fontFamily: "var(--font-title)", fontWeight: 600, fontSize: 24, lineHeight: "28px" };
const COL: CSSProperties = { display: "flex", flexDirection: "column" };
const abs = (left: number, top: number, extra: CSSProperties = {}): CSSProperties => ({ position: "absolute", left, top, ...extra });

// 版式固定的几段英文 / 古文字(第二十五批回复:不进语言包,不随文案翻译)。
const EYEBROW_EN = "SOUL LEDGER · SIGN-IN SLIP";
const MUST_CHANGE_EN = "■ Change the password at first sign-in.";
const EYEBROW_RIGHT: Partial<Record<SlipCiv, string>> = { eu: "LIBER ANIMARVM", gr: "ΒΙΒΛΟΣ ΨΥΧΩΝ" };
const EYEBROW_LEFT_GR = "ΑΙΔΗΣ · HADES";

/** 文明决定上联印哪种文字;中性皮(四种之外的殿)跟官员台。 */
const OWN_LOCALE: Partial<Record<SlipCiv, SlipLocale>> = { cn: "zh-Hans", eg: "egy", eu: "en", gr: "en" };

const pad = (n: number) => String(n).padStart(2, "0");
/** `YYYY-MM-DD HH:mm`:本地时间、24 小时、不带秒,与界面语言无关(不走 `formatDateTime`,它随语言变)。读不出来印破折号。 */
function slipTime(value: string): string {
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "—";
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/**
 * 登录交付单(第二十批 §三 F2;第二十四批第二稿按文明重做;第二十五批双语):A4 竖版一页,上联 110 mm 交给灵魂,剪切线,下面是存根。
 * 版面是 794 × 1123 px 的绝对定位稿(= 210 × 297 mm),坐标取自 `DeliverySlipCiv.dc.html`。
 * 内容全部来自 `print-slip` 的返回,**没有密码** —— 密码处是一个空框,官员当面写,或只口头告诉。
 *
 * 文字:**上联按文明印**(酆都中文、杜阿特埃及文、欧洲与希腊英文),本文字之外再加一行 10px 英文副行(本文字是英文时不加);
 * 存根、剪线说明与页脚是官员看的,跟官员台的界面语言(`useI18n`),只印一种。
 * 三种语言的词条由调用方在打印前加载好传进来(`slipTexts.ts`),组件自己同步渲染。
 *
 * 文明由 `home_tenant.code` 的前缀决定;四种之外的殿是中性版(实心带 + 单线框,殿印位置放品牌标)。
 * `color` 为真时,匾额带、框、分隔线、殿印取文明色(`data-slip-ink`,颜色在 `app/print-slip-ink.css`);
 * 正文、二维码、编号、密码框、签收线任何时候都是纯黑。
 *
 * 屏幕上不显示、不占位;只在打印媒体下出现(`app/print.css` 的 `[data-print-slip]`)。挂在 `document.body` 上:
 * print.css 会把不属于文书的东西都收掉,交付单于是单独成页。打印前由调用方挂载、打印后卸载。
 */
export function DeliverySlip({ slip, texts, color = false }: { slip: CredentialSlip; texts: SlipBundles; color?: boolean }) {
  const { t, locale } = useI18n();
  const tenant = slip.home_tenant;
  const skin = civSkinOf(tenant.code) as SlipCiv;
  const own = OWN_LOCALE[skin] ?? locale;
  const bi = own !== "en";
  const p = texts[own].slip;
  const e = texts.en.slip;
  const ink = color ? skin : "mono";
  const inkCiv = ink === "mono" || ink === "neutral" ? undefined : ink;
  const code = formatSoulCode(slip.soul_code);
  const until = slipTime(slip.expires_at);
  const printedAt = slipTime(slip.printed_at);
  const hall = tenant.hall_names[own] || tenant.display_name;
  const deskHall = tenant.hall_names[locale] || tenant.display_name;
  const deskRealm = skin === "neutral" ? "" : t(`plaque.realm.${skin}`);
  const s = (key: string) => t(`soul_accounts.credentials.slip.${key}`);
  const upper = (text: string) => text.toUpperCase();

  const ownRealm = skin === "neutral" ? "" : texts[own].realm[skin];
  const enRealm = skin === "neutral" ? "" : upper(texts.en.realm[skin]);
  const bandLeft = skin === "gr" ? EYEBROW_LEFT_GR : upper(ownRealm) === enRealm ? enRealm : `${ownRealm}${SEP}${enRealm}`;
  const bandRight = EYEBROW_RIGHT[skin] ?? EYEBROW_EN;
  const zh = own === "zh-Hans";
  const hours = bi ? `(${p.valid_hours}${SEP}72 h)` : `(${p.valid_hours})`;

  /** 标签:本文字一行,英文副行(只在双语时)紧跟其后。 */
  const label = (key: string, upperCase: boolean) => (
    <span style={COL}>
      <span style={LABEL}>{upperCase ? upper(p[key]) : p[key]}</span>
      {bi && <span style={SUB_LABEL}>{upper(e[key])}</span>}
    </span>
  );

  return createPortal(
    <div data-print-doc="" data-print-slip="" data-testid="delivery-slip" data-slip-civ={skin} data-slip-color={color ? "" : undefined}>
      <div style={{ position: "relative", width: 794, height: 1123, overflow: "hidden", fontSize: 13, lineHeight: "20px" }}>
        <div data-slip-ink={ink} data-civ={inkCiv} style={abs(24, 24, { width: 746, height: 376 })}>
          <SlipFrame civ={skin} />
        </div>

        <div
          data-slip-white=""
          // 文字区 72–722(四种文明一致):酆都的匾两端各有一对回纹(框内 x 16–28 与 718–730),两侧各让 12。
          style={abs(72, 38, { width: 650, height: 44, display: "flex", alignItems: "center", justifyContent: "space-between", gap: 24 })}
        >
          <div style={{ ...COL, minWidth: 0 }}>
            <span style={{ ...EYEBROW, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{bandLeft || " "}</span>
            <span data-slip-hall="" style={{ ...HEADLINE, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
              {hall}
            </span>
          </div>
          <div style={{ ...COL, alignItems: "flex-end", flex: "none" }}>
            <span style={EYEBROW}>{bandRight}</span>
            <span
              data-slip-doc-title=""
              style={{ ...HEADLINE, letterSpacing: zh ? ".3em" : ".06em", marginRight: zh ? "-.3em" : undefined }}
            >
              {p.doc_title}
            </span>
          </div>
        </div>

        {/* 杜阿特的框底有两条通栏线(画布 y 389 与 392.5–395.5);稿上正文区与竖线都伸到 392,官员那一行压在线上
            (导出的 PDF 上看到的)。这一种文明收到 384 为止。 */}
        <div style={abs(48, 108, { width: 460, height: skin === "eg" ? 276 : 284, ...COL })}>
          <div style={{ display: "grid", gridTemplateColumns: "112px minmax(0,1fr)", rowGap: 8, alignItems: "center" }}>
            {label("soul", true)}
            <span style={{ fontWeight: 600, fontSize: 20, lineHeight: "28px", maxWidth: 290, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
              {slip.soul_name}
            </span>
            {label("soul_id", true)}
            <span
              data-slip-code=""
              style={{ display: "flex", gap: 20, fontFamily: MONO, fontSize: 34, lineHeight: "44px", fontWeight: 600, letterSpacing: ".06em" }}
            >
              {code.split(" ").map((g, i) => (
                <span key={i}>{g}</span>
              ))}
            </span>
            {label("password_label", true)}
            <span style={{ display: "flex", alignItems: "center", gap: 12 }}>
              <span data-slip-password-box="" style={{ width: 192, height: 40, flex: "none", boxSizing: "border-box", border: "1px solid black" }} />
              <span style={{ ...COL, minWidth: 0 }}>
                <span style={{ fontSize: 11, lineHeight: "14px" }}>{p.password_hint}</span>
                {bi && <span style={SUB_TEXT}>{e.password_hint}</span>}
              </span>
            </span>
            {label("valid_label", true)}
            <span style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
              <span data-slip-valid="" style={{ fontFamily: MONO, fontWeight: 600, fontSize: 15, lineHeight: "24px" }}>
                {until}
              </span>
              <span style={{ fontSize: 12, lineHeight: "16px" }}>{hours}</span>
            </span>
          </div>
          <div style={{ ...COL, marginTop: 10 }}>
            <span style={{ fontSize: 13, lineHeight: "18px" }}>
              <b>{p.must_change_head}</b>
              {zh ? "" : " "}
              {p.must_change_tail}
            </span>
            {bi && <span style={SUB_TEXT}>{MUST_CHANGE_EN}</span>}
          </div>
          <div style={{ ...COL, marginTop: 6 }}>
            <span style={{ fontSize: 13, lineHeight: "18px", fontWeight: 600 }}>{p.personal}</span>
            {bi && <span style={{ ...SUB_TEXT, fontWeight: 600 }}>{e.personal}</span>}
          </div>
          <div data-slip-ink={ink} data-civ={inkCiv} style={{ marginTop: "auto", height: 8 }}>
            <SlipRule civ={skin} />
          </div>
          <div style={{ marginTop: 6, display: "flex", alignItems: "baseline", gap: 24, fontSize: 12, lineHeight: "16px" }}>
            <span style={{ display: "flex", alignItems: "baseline", gap: 6 }}>
              <span>{p.officer_label}</span>
              {bi && <span style={{ fontSize: 10 }}>{e.officer_label}</span>}
              <span style={{ fontWeight: 600 }}>{slip.officer_name}</span>
            </span>
            <span style={{ display: "flex", alignItems: "baseline", gap: 6 }}>
              <span>{p.printed_label}</span>
              {bi && <span style={{ fontSize: 10 }}>{e.printed_label}</span>}
              <span data-slip-printed="" style={{ fontFamily: MONO }}>
                {printedAt}
              </span>
            </span>
          </div>
        </div>

        <span data-slip-ink={ink} data-civ={inkCiv} data-slip-seal-slot="" style={abs(448, 104, { display: "flex" })}>
          {skin === "neutral" ? (
            <BrandMark size={64} tone="ink" />
          ) : (
            <Seal size={64} civ={skin} glyphs={tenant.seal_glyphs} court={hall} />
          )}
        </span>

        <span aria-hidden="true" style={abs(536, 104, { height: skin === "eg" ? 280 : 288, borderLeft: ".5px solid black" })} />
        {/* 二维码与编号永远纯黑,不随 data-slip-ink;二维码四周 26 的静区里没有墨。 */}
        <div data-slip-qr="" style={abs(565, 118, { width: 160, height: 160 })}>
          <QrCode text={soulCodeQrPayload(slip.soul_code)} size="160px" />
        </div>
        <div style={abs(548, 304, { width: 194, ...COL, alignItems: "center", gap: 4, textAlign: "center" })}>
          <span style={{ ...COL, fontSize: 12, lineHeight: "16px" }}>
            <span>{p.qr_where}</span>
            <b style={{ fontWeight: 600 }}>{p.qr_action}</b>
          </span>
          {bi && (
            <span style={{ ...COL, fontSize: 10, lineHeight: "13px" }}>
              <span>{e.qr_where}</span>
              <b style={{ fontWeight: 600 }}>{e.qr_action}</b>
            </span>
          )}
        </div>

        {/* 稿上是一条通栏虚线、字垫白底盖在线上;打印规则把背景一律压成透明,字于是被虚线划穿(导出的 PDF 上看到的)。
            所以线分两段画在字的两侧,字的位置与稿相同(左 48,线在 416)。 */}
        <div style={abs(0, 406, { right: 0, display: "flex", alignItems: "center", gap: 8, fontSize: 12, lineHeight: "20px" })}>
          <span style={{ width: 40, borderTop: "1px dashed black" }} />
          <span>{s("cut")}</span>
          <span style={{ flex: 1, borderTop: "1px dashed black" }} />
        </div>

        <section
          style={abs(24, 448, { width: 746, boxSizing: "border-box", padding: "20px 24px 24px", border: ".5px solid black", ...COL })}
        >
          <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 16, paddingBottom: 8 }}>
            <span style={{ fontWeight: 600, fontSize: 15, lineHeight: "24px" }}>{s("stub")}</span>
            <span data-slip-stub-hall="" style={{ fontSize: 12, lineHeight: "16px" }}>
              {deskRealm ? `${deskRealm}${SEP}${deskHall}` : deskHall}
            </span>
          </div>
          <div data-slip-ink={ink} data-civ={inkCiv} style={{ height: 8 }}>
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
              <span key={k} style={{ ...COL, gap: 4 }}>
                <span style={{ height: 40, borderBottom: "1px solid black" }} />
                <span style={{ fontSize: 12, lineHeight: "16px" }}>{s(k)}</span>
              </span>
            ))}
          </div>
          <span style={{ marginTop: 20, fontSize: 12, lineHeight: "16px" }}>{s("after_sign")}</span>
        </section>

        <div data-slip-foot="" style={{ position: "absolute", left: 40, right: 40, bottom: 24, display: "flex", alignItems: "center", gap: 8, fontSize: 11, lineHeight: "16px" }}>
          <BrandMark size={14} tone="ink" />
          <span>{s("system")}</span>
          <span style={{ fontFamily: MONO, marginLeft: 16 }}>{code}</span>
          <span style={{ marginLeft: "auto" }}>{t("print.page_label", { n: "1", m: "1" })}</span>
        </div>
      </div>
    </div>,
    document.body,
  );
}
