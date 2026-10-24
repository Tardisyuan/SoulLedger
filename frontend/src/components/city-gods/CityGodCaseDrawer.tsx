"use client";

import { MissingValue } from "@/src/components/ui/DomainValue";
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { cityGodCasesApi, cityGodKeys, type CityGod, type CityGodCase } from "@soulledger/core/api";
import { useI18n } from "@/src/contexts/I18nContext";
import { Drawer } from "@/src/components/ui/Drawer";
import { Button } from "@/src/components/ui/Button";
import { TextAreaField } from "@/src/components/ui/Field";
import { StatusBadge } from "@/src/components/ui/StatusBadge";
import { showToast } from "@/src/components/ui/Toast";
import { CITY_GOD_STATUS_TONES, MatchedOrigin, cityGodCaseRefusalCode, cityGodCaseRefusalMessage } from "./cityGodDisplay";

/*
 * 初审的案子抽屉(第五十三批 Q-1 / Q-2):没有单独的初审页,点一行右侧打开,队列不动。
 * 动作在底部:待初审 = 解送十殿(主)+ 退回补正(描边);退回补正 = 只剩解送(后端不许再退)。
 * 点了在原处展开批语框和确认,不叠弹层;解送批语选填,退回批语必填。改交只给持 `judgment.assign` 的,
 * 收在下拉里,选了直接提交。`can_act=false` 时三个按钮都置灰,上方一句「你不在这位城隍名下」。
 * `not_pending`(别人刚处理过)时刷新抽屉、toast 那一句,不关抽屉。
 */

interface Props {
  caseId: string;
  gods: readonly CityGod[];
  canTransfer: boolean;
  onClose: () => void;
}

const ROW = "grid grid-cols-[6rem_1fr] gap-3 py-2 text-sm";
const KEY = "text-[oklch(var(--color-ink-muted))]";

