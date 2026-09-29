"use client";

import { useMemo, useState } from "react";
import type { AssistAdminCorpusEntry } from "@soulledger/core/api/assist-admin";
import { useAssistCorpus } from "@soulledger/core/hooks/useAssistAdmin";
import { useI18n } from "@/src/contexts/I18nContext";
import { SelectField } from "@/src/components/ui/Field";
import { IdentifierChip } from "@/src/components/ui/DomainValue";
import { MONO, SUBTLE, Section, count } from "./parts";

type Filter = "audience" | "screen" | "civilization" | "locale";
const FILTERS: Filter[] = ["audience", "screen", "civilization", "locale"];

/** An entry's values for one filter. No civilizations = the entry applies to every civilization. */
const valuesOf = (e: AssistAdminCorpusEntry, f: Filter): string[] =>
  f === "screen" ? e.screens : f === "civilization" ? e.civilizations : [e[f]];

const matches = (e: AssistAdminCorpusEntry, f: Filter, v: string) =>
  !v || valuesOf(e, f).includes(v) || (f === "civilization" && e.civilizations.length === 0);

/**
 * 帮助语料 · 只读 (plan §5, canvas 1a). The corpus ships with the code and is
 * reviewed there, so the page never edits it. The headline is the backend's
 * estimate of the largest system prompt against the phase-4 threshold; the
 * count and token sum under it follow the filters.
 */
export function CorpusSection() {
  const { t } = useI18n();
  const corpus = useAssistCorpus();
  const [filter, setFilter] = useState<Record<Filter, string>>({ audience: "", screen: "", civilization: "", locale: "" });
  const entries = useMemo(() => corpus.data?.entries ?? [], [corpus.data]);
  const options = useMemo(
    () => Object.fromEntries(FILTERS.map((f) => [f, [...new Set(entries.flatMap((e) => valuesOf(e, f)))].sort()])) as Record<Filter, string[]>,
    [entries]
  );
  const shown = entries.filter((e) => FILTERS.every((f) => matches(e, f, filter[f])));
  const tokens = shown.reduce((sum, e) => sum + e.tokens, 0);
  const label = (f: Filter, v: string) => (f === "audience" ? t(`assist_admin.eval.side_${v}`) : v);

  if (!corpus.data) return null;
  const { total_tokens, threshold } = corpus.data;
  return (
    <Section
      title={t("assist_admin.sections.corpus")}
      id="aa-corpus"
      aside={
        <span className={`${SUBTLE} ${MONO}`} data-testid="aa-corpus-summary">
          {t("assist_admin.corpus.summary", { count: String(shown.length), tokens: count(tokens) })}
        </span>
      }
    >
      <p className="text-sm" data-testid="aa-corpus-threshold">
        <span className={MONO}>{t("assist_admin.corpus.threshold", { tokens: count(total_tokens), threshold: count(threshold) })}</span>{" "}
        <span className={total_tokens >= threshold ? "text-[oklch(var(--color-warning))]" : SUBTLE}>
          {t(total_tokens >= threshold ? "assist_admin.usage.reached" : "assist_admin.usage.not_reached")}
        </span>
      </p>
      <p className={`mt-1 ${SUBTLE}`}>{t("assist_admin.corpus.note")}</p>
      <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
        {FILTERS.map((f) => (
          <SelectField
            key={f}
            id={`aa-corpus-${f}`}
            size="sm"
            label={t(`assist_admin.corpus.${f}`)}
            value={filter[f]}
            onChange={(e) => setFilter((prev) => ({ ...prev, [f]: e.target.value }))}
            options={[{ value: "", label: t("filter.all") }, ...options[f].map((v) => ({ value: v, label: label(f, v) }))]}
          />
        ))}
      </div>
      {shown.length === 0 ? (
        <p className={`mt-3 ${SUBTLE}`}>{t("assist_admin.corpus.empty")}</p>
      ) : (
        <div className="mt-3 overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className={`text-left ${SUBTLE}`}>
                {(["entry", "audience", "screen", "civilization", "locale"] as const).map((c) => (
                  <th key={c} className="py-1 pr-2 font-normal">
                    {t(`assist_admin.corpus.${c}`)}
                  </th>
                ))}
                <th className="py-1 font-normal text-right">{t("assist_admin.corpus.tokens")}</th>
              </tr>
            </thead>
            <tbody>
              {shown.map((e) => (
                <tr key={`${e.locale}/${e.audience}/${e.id}`} className="border-t border-[oklch(var(--color-hairline))] align-top">
                  <td className="py-1 pr-2">
                    <IdentifierChip id={e.id} variant="inline" />
                  </td>
                  <td className="py-1 pr-2">{label("audience", e.audience)}</td>
                  <td className={`py-1 pr-2 ${MONO}`}>{e.screens.join(", ")}</td>
                  <td className={`py-1 pr-2 ${MONO}`}>{e.civilizations.length ? e.civilizations.join(", ") : t("filter.all")}</td>
                  <td className={`py-1 pr-2 ${MONO}`}>{e.locale}</td>
                  <td className={`py-1 text-right ${MONO}`}>{count(e.tokens)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Section>
  );
}
