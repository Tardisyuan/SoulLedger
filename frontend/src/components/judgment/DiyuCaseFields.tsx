"use client";

import { useId, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { judgmentApi, wangsiApi, WANGSI_ERROR_CODES, type Judgment } from "@soulledger/core/api";
import { dispositionKeys, judgmentKeys, soulKeys } from "@soulledger/core/query_keys";
import {
  GRIEVANCE_LEVELS,
  GRIEVANCE_RELEASE_LEVELS,
  OFFENCES_BY_COURT,
  WRONGFUL_DEATH_CAUSES,
  offenceCourt,
} from "@soulledger/core/domain/diyuCase";
import { isHeldUntilFatedDate } from "@soulledger/core/domain/dates";
import { useI18n } from "@/src/contexts/I18nContext";
import { useToast } from "@/src/contexts/ToastContext";
import { DomainEnum } from "@/src/components/ui/DomainValue";
import { Button } from "@/src/components/ui/Button";
import { ConfirmDialog } from "@/src/components/ui/Modal";
import { fieldControl } from "@/src/components/ui/Field";
import { SearchSelectField } from "@/src/components/ui/SearchSelectField";
import { Segmented } from "@/src/components/ui/Segmented";

/*
 * 地府案子的两块(Design 第五十七批 D-1、D-2):
 *  - 罪目:放在「戊 · 发落」最上面(罪目只用来决定送哪一殿,和发落是一件事)。可搜索的下拉按殿分组,
 *    组头「殿序 · 殿王 · 狱名」;选中后一块浅底写「判有罪时送 九殿 · 平等王」+ 狱名小字。未填时控件里是占位,
 *    不另起一行。结案(或不能改)只读一行「罪目 · 杀生 · 第九殿」。
 *  - 枉死城:只在枉死的案子上,放在资料舱身份那一组下面。块头右侧和页头同一句(`untimelyLine`)。冤情 4 档用分段。
 *    「属实 · 提前释放…」二次确认(ink 实底,不用危险色);冤情不到「重」按钮置灰、原因写在下面。判不实后申诉块回到
 *    可提交,上一条记录灰字留在下面。
 * 未结案且持 `judgment.execute` 才可改,其余只读。
 */

const LABEL = "text-2xs uppercase text-[oklch(var(--color-ink-subtle))]";
const HINT = "mt-1 text-xs text-[oklch(var(--color-ink-muted))]";

function useRefresh() {
  const queryClient = useQueryClient();
  // 属实提前释放 / 超度会改灵魂与处置(`wangsi._deliver`),不只是这件案子。
  return () =>
    Promise.all([judgmentKeys.all, dispositionKeys.all, soulKeys.all].map((queryKey) => queryClient.invalidateQueries({ queryKey })));
}

function refusalCode(err: unknown): string | undefined {
  return (err as { response?: { data?: { code?: string } } })?.response?.data?.code;
}

type Translate = ReturnType<typeof useI18n>["t"];
type FormatDate = ReturnType<typeof useI18n>["formatDate"];

/**
 * 页头与枉死城块头同一句(D-2):候审期间「枉死 · 候至 日期 · 在枉死城」;申诉属实已提前释放「枉死 · 日期 已提前释放」;
 * 其余只写「枉死」。
 */
export function untimelyLine(judgment: Judgment, t: Translate, formatDate: FormatDate): string {
  if (judgment.grievance_status === "UPHELD" && judgment.grievance_decided_at) {
    return t("judgment.wangsi.released_line", { date: formatDate(judgment.grievance_decided_at) });
  }
  if (judgment.grievance_status === "DELIVERED" && judgment.grievance_decided_at) {
    return t("judgment.wangsi.delivered_line", { date: formatDate(judgment.grievance_decided_at) });
  }
  if (isHeldUntilFatedDate(judgment)) {
    return [t("judgment.untimely"), t("judgment.held_until", { date: judgment.held_until as string }), t("judgment.in_city")].join(" · ");
  }
  return t("judgment.untimely");
}

function courtLine(court: number, t: Translate) {
  return `${t(`workflow.court.court_${court}`)} · ${t(`judgment.offence_field.kings.${court}`)}`;
}

export function OffenceField({ judgment, editable }: { judgment: Judgment; editable: boolean }) {
  const { t } = useI18n();
  const { showToast } = useToast();
  const refresh = useRefresh();
  const fieldId = useId();
  const saved = judgment.offence ?? "";
  const label = (o: string) => t(`judgment.offences.${o}`);
  const [picked, setPicked] = useState<string>(saved);
  const [search, setSearch] = useState(saved ? label(saved) : "");
  const save = useMutation({
    mutationFn: (offence: Judgment["offence"]) => judgmentApi.update(judgment.id, { offence }),
    onSuccess: refresh,
    onError: () => showToast(t("common.error"), "error"),
  });
  const court = offenceCourt(saved);

  if (!editable) {
    return (
      <p className="mb-4 text-sm text-[oklch(var(--color-ink))]" data-testid="desk-offence">
        {t("judgment.offence_field.label")} · {saved ? <DomainEnum namespace="judgment.offences" value={saved} /> : t("judgment.offence_field.none")}
        {court && ` · ${t(`workflow.court.court_${court}`)}`}
      </p>
    );
  }

  // 23 项,客户端筛就够:选中后输入框里是它的名字,这时列全部。
  const query = search.trim() && !(picked && search === label(picked)) ? search.trim().toLowerCase() : "";
  const options = OFFENCES_BY_COURT.flatMap((g) =>
    g.offences.map((o) => ({
      value: o,
      label: label(o),
      group: `${courtLine(g.court, t)} · ${t(`judgment.offence_field.hells.${g.court}`)}`,
    })),
  ).filter((o) => !query || o.label.toLowerCase().includes(query) || o.group.toLowerCase().includes(query));

  return (
    <div className="mb-4 space-y-2" data-testid="desk-offence">
      <SearchSelectField
        id={fieldId}
        name="offence"
        label={t("judgment.offence_field.label")}
        value={picked}
        onValueChange={(v) => {
          setPicked(v);
          // 打字会先清掉选择(值变空);那不是「改成未填」,只有把框清空才是。
          if (v && v !== saved) save.mutate(v as Judgment["offence"]);
        }}
        options={options}
        searchText={search}
        onSearchTextChange={(text) => {
          setSearch(text);
          if (text === "" && saved) save.mutate("" as Judgment["offence"]);
        }}
        disabled={save.isPending}
        placeholder={t("judgment.offence_field.placeholder")}
        loadingText={t("common.loading")}
        emptyText={t("judgment.offence_field.no_match")}
      />
      {court && (
        <div className="bg-[oklch(var(--color-surface-2))] px-3 py-2" data-testid="desk-offence-route">
          <p className="text-sm text-[oklch(var(--color-ink))]">{t("judgment.offence_field.routes_to", { court: courtLine(court, t) })}</p>
          <p className="text-2xs text-[oklch(var(--color-ink-muted))]">{t(`judgment.offence_field.hells.${court}`)}</p>
        </div>
      )}
    </div>
  );
}

export function WangsiPanel({ judgment, editable }: { judgment: Judgment; editable: boolean }) {
  const { t, formatDate, formatDateTime } = useI18n();
  const { showToast } = useToast();
  const refresh = useRefresh();
  const causeId = useId();
  const [plea, setPlea] = useState("");
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  // 二次确认的是哪一种属实:提前释放,还是超度(出城到莲花台、免审结案)。
  const [confirming, setConfirming] = useState<false | "release" | "deliver">(false);
  const held = isHeldUntilFatedDate(judgment);
  const status = judgment.grievance_status ?? "";
  const level = judgment.grievance_level ?? "";
  const canRelease = GRIEVANCE_RELEASE_LEVELS.includes(level);

  const onRefused = (err: unknown) => {
    const code = refusalCode(err);
    setError(code && (WANGSI_ERROR_CODES as readonly string[]).includes(code) ? t(`judgment.wangsi.error.${code}`) : t("common.error"));
  };
  const patch = useMutation({
    mutationFn: (data: Parameters<typeof judgmentApi.update>[1]) => judgmentApi.update(judgment.id, data),
    onSuccess: refresh,
    onError: () => showToast(t("common.error"), "error"),
  });
  const file = useMutation({
    mutationFn: () => wangsiApi.fileGrievance(judgment.id, plea.trim()),
    onSuccess: () => { setPlea(""); setError(null); void refresh(); },
    onError: onRefused,
  });
  const decide = useMutation({
    mutationFn: ({ upheld, deliver = false }: { upheld: boolean; deliver?: boolean }) =>
      wangsiApi.decideGrievance(judgment.id, upheld, note.trim(), deliver),
    onSuccess: () => { setNote(""); setError(null); setConfirming(false); void refresh(); },
    onError: (err) => { setConfirming(false); onRefused(err); },
  });

  // 上一条申诉记录。判不实之后它留在提交框下面,灰字。
  const lastRecord = status && (
    <div
      className={`mt-1 text-sm ${status === "REJECTED" ? "text-[oklch(var(--color-ink-subtle))]" : "text-[oklch(var(--color-ink))]"}`}
      data-testid="wangsi-grievance-status"
    >
      <DomainEnum namespace="judgment.grievance_statuses" value={status} />
      {judgment.grievance_decided_at && ` · ${t("judgment.wangsi.decided_line", { date: formatDateTime(judgment.grievance_decided_at) })}`}
      {judgment.grievance_plea && <p className="mt-1 whitespace-pre-wrap font-serif">{judgment.grievance_plea}</p>}
      {judgment.grievance_note && <p className="mt-1 whitespace-pre-wrap text-[oklch(var(--color-ink-muted))]">{judgment.grievance_note}</p>}
    </div>
  );
  const canFile = editable && held && (status === "" || status === "REJECTED");

  return (
    <section className="mt-6" data-testid="desk-wangsi" aria-label={t("judgment.wangsi.title")}>
      <div className="flex flex-wrap items-baseline gap-x-3 border-b border-[oklch(var(--color-block))] pb-1">
        <p className="flex-1 text-2xs uppercase text-[oklch(var(--color-ink-subtle))]">{t("judgment.wangsi.title")}</p>
        <span className="text-xs text-[oklch(var(--color-ink))]" data-testid="wangsi-head-line">{untimelyLine(judgment, t, formatDate)}</span>
      </div>

      <div className="mt-3 space-y-3">
        <div>
          <label htmlFor={causeId} className={LABEL}>{t("judgment.wangsi.cause")}</label>
          {editable ? (
            <select
              id={causeId}
              value={judgment.wrongful_death_cause ?? ""}
              disabled={patch.isPending}
              onChange={(e) => patch.mutate({ wrongful_death_cause: e.target.value as Judgment["wrongful_death_cause"] })}
              className={fieldControl({ size: "sm" })}
            >
              <option value="">{t("judgment.wangsi.unset")}</option>
              {WRONGFUL_DEATH_CAUSES.map((m) => <option key={m} value={m}>{t(`judgment.wrongful_death_causes.${m}`)}</option>)}
            </select>
          ) : (
            <p className="mt-1 text-sm text-[oklch(var(--color-ink))]">
              {judgment.wrongful_death_cause ? (
                <DomainEnum namespace="judgment.wrongful_death_causes" value={judgment.wrongful_death_cause} />
              ) : t("judgment.wangsi.unset")}
            </p>
          )}
        </div>
        <div>
          <p className={LABEL}>{t("judgment.wangsi.level")}</p>
          {editable ? (
            <Segmented
              label={t("judgment.wangsi.level")}
              value={level}
              options={GRIEVANCE_LEVELS.map((m) => ({ value: m, label: t(`judgment.grievance_levels.${m}`) }))}
              onChange={(v) => patch.mutate({ grievance_level: v as Judgment["grievance_level"] })}
              disabled={patch.isPending}
              fill
              className="mt-1"
              data-testid="wangsi-level"
            />
          ) : (
            <p className="mt-1 text-sm text-[oklch(var(--color-ink))]">
              {level ? <DomainEnum namespace="judgment.grievance_levels" value={level} /> : t("judgment.wangsi.unset")}
            </p>
          )}
        </div>
      </div>

      <div className="mt-3">
        <p className={LABEL}>{t("judgment.wangsi.grievance")}</p>
        {!canFile && lastRecord}
        {canFile && (
          <div className="mt-2 space-y-2">
            <textarea
              aria-label={t("judgment.wangsi.plea")}
              value={plea}
              onChange={(e) => setPlea(e.target.value)}
              rows={3}
              maxLength={2000}
              className={`${fieldControl({ size: "sm" })} font-serif`}
            />
            <p className={HINT}>{t("judgment.wangsi.plea_hint")}</p>
            <Button type="button" size="sm" variant="secondary" data-testid="wangsi-file" disabled={!plea.trim()} loading={file.isPending} onClick={() => file.mutate()}>
              {t("judgment.wangsi.file")}
            </Button>
            {lastRecord}
          </div>
        )}
        {/* 阳寿已到或已结案而申诉还挂着:仍可审,只记结论(后端 UPHELD_LATE),不看冤情等级、没有超度。 */}
        {editable && !held && status === "FILED" && (
          <div className="mt-2 space-y-2">
            <textarea
              aria-label={t("judgment.wangsi.decision_note")}
              value={note}
              onChange={(e) => setNote(e.target.value)}
              rows={2}
              maxLength={2000}
              className={fieldControl({ size: "sm" })}
            />
            <p className={HINT} data-testid="wangsi-late-hint">{t("judgment.wangsi.late_hint")}</p>
            <div className="flex flex-wrap gap-2">
              <Button type="button" size="sm" variant="secondary" data-testid="wangsi-uphold-late" disabled={!note.trim()} loading={decide.isPending && decide.variables?.upheld === true} onClick={() => decide.mutate({ upheld: true })}>
                {t("judgment.wangsi.uphold_late")}
              </Button>
              <Button type="button" size="sm" variant="secondary" data-testid="wangsi-reject" disabled={!note.trim()} loading={decide.isPending && decide.variables?.upheld === false} onClick={() => decide.mutate({ upheld: false })}>
                {t("judgment.wangsi.reject")}
              </Button>
            </div>
          </div>
        )}
        {editable && held && status === "FILED" && (
          <div className="mt-2 space-y-2">
            <textarea
              aria-label={t("judgment.wangsi.decision_note")}
              value={note}
              onChange={(e) => setNote(e.target.value)}
              rows={2}
              maxLength={2000}
              className={fieldControl({ size: "sm" })}
            />
            <div className="flex flex-wrap gap-2">
              <Button
                type="button"
                size="sm"
                variant="primary"
                data-testid="wangsi-uphold"
                disabled={!note.trim() || !canRelease}
                onClick={() => setConfirming("release")}
              >
                {`${t("judgment.wangsi.uphold")}…`}
              </Button>
              <Button
                type="button"
                size="sm"
                variant="secondary"
                data-testid="wangsi-deliver"
                disabled={!note.trim() || !canRelease}
                onClick={() => setConfirming("deliver")}
              >
                {`${t("judgment.wangsi.deliver")}…`}
              </Button>
              <Button type="button" size="sm" variant="secondary" data-testid="wangsi-reject" disabled={!note.trim()} loading={decide.isPending && !confirming} onClick={() => decide.mutate({ upheld: false })}>
                {t("judgment.wangsi.reject")}
              </Button>
            </div>
            {/* 冤情不到「重」:原因写在按钮下面,不藏在 tooltip 里。 */}
            {!canRelease && (
              <p className={HINT} data-testid="wangsi-release-gate">
                {t("judgment.wangsi.release_gate", { level: t("judgment.grievance_levels.MAJOR") })}
              </p>
            )}
          </div>
        )}
        {error && <p role="alert" className="mt-1 text-xs text-[oklch(var(--color-danger))]">{error}</p>}
      </div>

      <ConfirmDialog
        isOpen={confirming !== false}
        variant="info"
        title={confirming === "deliver"
          ? t("judgment.wangsi.deliver_title", { name: judgment.soul_name })
          : t("judgment.wangsi.release_title", { name: judgment.soul_name })}
        message={`${confirming === "deliver"
          ? t("judgment.wangsi.deliver_body", { name: judgment.soul_name }) +
            // 还在城隍初审:服务端超度时同一事务里先解送(2026-10-29),这里说一声。
            (judgment.city_god_status === "PENDING" || judgment.city_god_status === "RETURNED"
              ? ` ${t("judgment.wangsi.deliver_sends_on")}`
              : "")
          : t("judgment.wangsi.release_body", { name: judgment.soul_name, date: judgment.held_until ?? "" })} ${t("judgment.wangsi.release_irreversible")}`}
        confirmText={confirming === "deliver" ? t("judgment.wangsi.deliver") : t("judgment.wangsi.uphold")}
        confirmLoading={decide.isPending}
        onConfirm={() => decide.mutate({ upheld: true, deliver: confirming === "deliver" })}
        onCancel={() => setConfirming(false)}
      />
    </section>
  );
}
