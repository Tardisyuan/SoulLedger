/**
 * 判决文书的字(v4 第七批 S15 `verdict_doc.*`;文字定稿见 docs/design-handoff/v4-prompts/ 第五、六批)。
 * 纯函数:给一件已结的案子,返回该文明那份文书每一格的字;版式在 web 的 `VerdictDocument`。
 * 平台无关,审判台的「判语预览」与官员 App 可以用同一份。
 *
 * 四文明各自的规则:
 * - 地府:判语按裁决与罪目 —— 五逆 → `five_heinous`;别的罪目 → `fail`,殿号取罪目所属的殿
 *   (`offenceCourt`,与后端自动选殿同一张表);通过时功多于过 → `merit`(道别取第十殿的六道建议),
 *   否则 → `balanced`。**中文界面竖排、用汉字数字**(第六批第 3 条),年份逐位(一九三一),
 *   计数按读法(四十二);「年」由文书加,数据不带。其他语言横排、阿拉伯数字。
 * - 欧洲:天国 / 炼狱第 n 台 / 地狱第 n 圈 / 前庭(第六批第 6 条)。圈台号读处置的界域代码;
 *   否认灵魂不灭落第 6 圈(第六批第 7 条)。「哪一宗大罪」只在下地狱时写,取本案引用的七宗罪条文
 *   (`cited_deadly_sins`,D9);没引用就没有那一行。
 * - 埃及:跟天平,通过 / 不过两句。
 * - 希腊:按官员落印时选的文书(`greek_account`,D8)—— 《高尔吉亚》用 `gr.*`,《理想国》用 `gr_er.*`,
 *   两篇不合并。不过时按可医 / 不可医(`greek_curability`,D7)。一审落款只写判官名(第六批第 4 条)。
 *
 * 日期与时辰读 `concluded_at_local`(带偏移、按落印殿的时区写死,D12):直接取串里的年月日与钟点,
 * **不经过 `Date`** —— `Date` 会换成观看者的时区,同一份文书给两个时区的人看就成了两个时辰。
 *
 * 待定、重审(`RETRY`)、未结案没有文书,返回 null。
 */
import { civilHourAt, type HourCiv } from "./civilHours";
import { courtLabel, courtSlug } from "./courts";
import { offenceCourt } from "./diyuCase";

type T = (key: string, vars?: Record<string, string>) => string;

/** 文书用哪一套键:四文明各一套,希腊《理想国》另一套。 */
export type DocAccount = HourCiv | "gr_er";

export interface VerdictDocumentInput {
  civilization: string;
  verdict: string | null | undefined;
  soulName: string;
  /** `Judgment.concluded_at_local`:`2026-11-06T14:40:00+08:00`。 */
  concludedAtLocal: string | null | undefined;
  /** 中文界面:竖排 + 汉字数字(只对地府文书有意义)。 */
  han: boolean;
  /** `Judgment.court`(「第一殿」这类写法,`courts.ts` 认得的)。 */
  court?: string | null;
  /** 神话里的判官(`judge_name`,已按语言取好):地府是阎王,希腊是一审判官。 */
  judgeName?: string | null;
  merit?: number | null;
  demerit?: number | null;
  bornYear?: number | null;
  diedYear?: number | null;
  offence?: string | null;
  failReasons?: readonly string[] | null;
  failReasonNote?: string | null;
  /** 处置的界域代码(`Disposition.realm_code`),欧洲的圈台号、地府「其他」时的殿号读它。 */
  realmCode?: string | null;
  /** 第十殿的六道建议(`Disposition.suggested_rebirth_form`),地府「功多于过」的道别。 */
  rebirthForm?: string | null;
  greekAccount?: string | null;
  greekCurability?: string | null;
  citedDeadlySins?: readonly string[] | null;
}

export interface VerdictDocumentText {
  civ: HourCiv;
  account: DocAccount;
  /** 地府中文:竖排。 */
  vertical: boolean;
  /** 欧洲 SENTENTIA、希腊 ΚΡΙΣΙΣ;别的文明没有。 */
  deco?: string;
  title: string;
  body: string;
  /** 判语(已翻译好的一句;不叫 verdict,那是裁决枚举的字段名,domainDisplayContract 认它)。 */
  ruling: string;
  /** 欧洲下地狱时「哪一宗大罪」(七宗罪名,用 · 连);没引用就没有。 */
  sins?: string;
  /** 希腊两套的正文不带名字,名字单占正文上面一行(定稿 S15)。 */
  name?: string;
  date: string;
  /** 落款,一行一个:希腊高尔吉亚是一审判官 + 米诺斯终裁。 */
  signs: string[];
  seal: string;
}

