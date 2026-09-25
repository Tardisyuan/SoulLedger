import type { Statute } from "../api/judgment";
import { isCivilizationOption } from "./civilizations";
import { formatSigil, type StatuteRef } from "./civilizationSigil";

/**
 * 律条引用的**唯一**写法:〔文献 · 条号〕—— 与语料页「复制引用」同一个括号。
 *
 * 文献是这部语料的名字(`judgment.statute_corpus.<CORPUS>`,由调用方按语言解析后传进来,
 * 这一层不碰 i18n);条号是它自己文明的节号(`formatSigil`),没有节号时退回 `code`。
 * 登录页、灵魂收件箱的「/」、语料页三处写同一个括号;审判台的律条检索反过来把这个括号
 * (或裸节号、或 code)解回一条律条 —— 同一个 `squash`,所以复制出去的能粘回来。
 */

/** 比较用:去掉空白与间隔号、忽略大小写。「IX · XXVI」「ix·xxvi」「IX XXVI」是同一个节号。 */
export const squash = (s: string) => s.replace(/[\s·・]/g, "").toLowerCase();

/** The parts of `payload_json` a sigil is built from, each checked for its own type. */
export function statuteRef(statute: Pick<Statute, "ordinal" | "payload_json">): StatuteRef {
  const payload = statute.payload_json ?? {};
  return {
    ordinal: statute.ordinal,
    division: typeof payload.gate === "string" ? payload.gate : undefined,
    // `gate_ordinal`, not `ordinal`: see StatuteRef.gateOrdinal.
    gateOrdinal: typeof payload.gate_ordinal === "number" ? payload.gate_ordinal : undefined,
    circle: typeof payload.circle === "number" ? payload.circle : undefined,
    stephanus: typeof payload.stephanus === "string" ? payload.stephanus : undefined,
  };
}

/** An unknown civilization is a data condition: no sigil, not a crash. */
export function statuteSigil(statute: Pick<Statute, "civilization" | "ordinal" | "payload_json">): string | null {
  return isCivilizationOption(statute.civilization) ? formatSigil(statute.civilization, statuteRef(statute)) : null;
}

/** 〔文献 · 条号〕 */
export function formatCitation(corpusName: string, sigil: string): string {
  return `〔${corpusName} · ${sigil}〕`;
}

/** 一条律条的规范引用;没有节号时条号写 `code`。 */
export function citationOf(statute: Statute, corpusName: (corpus: string) => string): string {
  return formatCitation(corpusName(statute.corpus), statuteSigil(statute) ?? statute.code);
}

/**
 * 把粘进来的〔文献 · 条号〕、裸节号或 `code` 解回一条律条。解不出返回 undefined。
 * 裸节号在几部语料里可能重名 —— 取第一条,与语料页的直达同一规则;带文献名的括号不会重名。
 */
export function resolveCitation<S extends Statute>(
  statutes: readonly S[],
  input: string,
  corpusName: (corpus: string) => string
): S | undefined {
  const q = squash(input.replace(/[〔〕]/g, ""));
  if (!q) return undefined;
  return statutes.find((s) => {
    const sigil = statuteSigil(s);
    const keys = [s.code, ...(sigil ? [sigil, `${corpusName(s.corpus)}${sigil}`] : [`${corpusName(s.corpus)}${s.code}`])];
    return keys.some((k) => squash(k) === q);
  });
}
