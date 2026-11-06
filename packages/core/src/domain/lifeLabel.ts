import { civShortCode } from "../config/civilizations";

type T = (key: string, params?: Record<string, string>) => string;

/** 欧洲、埃及不转生:这一世不写序号(v4 第十批第 4 条)。希腊转生而不走六道,「第 n 世」照用。 */
const NO_REBIRTH = new Set(["eu", "eg"]);

/**
 * 一个灵魂「这一世」的叫法。欧洲、埃及写「此生」;调拨来的灵魂(n > 1,在别处转过世)写
 * 「此生 · 此前另有 m 世」,m = n − 1,不写那几世在哪个冥界。地府、希腊返回 `null`:调用方照旧用它自己的
 * 「第 {{n}} 世」键(`souls.detail.life_number`、`soul_app.life.cycle` …)。
 *
 * 只用于这一世。前世(灵魂详情的「此前」、App 的前世列表)是别处的那几世,照写序号。
 * `civilization`:`EUROPEAN` 或租户代码 `EU_HEAVEN_HELL` 都认;`n` 从 1 数。
 */
export function thisLifeLabel(t: T, civilization: string | null | undefined, n: number): string | null {
  const civ = civShortCode(civilization);
  if (!civ || !NO_REBIRTH.has(civ)) return null;
  return n > 1 ? t("souls.life_label.this_life_prior", { m: String(n - 1) }) : t("souls.life_label.this_life");
}
