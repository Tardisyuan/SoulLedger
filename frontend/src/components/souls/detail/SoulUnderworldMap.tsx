"use client";

import { useQuery } from "@tanstack/react-query";
import { DIYU_STATIONS, eventsApi, soulsApi, type Soul, type SoulPathEntry } from "@soulledger/core/api";
import { soulKeys } from "@soulledger/core/query_keys";
import { useI18n } from "@/src/contexts/I18nContext";
import { UnderworldMap, type MapArrival } from "@/src/components/realms/UnderworldMap";
import { diyuVisits, greekVisits, pathVisits } from "@/src/lib/underworldMap";

/**
 * 灵魂详情「走到了哪一步」的地图:这个灵魂的行程画在它文明的那张图上。
 *
 * 当前站:地府读 `diyu_station`(与十三站行程条同一个序号),十殿的子格读 path 的殿;
 * 其余三个文明读 path(`GET /souls/{id}/path/`)的界域码 —— 处置与受刑计划都是写进 path 才动灵魂的。
 *
 * 一生回放的站序是这个灵魂走过的路,不是「有日期的那几站」:
 *   - 地府:行程(`diyuVisits`)走过的站,十殿各殿接在酆都城之后。到达日期:站 = `DIYU_STATION_CHANGED` 事件
 *     (payload.to,`apps/souls/stations.py`)的时间,殿 = path 的 `entered_at`;没有记录的站照样停,卡片只写站名。
 *     此前只停有日期的那几站,而直接落在某站的灵魂(种子数据、演示里的屈原)一条挪站事件都没有:回放只剩一站殿,
 *     一点按钮十三站全暗、1.2 秒后弹回现在 —— 看起来就是「没有动画」(2026-11-07)。顺序也曾按日期字符串排,
 *     公元前的扩展年份(`-000278-…`)按字面排是反的。事件只取第一页(按时间正序)—— 一世十三站,够用。
 *   - 其余:path 按 `sequence`,日期是 `entered_at`。
 *   在路上之前的「死亡」「三判官」这类无码节点不单独停,随下游的站一起点亮。
 *
 * 希腊:可医者此刻在塔尔塔罗斯时点亮千年格,写「第 n 年」(用户 2026-11-07)。年数是账本 SENTENCE 读数的
 * `elapsed_years`(`Disposition.term_start_*` 量到今天,与官员看的读数同一个数);`eternal`(不可医、永罚)不点亮。
 */
export function SoulUnderworldMap({ soul, eternal = false, className }: { soul: Soul; eternal?: boolean; className?: string }) {
  const { t } = useI18n();
  const diyu = soul.civilization === "CHINESE";
  const greek = soul.civilization === "GREEK";
  // 图要 fetch 与 DOMParser 才画得出来(jsdom 没有 fetch):画不出来就不为它取数据。
  const canDraw = typeof fetch === "function" && typeof DOMParser !== "undefined";
  const path = useQuery({
    queryKey: soulKeys.path(soul.id),
    queryFn: () => soulsApi.path(soul.id).then((r) => r.data),
    enabled: canDraw,
  });
  const moves = useQuery({
    queryKey: [...soulKeys.all, "station-events", soul.id],
    queryFn: () =>
      eventsApi.list({ soul: soul.id, event_type: "DIYU_STATION_CHANGED", ordering: "create_time" }).then((r) => r.data.results ?? []),
    enabled: canDraw && diyu,
    staleTime: 60_000,
  });
  // 与 `useSoulLedger` 同一个键:详情页已经取过就直接用缓存。
  const ledger = useQuery({
    queryKey: soulKeys.ledger(soul.id),
    queryFn: async () => (await soulsApi.karma(soul.id)).data,
    enabled: canDraw && greek && !eternal,
    staleTime: 30_000,
  });
  if (!path.data || !Array.isArray(path.data)) return null;
  const entries: SoulPathEntry[] = [...path.data].sort((a, b) => a.sequence - b.sequence);

  const reading = ledger.data?.reading;
  const years = greek && !eternal && reading?.kind === "SENTENCE" ? reading.elapsed_years : null;
  const visits = diyu
    ? diyuVisits(DIYU_STATIONS, soul.diyu_station, entries)
    : greek
      ? greekVisits(entries, years)
      : pathVisits(entries);
  if (!visits.length) return null;

  const fromPath: MapArrival[] = entries.filter((p) => p.realm_code).map((p) => ({ id: p.realm_code!, at: p.entered_at }));
  let arrivals = fromPath;
  if (diyu) {
    const dated = new Map<string, string>(fromPath.map((a) => [a.id, a.at!]));
    for (const e of moves.data ?? []) {
      const to = e.payload?.to;
      if (typeof to === "string" && !dated.has(to)) dated.set(to, e.create_time);
    }
    const walk = visits.map((v) => v.id);
    const courts = walk.filter((id) => id.startsWith("DY_COURT_"));
    const road = walk.filter((id) => !id.startsWith("DY_COURT_"));
    const fengdu = road.indexOf("FENGDU_CITY");
    road.splice(fengdu < 0 ? road.length : fengdu + 1, 0, ...courts);
    arrivals = road.map((id) => ({ id, at: dated.get(id) ?? null }));
  }

  const inMillennium = visits.some((v) => v.current && v.id.startsWith("gr-millennium-"));
  const currentDetail = inMillennium && years !== null ? t("map.greece.year_n", { n: String(years) }) : null;

  return (
    <UnderworldMap
      civilization={soul.civilization}
      visits={visits}
      arrivals={arrivals}
      label={t(`souls.civilizations.${soul.civilization}`)}
      currentDetail={currentDetail}
      className={className}
    />
  );
}
