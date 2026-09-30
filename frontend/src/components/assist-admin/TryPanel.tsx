"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import type { AssistStreamEnd, AssistTryStreamEvent } from "@soulledger/core/api/assist-stream";
import {
  assistAdminApi,
  assistAdminErrorCode,
  type AssistAdminBackup,
  type AssistAdminCandidate,
  type AssistAdminConfig,
} from "@soulledger/core/api/assist-admin";
import { useI18n } from "@/src/contexts/I18nContext";
import { Button } from "@/src/components/ui/Button";
import { TextField } from "@/src/components/ui/Field";
import { StreamingText, WaitingDots, webStreamFetch } from "@/src/components/assist/StreamingText";
import { MONO, SUBTLE, Section, count } from "./parts";

type Side = "soul" | "officer";
type TryDone = Extract<AssistTryStreamEvent, { event: "done" }>;

/** Where one try got to. Times are ms from sending; `first` is the first text. */
interface Run {
  side: Side;
  text: string;
  sent: number;
  first: number | null;
  slow: boolean;
  end:
    | { kind: "done"; result: TryDone }
    | { kind: "stopped"; at: number }
    | { kind: "interrupted"; at: number; detail: string }
    | null;
}

/** 流式输出 A1: past this with no text, 「还在查……」. */
const SLOW_MS = 20_000;
const secs = (ms: number) => (ms / 1000).toFixed(1);

/**
 * 试问 (plan §3.3, canvas 1a right column): one real question as the eval soul or
 * the eval officer. Uses the unsaved connection draft when there is one, like the
 * connectivity test. The backend returns tool names only, never their results.
 *
 * Streamed like the two ask panels (canvas「流式输出」M frames): the send button turns into
 * 「■ 停止」, Esc in the question stops, and a mono ink3 line under the answer says what the
 * stream did — first text, where it stopped or broke, and (this page only) primary or backup
 * and why it switched.
 */
