"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { DIYU_STATIONS, diyuStationOrdinal, eventsApi, soulsApi, type Soul } from "@soulledger/core/api";
import { soulKeys } from "@soulledger/core/query_keys";
import { useI18n } from "@/src/contexts/I18nContext";
import { useToast } from "@/src/contexts/ToastContext";
import { DomainEnum } from "@/src/components/ui/DomainValue";
import { Button } from "@/src/components/ui/Button";
import { BaseModal } from "@/src/components/ui/Modal";
import { SelectField } from "@/src/components/ui/Field";
import { cn } from "@/lib/utils";
import { responseCode } from "@soulledger/core/api/client";
import { SoulUnderworldMap } from "./SoulUnderworldMap";
import { stayFrom, stayText } from "@/src/lib/journeyModel";

const ROW = "border-t border-[oklch(var(--color-line))] py-3";
const DT = "text-2xs text-[oklch(var(--color-ink-subtle))]";
const DD = "mt-1 min-w-0 text-sm text-[oklch(var(--color-ink))] break-words";

type Station = (typeof DIYU_STATIONS)[number];

/** 出身部洲(docs/07 §人道)在身份栏里一行,只地府。十三站是页头下面的行程条(`DiyuStationStrip`)。 */
export function DiyuRows({ soul }: { soul: Soul }) {
  const { t } = useI18n();
  if (soul.civilization !== "CHINESE") return null;
  return (
    <div className={ROW} data-testid="soul-birth-continent">
      <dt className={DT}>{t("souls.birth_continent.label")}</dt>
      <dd className={DD}>
        {soul.birth_continent ? (
          <DomainEnum namespace="souls.birth_continent" value={soul.birth_continent} />
        ) : (
          t("souls.birth_continent.NONE")
        )}
      </dd>
    </div>
  );
}

/**
 * 十三站行程条(Design 第五十七批 S-1,docs/06 §一):13 站等宽,字形同上诉站梯 —— 已过 ■ · 当前 ▪ · 未到 □。
 * 宽屏(xl)13 个站名都写;更窄只写当前站名,其余留方块,悬浮看站名。右上「第 n / 13 站 · 站名」。
 * 不在路上(在世 / 已转世)不画条,只留一行灰字。`canMove`(持 `soul.transition`)时右上「挪站…」开弹层(S-1b)。
 * v4(第七批 S07):卡头是 `soulmap.title`,按钮是 `soulmap.move`,卡片是 `.v4-card`;列表的读屏名仍是「十三站」。
 * 行程条下面是地府那张图(`SoulUnderworldMap`,阶段 5):同一个序号,加十殿的子格与一生回放。
 *
 * 第二十五批 §五.2:十三张卡不再等宽 —— 已过折成约 30 宽的窄条(勾 + 站号)、现在那张展开约 168 宽
 * (1.5 metal 内描,「现在 · 第 N 站」+ 站名)、未到是虚线框(站号;xl 起写站名)。三种状态靠宽度 / 实底 / 虚线分开,
 * 不靠颜色;已过与未到另有 sr-only 状态字。现在那张写「到此 N 日」(满一年写年):到站时间是最近一条
 * `DIYU_STATION_CHANGED` 事件(每次挪站一条,与那一笔同一事务;path 里只有十殿,没有十三站),
 * 而且只认它的 `to` 就是现在这站 —— 不是就不写,不写 0。
 * 样式在 globals.css 末尾「十三站卡」一节。
 */
