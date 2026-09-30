"use client";

import { useState } from "react";
import {
  assistAdminErrorCode,
  type AssistAdminEmbedding,
  type AssistAdminEmbeddingErrorKind,
  type AssistAdminEmbeddingTest,
} from "@soulledger/core/api/assist-admin";
import { useRebuildAssistEmbedding, useTestAssistEmbedding } from "@soulledger/core/hooks/useAssistAdmin";
import axios from "axios";
import { useI18n } from "@/src/contexts/I18nContext";
import { Button } from "@/src/components/ui/Button";
import { SelectField, TextField } from "@/src/components/ui/Field";
import { ConfirmDialog } from "@/src/components/ui/Modal";
import { MONO, SUBTLE, Section, count } from "./parts";
import { embeddingCandidate, embeddingFingerprint, type EmbeddingDraft, type EmbeddingDraftKey } from "./draft";

/** The kinds Design wrote copy for (1h ④–⑦); `bad_response` / `other` show only their code. */
const KINDS_WITH_COPY = new Set<string>(["connection", "timeout", "model_not_found", "dims_mismatch"]);
const DIMS = [null, 1024, 512];

const WARN = "border-l-2 border-[oklch(var(--color-warning))] pl-3";
const OK = "border-l-2 border-[oklch(var(--color-success))] pl-3";
const BAD = "border-l-2 border-[oklch(var(--color-danger))] pl-3";

/** Saved vectors were made with another model / dims than the saved setting (1h ⑬). */
export const vectorsFromOldModel = (s: AssistAdminEmbedding["status"]) =>
  s.needs_rebuild && s.last_rebuild_model != null && s.last_rebuild_model !== s.model;

/** 「需要重建」 at the top of the page too, until the rebuild is done (1a 六, 1j). */
export function RebuildNotice({ embedding }: { embedding: AssistAdminEmbedding }) {
  const { t } = useI18n();
  if (!vectorsFromOldModel(embedding.status)) return null;
  return (
    <div role="note" data-testid="aa-rebuild-notice" className={`mb-4 text-sm ${WARN}`}>
      <p>{t("assist_admin.embedding.needs_rebuild")}</p>
      <p className={SUBTLE}>
        {t("assist_admin.embedding.until_rebuilt")} <a href="#aa-embedding" className="underline">{t("assist_admin.embedding.rebuild")}</a>
      </p>
    </div>
  );
}

function KindLine({ kind }: { kind: AssistAdminEmbeddingErrorKind | null | undefined }) {
  const { t } = useI18n();
  if (!kind) return null;
  return (
    <p>
      {KINDS_WITH_COPY.has(kind) && `${t(`assist_admin.embedding.kind.${kind}`)} `}
      <span className={MONO}>{kind}</span>
    </p>
  );
}

/**
 * 向量模型 (canvas 1b/1c under 供应商; states 1h/1i; narrow 1j/1k). The fields feed the page's one
 * footer draft (`draft` / `set`); the test result and the rebuild live inside the block. A passing test
 * never rebuilds; the rebuild is its own confirmed action, all-or-nothing on the backend.
 */
