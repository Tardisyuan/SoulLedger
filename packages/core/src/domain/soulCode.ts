/**
 * 灵魂编号(第二十批 Design 回复 §一.2、§二、§一.1):10 位,分组 3-4-3,二维码 `SL1:<10 位>`。
 *
 * 字符集与长度必须和 `backend/apps/soul_accounts/services.py` 的 `SOUL_CODE_ALPHABET` /
 * `SOUL_CODE_LENGTH` 一致 —— 守卫在 `frontend/src/__tests__/soulCodeMatchesBackend.test.ts`
 * (读那个文件;core 的 vitest 不读后端)。纯函数,不碰 DOM,Web 与 App 共用。
 */
export const SOUL_CODE_ALPHABET = "23456789ABCDEFGHJKMNPQRSTUVWXYZ";
export const SOUL_CODE_LENGTH = 10;
/** 3-4-3:每组不超过 4 位。 */
export const SOUL_CODE_GROUPS = [3, 4, 3] as const;
/** 字符集里刻意没有的五个,最容易和别的字符看混。 */
export const SOUL_CODE_CONFUSABLES = "01OIL";

export type SoulCodeProblem = "bad_char" | "bad_symbol" | "bad_paste";

export interface SoulCodeInputResult {
  /** 接受之后的编号(大写、无分隔、至多 10 位)。有问题时等于规整后的 prev。 */
  value: string;
  /** null = 没有问题。`bad_char`:0 O 1 I L 之一;`bad_symbol`:其他符号;`bad_paste`:一次进来多个字符且含无效字符。 */
  problem: null | { kind: SoulCodeProblem; char: string };
}

const SEPARATOR = /[\s\-－]/u; // \s 含全角空格 U+3000

const isValidChar = (c: string) => c.length === 1 && SOUL_CODE_ALPHABET.includes(c);

/** 把 `QU33Q9FW5F` 分成 3-4-3;不满 10 位按已有位数分(`QU33Q` → `["QU3","3Q"]`)。 */
export function groupSoulCode(code: string): string[] {
  const chars = Array.from(code);
  const groups: string[] = [];
  let at = 0;
  for (const size of SOUL_CODE_GROUPS) {
    if (at >= chars.length) break;
    groups.push(chars.slice(at, at + size).join(""));
    at += size;
  }
  return groups;
}

/** 显示串:组间一个空格(`QU3 3Q9F W5F`)。复制出去的是不带分隔的 10 位。 */
export const formatSoulCode = (code: string): string => groupSoulCode(code).join(" ");

/** 读屏:字符间空格、组间中文逗号(`Q U 3，3 Q 9 F，W 5 F`)。 */
export const spellSoulCode = (code: string): string =>
  groupSoulCode(code)
    .map((g) => Array.from(g).join(" "))
    .join("，");

/**
 * 输入规则:大写;跳过空格、`-`、全角空格、全角 `－`;字符集以外的字符不放进去并说明是哪一个;至多 10 位。
 * 一次进来多个字符(粘贴)时,只要有一个无效字符就整段不收(`bad_paste`)。超过 10 位的多余部分直接截掉。
 */
export function acceptSoulCodeInput(prev: string, typed: string): SoulCodeInputResult {
  const kept = Array.from(prev)
    .filter((c) => !SEPARATOR.test(c))
    .map((c) => c.toUpperCase())
    .filter(isValidChar)
    .slice(0, SOUL_CODE_LENGTH)
    .join("");
  const incoming = Array.from(typed)
    .filter((c) => !SEPARATOR.test(c))
    .map((c) => c.toUpperCase());
  const bad = incoming.find((c) => !isValidChar(c));
  if (bad !== undefined) {
    if (incoming.length > 1) return { value: kept, problem: { kind: "bad_paste", char: bad } };
    return { value: kept, problem: { kind: SOUL_CODE_CONFUSABLES.includes(bad) ? "bad_char" : "bad_symbol", char: bad } };
  }
  return { value: (kept + incoming.join("")).slice(0, SOUL_CODE_LENGTH), problem: null };
}

const QR_RE = new RegExp(`^SL1:([${SOUL_CODE_ALPHABET}]{${SOUL_CODE_LENGTH}})$`);

/** 二维码内容 `SL1:<10 位>`;不是我们的码(前缀错、小写、位数不对、多余字符)一律 null。 */
export const parseSoulCodeQr = (text: string): string | null => QR_RE.exec(text)?.[1] ?? null;

export const soulCodeQrPayload = (code: string): string => `SL1:${code}`;
