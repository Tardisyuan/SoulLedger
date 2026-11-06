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
 * 一生回放的到达日期:
 *   - 地府:十三站各站的到达 = `DIYU_STATION_CHANGED` 事件(payload.to,`apps/souls/stations.py`)的时间;
 *     十殿各殿 = path 的 `entered_at`。两者按时间合在一起。事件只取第一页(按时间正序)—— 一个灵魂一世十三站,够用。
 *   - 其余:path 每一站的 `entered_at`。
 *   在路上之前的「死亡」「三判官」这类节点没有记录,回放里不单独停,随下游的站一起点亮。
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

  const fromPath: MapArrival[] = entries
    .filter((p) => p.realm_code && (!diyu || p.realm_code.startsWith("DY_COURT_")))
    .map((p) => ({ id: p.realm_code!, at: p.entered_at }));
  const fromMoves: MapArrival[] = diyu
    ? (moves.data ?? []).flatMap((e) => {
        const to = e.payload?.to;
        return typeof to === "string" && (DIYU_STATIONS as readonly string[]).includes(to) ? [{ id: to, at: e.create_time }] : [];
      })
    : [];
  const arrivals = [...fromMoves, ...fromPath].sort((a, b) => a.at.localeCompare(b.at));

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