export function EmbeddingSection({
  embedding,
  draft,
  set,
  onTested,
}: {
  embedding: AssistAdminEmbedding;
  draft: EmbeddingDraft;
  set: (key: EmbeddingDraftKey, value: unknown) => void;
  onTested: (fingerprint: string | null) => void;
}) {
  const { t, formatDateTime } = useI18n();
  const probe = useTestAssistEmbedding();
  const rebuild = useRebuildAssistEmbedding();
  const [tested, setTested] = useState<{ fp: string; result: AssistAdminEmbeddingTest; at: string } | null>(null);
  const [testError, setTestError] = useState(false);
  const [confirming, setConfirming] = useState(false);

  const value = <K extends EmbeddingDraftKey>(key: K) => (key in draft ? draft[key] : embedding[key]) as EmbeddingDraft[K];
  const shown = (v: unknown) => (typeof v === "number" && Number.isNaN(v) ? "" : String(v ?? ""));
  const num = (raw: string) => (raw === "" ? NaN : Number(raw));

  const dims = value("embedding_dims") ?? null;
  const dimOptions = DIMS.includes(dims) ? DIMS : [...DIMS, dims];
  const stale = tested !== null && tested.fp !== embeddingFingerprint(draft);

  const runTest = () => {
    const fp = embeddingFingerprint(draft);
    setTestError(false);
    probe.mutate(embeddingCandidate(draft), {
      onSuccess: (result) => {
        setTested({ fp, result, at: new Date().toISOString() });
        onTested(result.ok ? fp : null);
      },
      onError: () => {
        setTested(null);
        setTestError(true);
        onTested(null);
      },
    });
  };

  const { status } = embedding;
  const rebuildCode = assistAdminErrorCode(rebuild.error);
  // 409 means another rebuild holds the lock: the refetch its onError starts brings `rebuild_running` back.
  const running = rebuild.isPending || status.rebuild_running;
  // A failed rebuild changed nothing; the 503 names why, and `last_error` keeps it after a reload.
  const failedKind: AssistAdminEmbeddingErrorKind | null =
    rebuildCode === "embedding_unavailable" && axios.isAxiosError(rebuild.error)
      ? ((rebuild.error.response?.data as { error_kind?: AssistAdminEmbeddingErrorKind }).error_kind ?? "other")
      : rebuild.isSuccess
        ? null
        : status.last_error;
  const failed = !running && (failedKind != null || (rebuild.isError && rebuildCode !== "rebuild_running"));

  return (
    <Section title={t("assist_admin.sections.embedding")} id="aa-embedding">
      {vectorsFromOldModel(status) && (
        <div data-testid="aa-embedding-old-model" className={`mb-3 text-sm ${WARN}`}>
          <p>{t("assist_admin.embedding.needs_rebuild")}</p>
          <p className={`${MONO} ${SUBTLE}`}>
            {status.last_rebuild_model} → {status.model}
          </p>
          <p className={SUBTLE}>{t("assist_admin.embedding.until_rebuilt")}</p>
        </div>
      )}

      <div className="grid gap-3">
        <TextField id="aa-emb-url" label={t("assist_admin.embedding.url")} value={value("embedding_url") ?? ""} onChange={(e) => set("embedding_url", e.target.value)} />
        <TextField id="aa-emb-model" label={t("assist_admin.embedding.model")} value={value("embedding_model") ?? ""} onChange={(e) => set("embedding_model", e.target.value)} />
        <SelectField
          id="aa-emb-dims"
          label={t("assist_admin.embedding.dims")}
          description={t("assist_admin.embedding.dims_hint")}
          value={dims == null ? "" : String(dims)}
          onChange={(e) => set("embedding_dims", e.target.value === "" ? null : Number(e.target.value))}
          options={dimOptions.map((d) => ({ value: d == null ? "" : String(d), label: d == null ? t("assist_admin.embedding.dims_native") : String(d) }))}
        />
        <div className="grid gap-3 sm:grid-cols-2">
          <TextField
            id="aa-emb-k"
            type="number"
            min={1}
            max={20}
            step={1}
            label={t("assist_admin.embedding.k")}
            description={t("assist_admin.embedding.k_hint")}
            value={shown(value("retrieval_k"))}
            onChange={(e) => set("retrieval_k", num(e.target.value))}
          />
          <TextField
            id="aa-emb-floor"
            type="number"
            min={-1}
            max={1}
            step={0.01}
            label={t("assist_admin.embedding.floor")}
            description={t("assist_admin.embedding.floor_hint")}
            value={shown(value("retrieval_min_similarity"))}
            onChange={(e) => set("retrieval_min_similarity", num(e.target.value))}
          />
        </div>
      </div>

      <div className="mt-4">
        <Button type="button" onClick={runTest} loading={probe.isPending}>
          {tested ? t("assist_admin.test.again") : t("assist_admin.test.run")}
        </Button>
        {probe.isPending && (
          <p role="status" className={`mt-2 ${SUBTLE}`}>
            {t("assist_admin.embedding.testing")}
          </p>
        )}
        {testError && (
          <p role="alert" className="mt-2 text-xs text-[oklch(var(--color-danger))]">
            {t("assist_admin.errors.test_failed")}
          </p>
        )}
        {tested && !probe.isPending && (
          <div role="status" data-testid="aa-emb-test" className={`mt-3 text-sm ${tested.result.ok ? OK : BAD}`}>
            <p>{tested.result.ok ? t("assist_admin.embedding.test_ok") : t("assist_admin.test.failed")}</p>
            {!tested.result.ok && <KindLine kind={tested.result.error_kind} />}
            <p className={`${MONO} ${SUBTLE}`}>
              {count(tested.result.latency_ms)} ms
              {tested.result.dims != null && ` · ${t("assist_admin.embedding.returned_dims")} ${tested.result.dims}`}
              {tested.result.error_kind === "dims_mismatch" && tested.result.embedding_dims != null && ` ≠ ${tested.result.embedding_dims}`}
              {` · ${formatDateTime(tested.at)}`}
            </p>
            {stale && <p className="text-[oklch(var(--color-warning))]">{t("assist_admin.test.stale")}</p>}
          </div>
        )}
      </div>

      <div className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t border-[oklch(var(--color-hairline))] pt-3">
        <p className={`text-sm ${MONO}`} data-testid="aa-emb-progress">
          {status.embedded === 0 && status.last_rebuild_at == null
            ? t("assist_admin.embedding.none")
            : t("assist_admin.embedding.progress", { n: count(status.embedded), total: count(status.entries) })}
        </p>
        <Button type="button" size="sm" disabled={running} onClick={() => setConfirming(true)}>
          {failed ? t("assist_admin.embedding.retry_rebuild") : t("assist_admin.embedding.rebuild")}
        </Button>
      </div>
      <div className="mt-2 text-sm" data-testid="aa-emb-rebuild-state">
        {running || rebuildCode === "rebuild_running" ? (
          <p role="status">{t("assist_admin.embedding.rebuilding")}</p>
        ) : failed ? (
          <div role="alert" className={BAD}>
            <p>{t("assist_admin.embedding.rebuild_failed")}</p>
            <KindLine kind={failedKind} />
            {!rebuild.isError && status.last_error_at && <p className={`${MONO} ${SUBTLE}`}>{formatDateTime(status.last_error_at)}</p>}
          </div>
        ) : rebuild.isSuccess ? (
          <p role="status" className="text-[oklch(var(--color-success))]">
            {t("assist_admin.embedding.rebuilt")}
          </p>
        ) : null}
        {status.last_rebuild_at && (
          <p className={`${MONO} ${SUBTLE}`}>
            {t("assist_admin.embedding.last_rebuild")} {formatDateTime(status.last_rebuild_at)} · {status.last_rebuild_model}
          </p>
        )}
        {status.needs_rebuild && !vectorsFromOldModel(status) && status.last_rebuild_at != null && (
          <p className={SUBTLE}>{t("assist_admin.embedding.until_rebuilt")}</p>
        )}
      </div>

      <p className={`mt-3 ${SUBTLE}`} data-testid="aa-emb-fallback">
        {t("assist_admin.embedding.fallback_note")}
      </p>

      <ConfirmDialog
        isOpen={confirming}
        title={t("assist_admin.embedding.rebuild_confirm")}
        message={`${status.model} · ${t("assist_admin.embedding.progress", { n: count(status.embedded), total: count(status.entries) })} ${t("assist_admin.embedding.rebuild_body")}`}
        confirmText={t("assist_admin.embedding.rebuild")}
        variant="warning"
        onCancel={() => setConfirming(false)}
        onConfirm={() => {
          setConfirming(false);
          rebuild.mutate();
        }}
      />
    </Section>
  );
}
