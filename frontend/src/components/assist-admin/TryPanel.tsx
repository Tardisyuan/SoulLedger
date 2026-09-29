"use client";

import { useState, type FormEvent } from "react";
import {
  assistAdminErrorCode,
  type AssistAdminCandidate,
  type AssistAdminConfig,
} from "@soulledger/core/api/assist-admin";
import { useAssistTry } from "@soulledger/core/hooks/useAssistAdmin";
import { useI18n } from "@/src/contexts/I18nContext";
import { Button } from "@/src/components/ui/Button";
import { TextField } from "@/src/components/ui/Field";
import { MONO, SUBTLE, Section, count } from "./parts";

type Side = "soul" | "officer";

/**
 * 试问 (plan §3.3, canvas 1a right column): one real question as the eval soul or
 * the eval officer. Uses the unsaved connection draft when there is one, like the
 * connectivity test. The backend returns tool names only, never their results.
 */
export function TryPanel({ config, draftConnection }: { config: AssistAdminConfig; draftConnection: AssistAdminCandidate }) {
  const { t } = useI18n();
  const ask = useAssistTry();
  const [side, setSide] = useState<Side>("soul");
  const [question, setQuestion] = useState("");
  const [error, setError] = useState<string | null>(null);

  const hasDraft = Object.keys(draftConnection).length > 0;
  const missing = side === "soul" ? config.eval_soul_account == null : config.eval_officer == null;
  const reason = missing ? t(side === "soul" ? "assist_admin.identities.soul_missing" : "assist_admin.identities.officer_missing") : null;

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const q = question.trim();
    if (!q || missing || ask.isPending) return;
    setError(null);
    ask.mutate(
      { side, question: q, ...(hasDraft ? { candidate: draftConnection } : {}) },
      {
        onError: (err) => {
          const code = assistAdminErrorCode(err);
          setError(t(code ? `assist_admin.errors.${code}` : "assist_admin.errors.try_failed"));
        },
      }
    );
  };

  const result = ask.data;
  const tokens = result ? Object.values(result.tokens).reduce((a, b) => a + (Number(b) || 0), 0) : 0;

  return (
    <Section title={t("assist_admin.sections.try")} id="aa-try">
      <div role="group" aria-label={t("assist_admin.eval.side")} className="flex gap-2">
        {(["soul", "officer"] as const).map((s) => (
          <Button key={s} type="button" size="sm" variant={side === s ? "primary" : "secondary"} aria-pressed={side === s} onClick={() => setSide(s)}>
            {t(`assist_admin.eval.side_${s}`)}
          </Button>
        ))}
      </div>
      <p className={`mt-2 ${SUBTLE}`}>{t(side === "soul" ? "assist_admin.try.as_soul" : "assist_admin.try.as_officer")}</p>
      <form onSubmit={submit} className="mt-2 flex items-end gap-2">
        <div className="flex-1">
          <TextField
            id="aa-try-question"
            label={t("assist_admin.try.question")}
            value={question}
            maxLength={1000}
            disabled={missing}
            onChange={(e) => setQuestion(e.target.value)}
          />
        </div>
        <Button
          type="submit"
          variant="primary"
          disabled={missing || !question.trim()}
          loading={ask.isPending}
          aria-describedby={reason ? "aa-try-missing" : undefined}
        >
          {t("assist_admin.try.ask")}
        </Button>
      </form>
      {reason && (
        <p id="aa-try-missing" className="mt-1 text-xs text-[oklch(var(--color-warning))]">
          {reason}
        </p>
      )}
      <p className={`mt-1 ${SUBTLE}`}>
        {hasDraft && <>{t("assist_admin.try.uses_draft")} </>}
        {t("assist_admin.try.not_counted")}
      </p>
      {error && (
        <p role="alert" className="mt-1 text-xs text-[oklch(var(--color-danger))]">
          {error}
        </p>
      )}
      {result && !ask.isPending && (
        <div role="status" data-testid="aa-try-result" className="mt-3 grid gap-2">
          <p className={`flex justify-between ${SUBTLE}`}>
            <span>
              {t("assist_admin.try.answer")} · {t(`assist_admin.eval.side_${result.side}`)} · <span className={MONO}>{result.model}</span>
            </span>
            <span className={MONO}>{t("assist_admin.try.meta", { latency: count(result.latency_ms), tokens: count(tokens) })}</span>
          </p>
          <p className="whitespace-pre-wrap text-sm">{result.answer}</p>
          <div className="border border-[oklch(var(--color-hairline))]">
            <p className={`border-b border-[oklch(var(--color-hairline))] px-2 py-1 ${SUBTLE}`}>
              {t("assist_admin.try.tools", { count: String(result.tools_called.length) })}
            </p>
            {result.tools_called.length ? (
              <ul className={`px-2 py-1 text-xs ${MONO}`}>
                {result.tools_called.map((name, i) => (
                  <li key={`${name}-${i}`}>{name}()</li>
                ))}
              </ul>
            ) : (
              <p className={`px-2 py-1 ${SUBTLE}`}>{t("assist_admin.try.no_tools")}</p>
            )}
          </div>
        </div>
      )}
    </Section>
  );
}