const CIV: Record<string, HourCiv> = { CHINESE: "cn", EUROPEAN: "eu", EGYPTIAN: "eg", GREEK: "gr" };
const FINAL = new Set(["PASSED", "FAILED", "PURGATORY"]);

const HAN_DIGITS = "〇一二三四五六七八九";
const HAN_UNITS = ["", "十", "百", "千"];
const HAN_ZERO = "零";
const HAN_WAN = "万";
const HAN_YEAR = "年";

/** 年份逐位:1931 → 一九三一,2026 → 二〇二六。负数(公元前)原样给阿拉伯数字。 */
export const hanDigits = (n: number): string =>
  Number.isInteger(n) && n >= 0 ? [...String(n)].map((d) => HAN_DIGITS[Number(d)]).join("") : String(n);

function below10k(n: number, top: boolean): string {
  const s = String(n).padStart(4, "0");
  let out = "";
  let gap = false;
  for (let i = 0; i < 4; i++) {
    const d = Number(s[i]);
    const unit = HAN_UNITS[3 - i];
    if (d === 0) {
      gap = out !== "";
      continue;
    }
    if (gap) out += HAN_ZERO;
    gap = false;
    // 「十二」不是「一十二」:只在最高位、且最高位就是十位时省掉「一」。
    out += d === 1 && unit === "十" && out === "" && top ? unit : HAN_DIGITS[d] + unit;
  }
  return out;
}

/** 计数的读法:30 → 三十,42 → 四十二,105 → 一百零五,0 → 零。上亿或非整数退回阿拉伯数字。 */
export function hanNumber(n: number): string {
  if (!Number.isInteger(n) || n < 0 || n >= 1e8) return String(n);
  if (n === 0) return HAN_ZERO;
  if (n < 1e4) return below10k(n, true);
  const hi = Math.floor(n / 1e4);
  const lo = n % 1e4;
  return below10k(hi, true) + HAN_WAN + (lo ? (lo < 1000 ? HAN_ZERO : "") + below10k(lo, false) : "");
}

/** 带偏移的 ISO 串 → 那个时区里的年月日与钟点;读不出是 null。 */
export function localParts(iso: string | null | undefined): { year: number; month: number; day: number; hour: number } | null {
  const m = /^(-?\d{1,6})-(\d{2})-(\d{2})T(\d{2})/.exec(iso ?? "");
  return m ? { year: Number(m[1]), month: Number(m[2]), day: Number(m[3]), hour: Number(m[4]) } : null;
}

const courtNumber = (court: string | null | undefined): number | null => {
  const m = /^court_(\d+)$/.exec(courtSlug(court) ?? "");
  return m ? Number(m[1]) : null;
};

/** `DY_COURT_04_WUGUAN` → 4;`EU_HELL_4TH` → 4;`EU_PURGATORY_T5_AVARICE` → 5。 */
const realmNumber = (code: string | null | undefined, re: RegExp): number | null => {
  const m = re.exec(code ?? "");
  return m ? Number(m[1]) : null;
};

/** 否认灵魂不灭(异端)在第六圈(docs/01、docs/03)。 */
const HERESY_CIRCLE = 6;

const SIN_TERRACE: Record<string, number> = { pride: 1, envy: 2, wrath: 3, sloth: 4, greed: 5, gluttony: 6, lust: 7 };

