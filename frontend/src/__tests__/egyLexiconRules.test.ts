/**
 * egy 语言包守着「egy 词表与命名规则」里能机械判定的那几条。
 *
 * 词表(Claude Design 定稿)的总原则是「同一概念,永远同一写法」。它统一了七处冲突
 * (否定一律 Nen、驳回 Khesef / 取消 Sehen、审批中与审判中同为 Em Wedja、Send→Hab、
 * Ma'a→Wehem Maa、密码一律 Sekhem……),并给了 462 行逐字修订表;后来追加的「审核域」一节
 * 又给了 social_moderation 71 行与 18 个审核域词根(删除一律 Fekh,Sekhem Ma 废止)。这里钉住:
 *
 * - 修订表 533 行与包里逐字一致(夹具 support/egyLexiconRevisions.json,键 → 修订后 egy);
 * - 无撇号、无全大写词(技术词白名单除外)、无已知英文残留;
 * - 已废止写法不再出现;
 * - 每条的 {{占位符}} 集合与 zh-Hans 同键一致;
 * - 每词首字母大写(含小词;连字符复合词的每一段,如 Djes-Ef);
 * - 封闭词汇:每个词都在「词根 ∪ 小词 ∪ 登记表」里,登记表不含已不用的词。
 *
 * 不守什么,说清楚:
 * - 登记表只管「这个词形有没有被显式登记」,不管它是否合乎词表 —— 词根 39 + 18、小词 18 个,
 *   现有文案用到四百多个词形。新生词要在评审里看它在登记表 diff 里那一行。
 */
import { writeFileSync } from "node:fs";
import path from "node:path";

import egy from "@soulledger/core/messages/egy.json";
import zh from "@soulledger/core/messages/zh-Hans.json";

import REVISIONS from "./support/egyLexiconRevisions.json";
import VOCABULARY from "./support/egyVocabulary.json";

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
const KEYS = Object.keys(EGY);

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
]);

/** 「Pert Abuf」只剩调度义(dispatch);作密码的写法已废止。 */
const isDispatchKey = (k: string) => /^dispatch\.|\.DISPATCH_|\.dispatch$/.test(k);

/**
 * 技术词原样引用(词表「技术词 cron / webhook / ms / 权限键名不转写」):每条只放行它自己的
 * 那几个记号 —— 权限键名、命令 / 方法名、时间单位、占位示例里的代码值、版本号、色值。
 * 放行按键不按词:`soul` 在示例里是分类代码,在别处就是该大写的词。
 * 修订表 533 行里除这些技术词外**没有**大小写违例,所以不需要为修订表另设豁免。
 */
const TECHNICAL: Record<string, string[]> = {
  "soul_accounts.credentials.manage_hint": ["soul_account.manage"],
  "scheduler.manage_hint": ["scheduler.manage"],
  "audit.needs_audit_read": ["audit.read"],
  "judgment.queue.read_only": ["judgment.execute"],
  "permissions.matrix.confirm_menu_read_warning": ["menu.read"],
  "menus.permission_codename_placeholder": ["soul.read"],
  "menu_buttons.permission_placeholder": ["soul.create", "judgment.delete"],
  "menu_buttons.code_placeholder": ["add", "edit", "delete", "export"],
  "menus.component_placeholder": ["souls"],
  "permissions.category_placeholder": ["soul"],
  "menus.gate_permission_effect": ["get_codename"],
  "scheduler.empty.no_jobs_reason": ["setup_scheduled_tasks"],
  "scheduler.duration.ms": ["ms"],
  "scheduler.duration.s": ["s"],
  "welcome.minutes_ago": ["m"],
  "welcome.hours_ago": ["h"],
  "footer.version": ["v0.1"],
  "settings.accent_hex_invalid": ["#ff5500"],
  "ledger.copy_resource_id": ["{resource}"],
};

