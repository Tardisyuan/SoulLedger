/**
 * egy 语言包守着「egy 词表与命名规则」里能机械判定的那几条。
 *
 * 词表(Claude Design 定稿)的总原则是「同一概念,永远同一写法」。它统一了七处冲突
 * (否定一律 Nen、驳回 Khesef / 取消 Sehen、审批中与审判中同为 Em Wedja、Send→Hab、
 * Ma'a→Wehem Maa、密码一律 Sekhem……),并给了 462 行逐字修订表;后来追加的「审核域」一节
 * 又给了 social_moderation 71 行与 18 个审核域词根(删除一律 Fekh,Sekhem Ma 废止);再后来的
 * 「笔误 · 一词多写 · 英文残留」一节给了 39 行与 24 个词根。那 39 行里有 5 个键各出现两次
 * (每行判一处毛病),两行的修订后 egy 逐字相同 —— 是同一条修订结果,所以夹具里一键一条:
 * 34 个键,其中 2 个前几节已有同值,净增 32。第四节「一词一义收口 · Sekhem / Was / Mekher / Dbh」
 * 给了 113 行与 14 个词根:113 行里 menu_buttons.permission_mismatch_warning 出现两次且同值,
 * 所以是 112 个键;其中 19 个前几节已有(12 条「沿用」同值,7 条按转生政策改写),净增 93。
 * 第五节「设置 / 加载 / Sethety 收口」给了 35 行与 5 个词根(ROOTS_CLOSE):其中 5 个键前几节已有,净增 30。
 * 第六节「Sethet / Seshem / Pert 收口」(末轮)给了 74 行与 12 个词根(ROOTS_FINAL):其中 1 个键前几节已有
 * (soul_accounts.reveal.failed,回填为 Nen Maa),净增 73。
 * 第七节「「失败」写法与零星收口」给了 30 行与 4 个词根(ROOTS_LATE):其中 12 个键前几节已有(Nen Kheper 叠用去除),
 * 净增 18。
 * 定稿同时把后定的值**回填**到早先各节的行里,所以全表十节 824 行、779 个键,每个键全表只有一个值。
 *
 * 夹具 support/egyLexiconRevisions.json 以定稿全表为准生成,不手抄:取画布导出的 lexicon.json,
 * 按 SECTIONS 十节的行序遍历 [键, 中文, 修订后 egy, 理由],每键取首次出现的位置、写修订后 egy
 * (生成时断言同键各行值相同),`JSON.stringify(table, null, 2)` 落盘。改定稿就整份重生成。这里钉住:
 *
 * - 修订表 779 个键与包里逐字一致(键 → 修订后 egy);
 * - 无撇号、无全大写词(技术词白名单除外)、无已知英文残留;
 * - 已废止写法不再出现;
 * - 加载一律 Ini(同键中文含「加载 / 载入」);
 * - Sethet 只表技术错误、Seshem 只表推进、Pert 只在调度键里出现(第六节);
 * - 失败一律 Nen + 具体动词,Nen Kheper 只留白名单两键(第七节);
 * - Dbh 政策:推送 / 申请类页面副题 / 点名键写全 Dbh Wehem Mesut,点名的页内键只写 Dbh(第四节);
 * - 每条的 {{占位符}} 集合与 zh-Hans 同键一致;
 * - 每词首字母大写(含小词;连字符复合词的每一段,如 Djes-Ef);
 * - 封闭词汇:每个词都在「词根 ∪ 小词 ∪ 登记表」里,登记表不含已不用的词。
 *
 * 不守什么,说清楚:
 * - 登记表只管「这个词形有没有被显式登记」,不管它是否合乎词表 —— 词根 39 + 18 + 24 + 14 + 5 + 12 + 4、小词 18 个,
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
const ENGLISH_RESIDUE = ["Send", "Dismiss", "Egyptian", "Hall", "Purgatorium", "SevenArrwt", "TwentyOneSebkhet"];

/**
 * Sekhem 只表密码(第四节:它曾担设置 / 权限 / 按钮 / 选择 / 加载 / 开关 / 切换 / 状态 / 搜索九义,全部拆净)。
 * 判据是同键中文含「密码」。下面这些是密码义、但中文没写出「密码」二字(重置、改密、待交付的都是密码)——
 * 第四节把它们标为「沿用」。新增一条之前先确认它真是密码义。
 */