export type DiyuCardState = "passed" | "current" | "ahead";
/** When the soul reached `station`: the latest station event, and only if it moved the soul there. */
export function diyuArrival(events: readonly { payload?: Record<string, unknown> | null; create_time: string }[], station: string): string | null {
  const last = events[events.length - 1];
  return last && last.payload?.to === station ? last.create_time : null;
}
/** Station `i` (0-based) against the soul's 1-based ordinal `at`. */
export const diyuCardState = (i: number, at: number): DiyuCardState => (i + 1 < at ? "passed" : i + 1 === at ? "current" : "ahead");
export function DiyuStationStrip({ soul, canMove }: { soul: Soul; canMove: boolean }) {
  const { t } = useI18n();
  const [moving, setMoving] = useState(false);
  // 与 SoulUnderworldMap 同一个键:按时间正序的第一页(一世十三站,够用)。
  const moves = useQuery({
    queryKey: [...soulKeys.all, "station-events", soul.id],
    queryFn: () =>
      eventsApi.list({ soul: soul.id, event_type: "DIYU_STATION_CHANGED", ordering: "create_time" }).then((r) => r.data.results ?? []),
    enabled: soul.civilization === "CHINESE",
    staleTime: 60_000,
  });
  if (soul.civilization !== "CHINESE") return null;
  const at = diyuStationOrdinal(soul.diyu_station);
  if (at === null) {
    return (
      <p data-testid="soul-diyu-station" className="text-xs text-[oklch(var(--color-ink-subtle))]">
        {t("souls.diyu_station.not_on_road")}
      </p>
    );
  }
  const name = (s: Station) => t(`souls.diyu_station.${s}`);
  const stay = stayFrom(Array.isArray(moves.data) ? diyuArrival(moves.data, DIYU_STATIONS[at - 1]) : null);
  return (
    <section
      data-testid="soul-diyu-station"
      className="v4-card min-w-0 rounded-panel border border-[oklch(var(--color-line))] bg-[oklch(var(--color-surface-1))] px-6 py-4"
    >
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        {/* v4 S07 卡头「{soul} 走到了哪一步」(`soulmap.title`);十三格行程条下面是地图。 */}
        <h2 data-testid="soul-diyu-station-title" className="font-title text-lg text-[oklch(var(--color-ink))]">
          {t("soulmap.title", { soul: soul.name })}
        </h2>
        <span className="flex-1" />
        <span className="font-mono text-xs text-[oklch(var(--color-ink))]" data-testid="soul-diyu-station-now">
          {`${t("souls.diyu_station.ordinal", { n: String(at) })} · ${name(DIYU_STATIONS[at - 1])}`}
        </span>
        {canMove && (
          <Button size="sm" variant="secondary" data-testid="soul-diyu-station-move" onClick={() => setMoving(true)}>
            {t("soulmap.move")}
          </Button>
        )}
      </div>
      <ol className="mt-3 flex gap-1" aria-label={t("souls.diyu_station.label")}>
        {DIYU_STATIONS.map((s, i) => {
          const where = diyuCardState(i, at);
          const n = String(i + 1);
          return (
            <li
              key={s}
              data-station={s}
              data-state={where}
              title={name(s)}
              aria-current={where === "current" ? "step" : undefined}
              className={cn("diyu-card", `diyu-card--${where}`)}
            >
              {where === "current" ? (
                <>
                  <span className="diyu-card-now text-2xs font-semibold">{t("souls.diyu_station.now_card", { n })}</span>
                  <span title={name(s)} className="w-full truncate font-title text-md font-semibold text-[oklch(var(--color-ink))]">{name(s)}</span>
                  {stay && (
                    <span data-testid="diyu-card-stay" className="text-2xs text-[oklch(var(--color-ink-subtle))]">
                      {stayText(t, stay)}
                    </span>
                  )}
                </>
              ) : (
                <>
                  {where === "passed" && <span aria-hidden="true" className="text-sm leading-none">✓</span>}
                  <span aria-hidden="true" className="font-mono text-2xs">{n}</span>
                  <span className="sr-only">{t(`souls.diyu_station.state_${where}`)}</span>
                  <span
                    title={name(s)}
                    className={cn(
                      "truncate text-2xs",
                      // 已过的窄条永远只给读屏;未到的 xl 起写出来。w-full 只给看得见的站名(和 sr-only 同写会压过它的 1px 宽)
                      where === "ahead" ? "sr-only xl:not-sr-only xl:w-full" : "sr-only",
                    )}
                  >
                    {name(s)}
                  </span>
                </>
              )}
            </li>
          );
        })}
      </ol>
      <SoulUnderworldMap soul={soul} className="mt-4" />
      {moving && <MoveStationDialog soul={soul} at={at} onClose={() => setMoving(false)} />}
    </section>
  );
}

/** 挪站弹层(S-1b):一个下拉列 13 站(当前站标「· 现在」不可选),一句后果。 */
function MoveStationDialog({ soul, at, onClose }: { soul: Soul; at: number; onClose: () => void }) {
  const { t } = useI18n();
  const { showToast } = useToast();
  const queryClient = useQueryClient();
  const [target, setTarget] = useState<Station>(DIYU_STATIONS[Math.min(at, DIYU_STATIONS.length - 1)]);
  const current = DIYU_STATIONS[at - 1];
  const move = useMutation({
    mutationFn: (station: Station) => soulsApi.moveStation(soul.id, station),
    onSuccess: (_, station) => {
      void queryClient.invalidateQueries({ queryKey: soulKeys.all });
      showToast(t("souls.diyu_station.moved", { station: t(`souls.diyu_station.${station}`) }), "success");
      onClose();
    },
    onError: (err: unknown) => {
      const code = responseCode(err);
      showToast(code === "not_diyu" || code === "alive" ? t(`souls.diyu_station.error.${code}`) : t("common.error"),
        "error");
    },
  });
  return (
    <BaseModal
      isOpen
      onClose={onClose}
      title={t("souls.diyu_station.move_title", { name: soul.name })}
      footer={
        <>
          <Button type="button" variant="ghost" onClick={onClose} disabled={move.isPending}>
            {t("common.cancel")}
          </Button>
          <Button
            type="button"
            variant="primary"
            data-testid="soul-diyu-station-move-confirm"
            loading={move.isPending}
            disabled={target === current}
            onClick={() => move.mutate(target)}
          >
            {t("souls.diyu_station.move_confirm")}
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        <p className="text-sm text-[oklch(var(--color-ink-muted))]">
          {t("souls.diyu_station.move_current", { n: String(at), station: t(`souls.diyu_station.${current}`) })}
        </p>
        <SelectField
          id="soul-diyu-station-target"
          label={t("souls.diyu_station.move_to")}
          value={target}
          onChange={(e) => setTarget(e.target.value as Station)}
          disabled={move.isPending}
          options={DIYU_STATIONS.map((s, i) => ({
            value: s,
            label: `${t("souls.diyu_station.ordinal", { n: String(i + 1) })} · ${t(`souls.diyu_station.${s}`)}${
              s === current ? ` · ${t("souls.diyu_station.here_mark")}` : ""}`,
            disabled: s === current,
          }))}
        />
        <p className="text-xs text-[oklch(var(--color-ink-muted))]">{t("souls.diyu_station.move_body")}</p>
      </div>
    </BaseModal>
  );
}