/** 空白切出的记号去掉两端标点(括号、引号、逗号、句点……),留下可与 TECHNICAL 比对的原形。 */
const bare = (token: string) => token.replace(/^[^A-Za-z0-9#{]+|[^A-Za-z0-9}]+$/g, "");
const tokens = (k: string) => prose(EGY[k]).split(/\s+/).map(bare);
/** 一条文案里的词:去占位符、去该键的技术词,取字母串;连字符复合词(Djes-Ef)算一个词。 */
const words = (k: string) =>
  prose(EGY[k])
    .split(/\s+/)
    .filter((t) => !(TECHNICAL[k] ?? []).includes(bare(t)))
    .flatMap((t) => t.match(/[A-Za-z]+(?:-[A-Za-z]+)*/g) ?? []);

/**
 * 定稿词表:词根 39 个、审核域词根 18 个、语法小词 18 个,逐字照抄。「Duat / Pet」「Er Hry」按空格
 * 拆成词;连字符写法(Djes-Ef、Neb-Medu、Ankh-Wehem)照抄为一个词形。
 */
const ROOTS = [
  "Ba", "Ren", "Ankh", "Medjat", "Sesh", "Medu", "Sekhem", "Wedja", "Wetep", "Mesut",
  "Dbh", "Nehet", "Khesef", "Hesy", "Hemes", "Taui", "Wesekhet", "Sab", "Nefer", "Isfet",
  "Shut", "Ib", "Wat", "Kheperu", "Kheper", "Sethet", "Gem", "Mut", "Khetem", "Djeret",
  "Hab", "Aq", "Wenen", "Baku", "Ahet", "Was", "Renpi", "Qebeh", "Duat / Pet",
];
/** 审核域(social_moderation)。Imen 隐藏 / Fekh 删除·解除;Menkh 审核通过 / Hesy 批准转生;Gerh 禁言 / Djeseru 敏感词。 */
const ROOTS_MOD = [
  "Sedjem", "Wesheb", "Djeseru", "Gerh", "Imen", "Fekh", "Per", "Aat", "Redi",
  "Mehy", "Kher", "Hemet", "Betau", "Shemsu", "Neb-Medu", "Khet", "Menkh", "Ankh-Wehem",
];
const PARTICLES = [
  "Em", "Nen", "Seth", "Tepy", "Pehwy", "Wehem", "Pen", "Ky", "Neb", "Wa",
  "Ek", "Er", "Hena", "Djer", "Emu", "Dy", "Djes-Ef", "Er Hry",
];
const LEXICON = new Set([...ROOTS, ...ROOTS_MOD, ...PARTICLES].flatMap((e) => e.split(/ \/ | /)));

/**
 * 封闭词汇登记表(support/egyVocabulary.json):egy 文案用到的
 * 每个词形 → 出现次数、是否在定稿词根 / 小词表内。**由本文件生成,不手抄**:
 *
 *     EGY_VOCAB_WRITE=1 npx jest egyLexiconRules    # 在 frontend/ 下;写完再跑一次看绿
 *
 * 写的那一次仍按旧表断言(import 在写之前),所以会红;第二次才是结论。
 */
type VocabEntry = { count: number; lexicon: boolean };
const usage: Record<string, VocabEntry> = {};
for (const k of KEYS) {
  for (const w of words(k)) usage[w] = { count: (usage[w]?.count ?? 0) + 1, lexicon: LEXICON.has(w) };
}
const USAGE = Object.fromEntries(Object.entries(usage).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)));
if (process.env.EGY_VOCAB_WRITE === "1") {
  const lines = Object.entries(USAGE).map(([w, e]) => `  ${JSON.stringify(w)}: ${JSON.stringify(e)}`);
  writeFileSync(path.join(__dirname, "support/egyVocabulary.json"), `{\n${lines.join(",\n")}\n}\n`);
}
const REGISTERED = VOCABULARY as Record<string, VocabEntry>;

describe("egy 词表规则", () => {
  it("摊平后拿到了整份包(扫不到东西的扫描器会让下面全部通过)", () => {
    expect(KEYS.length).toBeGreaterThan(1800);
  });

  it("修订表 533 行与包里逐字一致", () => {
    const table = REVISIONS as Record<string, string>;
    expect(Object.keys(table)).toHaveLength(533);
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
    expect(offenders(KEYS, (v) => /['’]/.test(prose(v)))).toEqual([]);
  });

  it("无全大写词(技术词白名单除外)", () => {
    expect(
      offenders(KEYS, (v) => (prose(v).match(/\b[A-Z]{2,}\b/g) ?? []).some((w) => !CAPS_ALLOWED.has(w)))
    ).toEqual([]);
  });

  it("无已知英文残留", () => {
    const re = new RegExp(`\\b(${ENGLISH_RESIDUE.join("|")})\\b`);
    expect(offenders(KEYS, (v) => re.test(prose(v)))).toEqual([]);
  });

  it("已废止写法不再出现", () => {
    // Sekhem 只表密码:删除一律 Fekh(审核域定稿)。
    const abolished = [/Ma'a/, /Medu Sekhem/, /Em Sheemtet/, /Em Maa Seth/, /\bSend\b/, /\bSekhem Ma\b/];
    expect(offenders(KEYS, (v) => abolished.some((re) => re.test(v)))).toEqual([]);
    expect(offenders(KEYS, (v, k) => !isDispatchKey(k) && /Pert Abuf/.test(v))).toEqual([]);
  });

  it("否定一律 Nen:单词 Ma 只剩判过义的非否定用法", () => {
    expect(offenders(KEYS, (v, k) => !MA_NOT_NEGATION.has(k) && /\b[Mm]a\b/.test(prose(v)))).toEqual([]);
    // 白名单里的键若已不含 Ma,就该从白名单删掉,否则它会替将来的漏改背书。
    const stale = [...MA_NOT_NEGATION].filter((k) => !/\b[Mm]a\b/.test(prose(EGY[k] ?? "")));
    expect(stale).toEqual([]);
  });

  it("每词首字母大写:含小词,连字符复合词的每一段都算", () => {
    expect(offenders(KEYS, (_v, k) => words(k).some((w) => w.split("-").some((s) => !/^[A-Z]/.test(s))))).toEqual(
      []
    );
  });

  it("技术词放行清单没有陈旧项:每个记号都还原样出现在它的键里", () => {
    const stale = Object.entries(TECHNICAL).flatMap(([k, ts]) =>
      ts.filter((t) => !tokens(k).includes(t)).map((t) => `${k}: ${t}`)
    );
    expect(stale).toEqual([]);
  });

  it("封闭词汇:每个词都在词根 ∪ 小词 ∪ 登记表里", () => {
    expect(Object.keys(USAGE).length).toBeGreaterThan(300);
    const unregistered = Object.keys(USAGE).filter((w) => !LEXICON.has(w) && !(w in REGISTERED));
    expect(unregistered).toEqual([]);
  });

  it("登记表没有已不再使用的词", () => {
    expect(Object.keys(REGISTERED).filter((w) => !(w in USAGE))).toEqual([]);
  });

  it("登记表的次数与词表标记与现状逐条一致(改了文案就重新生成,见上方命令)", () => {
    expect(REGISTERED).toEqual(USAGE);
  });
});
