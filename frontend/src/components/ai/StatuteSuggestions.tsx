"use client";

import { useState } from "react";
import { judgmentAiApi, type StatuteSuggestions as Suggestions } from "@soulledger/core/api/ai-business";
import { officerAssistApi } from "@soulledger/core/api/officer-assist";
import { useI18n } from "@/src/contexts/I18nContext";
import { Button } from "@/src/components/ui/Button";

/**
 * 「建议援引」(docs/audit/2026-11-12-portfolio-ai-ideas.md 第二部分接入点 1)。
 *
 * 点一下 → `POST /judgment/<id>/statute-suggestions/` → 每条建议带条文原文与「为什么」,**默认都不勾**;
 * 判官逐条读、勾选,点「引用所选」才经 `onCite`(页面原来的 `POST citations/`)写入 —— 认领、未结案、
 * 本殿本文明的规则照常生效。采纳 / 都不用回报给 `AIDraft`(只记状态与改动比例)。
 * AI 不可用或殿没开通时,后端给关键词匹配(`fallback`),这里照样能勾选引用。
 *
 * 自成一体:只要案子 id、能不能引用、已引用的条文 id 与一个引用函数。挂在哪里由页面决定。
 */
export function StatuteSuggestions({
  judgmentId,
  canCite,
  cited,
  onCite,
}: {
  judgmentId: string;
  canCite: boolean;
  cited: ReadonlySet<string> | readonly string[];
  onCite: (statuteId: string) => Promise<unknown>;
}) {
  const { t } = useI18n();
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<Suggestions | null>(null);
  const [ticked, setTicked] = useState<Set<string>>(new Set());
  const [note, setNote] = useState("");
  const citedSet = cited instanceof Set ? cited : new Set(cited);

  if (!canCite) return null;

  const ask = async () => {
    setBusy(true);
    setNote("");
    setResult(null);
    setTicked(new Set());
    try {
      setResult(await judgmentAiApi.statuteSuggestions(judgmentId));
    } catch {
      setNote(t("ai_assist.statutes.error"));
    } finally {
      setBusy(false);
    }
  };

  const finish = async (adopt: boolean) => {
    if (!result) return;
    const chosen = result.suggestions.filter((s) => ticked.has(s.statute) && !citedSet.has(s.statute));
    setBusy(true);
    try {
      if (adopt) for (const s of chosen) await onCite(s.statute);
      // 处置只是记账:记不上不影响引用。最终文本 = 勾选的编号,改动比例据此算。
      if (result.draft_id !== null) {
        const final = JSON.stringify(chosen.map((s) => s.code));
        void officerAssistApi.decideDraft(result.draft_id, adopt && chosen.length > 0, final).catch(() => undefined);
      }
      setResult(null);
    } finally {
      setBusy(false);
    }
  };

  const toggle = (id: string) =>
    setTicked((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  return (
    <section data-testid="ai-statute-suggestions" aria-label={t("ai_assist.statutes.title")} className="mt-4">
      <div className="flex flex-wrap items-center gap-2">
        <Button type="button" size="sm" variant="secondary" loading={busy && !result} onClick={() => void ask()}>
          {t("ai_assist.statutes.ask")}
        </Button>
        <span className="text-xs text-[oklch(var(--color-ink-muted))]">{t("ai_assist.statutes.note")}</span>
      </div>
      {note && (
        <p role="status" className="mt-2 text-xs text-[oklch(var(--color-ink-muted))]">
          {note}
        </p>
      )}
      {result && (
        <div className="mt-3">
          {result.fallback && (
            <p role="status" data-testid="ai-statute-fallback" className="mb-2 text-xs text-[oklch(var(--color-ink-muted))]">
              {t("ai_assist.statutes.fallback")}
            </p>
          )}
          {result.suggestions.length === 0 ? (
            <p className="text-sm text-[oklch(var(--color-ink-muted))]">{t("ai_assist.statutes.none")}</p>
          ) : (
            <ul className="divide-y divide-[oklch(var(--color-rule))] border-y border-[oklch(var(--color-rule))]">
              {result.suggestions.map((s) => {
                const already = citedSet.has(s.statute);
                return (
                  <li key={s.statute} data-testid={`ai-statute-${s.code}`} className="py-2">
                    <label className="flex gap-3">
                      <input
                        type="checkbox"
                        className="mt-1"
                        checked={already || ticked.has(s.statute)}
                        disabled={already || busy}
                        onChange={() => toggle(s.statute)}
                      />
                      <span className="min-w-0 flex-1">
                        <span className="flex flex-wrap items-baseline gap-2">
                          <b className="font-mono text-xs">{s.code}</b>
                          <span className="text-sm text-[oklch(var(--color-ink))]">{s.title}</span>
                          {s.source === "keyword" && (
                            <span className="font-mono text-2xs text-[oklch(var(--color-ink-subtle))]">{t("ai_assist.statutes.keyword")}</span>
                          )}
                        </span>
                        <blockquote className="mt-1 font-serif text-sm text-[oklch(var(--color-ink-muted))]">{s.text}</blockquote>
                        {s.why && (
                          <span className="mt-1 block text-xs text-[oklch(var(--color-ink))]">
                            {t("ai_assist.statutes.why")}:{s.why}
                          </span>
                        )}
                      </span>
                    </label>
                  </li>
                );
              })}
            </ul>
          )}
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <Button
              type="button"
              size="sm"
              data-testid="ai-statute-cite"
              disabled={busy || ticked.size === 0}
              onClick={() => void finish(true)}
            >
              {t("ai_assist.statutes.cite_selected", { n: String(ticked.size) })}
            </Button>
            <Button type="button" size="sm" variant="ghost" disabled={busy} onClick={() => void finish(false)}>
              {t("ai_assist.statutes.discard")}
            </Button>
            {result.dropped.length > 0 && (
              <span className="w-full text-xs text-[oklch(var(--color-ink-muted))]">
                {t("ai_assist.statutes.dropped", { codes: result.dropped.join(", ") })}
              </span>
            )}
            {result.model && (
              <span className="w-full font-mono text-2xs text-[oklch(var(--color-ink-subtle))]">
                {t("ai_assist.statutes.model", { model: result.model })}
              </span>
            )}
          </div>
        </div>
      )}
    </section>
  );
}