export function TryPanel({
  config,
  backup,
  draftConnection,
}: {
  config: AssistAdminConfig;
  backup: AssistAdminBackup | undefined;
  draftConnection: AssistAdminCandidate;
}) {
  const { t } = useI18n();
  const [side, setSide] = useState<Side>("soul");
  const [question, setQuestion] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [run, setRun] = useState<Run | null>(null);
  const controller = useRef<AbortController | null>(null);
  useEffect(() => () => controller.current?.abort(), []);

  const hasDraft = Object.keys(draftConnection).length > 0;
  const missing = side === "soul" ? config.eval_soul_account == null : config.eval_officer == null;
  const reason = missing ? t(side === "soul" ? "assist_admin.identities.soul_missing" : "assist_admin.identities.officer_missing") : null;
  const busy = run !== null && run.end === null;
  // 「已等 x s」 counts up while there is no text yet (M frames); the tick stops at the first text.
  const waiting = run !== null && run.end === null && run.first === null;
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!waiting) return;
    const tick = setInterval(() => setNow(Date.now()), 100);
    return () => clearInterval(tick);
  }, [waiting]);

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const q = question.trim();
    if (!q || missing || busy) return;
    setError(null);
    const mine = new AbortController();
    controller.current = mine;
    const sent = Date.now();
    let text = "";
    let first: number | null = null;
    let last: AssistTryStreamEvent | null = null;
    setRun({ side, text: "", sent, first: null, slow: false, end: null });
    const slow = setTimeout(() => setRun((r) => (r && !r.text ? { ...r, slow: true } : r)), SLOW_MS);
    const onEvent = (event: AssistTryStreamEvent) => {
      if (controller.current !== mine) return;
      last = event;
      if (event.event === "delta") {
        text += event.text;
        first ??= Date.now() - sent;
        setRun((r) => (r ? { ...r, text, first, slow: false } : r));
      }
    };
    const finish = (how: AssistStreamEnd) => {
      if (controller.current !== mine) return;
      const end = last as AssistTryStreamEvent | null;
      const at = Date.now() - sent;
      if (end?.event === "done") setRun((r) => r && { ...r, text: end.answer, end: { kind: "done", result: end } });
      else if (how === "stopped") setRun((r) => r && { ...r, end: { kind: "stopped", at } });
      else if (text) setRun((r) => r && { ...r, end: { kind: "interrupted", at, detail: end?.event === "error" ? end.detail : "" } });
      else {
        setRun(null);
        setError(t("assist_admin.errors.assistant_unavailable"));
      }
    };
    assistAdminApi
      .tryStream(webStreamFetch, { side, question: q, ...(hasDraft ? { candidate: draftConnection } : {}) }, mine, onEvent)
      .then(finish, (err: unknown) => {
        if (controller.current !== mine) return;
        setRun(null);
        const code = assistAdminErrorCode(err);
        setError(t(code ? `assist_admin.errors.${code}` : "assist_admin.errors.try_failed"));
      })
      .finally(() => clearTimeout(slow));
  };
  const stop = () => controller.current?.abort();

  const result = run?.end?.kind === "done" ? run.end.result : null;
  const tokens = result ? Object.values(result.tokens).reduce((a, b) => a + (Number(b) || 0), 0) : 0;

  /** The technical line (M frames). Only this page names primary / backup and the switch. */
  const techLine = (() => {
    if (!run) return null;
    if (run.first === null) return waiting ? t("assist_admin.try.waited", { x: secs(Math.max(0, now - run.sent)) }) : null;
    const parts = [t("assist_admin.try.first_text", { t: secs(run.first) })];
    const end = run.end;
    if (!end) parts.push(t("assist_admin.try.chars_out", { n: count([...run.text].length) }));
    if (end?.kind === "stopped") parts.push(t("assist_admin.try.stopped_at", { t: secs(end.at) }));
    if (end?.kind === "interrupted") {
      parts.push(t("assist_admin.try.interrupted_at", { t: secs(end.at) }));
      if (end.detail) parts.push(end.detail);
      parts.push(t("assist_admin.try.no_switch"));
    }
    if (end?.kind === "done") {
      const r = end.result;
      parts.push(t(r.provider_role === "backup" ? "assist_admin.try.role_backup" : "assist_admin.try.role_primary"));
      if (r.fallback_reason === "timeout")
        parts.push(t("assist_admin.try.switched", { t: String(backup?.primary_first_token_seconds ?? config.read_only.primary_first_token_seconds) }));
      else if (r.fallback_reason) parts.push(`${t("assist_admin.usage.fallback")} ${r.fallback_reason}`);
    }
    return parts.join(" · ");
  })();

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
            onKeyDown={(e) => {
              if (e.key === "Escape" && busy) {
                e.preventDefault();
                stop();
              }
            }}
          />
        </div>
        {busy ? (
          <Button type="button" variant="secondary" aria-label={t("officer_assist.stop_aria")} onClick={stop}>
            <span aria-hidden="true">■ </span>
            {t("officer_assist.stop")}
          </Button>
        ) : (
          <Button type="submit" variant="primary" disabled={missing || !question.trim()} aria-describedby={reason ? "aa-try-missing" : undefined}>
            {t("assist_admin.try.ask")}
          </Button>
        )}
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
      {run && (
        <div data-testid="aa-try-result" className="mt-3 grid gap-2" aria-busy={busy || undefined}>
          <p className={`flex justify-between ${SUBTLE}`}>
            <span>
              {t("assist_admin.try.answer")} · {t(`assist_admin.eval.side_${run.side}`)}
              {result && (
                <>
                  {" "}· <span className={MONO}>{result.model}</span>
                </>
              )}
            </span>
            {result && <span className={MONO}>{t("assist_admin.try.meta", { latency: count(result.latency_ms), tokens: count(tokens) })}</span>}
          </p>
          {run.text ? (
            <StreamingText text={run.text} streaming={busy} />
          ) : busy ? (
            <p className="flex items-center gap-2 text-sm text-[oklch(var(--color-ink-muted))]">
              <WaitingDots />
              {run.slow && <span>{t("officer_assist.still_searching")}</span>}
            </p>
          ) : null}
          {run.end?.kind === "stopped" && <p className={SUBTLE}>{t("officer_assist.stopped")}</p>}
          {run.end?.kind === "interrupted" && (
            <p className="text-xs text-[oklch(var(--color-warning))]">
              <span aria-hidden="true">! </span>
              {t("officer_assist.interrupted")}
            </p>
          )}
          {techLine && (
            <p data-testid="aa-try-tech" className={`${MONO} ${SUBTLE}`}>
              {techLine}
            </p>
          )}
          {result && (
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
          )}
        </div>
      )}
    </Section>
  );
}