const SEKHEM_PASSWORD_WITHOUT_THE_WORD = new Set([
  "soul_accounts.credentials.reason.voided",
  "soul_accounts.credentials.actions.go_reset",
  "soul_accounts.account.pending_link",
  "soul_app.change_password.hours_left_consequence",
  "soul_app.change_password.under_hour_consequence",
  "soul_app.change_password.expired_consequence",
]);
const hasSekhem = (v: string) => /\bSekhem\b/.test(prose(v));

/**
 * 仍含单词 Ma 的键 —— 这些 Ma 不是否定(「有误」「移至」等早期写法),按同键中文判过义。
 * 否定一律 Nen:任何不在这里的 Ma 都是漏改的否定。
 * 第六节把「Ma Sethet」四处改写(Culpa (Isfet)、Khet Hru、Ankh Nen Maat、Maa Khet Wa),它们随之移出;
 * 第七节把 souls.date_problem_marker.error 改成 Khet Hru,它也移出。
 */
const MA_NOT_NEGATION = new Set([
  "souls.categories.COWARDICE",
  "souls.detail.delete_to_recycle_bin",
  "menus.delete_confirm_title",
  "menus.delete_confirm_action",
  "permissions.matrix.only_differences",
  "permissions.matrix.confirm_removed_label",
  "workflow.detail.escalate_reason_placeholder",
]);

/**
 * 第六节:「Pert Abuf」整个废止(它是密码的旧写法,误贴到了调度上;调度统一 Hab-Ba)。Pert 本义「出」,
 * 「杜阿特入口」写成 Duat Pert 是把入口写成了出口(→ Duat Aq)。Pert 若再出现,只许在调度键里。
 */
/**
 * 第七节:失败一律 Nen + 具体动词(登录 Nen Aq、更新 Nen Khemen、判决未通过 Nen Menkh、任务没跑成 Nen Iri……)。
 * Nen Kheper(「未成」)只留给确无具体动词可指的两处 —— 泛指的「失败」与「若持续失败」。
 * 不是失败义的也不用它:未结案 Nen Khetem、未了结 Nen Wetep。
 */
const NEN_KHEPER_ALLOWED = new Set(["souls.detail.failed", "judgment.queue.error_body"]);
const hasNenKheper = (v: string) => /\bNen Kheper\b/.test(prose(v));

/**
 * 第四节「Dbh 政策」(转生申请):上下文已明确时只写 Dbh,脱离上下文一律 Dbh Wehem Mesut。
 * - 脱离上下文:soul_push.* 整个命名空间(锁屏上没有页面)、页面副题(中文含「申请」的 subtitle 键)、
 *   下面 DBH_OUT_OF_CONTEXT 点名的键 —— 其中每一个 Dbh 都必须带 Wehem Mesut。
 * - 页内:DBH_IN_CONTEXT 点名的键(申请页内、本世页内的空态与错误)只写 Dbh,不许补全。
 * 页面副题要求中文含「申请」:受刑计划的「请求」也写 Dbh(Dbh Wetep),不在本政策内。
 * 后端副本 apps/soul_push/messages.py 与包逐字一致由后端测试钉住,所以这里守住包就守住了它。
 * 两份清单都反向查陈旧:点名的键不存在、或已不含 Dbh,即红。
 */
const DBH_OUT_OF_CONTEXT = new Set(["soul_app.errors.soul_state", "soul_app.errors.sentence_in_progress"]);
const DBH_IN_CONTEXT = new Set([
  "soul_app.applications.empty",
  "soul_app.applications.cannot_apply",
  "soul_app.life.no_applications",
  "soul_app.errors.cooldown",
  "soul_app.errors.appeal_used",
  "soul_app.errors.not_appealable",
]);
const hasDbh = (v: string) => /\bDbh\b/.test(prose(v));
/** 有一个 Dbh 后面没跟 Wehem Mesut。 */
const hasBareDbh = (v: string) => /\bDbh\b(?! Wehem Mesut\b)/.test(prose(v));
const isDbhOutOfContext = (k: string) =>
  k.startsWith("soul_push.") ||
  DBH_OUT_OF_CONTEXT.has(k) ||
  (/(^|[._])subtitle$/.test(k) && (ZH[k] ?? "").includes("申请"));

