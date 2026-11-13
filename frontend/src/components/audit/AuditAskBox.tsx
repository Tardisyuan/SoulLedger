"use client";

import { useState } from "react";
import { auditApi, type AuditNlFilter } from "@soulledger/core/api";
import { officerAssistApi } from "@soulledger/core/api/officer-assist";
import { useI18n } from "@/src/contexts/I18nContext";
import { Button } from "@/src/components/ui/Button";
import { fieldControl } from "@/src/components/ui/Field";
import { filterChipClass } from "@/src/components/ui/FilterChip";
import { cn } from "@/lib/utils";
import { auditResourceLabel } from "./auditLabels";

type Values = Record<string, string>;
const ERRORS: Record<string, string> = {
  assistant_not_configured: "audit_ask.not_configured",
  assistant_unavailable: "audit_ask.unavailable",
  assistant_busy: "audit_ask.busy",
};

/** 筛选里的一项,写成人读的:动作与资源走词条,其余原样。 */
function useAskValueLabel() {
  const { t } = useI18n();
  return (key: string, value: string) =>
    key === "action" ? t(`audit.actions.${value}`) : key === "resource" ? auditResourceLabel(t, value) : value;
}

/**
 * 审计页的「用一句话找记录」(docs/audit/2026-11-12-portfolio-ai-ideas.md 第二部分接入点 7)。
 * 问题 → `POST /audit-logs/nl-filter/` → 一组**建议的**筛选(可逐项去掉)→ 人点「按这些条件查」才交给页面,
 * 页面照旧调 `GET /audit-logs/`。模型不可用、殿没开助手时只说一句,手动筛选照常可用。
 * 采纳 / 不用都回报给 `AIDraft`(只记状态与改动比例)。
 * `extra`:页面上没有对应控件的那几项(日期、资源编号),采纳后在这里留成可去掉的签。
 */
export function AuditAskBox({
  onApply,
  extra,
  onRemoveExtra,
}: {
  onApply: (filters: Values) => void;
  extra: Values;
  onRemoveExtra: (key: string) => void;
}) {
  const { t } = useI18n();
  const valueLabel = useAskValueLabel();
  const [question, setQuestion] = useState("");
  const [busy, setBusy] = useState(false);
  const [proposal, setProposal] = useState<(AuditNlFilter & { kept: Values }) | null>(null);
  const [note, setNote] = useState("");

  const ask = async () => {
    if (!question.trim() || busy) return;
    setBusy(true);
    setNote("");
    setProposal(null);
    try {
      const { data } = await auditApi.nlFilter(question.trim());
      if (!data.understood || Object.keys(data.filters).length === 0) setNote(t("audit_ask.not_understood"));
      else setProposal({ ...data, kept: { ...(data.filters as Values) } });
    } catch (error) {
      const body = (error as { response?: { data?: { code?: string; examples?: string[] } } }).response?.data;
      // 演示站(frontend/demo/aiReplay.ts)只回放录好的问题:没录的,说出录了哪些。
      if (body?.code === "demo_not_recorded") setNote(t("audit_ask.demo_not_recorded", { examples: (body.examples ?? []).join(" / ") }));
      else setNote(t(ERRORS[body?.code ?? ""] ?? "audit_ask.unavailable"));
    } finally {
      setBusy(false);
    }
  };

  const decide = (adopted: boolean) => {
    if (!proposal) return;
    const final = JSON.stringify(Object.fromEntries(Object.entries(proposal.kept).sort()));
    // 处置只是记账:记不上不影响查询。
    void officerAssistApi.decideDraft(proposal.draft_id, adopted, adopted ? final : "").catch(() => undefined);
    if (adopted) onApply(proposal.kept);
    setProposal(null);
  };

  const fieldName = (key: string) => t(`audit_ask.fields.${key}`);
  const chip = (key: string, value: string, remove: () => void) => (
    <button
      key={key}
      type="button"
      data-testid={`audit-ask-chip-${key}`}
      className={filterChipClass(true)}
      aria-label={t("audit_ask.clear_field", { name: fieldName(key) })}
      onClick={remove}
    >
      {fieldName(key)} · {valueLabel(key, value)} ×
    </button>
  );

  return (
    <div className="flex w-full flex-col gap-2" data-testid="audit-ask">
      <form
        className="flex w-full gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          void ask();
        }}
      >
        <input
          type="text"
          data-testid="audit-ask-input"
          value={question}
          maxLength={500}
          onChange={(e) => setQuestion(e.target.value)}
          placeholder={t("audit_ask.placeholder")}
          aria-label={t("audit_ask.label")}
          className={cn(fieldControl({ size: "md" }), "min-w-[200px] flex-1")}
        />
        <Button type="submit" variant="secondary" loading={busy} disabled={!question.trim()}>
          {t("audit_ask.submit")}
        </Button>
      </form>
      {note ? (
        <p role="status" data-testid="audit-ask-note" className="text-xs text-[oklch(var(--color-ink-muted))]">
          {note}
        </p>
      ) : null}
      {proposal ? (
        <div role="group" aria-label={t("audit_ask.proposed")} data-testid="audit-ask-proposal" className="flex flex-wrap items-center gap-2">
          <span className="text-xs text-[oklch(var(--color-ink-muted))]">{t("audit_ask.proposed")}</span>
          {Object.entries(proposal.kept).map(([key, value]) =>
            chip(key, value, () => {
              const kept = { ...proposal.kept };
              delete kept[key];
              setProposal({ ...proposal, kept });
            })
          )}
          <Button type="button" size="sm" data-testid="audit-ask-apply" disabled={Object.keys(proposal.kept).length === 0} onClick={() => decide(true)}>
            {t("audit_ask.apply")}
          </Button>
          <Button type="button" size="sm" variant="ghost" onClick={() => decide(false)}>
            {t("audit_ask.discard")}
          </Button>
          {proposal.dropped.length > 0 ? (
            <span data-testid="audit-ask-dropped" className="w-full text-xs text-[oklch(var(--color-ink-muted))]">
              {t("audit_ask.dropped", { keys: proposal.dropped.join(", ") })}
            </span>
          ) : null}
          {proposal.model ? (
            <span className="w-full font-mono text-2xs text-[oklch(var(--color-ink-subtle))]">
              {t("audit_ask.model", { model: proposal.model })}
            </span>
          ) : null}
        </div>
      ) : null}
      {Object.keys(extra).length > 0 ? (
        <div className="flex flex-wrap gap-2">{Object.entries(extra).map(([key, value]) => chip(key, value, () => onRemoveExtra(key)))}</div>
      ) : null}
    </div>
  );
}
