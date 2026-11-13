import { courtLabel } from "@soulledger/core/domain/courts";
import { DIYU_STATIONS, diyuStationOrdinal } from "@soulledger/core/domain/diyuStations";
import type { SpineNow } from "./spineModel";

type T = (key: string, params?: Record<string, string>) => string;

/**
 * 卷宗头人名下面那一行的「在哪」(Design 第三十批 第 3 步样张「第 10 站 · 酆都城 · 第一殿」):站 · 界域 · 殿。
 * 与脊读同一份 `spineNow`,所以字和脊上的 metal 点说的是同一处。地府:十三站的序号与站名,再接殿;
 * 欧洲:米诺斯门前 / 第 N 圈;埃及、希腊:脊上那一站的名字。殿名(`court`)按界面语言接在最后,与前一段相同就不重复。
 * 什么都认不出就是空数组 —— 不写「未知」。
 */
export function dossierWhere(
  t: T,
  now: SpineNow | null,
  { diyuStation, court, locale }: { diyuStation?: string | null; court?: string | null; locale: string },
): string[] {
  const parts: string[] = [];
  if (now?.civ === "cn") {
    const at = diyuStationOrdinal(diyuStation);
    if (at !== null) parts.push(t("caseDesk.dossier.where.station", { n: String(at) }), t(`souls.diyu_station.${DIYU_STATIONS[at - 1]}`));
  } else if (now?.civ === "eu") {
    parts.push(now.at === "circle" ? t("caseDesk.dossier.where.circle", { n: String(now.n) }) : t("caseDesk.dossier.spine.eu.minos"));
  } else if (now?.civ === "eg" && now.at !== "scale") {
    parts.push(t(`caseDesk.dossier.spine.eg.${now.at}`));
  } else if (now?.civ === "gr" && now.at !== "fork") {
    parts.push(t(`caseDesk.dossier.spine.gr.${now.at}`));
  }
  const hall = courtLabel(t, court, locale);
  if (hall && !parts.includes(hall)) parts.push(hall);
  return parts;
}
