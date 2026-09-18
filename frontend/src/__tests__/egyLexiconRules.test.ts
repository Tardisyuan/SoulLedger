/**
 * egy 语言包守着「egy 词表与命名规则」里能机械判定的那几条。
 *
 * 词表(Claude Design 定稿)的总原则是「同一概念,永远同一写法」。它统一了七处冲突
 * (否定一律 Nen、驳回 Khesef / 取消 Sehen、审批中与审判中同为 Em Wedja、Send→Hab、
 * Ma'a→Wehem Maa、密码一律 Sekhem……),并给了 462 行逐字修订表。这里钉住:
 *
 * - 修订表 462 行与包里逐字一致(夹具 support/egyLexiconRevisions.json,键 → 修订后 egy);
 * - 无撇号、无全大写词(技术词白名单除外)、无已知英文残留;
 * - 已废止写法不再出现;
 * - 每条的 {{占位符}} 集合与 zh-Hans 同键一致。
 *
 * 不守什么,说清楚:
 * - 「词表外的生词」不是门禁 —— 现有文案大量使用词根表以外的词,硬上只会整体红;
 * - 大小写(每词首字母大写)不是门禁 —— 早期文案里还有上百条小写词;
 * - `social_moderation` 整个命名空间还是英文原文(没翻),对英文残留与撇号两条豁免。
 *   下面有一条断言它**仍然**需要豁免:翻完之后那条会红,提醒把豁免删掉。
 */
import egy from "@soulledger/core/messages/egy.json";
import en from "@soulledger/core/messages/en.json";
import zh from "@soulledger/core/messages/zh-Hans.json";

import REVISIONS from "./support/egyLexiconRevisions.json";

type Bundle = Record<string, unknown>;

function flatten(node: unknown, prefix = ""): Record<string, string> {
  if (typeof node === "string") return { [prefix]: node };
  if (!node || typeof node !== "object") return {};
  return Object.assign(
    {},
    ...Object.entries(node as Bundle).map(([k, v]) => flatten(v, prefix ? `${prefix}.${k}` : k))
  );
}

const EGY = flatten(egy);
const ZH = flatten(zh);
const EN = flatten(en);
const KEYS = Object.keys(EGY);

/** 还没翻译的命名空间:值与 en 相同的英文原文。 */
const UNTRANSLATED = "social_moderation.";
const translated = KEYS.filter((k) => !k.startsWith(UNTRANSLATED));

const placeholders = (s: string) => [...s.matchAll(/\{\{\s*(\w+)\s*\}\}/g)].map((m) => m[1]).sort();
/** 去掉占位符后的正文 —— 占位符名是代码,不是文案。 */
const prose = (s: string) => s.replace(/\{\{\s*\w+\s*\}\}/g, "");
type Rule = (_value: string, _key: string) => boolean;
const offenders = (keys: string[], bad: Rule) =>
  keys.filter((k) => bad(EGY[k], k)).map((k) => `${k}: ${EGY[k]}`);

/** 技术词原样引用(词表「技术词不转写」):缩写与角色码。 */
const CAPS_ALLOWED = new Set(["IP", "PNG", "JPEG", "MB", "MODERATOR"]);

/** 已确认改掉的英文残留。新发现一个,改掉之后加进来。 */
const ENGLISH_RESIDUE = ["Send", "Dismiss", "Egyptian"];

/**
 * 仍含单词 Ma 的键 —— 这些 Ma 不是否定(「有误」「移至」等早期写法),按同键中文判过义。
 * 否定一律 Nen:任何不在这里的 Ma 都是漏改的否定。
 */
const MA_NOT_NEGATION = new Set([
  "souls.categories.COWARDICE",
  "souls.detail.demerit",
  "souls.detail.reading.culpa_label",
  "souls.detail.date_problems.title",
  "souls.detail.date_problems.codes.implausible_lifespan",
  "souls.detail.delete_to_recycle_bin",
  "souls.date_problem_filter",
  "souls.date_problem_marker.error",
  "menus.delete_confirm_title",
  "menus.delete_confirm_message",
  "menus.delete_confirm_action",
  "permissions.matrix.only_differences",
  "permissions.matrix.confirm_removed_label",
  "workflow.detail.escalate_reason_placeholder",
  "workflow.view_to_see_nodes",
  "social_moderation.moderation_status.DELETED",
]);

/** 「Pert Abuf」只剩调度义(dispatch);作密码的写法已废止。 */
const isDispatchKey = (k: string) => /^dispatch\.|\.DISPATCH_|\.dispatch$/.test(k);

describe("egy 词表规则", () => {
  it("摊平后拿到了整份包(扫不到东西的扫描器会让下面全部通过)", () => {
    expect(KEYS.length).toBeGreaterThan(1800);
    expect(translated.length).toBeGreaterThan(1700);
  });

  it("修订表 462 行与包里逐字一致", () => {
    const table = REVISIONS as Record<string, string>;
    expect(Object.keys(table)).toHaveLength(462);
    const drift = Object.entries(table)
      .filter(([k, v]) => EGY[k] !== v)
      .map(([k, v]) => `${k}: 表=${v} 包=${EGY[k]}`);
    expect(drift).toEqual([]);
  });

  it("每条的占位符集合与 zh-Hans 同键一致", () => {
    const mismatch = KEYS.filter((k) => placeholders(EGY[k]).join() !== placeholders(ZH[k] ?? "").join()).map(
      (k) => `${k}: egy=${placeholders(EGY[k])} zh=${placeholders(ZH[k] ?? "")}`
    );
    expect(mismatch).toEqual([]);
  });

  it("无撇号", () => {
    expect(offenders(translated, (v) => /['’]/.test(prose(v)))).toEqual([]);
  });

  it("无全大写词(技术词白名单除外)", () => {
    expect(
      offenders(KEYS, (v) => (prose(v).match(/\b[A-Z]{2,}\b/g) ?? []).some((w) => !CAPS_ALLOWED.has(w)))
    ).toEqual([]);
  });

  it("无已知英文残留", () => {
    const re = new RegExp(`\\b(${ENGLISH_RESIDUE.join("|")})\\b`);
    expect(offenders(translated, (v) => re.test(prose(v)))).toEqual([]);
  });

  it("已废止写法不再出现", () => {
    const abolished = [/Ma'a/, /Medu Sekhem/, /Em Sheemtet/, /Em Maa Seth/, /\bSend\b/];
    expect(offenders(KEYS, (v) => abolished.some((re) => re.test(v)))).toEqual([]);
    expect(offenders(KEYS, (v, k) => !isDispatchKey(k) && /Pert Abuf/.test(v))).toEqual([]);
  });

  it("否定一律 Nen:单词 Ma 只剩判过义的非否定用法", () => {
    expect(offenders(KEYS, (v, k) => !MA_NOT_NEGATION.has(k) && /\b[Mm]a\b/.test(prose(v)))).toEqual([]);
    // 白名单里的键若已不含 Ma,就该从白名单删掉,否则它会替将来的漏改背书。
    const stale = [...MA_NOT_NEGATION].filter((k) => !/\b[Mm]a\b/.test(prose(EGY[k] ?? "")));
    expect(stale).toEqual([]);
  });

  it(`${UNTRANSLATED}* 仍是英文原文,豁免仍然必要`, () => {
    const english = KEYS.filter((k) => k.startsWith(UNTRANSLATED) && EGY[k] === EN[k]);
    expect(english.length).toBeGreaterThan(0);
  });
});