export function verdictDocument(input: VerdictDocumentInput, t: T): VerdictDocumentText | null {
  const civ = CIV[input.civilization];
  if (!civ || !input.verdict || !FINAL.has(input.verdict)) return null;
  // 地府的「存疑」不是终判:灵魂发回待审所候再审(`_route_chinese`),没有解送哪一殿,不出文书。
  if (civ === "cn" && input.verdict === "PURGATORY") return null;
  const passed = input.verdict === "PASSED";
  const unrecorded = t("common.value.unrecorded");
  const han = input.han && civ === "cn";
  const num = (n: number | null | undefined) => (n == null ? unrecorded : han ? hanNumber(n) : String(n));
  const year = (n: number | null | undefined) => (n == null ? unrecorded : han ? hanDigits(n) + HAN_YEAR : String(n));

  const greekRepublic = civ === "gr" && input.greekAccount === "REPUBLIC";
  const account: DocAccount = greekRepublic ? "gr_er" : civ;
  const k = (rest: string) => `verdict_doc.${account}.${rest}`;

  const parts = localParts(input.concludedAtLocal);
  const date = parts
    ? (() => {
        const hour = civilHourAt(civ, parts.hour);
        return t(k("date"), {
          year: han ? hanDigits(parts.year) : String(parts.year),
          month: han ? hanNumber(parts.month) : String(parts.month),
          day: han ? hanNumber(parts.day) : String(parts.day),
          hour: t(hour.key, hour.params),
        });
      })()
    : unrecorded;

  const soul = input.soulName || unrecorded;
  const reasons = input.failReasons ?? [];

  switch (civ) {
    case "cn": {
      const n = courtNumber(input.court);
      const courtName = courtLabel(t, input.court) || unrecorded;
      let verdict: string;
      if (passed) {
        const more = (input.merit ?? 0) > (input.demerit ?? 0);
        verdict = more
          ? t(k("verdict.merit"), { path: input.rebirthForm ? t(`reincarnation.forms.${input.rebirthForm}`) : unrecorded })
          : t(k("verdict.balanced"));
      } else if (input.offence === "FIVE_HEINOUS") {
        verdict = t(k("verdict.five_heinous"));
      } else {
        const to = offenceCourt(input.offence) ?? realmNumber(input.realmCode, /^DY_COURT_(\d+)_/);
        const offence = input.offence ? t(`judgment.offences.${input.offence}`) : input.failReasonNote?.trim() || unrecorded;
        verdict = t(k("verdict.fail"), { offence, n: num(to) });
      }
      return {
        civ,
        account,
        vertical: han,
        title: t(k("title"), { court: courtName }),
        body: t(k("body"), { soul, born: year(input.bornYear), died: year(input.diedYear), merit: num(input.merit), demerit: num(input.demerit) }),
        ruling: verdict,
        date,
        signs: [n == null ? input.judgeName || courtName : t(k("sign"), { n: num(n), king: input.judgeName || unrecorded })],
        seal: t(k("seal"), { court: courtName }),
      };
    }
    case "eu": {
      let verdict: string;
      let sins: string | undefined;
      const cited = input.citedDeadlySins ?? [];
      if (passed) verdict = t(k("verdict.heaven"));
      else if (input.verdict === "PURGATORY") {
        const lowest = cited.length ? Math.min(...cited.map((s) => SIN_TERRACE[s] ?? 99)) : null;
        const n = realmNumber(input.realmCode, /^EU_PURGATORY_T(\d+)_/) ?? (lowest != null && lowest < 99 ? lowest : null);
        verdict = t(k("verdict.purgatory"), { n: num(n) });
      } else if (input.realmCode === "EU_ANTINFERNO" || (!input.realmCode && reasons.includes("NEUTRAL"))) {
        verdict = t(k("verdict.antinferno"));
      } else {
        const heresy = reasons.includes("DENIED_IMMORTALITY");
        const n = realmNumber(input.realmCode, /^EU_HELL_(\d+)/) ?? (heresy ? HERESY_CIRCLE : null);
        // 第一圈林勃不是刑罚,第六圈的异端理由不是大罪:各有自己的一句,不借「有未悔的大罪」(docs/01 §判决理由、docs/03)。
        if (n === 1) verdict = t(k("verdict.limbo"));
        else if (n === HERESY_CIRCLE && heresy) verdict = t(k("verdict.heresy"));
        else {
          verdict = t(k("verdict.hell"), { n: num(n) });
          if (cited.length) sins = cited.map((s) => t(`reject_reason.eu.sin.${s}`)).join(" · ");
        }
      }
      return {
        civ, account, vertical: false, deco: t(k("deco")), title: t(k("title")), body: t(k("body"), { soul }),
        ruling: verdict, sins, date, signs: [t(k("sign"))], seal: t(k("seal")),
      };
    }
    case "eg":
      return {
        civ, account, vertical: false, title: t(k("title")), body: t(k("body"), { soul }),
        ruling: t(k(passed ? "verdict.pass" : "verdict.fail")), date, signs: [t(k("sign"))], seal: t(k("seal")),
      };
    case "gr": {
      const incurable = input.greekCurability === "INCURABLE";
      const verdict = greekRepublic
        ? t(k(passed ? "verdict.just" : incurable ? "verdict.incurable" : "verdict.unjust"))
        : t(k(passed ? "verdict.isles" : incurable ? "verdict.incurable" : "verdict.curable"));
      const signs = greekRepublic
        ? [t(k("sign"))]
        : [...(input.judgeName ? [t(k("sign_first"), { judge: input.judgeName })] : []), t(k("sign_final"))];
      return {
        civ, account, vertical: false, deco: t("verdict_doc.gr.deco"), title: t(k("title")), name: soul, body: t(k("body")),
        ruling: verdict, date, signs, seal: t(k("seal")),
      };
    }
  }
}