const isDispatchKey = (k: string) => /^dispatch\.|\.DISPATCH_|\.dispatch$/.test(k);

/**
 * 技术词原样引用(词表「技术词 cron / webhook / ms / 权限键名不转写」):每条只放行它自己的
 * 那几个记号 —— 权限键名、命令 / 方法名、时间单位、占位示例里的代码值、版本号、色值。
 * 放行按键不按词:`soul` 在示例里是分类代码,在别处就是该大写的词。
 * 修订表 779 个键里除这些技术词外**没有**大小写违例,所以不需要为修订表另设豁免。
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
  "menus.gate_visible_nonadmin": ["menu.manage"],
  "menus.gate_permission_nonadmin": ["menu.manage"],
  "menus.gate_roles_nonadmin": ["menu.manage"],
  "menus.gate_menu_type_nonadmin": ["menu.manage"],
  "menus.gates_footnote": ["menu.manage"],
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
 * 定稿词表:词根 39 个、审核域词根 18 个、笔误修订词根 24 个、一词一义词根 14 个、收口词根 5 个、末轮收口词根 12 个、
 * 第七节词根 4 个、语法小词 18 个,逐字照抄。
 * 「Duat / Pet」「Er Hry」按空格拆成词;连字符写法(Djes-Ef、Neb-Medu、Hemet-Sesh……)照抄为一个词形。
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
/** 笔误 · 一词多写 · 英文残留。Wesir(神名)与 Wser(强)是两个词,不可互改;Maakheru 不是 Mekher 的异写。 */
const ROOTS_FIX = [
  "Hemsu", "Remetj", "Sep", "Dbh", "Mekher", "Maakheru", "Aaru", "Wesir", "Wser", "Smen", "Wen", "Mut",
  "Ammit", "Weret", "Fai", "Sebkhet", "Hesmen", "Hep", "Djadjat", "Gesu", "Hemet-Sesh", "Medu-Sesu",
  "Wat-Ha", "Per-Hemsu",
];
/**
 * 一词一义收口(第四节,Sekhem 九义拆净)。Ini(加载)、Wen-Khetem(开关)、Arrwt(通路)、Wa-Ek(仅自己)为新词,
 * 其余是把已在用的词正式定为该义。「私密」第四节行里写作两词 Wa Ek,第五节确认为连字符合成词 Wa-Ek(同 Djes-Ef)。
 */
const ROOTS_SPLIT = [
  "Smen", "Was", "Aha", "Setep", "Ini", "Wen-Khetem", "Khemen", "Ta", "Wat", "Arrwt",
  "Netjer", "Mesqet", "Sesen", "Wa-Ek",
];
/** 设置 / 加载 / Sethety 收口(第五节)。Pet-Sesh(模板,定式之书)为新词;其余四个是把已定的词派给 Sethety 的旧义项。 */
const ROOTS_CLOSE = ["Pet-Sesh", "Setep", "Renu", "Nefer", "Isfet"];
/**
 * Sethet / Seshem / Pert 收口(第六节,末轮)。Khedu(活动)、Sepdet(时戳)、Djedu(条文)、Bek(导出,与 Ini 成对)、
 * Tut-Hesb(图表)为新词;其余是把已在用的词派给 Sethet / Seshem 散出去的义项。Seshem 收口后唯一义是推进。
 */
const ROOTS_FINAL = [
  "Iri", "Seshem", "Khedu", "Medew", "Sepdet", "Djedu", "Hetep", "Unemu", "Menkh", "Bek", "Wen", "Tut-Hesb",
];
/**
 * 「失败」写法与零星收口(第七节)。Hab-Ba(调拨 / 遣魂)此前全库 17 次却失登,这里补登;Kheper 只表「成为、发生」;
 * Khetem 结案与失败无关;Menmen(连续)为新词,与 Wehem(再一次)分开。
 */
