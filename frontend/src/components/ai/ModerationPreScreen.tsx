"use client";

import { useCallback, useMemo, useState } from "react";
import { moderationAiApi, type AIScreenResult, type AIScreenScore } from "@soulledger/core/api/ai-business";
import { useI18n } from "@/src/contexts/I18nContext";
import { Button } from "@/src/components/ui/Button";

/**
 * 朋友圈审核的 AI 预筛(docs/audit/2026-11-12-portfolio-ai-ideas.md 第二部分接入点 4):**只排序,不动手**。
 *
 * `useAiScreen(rows)`:先认列表行上已存的分(`ai_screen`),点「AI 预筛」再给待审的帖子与评论打分
 * (`POST /social-moderation/{posts,comments}/ai-screen/`);返回 id → 分。内容的状态一个都不改 ——
 * 通过 / 隐藏 / 删除仍是审核员的那几个按钮。分只在审核后台出现。
 */
export function useAiScreen(rows: readonly { id: string; ai_screen?: AIScreenScore | null }[]) {
  const [fresh, setFresh] = useState<Record<string, AIScreenScore>>({});
  const [result, setResult] = useState<Pick<AIScreenResult, "model" | "fallback"> | null>(null);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const [byRisk, setByRisk] = useState(false);

  const scores = useMemo(() => {
    const out: Record<string, AIScreenScore> = {};
    for (const row of rows) if (row.ai_screen) out[row.id] = row.ai_screen;
    return { ...out, ...fresh };
  }, [rows, fresh]);

  const run = useCallback(async () => {
    setBusy(true);
    setFailed(false);
    try {
      const [posts, comments] = await Promise.all([moderationAiApi.screen("posts"), moderationAiApi.screen("comments")]);
      setFresh(Object.fromEntries([...posts.items, ...comments.items].map((s) => [s.id, s])));
      setResult({ model: posts.model || comments.model, fallback: posts.fallback && comments.fallback });
      setByRisk(true);
    } catch {
      setFailed(true);
    } finally {
      setBusy(false);
    }
  }, []);

  return { scores, run, busy, failed, result, byRisk, setByRisk };
}

export type AiScreen = ReturnType<typeof useAiScreen>;

/** Highest score first, unscored last; ties keep their order. Sorts a copy, never filters. */
export function byRiskOrder<T>(items: readonly T[], scoreOf: (item: T) => number | undefined): T[] {
  return items
    .map((item, i) => ({ item, i, s: scoreOf(item) ?? -1 }))
    .sort((a, b) => b.s - a.s || a.i - b.i)
    .map((x) => x.item);
}

export function AiScreenBar({ screen }: { screen: AiScreen }) {
  const { t } = useI18n();
  return (
    <div data-testid="ai-screen-bar" className="flex flex-wrap items-center gap-3 px-4 py-2">
      <Button type="button" size="sm" variant="secondary" loading={screen.busy} onClick={() => void screen.run()}>
        {t("ai_assist.screen.run")}
      </Button>
      <label className="flex items-center gap-1 text-xs">
        <input type="checkbox" checked={screen.byRisk} onChange={(e) => screen.setByRisk(e.target.checked)} />
        {t("ai_assist.screen.sort")}
      </label>
      <span className="text-xs text-[oklch(var(--color-ink-muted))]">{t("ai_assist.screen.note")}</span>
      {screen.failed && (
        <span role="status" className="text-xs text-[oklch(var(--color-ink-muted))]">
          {t("ai_assist.screen.error")}
        </span>
      )}
      {screen.result?.fallback && (
        <span role="status" className="text-xs text-[oklch(var(--color-ink-muted))]">
          {t("ai_assist.screen.fallback")}
        </span>
      )}
      {screen.result?.model && (
        <span className="font-mono text-2xs text-[oklch(var(--color-ink-subtle))]">
          {t("ai_assist.screen.model", { model: screen.result.model })}
        </span>
      )}
    </div>
  );
}

/** One row's score and why: the model's sentence, or the rule signals in words. */
export function AiScoreTag({ score }: { score: AIScreenScore | undefined }) {
  const { t } = useI18n();
  if (!score) return null;
  const why = score.reason || score.signals.map((s) => t(`ai_assist.screen.signals.${s}`)).join(" · ");
  return (
    <span data-testid="ai-score" title={why} className="font-semibold text-[oklch(var(--color-ink))]">
      {t("ai_assist.screen.score", { score: String(score.score) })}
      {why && <span className="font-normal text-[oklch(var(--color-ink-muted))]"> · {why}</span>}
    </span>
  );
}