export function CityGodCaseDrawer({ caseId, gods, canTransfer, onClose }: Props) {
  const { t, formatDateTime } = useI18n();
  const qc = useQueryClient();
  const [mode, setMode] = useState<"send" | "return" | null>(null);
  const [note, setNote] = useState("");
  const [noteMissing, setNoteMissing] = useState(false);
  const detail = useQuery({ queryKey: cityGodKeys.case(caseId), queryFn: () => cityGodCasesApi.get(caseId).then((r) => r.data) });
  const c = detail.data;

  const done = (message: string, close = false) => {
    void qc.invalidateQueries({ queryKey: cityGodKeys.all });
    showToast(message, "success");
    setMode(null);
    setNote("");
    if (close) onClose();
  };
  const refused = (err: unknown) => {
    if (cityGodCaseRefusalCode(err) === "not_pending") void detail.refetch();
    showToast(cityGodCaseRefusalMessage(err, t), "error");
  };
  const act = useMutation({
    mutationFn: (run: () => Promise<{ data: CityGodCase }>) => run().then((r) => r.data),
    onError: refused,
  });

  const confirm = () => {
    if (mode === "return" && !note.trim()) {
      setNoteMissing(true);
      return;
    }
    if (mode === "send") act.mutate(() => cityGodCasesApi.sendOn(caseId, note.trim()), { onSuccess: () => done(t("cityGodCases.sent_on_toast"), true) });
    if (mode === "return") act.mutate(() => cityGodCasesApi.returnCase(caseId, note.trim()), { onSuccess: () => done(t("cityGodCases.returned_toast")) });
  };
  const transfer = (target: string) => {
    const name = gods.find((g) => g.id === target)?.name ?? "";
    act.mutate(() => cityGodCasesApi.transfer(caseId, target), { onSuccess: () => done(t("cityGodCases.transferred_toast", { city_god: name })) });
  };

  const open = c ? c.city_god_status !== "SENT_ON" : false;
  const locked = !c?.can_act || act.isPending;
  const years = (a: number | null, b: number | null) => (a === null && b === null ? "—" : `${a ?? "?"} — ${b ?? "?"}`);

  return (
    <Drawer
      isOpen
      onClose={onClose}
      title={c ? `${c.case_number} · ${c.city_god_name}` : t("cityGodCases.title")}
      footer={
        c && open ? (
          <div className="space-y-2" data-testid="city-god-case-actions">
            {!c.can_act && <p className="text-sm text-[oklch(var(--color-ink-muted))]">{t("cityGodCases.cannot_act")}</p>}
            {mode ? (
              <div className="space-y-2">
                <TextAreaField
                  label={mode === "send" ? t("cityGodCases.send_on_note") : t("cityGodCases.return_note")}
                  value={note}
                  rows={3}
                  required={mode === "return"}
                  error={mode === "return" && noteMissing ? t("cityGodCases.return_note_required") : null}
                  onChange={(e) => {
                    setNote(e.target.value);
                    setNoteMissing(false);
                  }}
                />
                {mode === "return" && <p className="text-xs text-[oklch(var(--color-ink-muted))]">{t("cityGodCases.return_hint")}</p>}
                <div className="flex justify-end gap-2">
                  <Button type="button" variant="secondary" size="sm" onClick={() => setMode(null)}>{t("common.cancel")}</Button>
                  <Button type="button" variant="primary" size="sm" data-testid="city-god-case-confirm" loading={act.isPending} disabled={locked} onClick={confirm}>
                    {mode === "send" ? t("cityGodCases.send_on") : t("cityGodCases.return")}
                  </Button>
                </div>
              </div>
            ) : (
              <div className="flex flex-wrap items-center gap-2">
                <Button type="button" variant="primary" size="sm" data-testid="city-god-send-on" disabled={locked} onClick={() => setMode("send")}>
                  {t("cityGodCases.send_on")}
                </Button>
                {c.city_god_status === "PENDING" && (
                  <Button type="button" variant="secondary" size="sm" data-testid="city-god-return" disabled={locked} onClick={() => setMode("return")}>
                    {t("cityGodCases.return")}
                  </Button>
                )}
                {canTransfer && (
                  <select
                    aria-label={t("cityGodCases.transfer_pick")}
                    data-testid="city-god-transfer"
                    value=""
                    disabled={act.isPending}
                    onChange={(e) => e.target.value && transfer(e.target.value)}
                    className="ml-auto border border-[oklch(var(--color-line))] bg-transparent px-2 py-1 text-sm"
                  >
                    <option value="">{t("cityGodCases.transfer")} ▾</option>
                    {gods.filter((g) => g.id !== c.city_god).map((g) => (
                      <option key={g.id} value={g.id}>{g.name}</option>
                    ))}
                  </select>
                )}
              </div>
            )}
          </div>
        ) : undefined
      }
    >
      {c && (
        <div className="space-y-4 p-4">
          <div className="flex items-center gap-2">
            <p className="font-title text-xl text-[oklch(var(--color-ink))]">{c.soul_name}</p>
            <StatusBadge namespace="cityGodCases.status" value={c.city_god_status} tone={CITY_GOD_STATUS_TONES[c.city_god_status]} />
          </div>
          <div className="border-t border-[oklch(var(--color-rule))]">
            <div className={ROW}>
              <span className={KEY}>{t("cityGodCases.origin_location")}</span>
              <span><MatchedOrigin location={c.origin_location} region={c.matched_region} /></span>
            </div>
            <div className={ROW}>
              <span className={KEY}>{t("cityGodCases.life")}</span>
              <span className="font-mono tabular-nums">{years(c.soul_birth_year, c.soul_death_year)}</span>
            </div>
            <div className={ROW}>
              <span className={KEY}>{t("souls.fated_death_date")}</span>
              <span className="font-mono tabular-nums">{c.soul_fated_death_year ?? <MissingValue kind="unrecorded" />}</span>
            </div>
            <div className={ROW}>
              <span className={KEY}>{t("cityGodCases.registered_via")}</span>
              <span>
                {t(c.registered_via === "DEATH_SYNC" ? "cityGodCases.source.death_sync" : "cityGodCases.source.manual")} · {formatDateTime(c.created_at)}
              </span>
            </div>
          </div>
          {c.city_god_status === "RETURNED" && (
            <div data-testid="city-god-returned" className="space-y-1 bg-[oklch(var(--color-surface-2))] p-3 text-sm">
              <p className="text-[oklch(var(--color-ink-muted))]">
                {t("cityGodCases.returned_line", { city_god: c.city_god_name, date: c.returned_at ? formatDateTime(c.returned_at) : "" })}
              </p>
              {c.city_god_note && <p className="text-[oklch(var(--color-ink))]">{c.city_god_note}</p>}
            </div>
          )}
          {c.city_god_status === "SENT_ON" && c.sent_on_at && (
            <p className="text-sm text-[oklch(var(--color-ink-muted))]">
              {t("cityGodCases.sent_on_line", { city_god: c.city_god_name, date: formatDateTime(c.sent_on_at) })}
              {c.city_god_note && <span className="block pl-4 text-[oklch(var(--color-ink))]">{c.city_god_note}</span>}
            </p>
          )}
        </div>
      )}
    </Drawer>
  );
}
