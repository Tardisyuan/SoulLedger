"use client";

import { useEffect, useState } from "react";
import { createPortal, flushSync } from "react-dom";
import { judgmentApi, type JudgmentDetail } from "@soulledger/core/api/judgment";
import type { HistoricalDate } from "@soulledger/core/domain/dates";
import { localName } from "@soulledger/core/domain/localName";
import { verdictDocument, type VerdictDocumentText } from "@soulledger/core/domain/verdictDocument";
import { useI18n } from "@/src/contexts/I18nContext";
import { useToast } from "@/src/contexts/ToastContext";
import { saveBlob } from "@/src/lib/saveBlob";
import { Button } from "@/src/components/ui/Button";
import { CaseNumber } from "@/src/components/ui/DomainValue";

/**
 * 判决文书(v4 第七批 S15,`verdict_doc.*` · `doc.download_pdf` · 复用 `print.button`)。
 * 字由 `@soulledger/core/domain/verdictDocument` 给,这里只管版式:地府竖排牒文加朱印,欧洲判词带花体首字母与火漆,
 * 埃及纸草带圣书字边,希腊石刻配回纹(定稿 S15 的说明)。纸、墨与尺寸都在 `app/verdict-doc.css`,按 `data-civ`。
 *
 * 只给已结的案子(`is_final`,且裁决是通过 / 不过 / 炼狱)渲染;别的返回 null —— 落印不可撤回
 * (`judgment.desk.irreversible`),文书上没有任何改判或撤回的入口。
 *
 * 「打印」走浏览器打印(定稿:「浏览器里『打印』走同一份 @page A4 样式」):
 * 点了之后把一份文书挂到 body 下(`data-print-verdict-doc`),`print.css` 在打印时只留它、一页 A4;
 * 打印完(`afterprint`)卸下。屏幕上的这张卡带 `data-print-hide`:整页打印案卷时不重复印一份。
 *
 * 「下载 PDF」直接下载一个真 PDF(用户 2026-11-07):`GET /judgment/{id}/verdict-document.pdf/`,后端让无头 Chromium
 * 打开 `app/verdict-print`,那一页渲染的是下面同一个 `VerdictPaper`、同一份 CSS,所以 PDF 与打印出来的一样。
 * 服务不在(503)或别的失败:提示一句,退回浏览器打印 —— 把 `document.title` 暂换成案号,「存为 PDF」的默认文件名就是案号。
 * 演示站(`NEXT_PUBLIC_DEMO_MODE`)没有后端,直接走后一条。
 */
export interface VerdictDocumentProps {
  judgment: Pick<
    JudgmentDetail,
    | "id"
    | "civilization"
    | "verdict"
    | "is_final"
    | "case_number"
    | "soul_name"
    | "court"
    | "judge_name"
    | "judge_name_en"
    | "merit_score"
    | "demerit_score"
    | "offence"
    | "fail_reasons"
    | "fail_reason_note"
    | "greek_account"
    | "greek_curability"
    | "concluded_at_local"
    | "cited_deadly_sins"
    | "judge"
    | "final_review_by"
  >;
  /** 灵魂的生卒(`Soul.birth_date` / `death_date`),地府正文的生年卒年;没给就写「未记录」。 */
  soul?: { birth_date?: HistoricalDate | null; death_date?: HistoricalDate | null } | null;
  /** 这件案子的处置:欧洲的圈台号、地府「功多于过」的道别读它;没给就写「未记录」。 */
  disposition?: { realm_code?: string | null; suggested_rebirth_form?: string | null } | null;
}

const DownloadIcon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M12 4v11m-4.5-4.5L12 15l4.5-4.5M5 20h14" />
  </svg>
);
const PrintIcon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M7 9V4h10v5M7 17H5a1.5 1.5 0 0 1-1.5-1.5v-5A1.5 1.5 0 0 1 5 9h14a1.5 1.5 0 0 1 1.5 1.5v5A1.5 1.5 0 0 1 19 17h-2" />
    <path d="M7 14h10v6H7Z" />
  </svg>
);

