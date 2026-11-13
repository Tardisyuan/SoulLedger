"use client";

import type { AssistTrace } from "@soulledger/core/api/officer-assist";
import { useI18n } from "@/src/contexts/I18nContext";

const n = (v: number | undefined) => (v ?? 0).toLocaleString("en-US");

/**
 * 「这次怎么答的」 (作品集建议 B1) under an answer that carries a trace — only the demo's recorded answers do
 * (`AssistTrace`). Folded by default: the answer is the point, the trace is for whoever asks how it was reached.
 * Tool names only; what a tool returned is the officer's own data and is never part of a trace.
 */
export function AnswerTrace({ trace }: { trace: AssistTrace }) {
  const { t } = useI18n();
  const tokens = trace.tokens ?? {};
  return (
    <details data-testid="officer-assist-trace" className="mt-2 text-2xs text-[oklch(var(--color-ink-muted))]">
      <summary className="cursor-pointer font-mono text-[oklch(var(--color-ink-subtle))] hover:text-[oklch(var(--color-ink))]">
        {t("officer_assist.trace.title")}
      </summary>
      <dl className="mt-1 grid grid-cols-[auto_minmax(0,1fr)] gap-x-2 gap-y-1 border-l border-[oklch(var(--color-line))] pl-2">
        <dt>{t("officer_assist.trace.tools")}</dt>
        <dd className="m-0 font-mono break-all text-[oklch(var(--color-ink))]" data-testid="officer-assist-trace-tools">
          {trace.tools_called.length ? trace.tools_called.join(" → ") : t("officer_assist.trace.no_tools")}
        </dd>
        <dt>{t("officer_assist.trace.entries")}</dt>
        <dd className="m-0 text-[oklch(var(--color-ink))]" data-testid="officer-assist-trace-entries">
          {t(`officer_assist.trace.retrieval.${trace.retrieval}`)}
          {trace.retrieved_entries.length ? <span className="block font-mono break-all">{trace.retrieved_entries.join(", ")}</span> : null}
        </dd>
        <dt>{t("officer_assist.trace.tokens")}</dt>
        <dd className="m-0 font-mono text-[oklch(var(--color-ink))]">
          {t("officer_assist.trace.tokens_value", { input: n(tokens.input), output: n(tokens.output), cached: n(tokens.cache_read) })}
        </dd>
        <dt>{t("officer_assist.trace.latency")}</dt>
        <dd className="m-0 font-mono text-[oklch(var(--color-ink))]" data-testid="officer-assist-trace-latency">
          {trace.first_token_ms == null
            ? t("officer_assist.trace.latency_value", { ms: n(trace.latency_ms) })
            : t("officer_assist.trace.latency_first", { ms: n(trace.latency_ms), first: n(trace.first_token_ms) })}
        </dd>
        <dt>{t("officer_assist.trace.answered_by")}</dt>
        <dd className="m-0 text-[oklch(var(--color-ink))]">
          {t(`officer_assist.trace.role.${trace.provider_role}`)} · <span className="font-mono">{trace.model}</span>
          {trace.fallback_reason ? ` · ${t(`assist_admin.usage.reason.${trace.fallback_reason}`, { n: "" }).trim()}` : null}
        </dd>
      </dl>
    </details>
  );
}
