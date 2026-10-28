"use client";

import { useId, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { DIYU_STATIONS, diyuStationOrdinal, soulsApi, type Soul } from "@soulledger/core/api";
import { soulKeys } from "@soulledger/core/query_keys";
import { useI18n } from "@/src/contexts/I18nContext";
import { useToast } from "@/src/contexts/ToastContext";
import { DomainEnum } from "@/src/components/ui/DomainValue";
import { Button } from "@/src/components/ui/Button";
import { SelectField } from "@/src/components/ui/Field";

const ROW = "border-t border-[oklch(var(--color-line))] py-3";
const DT = "text-2xs text-[oklch(var(--color-ink-subtle))]";
const DD = "mt-1 min-w-0 text-sm text-[oklch(var(--color-ink))] break-words";

type Station = (typeof DIYU_STATIONS)[number];

/**
 * 地府的两行(2026-10-28,只地府):十三站(docs/06 §一)与出身部洲(docs/07 §人道)。
 * 十三站只对不在世的灵魂画;`canMove`(持 `soul.transition`)时多一个「挪站」。
 * ponytail: 临时样式 —— 一行文字 + 原生下拉,等 Design 画十三站的行程条(见交接报告)。
 */
export function DiyuRows({ soul, canMove }: { soul: Soul; canMove: boolean }) {
  const { t } = useI18n();
  if (soul.civilization !== "CHINESE") return null;
  return (
    <>
      {soul.current_state !== "ALIVE" && <StationRow soul={soul} canMove={canMove} />}
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
    </>
  );
}

function StationRow({ soul, canMove }: { soul: Soul; canMove: boolean }) {
  const { t } = useI18n();
  const { showToast } = useToast();
  const queryClient = useQueryClient();
  const selectId = useId();
  const [target, setTarget] = useState<Station>(DIYU_STATIONS[0]);
  const at = diyuStationOrdinal(soul.diyu_station);
  const move = useMutation({
    mutationFn: (station: Station) => soulsApi.moveStation(soul.id, station),
    onSuccess: (_, station) => {
      void queryClient.invalidateQueries({ queryKey: soulKeys.all });
      showToast(t("souls.diyu_station.moved", { station: t(`souls.diyu_station.${station}`) }), "success");
    },
    onError: (err: unknown) => {
      const code = (err as { response?: { data?: { code?: string } } })?.response?.data?.code;
      showToast(code === "not_diyu" || code === "alive" ? t(`souls.diyu_station.error.${code}`) : t("common.error"),
        "error");
    },
  });
  return (
    <div className={ROW} data-testid="soul-diyu-station">
      <dt className={DT}>{t("souls.diyu_station.label")}</dt>
      <dd className={DD}>
        {soul.diyu_station ? (
          <>
            <DomainEnum namespace="souls.diyu_station" value={soul.diyu_station} />
            {at !== null && (
              <span className="ml-2 font-mono text-xs text-[oklch(var(--color-ink-muted))]">
                {t("souls.diyu_station.ordinal", { n: String(at) })}
              </span>
            )}
          </>
        ) : (
          t("souls.diyu_station.NONE")
        )}
      </dd>
      {canMove && (
        <div className="mt-2 flex items-end gap-2" data-testid="soul-diyu-station-move">
          <SelectField
            id={selectId}
            label={t("souls.diyu_station.move_label")}
            size="sm"
            value={target}
            onChange={(e) => setTarget(e.target.value as Station)}
            disabled={move.isPending}
            options={DIYU_STATIONS.map((s, i) => ({ value: s, label: `${i + 1} · ${t(`souls.diyu_station.${s}`)}` }))}
          />
          <Button size="sm" disabled={move.isPending || target === soul.diyu_station} onClick={() => move.mutate(target)}>
            {t("souls.diyu_station.move")}
          </Button>
        </div>
      )}
    </div>
  );
}
