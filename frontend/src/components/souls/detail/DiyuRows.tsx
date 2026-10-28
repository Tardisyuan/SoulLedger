"use client";

import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { DIYU_STATIONS, diyuStationOrdinal, soulsApi, type Soul } from "@soulledger/core/api";
import { soulKeys } from "@soulledger/core/query_keys";
import { useI18n } from "@/src/contexts/I18nContext";
import { useToast } from "@/src/contexts/ToastContext";
import { DomainEnum } from "@/src/components/ui/DomainValue";
import { Button } from "@/src/components/ui/Button";
import { BaseModal } from "@/src/components/ui/Modal";
import { SelectField } from "@/src/components/ui/Field";
import { cn } from "@/lib/utils";

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
 */
export function DiyuStationStrip({ soul, canMove }: { soul: Soul; canMove: boolean }) {
  const { t } = useI18n();
  const [moving, setMoving] = useState(false);
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
  return (
    <section data-testid="soul-diyu-station" className="min-w-0 bg-[oklch(var(--color-surface-1))] px-6 py-4">
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <h2 className="text-2xs uppercase tracking-widest text-[oklch(var(--color-ink-subtle))]">
          {t("souls.diyu_station.label")}
        </h2>
        <span className="flex-1" />
        <span className="font-mono text-xs text-[oklch(var(--color-ink))]" data-testid="soul-diyu-station-now">
          {`${t("souls.diyu_station.ordinal", { n: String(at) })} · ${name(DIYU_STATIONS[at - 1])}`}
        </span>
        {canMove && (
          <Button size="sm" variant="secondary" data-testid="soul-diyu-station-move" onClick={() => setMoving(true)}>
            {t("souls.diyu_station.move")}
          </Button>
        )}
      </div>
      <ol className="mt-3 grid grid-cols-13 gap-1" aria-label={t("souls.diyu_station.label")}>
        {DIYU_STATIONS.map((s, i) => {
          const where = i + 1 < at ? "passed" : i + 1 === at ? "current" : "ahead";
          return (
            <li
              key={s}
              data-station={s}
              data-state={where}
              title={name(s)}
              aria-current={where === "current" ? "step" : undefined}
              className="flex min-w-0 flex-col items-center gap-1 text-center"
            >
              <span aria-hidden="true" className={cn("leading-none", where === "current" ? "text-lg font-semibold" : "text-sm text-[oklch(var(--color-ink-muted))]")}>
                {where === "passed" ? "■" : where === "current" ? "▪" : "□"}
              </span>
              <span
                title={name(s)}
                className={cn(
                  "w-full truncate text-2xs",
                  where === "current" ? "font-semibold text-[oklch(var(--color-ink))]" : "sr-only text-[oklch(var(--color-ink-muted))] xl:not-sr-only", // 窄屏只藏起来给眼睛,读屏照样念出每一站
                )}
              >
                {name(s)}
              </span>
            </li>
          );
        })}
      </ol>
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
      const code = (err as { response?: { data?: { code?: string } } })?.response?.data?.code;
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
