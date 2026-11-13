"use client";

import { useEffect, useRef, useState } from "react";
import { judgmentAiApi, type ChosenVerdict, type VerdictDraft } from "@soulledger/core/api/ai-business";
import { officerAssistApi } from "@soulledger/core/api/officer-assist";
import { useI18n } from "@/src/contexts/I18nContext";
import { Button } from "@/src/components/ui/Button";

const VERDICTS: readonly string[] = ["PASSED", "FAILED", "PURGATORY", "RETRY"];

/**
 * 「起草判词」(docs/audit/2026-11-12-portfolio-ai-ideas.md 第二部分接入点 2)。
 *
 * **先有裁决,后有草稿**:没选裁决时按钮不可用。草稿先在这里预览,确定性检查(不在已采纳引用里的条文、
 * 相反的裁决词、灵魂的名字)标红;判官点「放入判词框」才经 `onInsert` 交给页面的判词框 —— 之后照旧
 * 自动保存(`PATCH draft/`)、结案,提交按钮仍是判官的。
 *
 * 处置回报 `AIDraft`:「不用」当场记丢弃;放进去的,等这块面板卸下(结案、离开审判台)时按判词框里最后的文字
 * 记采纳与改动比例。ponytail: 关掉标签页时这一下可能发不出去;要准就在保存判词的那条路径上回报。
 */
export function VerdictDraftPanel({
  judgmentId,
  verdict,
  currentText,
  onInsert,
}: {
  judgmentId: string;
  /** The verdict the judge has chosen on the desk; "" while none is. */
  verdict: string;
  /** What is in the verdict text box now: replaced on insert, and the final text the edit ratio is measured on. */
  currentText: string;
  onInsert: (text: string) => void;
}) {
  const { t } = useI18n();
  const [busy, setBusy] = useState(false);
  const [draft, setDraft] = useState<VerdictDraft | null>(null);
  const [note, setNote] = useState("");
  const inserted = useRef<number | null>(null);
  const latest = useRef(currentText);
  latest.current = currentText;

  useEffect(
    () => () => {
      if (inserted.current !== null) {
        void officerAssistApi.decideDraft(inserted.current, true, latest.current).catch(() => undefined);
      }
    },
    []
  );

  const chosen = VERDICTS.includes(verdict);

  const ask = async () => {
    if (!chosen) return;
    setBusy(true);
    setNote("");
    setDraft(null);
    try {
      setDraft(await judgmentAiApi.verdictDraft(judgmentId, verdict as ChosenVerdict));
    } catch {
      setNote(t("ai_assist.verdict.error"));
    } finally {
      setBusy(false);
    }
  };

  const insert = () => {
    if (!draft) return;
    onInsert(draft.text);
    if (draft.draft_id !== null) inserted.current = draft.draft_id;
    setDraft(null);
  };

  const discard = () => {
    if (draft?.draft_id != null) void officerAssistApi.decideDraft(draft.draft_id, false).catch(() => undefined);
    setDraft(null);
  };

  const checks = draft?.checks;
  const problems = checks
    ? [
        checks.unknown_codes.length > 0 && t("ai_assist.verdict.check_unknown", { codes: checks.unknown_codes.join(", ") }),
        checks.contrary_verdict_words.length > 0 &&
          t("ai_assist.verdict.check_contrary", { words: checks.contrary_verdict_words.join(", ") }),
        checks.names_soul && t("ai_assist.verdict.check_name"),
      ].filter((x): x is string => !!x)
    : [];

  return (
    <section data-testid="ai-verdict-draft" aria-label={t("ai_assist.verdict.ask")} className="mt-2">
      <div className="flex flex-wrap items-center gap-2">
        <Button type="button" size="sm" variant="secondary" loading={busy} disabled={!chosen} onClick={() => void ask()}>
          {t("ai_assist.verdict.ask")}
        </Button>
        <span className="text-xs text-[oklch(var(--color-ink-muted))]">
          {chosen ? t("ai_assist.verdict.note") : t("ai_assist.verdict.need_verdict")}
        </span>
      </div>
      {note && (
        <p role="status" className="mt-2 text-xs text-[oklch(var(--color-ink-muted))]">
          {note}
        </p>
      )}
      {draft && (
        <div className="mt-2 border border-[oklch(var(--color-line))] px-3 py-2">
          {draft.fallback && (
            <p role="status" className="mb-1 text-xs text-[oklch(var(--color-ink-muted))]">
              {t("ai_assist.verdict.fallback")}
            </p>
          )}
          <p data-testid="ai-verdict-text" className="whitespace-pre-wrap font-serif text-md text-[oklch(var(--color-ink))]">
            {draft.text}
          </p>
          {problems.length > 0 && (
            <ul data-testid="ai-verdict-problems" className="mt-2 text-xs text-[oklch(var(--color-danger))]">
              {problems.map((p) => (
                <li key={p}>{p}</li>
              ))}
            </ul>
          )}
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <Button type="button" size="sm" data-testid="ai-verdict-insert" onClick={insert}>
              {currentText.trim() ? t("ai_assist.verdict.replace") : t("ai_assist.verdict.insert")}
            </Button>
            <Button type="button" size="sm" variant="ghost" onClick={discard}>
              {t("ai_assist.verdict.discard")}
            </Button>
            {draft.model && (
              <span className="font-mono text-2xs text-[oklch(var(--color-ink-subtle))]">
                {t("ai_assist.verdict.model", { model: draft.model })}
              </span>
            )}
          </div>
        </div>
      )}
    </section>
  );
}
