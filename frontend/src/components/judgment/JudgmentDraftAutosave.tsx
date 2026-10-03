"use client";

import { useEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import type { JudgmentDetail, JudgmentDraft, JudgmentDraftConflict } from "@soulledger/core/api/judgment";
import { judgmentKeys } from "@soulledger/core/query_keys";
import { useSaveJudgmentDraft } from "@soulledger/core/hooks/useJudgments";
import { useI18n } from "@/src/contexts/I18nContext";
import { Button } from "@/src/components/ui/Button";
import { DomainEnum } from "@/src/components/ui/DomainValue";
import { VerdictBadge } from "@/src/components/ui/StatusBadge";
import { MISSING_LABEL_KEY } from "@/src/lib/domainDisplay";
import { placementDraftFields, type Placement } from "@/src/components/judgment/JudgmentPlacement";
import { prefersReducedMotion } from "@/lib/motion";

/**
 * 丁 · 判词的自动保存(`PATCH /judgment/{id}/draft/`),连同 戊 · 发落 的选择(目的地、刑期、永恒):
 * 同一个请求、同一个版本号,所以发落的冲突与判词的冲突是同一个 409、同一个冲突条。
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
  placement,
  enabled,
}: {
  judgmentId: string;
  notes: string;
  verdict: string;
  /** 戊 · 发落 的选择;不是为 `verdict` 选的存空(`placementDraftFields`)。 */
  placement: Placement;
  /** 未结案且持 judgment.execute。 */
  enabled: boolean;
}) {
  const queryClient = useQueryClient();
  const save = useSaveJudgmentDraft(judgmentId);
  const [editSeq, setEditSeq] = useState(0);
  const [status, setStatus] = useState<DraftStatus>("idle");
  const [conflict, setConflict] = useState<JudgmentDraft | null>(null);
  /** 最后一次**存成功**(或改用对方版本)时的编辑序号。比它新的编辑就是「还没存上」。 */
  const [settledSeq, setSettledSeq] = useState(0);
  /** 存成功的次数 —— 「已保存」每次闪一下的触发。不从 status 的 saving → idle 推:快的保存两次更新会并成一次渲染。 */
  const [saves, setSaves] = useState(0);
  /** 最后一次**发出去**的编辑序号。只有比它新的编辑才值得再存。 */
  const attempted = useRef(0);
  const saving = save.isPending;

  useEffect(() => {
    if (!enabled || conflict || saving || status === "concluded" || editSeq <= attempted.current) return;
    const timer = setTimeout(() => {
      const cached = queryClient.getQueryData<JudgmentDetail>(judgmentKeys.detail(judgmentId));
      const seq = editSeq;
      attempted.current = seq;
      setStatus("saving");
      save.mutate(
        {
          version: cached?.draft_version ?? 0,
          notes,
          draft_verdict: (verdict || null) as Verdict | null,
          ...placementDraftFields(placement, verdict),
        },
        {
          onSuccess: () => {
            setStatus("idle");
            setSettledSeq(seq);
            setSaves((n) => n + 1);
          },
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
  }, [enabled, conflict, saving, status, editSeq, notes, verdict, placement, judgmentId, queryClient]);

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
    saves,
    conflict,
    /** 动过、还没存上(在去抖里、正在存、或存失败)。审判台 769–1279 草稿收起时,开关上靠它挂 ◐。 */
    unsaved: editSeq > settledSeq,
    markEdited: () => setEditSeq((n) => n + 1),
    /** 改用对方的版本:缓存与版本号跟过去,不再存。调用方负责把判词框换成 `draft.notes`。 */
    acceptTheirs: (): JudgmentDraft | null => {
      if (!conflict) return null;
      adopt(conflict, true);
      attempted.current = editSeq;
      setSettledSeq(editSeq);
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

/** 「已保存」闪一下多久:v3 0→1→0 各 160ms;减少动态效果下静态 1.5s。 */
export const SAVED_FLASH_MS = { motion: 320, reduced: 1500 } as const;

/**
 * 判词框下的状态行(规范 v3「草稿保存」):每次存成功,「已保存」闪一下(opacity 0→1→0,
 * 160 进场 + 160 出场;减少动态效果时静态显示 1.5s 后移除),不再常驻 v2 的「已自动保存 HH:MM」——
 * 那个时间挪到 丁 的标题行(`DraftSavedAt`)。「保存中…」「自动保存未成功」「已结案」照旧常驻:
 * 失败与冻结是要读到的状态,不是一闪而过的回执。容器一直在,`aria-live` 才念得出后来塞进去的字。
 */
export function DraftStatusLine({ status, saves }: { status: DraftStatus; saves: number }) {
  const { t } = useI18n();
  const [seen, setSeen] = useState(saves);
  const [flash, setFlash] = useState(0);
  if (seen !== saves) {
    setSeen(saves);
    setFlash(saves);
  }
  const reduced = flash > 0 && prefersReducedMotion();
  useEffect(() => {
    if (!flash) return;
    const timer = setTimeout(() => setFlash(0), reduced ? SAVED_FLASH_MS.reduced : SAVED_FLASH_MS.motion);
    return () => clearTimeout(timer);
  }, [flash, reduced]);

  let text: string | null = null;
  if (status === "saving") text = t("judgment.draft.saving");
  else if (status === "failed") text = t("judgment.draft.save_failed");
  else if (status === "concluded") text = t("judgment.draft.concluded");
  return (
    <p
      data-testid="draft-status"
      aria-live="polite"
      className={`mt-1 min-h-4 text-right font-mono text-2xs ${
        status === "failed" ? "text-[oklch(var(--color-danger))]" : "text-[oklch(var(--color-ink-subtle))]"
      }`}
    >
      {status === "failed" && <span aria-hidden="true">! </span>}
      {text}
      {!text && flash > 0 && (
        <span key={flash} data-testid="draft-saved-flash" className={reduced ? undefined : "inline-block animate-saved-flash"}>
          {t("judgment.draft.saved_flash")}
        </span>
      )}
    </p>
  );
}

/** 最后一次存上的时间(服务端 `draft_saved_at`),放在 丁 的标题行 —— 与 戊 的「已自动保存 HH:MM」同一处、同一档字。 */
export function DraftSavedAt({ savedAt }: { savedAt: string | null | undefined }) {
  const { t, formatDateTime } = useI18n();
  if (!savedAt) return null;
  return (
    <span data-testid="draft-saved-at">
      {t("judgment.draft.saved_at", { time: formatDateTime(savedAt, { hour: "2-digit", minute: "2-digit" }) })}
    </span>
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
        <p className="text-xs">
          <VerdictBadge verdict={current.draft_verdict} />
        </p>
      )}
      <blockquote className="mt-1 pl-3 border-l-2 border-[oklch(var(--color-ink))] font-serif text-md font-normal text-[oklch(var(--color-ink))] whitespace-pre-wrap">
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
