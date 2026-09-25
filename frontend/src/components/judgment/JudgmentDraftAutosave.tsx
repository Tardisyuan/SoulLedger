"use client";

import { useEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import type { JudgmentDetail, JudgmentDraft, JudgmentDraftConflict } from "@soulledger/core/api/judgment";
import { judgmentKeys } from "@soulledger/core/query_keys";
import { useSaveJudgmentDraft } from "@soulledger/core/hooks/useJudgments";
import { useI18n } from "@/src/contexts/I18nContext";
import { Button } from "@/src/components/ui/Button";
import { DomainEnum } from "@/src/components/ui/DomainValue";
import { verdictGlyph, verdictInk } from "@/src/lib/verdictGlyph";
import { MISSING_LABEL_KEY } from "@/src/lib/domainDisplay";

/**
 * 丁 · 判词的自动保存(`PATCH /judgment/{id}/draft/`)。
 *
 * 只在操作员动过判词或裁决之后才存(`markEdited`),停手 `AUTOSAVE_DEBOUNCE_MS` 后发一次。
 * 每次带上最后见到的 `draft_version` —— 从查询缓存里读,不从渲染时的闭包里读:上一次保存
 * 成功后 `useSaveJudgmentDraft` 把新版本写进了缓存,闭包里的还是旧的。
 *
 * 409 `draft_conflict`:别人(或另一个标签页)先存了。**绝不静默覆盖** —— 停下自动保存,
 * 把服务端那一版交给 `DraftConflictBanner`,由操作员二选一:改用对方的,或保留自己的并显式
 * 覆盖(用对方的版本号再存一次)。409 `concluded`:案子已经结了,刷新详情,页面随之冻结。
 *
 * 失败(非 409)不自动重试:下一次改动会再试。自动重试一个持续失败的请求只会每秒打一次服务器。
 */

export const AUTOSAVE_DEBOUNCE_MS = 1200;

type Verdict = NonNullable<JudgmentDraft["draft_verdict"]>;
export type DraftStatus = "idle" | "saving" | "failed" | "concluded";

export function useDraftAutosave({
  judgmentId,
  notes,
  verdict,
  enabled,
}: {
  judgmentId: string;
  notes: string;
  verdict: string;
  /** 未结案且持 judgment.execute。 */
  enabled: boolean;
}) {
  const queryClient = useQueryClient();
  const save = useSaveJudgmentDraft(judgmentId);
  const [editSeq, setEditSeq] = useState(0);
  const [status, setStatus] = useState<DraftStatus>("idle");
  const [conflict, setConflict] = useState<JudgmentDraft | null>(null);
  /** 最后一次**发出去**的编辑序号。只有比它新的编辑才值得再存。 */
  const attempted = useRef(0);
  const saving = save.isPending;

  useEffect(() => {
    if (!enabled || conflict || saving || status === "concluded" || editSeq <= attempted.current) return;
    const timer = setTimeout(() => {
      const cached = queryClient.getQueryData<JudgmentDetail>(judgmentKeys.detail(judgmentId));
      attempted.current = editSeq;
      setStatus("saving");
      save.mutate(
        { version: cached?.draft_version ?? 0, notes, draft_verdict: (verdict || null) as Verdict | null },
        {
          onSuccess: () => setStatus("idle"),
          onError: (err) => {
            const e = err as { response?: { status?: number; data?: Partial<JudgmentDraftConflict> } };
            const body = e?.response?.data;
            if (e?.response?.status === 409 && body?.code === "draft_conflict" && body.current) {
              setConflict(body.current);
              setStatus("idle");
            } else if (e?.response?.status === 409 && body?.code === "concluded") {
              setStatus("concluded");
              queryClient.invalidateQueries({ queryKey: judgmentKeys.detail(judgmentId) });
            } else {
              setStatus("failed");
            }
          },
        }
      );
    }, AUTOSAVE_DEBOUNCE_MS);
    return () => clearTimeout(timer);
    // `save` is a fresh object each render; `saving` is the part of it that matters.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, conflict, saving, status, editSeq, notes, verdict, judgmentId, queryClient]);

  /**
   * 把服务端那一版写进缓存,下一次保存就以它的版本号为底。`whole=false` 只取版本号:
   * 「保留我的」若把对方的 `draft_verdict` 也并进缓存,页面的播种 effect 会把裁决悄悄换成
   * 对方的 —— 正是「绝不静默覆盖」要防的那件事,只是方向反了。
   */
  const adopt = (draft: JudgmentDraft, whole: boolean) =>
    queryClient.setQueryData<JudgmentDetail>(judgmentKeys.detail(judgmentId), (old) =>
      old ? { ...old, ...(whole ? draft : { draft_version: draft.draft_version }) } : old
    );

  return {
    status,
    conflict,
    markEdited: () => setEditSeq((n) => n + 1),
    /** 改用对方的版本:缓存与版本号跟过去,不再存。调用方负责把判词框换成 `draft.notes`。 */
    acceptTheirs: (): JudgmentDraft | null => {
      if (!conflict) return null;
      adopt(conflict, true);
      attempted.current = editSeq;
      setConflict(null);
      return conflict;
    },
    /** 保留自己的:以对方的版本号为底,立刻再存一次 —— 这是一次看见了对方之后的显式覆盖。 */
    keepMine: () => {
      if (!conflict) return;
      adopt(conflict, false);
      setConflict(null);
      setEditSeq((n) => n + 1);
    },
  };
}

/** 「已自动保存 HH:MM」/「保存中…」/「自动保存未成功」。时间是服务端的 `draft_saved_at`。 */
export function DraftStatusLine({ status, savedAt }: { status: DraftStatus; savedAt: string | null | undefined }) {
  const { t, formatDateTime } = useI18n();
  let text: string | null = null;
  if (status === "saving") text = t("judgment.draft.saving");
  else if (status === "failed") text = t("judgment.draft.save_failed");
  else if (status === "concluded") text = t("judgment.draft.concluded");
  else if (savedAt) text = t("judgment.draft.saved_at", { time: formatDateTime(savedAt, { hour: "2-digit", minute: "2-digit" }) });
  if (!text) return null;
  return (
    <p
      data-testid="draft-status"
      aria-live="polite"
      className={`mt-1 text-right font-mono text-2xs ${
        status === "failed" ? "text-[oklch(var(--color-danger))]" : "text-[oklch(var(--color-ink-subtle))]"
      }`}
    >
      {status === "failed" && <span aria-hidden="true">! </span>}
      {text}
    </p>
  );
}

/** 409 的冲突条:对方的版本原样摆出来,两个选择,没有第三个「忽略」。 */
export function DraftConflictBanner({
  current,
  onUseServer,
  onKeepMine,
}: {
  current: JudgmentDraft;
  onUseServer: () => void;
  onKeepMine: () => void;
}) {
  const { t, formatDateTime } = useI18n();
  const time = current.draft_saved_at ? formatDateTime(current.draft_saved_at, { hour: "2-digit", minute: "2-digit" }) : t(MISSING_LABEL_KEY.unrecorded);
  return (
    <div
      role="alert"
      data-testid="draft-conflict"
      className="mt-3 border border-[oklch(var(--color-warning))] bg-[oklch(var(--color-surface-2))] px-3 py-2 text-sm"
    >
      <p className="font-semibold text-[oklch(var(--color-ink))]">
        <span aria-hidden="true">! </span>
        {t("judgment.draft.conflict_title", { time })}
      </p>
      <p className="mt-1 text-[oklch(var(--color-ink-muted))]">{t("judgment.draft.conflict_body")}</p>
      <p className="mt-2 text-2xs uppercase font-mono text-[oklch(var(--color-ink-subtle))]">{t("judgment.draft.server_version")}</p>
      {current.draft_verdict && (
        <p className={`text-xs ${verdictInk(current.draft_verdict)}`}>
          <span aria-hidden="true">{verdictGlyph(current.draft_verdict)} </span>
          <DomainEnum namespace="judgment.verdicts" value={current.draft_verdict} />
        </p>
      )}
      <blockquote className="mt-1 pl-3 border-l-2 border-[oklch(var(--color-ink))] font-serif text-quote text-[oklch(var(--color-ink))] whitespace-pre-wrap">
        {current.notes || t("judgment.draft.empty_text")}
      </blockquote>
      <div className="mt-2 flex flex-wrap justify-end gap-2">
        <Button type="button" size="sm" variant="secondary" onClick={onUseServer}>
          {t("judgment.draft.use_server")}
        </Button>
        <Button type="button" size="sm" variant="secondary" onClick={onKeepMine}>
          {t("judgment.draft.keep_mine")}
        </Button>
      </div>
    </div>
  );
}