/** 圣书字边(纯装饰,读屏不读)。 */
const HIEROGLYPH_BORDER = "𓋹 𓂀 𓆄 𓊽 𓁹 𓇳 𓋴 𓏏 𓆄 𓋹 𓂀 𓊽 𓇳 𓁹 𓋹 𓂀 𓆄 𓊽";

/** 印:外形按文明(地府方、欧洲火漆圆、埃及拱、希腊六边),印文是语言包的 `verdict_doc.*.seal`。 */
function DocSeal({ doc }: { doc: VerdictDocumentText }) {
  const shape = {
    cn: <><rect x="3" y="3" width="94" height="94" rx="4" strokeWidth="5" /><rect x="11" y="11" width="78" height="78" strokeWidth="1.5" /></>,
    eu: <circle cx="50" cy="50" r="30" strokeWidth="1.5" />,
    eg: <><path d="M3 97V48A47 47 0 0 1 97 48V97Z" strokeWidth="3" /><path d="M10 90V49A40 40 0 0 1 90 49V90Z" strokeWidth="1" /></>,
    gr: <><path d="M50 2 92 26V74L50 98 8 74V26Z" strokeWidth="2.5" /><path d="M50 9 86 30V70L50 91 14 70V30Z" strokeWidth="1" /></>,
  }[doc.civ];
  return (
    <div data-doc-seal="" role="img" aria-label={doc.seal}>
      <svg viewBox="0 0 100 100" fill="none" stroke="currentColor" aria-hidden="true">
        {shape}
      </svg>
      <span aria-hidden="true">{doc.seal}</span>
    </div>
  );
}

/** 一张纸:屏幕上的卡、打印用的那份、PDF 打印页(`app/verdict-print`)是同一个组件。 */
export function VerdictPaper({ doc, caseNumber }: { doc: VerdictDocumentText; caseNumber: string }) {
  return (
    <article data-verdict-paper="" data-civ={doc.civ} data-account={doc.account} data-vertical={doc.vertical ? "" : undefined}>
      {doc.civ === "eg" && (
        <>
          <div data-doc-border="top" aria-hidden="true">{HIEROGLYPH_BORDER}</div>
          <div data-doc-border="bottom" aria-hidden="true">{HIEROGLYPH_BORDER}</div>
        </>
      )}
      <div data-doc-text="">
        {doc.civ === "eu" ? (
          <p data-doc-deco="">
            {doc.deco} · <CaseNumber value={caseNumber} variant="inline" plain />
          </p>
        ) : (
          doc.deco && <p data-doc-deco="">{doc.deco}</p>
        )}
        {/* 不用 <h2>:页面的 h2 只有三个字阶角色(PageShell density 守卫),文书题名是纸上的字,字号在 verdict-doc.css。 */}
        <p data-doc-title="" role="heading" aria-level={2}>
          {doc.title}
        </p>
        {doc.name && <p data-doc-name="">{doc.name}</p>}
        <p data-doc-body="">{doc.body}</p>
        <p data-doc-verdict="">{doc.ruling}</p>
        {doc.sins && <p data-doc-sins="">{doc.sins}</p>}
        <div data-doc-sign="">
          {doc.signs.map((s) => (
            <p key={s}>{s}</p>
          ))}
          <p data-doc-date="">{doc.date}</p>
        </div>
      </div>
      <DocSeal doc={doc} />
    </article>
  );
}

const yearOf = (d: HistoricalDate | null | undefined) => d?.year ?? null;