const ROOTS_LATE = ["Hab-Ba", "Kheper", "Khetem", "Menmen"];
const PARTICLES = [
  "Em", "Nen", "Seth", "Tepy", "Pehwy", "Wehem", "Pen", "Ky", "Neb", "Wa",
  "Ek", "Er", "Hena", "Djer", "Emu", "Dy", "Djes-Ef", "Er Hry",
];
const LEXICON = new Set([...ROOTS, ...ROOTS_MOD, ...ROOTS_FIX, ...ROOTS_SPLIT, ...ROOTS_CLOSE, ...ROOTS_FINAL, ...ROOTS_LATE, ...PARTICLES].flatMap((e) => e.split(/ \/ | /)));

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

  it("修订表 779 个键与包里逐字一致", () => {
    const table = REVISIONS as Record<string, string>;
    expect(Object.keys(table)).toHaveLength(779);
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
    // 笔误一节:标「废止」的异写(Remetch、Sepr、Sep-U、词中大写的 AmMit)、词根表点名的笔误
    // (Djesef、Hemst、Maakher、Mekheru、Iaru、Semen、Wenu)、改用 Ahet 的 Metu、转生统一
    // Wehem Mesut 之后的旧写法 Wehem Ankh。
    // 第五节:Sethety(早期万能填充,不是词根;按义项分给 Pet-Sesh / Was / Setep / Smen / Nefer / Isfet / Renu)、
    // 保存 Pedet(→ Sau)、新 Werpet(→ Renpi)、加载 Khemut(→ Ini)。定稿表外的同形也按同键中文判义改掉了。
    // 第六节:Pert Abuf(密码旧写法,调度统一 Hab-Ba;定稿表外的 16 处调度键一并改了)。
    const abolished = [
      /Ma'a/, /Medu Sekhem/, /Em Sheemtet/, /Em Maa Seth/, /\bSend\b/, /\bSekhem Ma\b/,
      /\bRemetch\b/, /\bSepr\b/, /\bSep-U\b/, /\bAmMit\b/, /\bDjesef\b/, /\bHemst\b/, /\bMaakher\b/,
      /\bMekheru\b/, /\bIaru\b/, /\bSemen\b/, /\bWenu\b/, /\bMetu\b/, /\bWehem Ankh\b/,
      /\bSethety\b/, /\bPedet\b/, /\bWerpet\b/, /\bKhemut\b/, /\bPert Abuf\b/,
    ];
    expect(offenders(KEYS, (v) => abolished.some((re) => re.test(v)))).toEqual([]);
  });

  it("失败一律 Nen + 动词:Nen Kheper 只在白名单两键里出现", () => {
    expect(offenders(KEYS, (v, k) => hasNenKheper(v) && !NEN_KHEPER_ALLOWED.has(k))).toEqual([]);
    // 白名单里的键若已不存在或不再含 Nen Kheper,就该删掉 —— 留着会替将来的「未成」背书。
    const stale = [...NEN_KHEPER_ALLOWED].filter((k) => !hasNenKheper(EGY[k] ?? ""));
    expect(stale).toEqual([]);
  });

  it("Dbh 政策:脱离上下文的键每个 Dbh 都写全 Dbh Wehem Mesut", () => {
    expect(offenders(KEYS, (v, k) => isDbhOutOfContext(k) && hasBareDbh(v))).toEqual([]);
    // 推送里至少还有 Dbh(否则这条对 soul_push 什么都没守),点名的键必须存在且含 Dbh。
    expect(KEYS.filter((k) => k.startsWith("soul_push.") && hasDbh(EGY[k])).length).toBeGreaterThan(0);
    expect([...DBH_OUT_OF_CONTEXT].filter((k) => !hasDbh(EGY[k] ?? ""))).toEqual([]);
  });

  it("Dbh 政策:页内键只写 Dbh,不补全 Wehem Mesut", () => {
    expect(
      [...DBH_IN_CONTEXT].filter((k) => /\bDbh Wehem Mesut\b/.test(prose(EGY[k] ?? ""))).map((k) => `${k}: ${EGY[k]}`)
    ).toEqual([]);
    // 清单陈旧:键不存在或已不含 Dbh。
    expect([...DBH_IN_CONTEXT].filter((k) => !hasDbh(EGY[k] ?? ""))).toEqual([]);
    // 两份清单不许重叠。
    expect([...DBH_IN_CONTEXT].filter((k) => isDbhOutOfContext(k))).toEqual([]);
  });

  it("Pert 只在调度键里出现(入口是 Aq,不是 Pert)", () => {
    expect(offenders(KEYS, (v, k) => !isDispatchKey(k) && /\bPert\b/.test(prose(v)))).toEqual([]);
  });

  it("Sethet 只表技术错误:中文不含「错误 / 出错 / 故障 / 异常」的键不出现 Sethet", () => {
    // 第六节把它曾担的通过 / 活动 / 审计 / 证据 / 条文 / 时戳 / 顺序 / 资源……五十处散回各自的词,
    // settings 的冗余 Sethet 直接删。目前没有例外,所以不设白名单;真出现一个再加,并照 Sekhem 那条补陈旧检查。
    expect(offenders(KEYS, (v, k) => /\bSethet\b/.test(prose(v)) && !/错误|出错|故障|异常/.test(ZH[k] ?? ""))).toEqual([]);
  });

  it("Seshem 只表推进:中文不含「推进 / 越级 / 升级」的键不出现 Seshem", () => {
    // 第六节:创建 Iri、展开 Wen、开始 Tepy、图表 Tut-Hesb、系统层 Ta、开关 Wen-Khetem 都分出去了。
    // 「升级」是 workflow.status.ESCALATED 的中文(越级推进后的状态)。不设白名单,理由同上。
    expect(offenders(KEYS, (v, k) => /\bSeshem\b/.test(prose(v)) && !/推进|越级|升级/.test(ZH[k] ?? ""))).toEqual([]);
  });

  it("Sekhem 只表密码:中文不含「密码」的键不出现 Sekhem(白名单除外)", () => {
    expect(
      offenders(KEYS, (v, k) => hasSekhem(v) && !(ZH[k] ?? "").includes("密码") && !SEKHEM_PASSWORD_WITHOUT_THE_WORD.has(k))
    ).toEqual([]);
    // 白名单里的键若已不含 Sekhem,或中文已写出「密码」,就不再需要豁免 —— 留着会替将来的误用背书。
    const stale = [...SEKHEM_PASSWORD_WITHOUT_THE_WORD].filter(
      (k) => !hasSekhem(EGY[k] ?? "") || (ZH[k] ?? "").includes("密码")
    );
    expect(stale).toEqual([]);
  });

  it("否定一律 Nen:单词 Ma 只剩判过义的非否定用法", () => {
    expect(offenders(KEYS, (v, k) => !MA_NOT_NEGATION.has(k) && /\b[Mm]a\b/.test(prose(v)))).toEqual([]);
    // 白名单里的键若已不含 Ma,就该从白名单删掉,否则它会替将来的漏改背书。
    const stale = [...MA_NOT_NEGATION].filter((k) => !/\b[Mm]a\b/.test(prose(EGY[k] ?? "")));
    expect(stale).toEqual([]);
  });

  it("加载一律 Ini:中文含「加载 / 载入」的键必含 Ini", () => {
    // 第五节把 Khemut、Smen(其实是「定」)、Em Iri(泛指进行中)三种加载写法归一为 Ini。
    // 反过来不守:Ini 本义「取来」,「正在取下一条」「承自前世」这类中文不写加载的键也用它。
    // 目前没有例外,所以不设白名单;真出现一个再加,并照 Sekhem 那条补陈旧检查。
    expect(offenders(KEYS, (v, k) => /加载|载入/.test(ZH[k] ?? "") && !/\bIni\b/.test(prose(v)))).toEqual([]);
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
