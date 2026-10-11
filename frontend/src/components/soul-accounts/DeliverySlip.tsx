"use client";

import { createPortal } from "react-dom";
import type { CredentialSlip } from "@soulledger/core/api";
import { formatSoulCode, soulCodeQrPayload } from "@soulledger/core/domain/soulCode";
import { BrandMark } from "@/src/components/brand/BrandMark";
import { QrCode } from "@/src/components/print/QrCode";
import { useI18n } from "@/src/contexts/I18nContext";

const CAPTION = "text-[11px] tracking-[0.08em]";
const RULED = "block h-10 border-b";

/**
 * 登录交付单(第二十批 §三 F2):A4 竖版一页,上联 99 mm 交给灵魂,剪切线,下面是存根。
 * 内容全部来自 `print-slip` 的返回,**没有密码** —— 密码处是一个空框,官员当面写,或只口头告诉。
 *
 * 屏幕上不显示、不占位;只在打印媒体下出现(`app/print.css` 的 `[data-print-slip]`)。挂在 `document.body` 上:
 * print.css 会把不属于文书的东西都收掉,交付单于是单独成页。打印前由调用方挂载、打印后卸载。
 */
export function DeliverySlip({ slip }: { slip: CredentialSlip }) {
  const { t, locale, formatDateTime } = useI18n();
  const hall = slip.home_tenant.hall_names[locale] || slip.home_tenant.display_name;
  const glyphs = slip.home_tenant.seal_glyphs.join("");
  const code = formatSoulCode(slip.soul_code);
  const until = formatDateTime(slip.expires_at);
  const printedAt = formatDateTime(slip.printed_at);

  return createPortal(
    <div data-print-doc="" data-print-slip="" data-testid="delivery-slip">
      <section className="flex h-[99mm] flex-col gap-4 px-10 pt-8 pb-6">
        <div className="flex items-center gap-3 border-b-[1.5px] pb-2.5 text-[15px] font-semibold">
          <span>{hall}</span>
          <span className="flex-1" />
          <span>{t("soul_accounts.credentials.slip.title")}</span>
          {glyphs ? (
            <span aria-hidden="true" className="inline-flex min-w-6 items-center justify-center border px-1 text-[14px] leading-6">
              {glyphs}
            </span>
          ) : (
            <BrandMark size={24} tone="ink" />
          )}
        </div>
        <div className="grid flex-1 grid-cols-[minmax(0,1fr)_42mm] gap-8">
          <div className="flex flex-col gap-2.5">
            <div className="flex flex-col">
              <span className={CAPTION}>{t("soul_accounts.credentials.slip.soul")}</span>
              <span className="text-[20px] leading-7 font-semibold">{slip.soul_name}</span>
            </div>
            <div className="flex flex-col">
              <span className={CAPTION}>{t("soul_accounts.credentials.slip.soul_id")}</span>
              <span data-slip-code="" className="font-mono text-[30px] leading-10 font-semibold tracking-[0.1em]">
                {code}
              </span>
            </div>
            <div className="flex flex-col gap-1">
              <span className={CAPTION}>{t("soul_accounts.credentials.slip.password_box")}</span>
              <span data-slip-password-box="" className="block h-10 w-[300px] border" />
            </div>
            <div className="flex flex-col gap-0.5 text-[13px]">
              <b>{t("soul_accounts.credentials.slip.valid_until", { time: until })}</b>
              <span>{t("soul_accounts.credentials.slip.must_change")}</span>
            </div>
          </div>
          <div className="flex flex-col items-center gap-2">
            <QrCode text={soulCodeQrPayload(slip.soul_code)} size="42mm" />
            <span className="text-center text-[12px] leading-4">{t("soul_accounts.credentials.slip.qr_hint")}</span>
          </div>
        </div>
        <div className="flex gap-6 border-t pt-2 text-[12px]">
          <span>{t("soul_accounts.credentials.slip.officer", { name: slip.officer_name })}</span>
          <span>{t("soul_accounts.credentials.slip.printed_at", { time: printedAt })}</span>
          <span className="ml-auto">{t("soul_accounts.credentials.slip.personal")}</span>
        </div>
      </section>

      <div className="flex items-center gap-2 px-10 text-[12px]">
        <span className="w-8 border-t-[1.5px] border-dashed" />
        <span>{t("soul_accounts.credentials.slip.cut")}</span>
        <span className="flex-1 border-t-[1.5px] border-dashed" />
      </div>

      <section className="flex flex-col gap-4 px-10 py-8">
        <span className="border-b-[1.5px] pb-2.5 text-[15px] font-semibold">{t("soul_accounts.credentials.slip.stub")}</span>
        <dl className="m-0 grid grid-cols-[120px_minmax(0,1fr)] gap-x-4 gap-y-2">
          <dt>{t("soul_accounts.credentials.slip.soul")}</dt>
          <dd className="m-0">{slip.soul_name}</dd>
          <dt>{t("soul_accounts.credentials.slip.soul_id")}</dt>
          <dd className="m-0 font-mono tracking-[0.1em]">{code}</dd>
          <dt>{t("soul_accounts.credentials.slip.stub_until")}</dt>
          <dd className="m-0 font-mono">{until}</dd>
          <dt>{t("soul_accounts.credentials.slip.stub_printed")}</dt>
          <dd className="m-0">
            {slip.officer_name} · <span className="font-mono">{printedAt}</span>
          </dd>
        </dl>
        <div className="mt-6 grid grid-cols-2 gap-8">
          <span className="flex flex-col gap-1">
            <span className={RULED} />
            <span className="text-[12px]">{t("soul_accounts.credentials.slip.sign_soul")}</span>
          </span>
          <span className="flex flex-col gap-1">
            <span className={RULED} />
            <span className="text-[12px]">{t("soul_accounts.credentials.slip.sign_officer")}</span>
          </span>
        </div>
        <span className="text-[12px]">{t("soul_accounts.credentials.slip.after_sign")}</span>
      </section>

      <div data-slip-foot="" className="flex px-10 pb-6 text-[11px]">
        <span className="font-mono">{code}</span>
        <span className="ml-auto">{t("print.page_label", { n: "1", m: "1" })}</span>
      </div>
    </div>,
    document.body,
  );
}