/** 文书的字:网页上的卡与 PDF 打印页同一个算法、同一组输入。不是已结的案子就是 null。 */
export function useVerdictDoc({ judgment, soul, disposition }: VerdictDocumentProps): VerdictDocumentText | null {
  const { t, locale } = useI18n();
  return judgment.is_final
    ? verdictDocument(
        {
          civilization: judgment.civilization,
          verdict: judgment.verdict,
          soulName: judgment.soul_name,
          concludedAtLocal: judgment.concluded_at_local,
          han: locale === "zh-Hans",
          court: judgment.court,
          judgeName: localName(judgment, locale, "judge_name"),
          merit: judgment.merit_score,
          demerit: judgment.demerit_score,
          bornYear: yearOf(soul?.birth_date),
          diedYear: yearOf(soul?.death_date),
          offence: judgment.offence,
          failReasons: judgment.fail_reasons,
          failReasonNote: judgment.fail_reason_note,
          realmCode: disposition?.realm_code,
          rebirthForm: disposition?.suggested_rebirth_form,
          greekAccount: judgment.greek_account,
          greekCurability: judgment.greek_curability,
          citedDeadlySins: judgment.cited_deadly_sins,
          judgeId: judgment.judge,
          finalReviewBy: judgment.final_review_by,
        },
        t
      )
    : null;
}

export function VerdictDocument(props: VerdictDocumentProps) {
  const { judgment } = props;
  const { t, locale } = useI18n();
  const { showToast } = useToast();
  const [printing, setPrinting] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const doc = useVerdictDoc(props);
  if (!doc) return null;

  const print = (asPdf: boolean) => {
    flushSync(() => setPrinting(true));
    const title = document.title;
    if (asPdf && judgment.case_number) document.title = judgment.case_number;
    window.addEventListener(
      "afterprint",
      () => {
        document.title = title;
        setPrinting(false);
      },
      { once: true }
    );
    window.print();
  };

  const downloadPdf = async () => {
    if (process.env.NEXT_PUBLIC_DEMO_MODE === "1") return print(true);
    setDownloading(true);
    try {
      const { data } = await judgmentApi.verdictDocumentPdf(judgment.id, locale);
      saveBlob(data, `${judgment.case_number || judgment.id}.pdf`, "application/pdf");
    } catch {
      showToast(t("doc.pdf_fallback"), "info");
      print(true);
    } finally {
      setDownloading(false);
    }
  };

  return (
    <section data-verdict-doc="" data-print-hide="">
      <VerdictPaper doc={doc} caseNumber={judgment.case_number} />
      <div data-verdict-doc-actions="" className="mt-3 flex items-center gap-2">
        <Button type="button" variant="secondary" size="sm" loading={downloading} onClick={downloadPdf}>
          <DownloadIcon />
          {t("doc.download_pdf")}
        </Button>
        {/* 审判台上还有页面自己的「打印」(整份案卷);这个的可读名字带上文书题名,两者不重名。不另起词条。 */}
        <Button type="button" variant="secondary" size="sm" aria-label={`${t("print.button")} · ${doc.title}`} onClick={() => print(false)}>
          <PrintIcon />
          {t("print.button")}
        </Button>
      </div>
      {printing &&
        createPortal(
          <div data-print-doc="" data-print-verdict-doc="">
            <VerdictPaper doc={doc} caseNumber={judgment.case_number} />
          </div>,
          document.body
        )}
    </section>
  );
}

/**
 * PDF 打印页(`app/verdict-print`)的那一份:挂到 body 下,与「打印」挂的同一个形状(`print.css` 只认 body 的直接孩子),
 * 无头 Chromium 按 print 媒体出 PDF。文书挂好、当前语言包到了(`ready`)、字体加载完,才在 body 上写
 * `data-verdict-ready="1"` —— 后端交给 Gotenberg 的 `waitForExpression` 等的就是它(`apps/judgment/verdict_pdf.py`)。
 */
export function VerdictPrintSheet(props: VerdictDocumentProps) {
  const { ready } = useI18n();
  const doc = useVerdictDoc(props);
  const hasDoc = doc !== null;
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  useEffect(() => {
    if (!mounted || !ready || !hasDoc) return;
    let live = true;
    void document.fonts.ready.then(() => {
      if (live) document.body.dataset.verdictReady = "1";
    });
    return () => {
      live = false;
    };
  }, [mounted, ready, hasDoc]);
  if (!doc || !mounted) return null;
  return createPortal(
    <div data-print-doc="" data-print-verdict-doc="">
      <VerdictPaper doc={doc} caseNumber={props.judgment.case_number} />
    </div>,
    document.body
  );
}
