"use client";

import { Fragment, useMemo, useState, type ReactNode } from "react";
import type {
  AssistAdminCandidate,
  AssistAdminConfig,
  AssistAdminEvalPreview,
  AssistAdminEvalProblem,
  AssistAdminEvalResult,
  AssistAdminEvalRunDetail,
} from "@soulledger/core/api/assist-admin";
import { assistAdminErrorCode } from "@soulledger/core/api/assist-admin";
import {
  evalRunInFlight,
  useEnsureEvalIdentities,
  useEvalCases,
  useEvalPreview,
  useEvalRun,
  useEvalRuns,
  useStartEval,
} from "@soulledger/core/hooks/useAssistAdmin";
import { useI18n } from "@/src/contexts/I18nContext";
import { Button } from "@/src/components/ui/Button";
import { Modal } from "@/src/components/ui/Modal";
import { MissingValue } from "@/src/components/ui/DomainValue";
import { MONO, MUTED, SUBTLE, Section, count, money, pct } from "./parts";

type Side = "soul" | "officer";
const LABELS = ["A", "B"];

/**
 * Eval identities, then the eval itself (canvas 1b/1c, 1d ⑤⑥). Money actions
 * preview first: 「开跑…」 asks the backend for a quote; the confirm dialog
 * shows it; only the confirm button spends, by sending the quote's token.
 * `afterIdentities` sits between the two — the canvas puts 试问 there.
 */
export function EvalPanel({
  config,
  draftConnection,
  afterIdentities,
}: {
  config: AssistAdminConfig;
  draftConnection: AssistAdminCandidate;
  afterIdentities?: ReactNode;
}) {
  const { t, formatDateTime } = useI18n();
  const ensure = useEnsureEvalIdentities();
  const preview = useEvalPreview();
  const start = useStartEval();
  const runs = useEvalRuns();
  const [side, setSide] = useState<Side>("soul");
  const [compare, setCompare] = useState(false);
  const [quote, setQuote] = useState<AssistAdminEvalPreview | null>(null);
  const [problems, setProblems] = useState<Set<AssistAdminEvalProblem>>(new Set());
  const [selected, setSelected] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  const hasDraft = Object.keys(draftConnection).length > 0;
  const soulMissing = config.eval_soul_account == null || problems.has("no_eval_soul");
  const officerMissing = config.eval_officer == null || problems.has("no_eval_officer");
  const sideMissing = side === "soul" ? soulMissing : officerMissing;

  const createIdentities = () =>
    ensure.mutate(undefined, { onSuccess: () => setProblems(new Set()) });

  const askQuote = () => {
    setError(null);
    const candidates: AssistAdminCandidate[] = compare && hasDraft ? [{}, draftConnection] : [{}];
    preview.mutate(
      { side, candidates },
      {
        onSuccess: (q) => {
          setProblems(new Set(q.problems));
          setQuote(q);
        },
        onError: (err) => {
          const code = assistAdminErrorCode(err);
          setError(t(code ? `assist_admin.errors.${code}` : "assist_admin.errors.preview_failed"));
        },
      }
    );
  };

  const confirm = () => {
    if (!quote?.confirm_token) return;
    start.mutate(quote.confirm_token, {
      onSuccess: (run) => {
        setQuote(null);
        setSelected(run.id);
      },
      onError: (err) => {
        const code = assistAdminErrorCode(err);
        setQuote(null);
        setError(t(code ? `assist_admin.errors.${code}` : "assist_admin.errors.start_failed"));
      },
    });
  };

  return (
    <>
      <Section title={t("assist_admin.sections.identities")} id="aa-identities">
        <p className={SUBTLE}>{t("assist_admin.identities.hint")}</p>
        <ul className="mt-2 grid gap-1 text-sm">
          <li data-testid="aa-identity-soul">
            <span className={soulMissing ? "text-[oklch(var(--color-warning))]" : "text-[oklch(var(--color-success))]"}>
              {soulMissing ? t("assist_admin.identities.missing") : t("assist_admin.identities.ready")}
            </span>{" "}
            {t("assist_admin.identities.soul")}
          </li>
          <li data-testid="aa-identity-officer">
            <span className={officerMissing ? "text-[oklch(var(--color-warning))]" : "text-[oklch(var(--color-success))]"}>
              {officerMissing ? t("assist_admin.identities.missing") : t("assist_admin.identities.ready")}
            </span>{" "}
            {t("assist_admin.identities.officer")}
          </li>
        </ul>
        {(soulMissing || officerMissing) && (
          <div className="mt-2">
            <Button type="button" onClick={createIdentities} disabled={ensure.isPending}>
              {ensure.isPending ? t("assist_admin.identities.creating") : t("assist_admin.identities.create")}
            </Button>
            {ensure.isError && (
              <p role="alert" className="mt-1 text-xs text-[oklch(var(--color-danger))]">
                {t("assist_admin.identities.failed")}{" "}
                <Button type="button" size="sm" variant="ghost" onClick={createIdentities}>
                  {t("assist_admin.retry")}
                </Button>
              </p>
            )}
          </div>
        )}
        {ensure.data && <p className={`mt-2 ${SUBTLE}`}>{ensure.data.description}</p>}
      </Section>

      {afterIdentities}

      <Section title={t("assist_admin.sections.eval")} id="aa-eval">
        <div role="group" aria-label={t("assist_admin.eval.side")} className="flex gap-2">
          {(["soul", "officer"] as const).map((s) => (
            <Button key={s} type="button" size="sm" variant={side === s ? "primary" : "secondary"} aria-pressed={side === s} onClick={() => setSide(s)}>
              {t(`assist_admin.eval.side_${s}`)}
            </Button>
          ))}
        </div>
        <label className="mt-3 flex items-center gap-2 text-sm">
          <input type="checkbox" checked={compare && hasDraft} disabled={!hasDraft} onChange={(e) => setCompare(e.target.checked)} />
          {t("assist_admin.eval.compare")}
        </label>
        {!hasDraft && <p className={SUBTLE}>{t("assist_admin.eval.compare_needs_draft")}</p>}
        <div className="mt-3">
          <Button type="button" onClick={askQuote} disabled={sideMissing} loading={preview.isPending} aria-describedby={sideMissing ? "aa-eval-missing" : undefined}>
            {t("assist_admin.eval.start")}
          </Button>
          {sideMissing && (
            <p id="aa-eval-missing" className="mt-1 text-xs text-[oklch(var(--color-warning))]">
              {t(side === "soul" ? "assist_admin.identities.soul_missing" : "assist_admin.identities.officer_missing")}
            </p>
          )}
          {error && (
            <p role="alert" className="mt-1 text-xs text-[oklch(var(--color-danger))]">
              {error}
            </p>
          )}
        </div>

        <h3 className={`mt-6 text-2xs uppercase ${MUTED}`}>{t("assist_admin.eval.runs")}</h3>
        {runs.data && runs.data.length === 0 && <p className={SUBTLE}>{t("assist_admin.eval.no_runs")}</p>}
        <ul className="mt-1 grid gap-1">
          {(runs.data ?? []).map((run) => (
            <li key={run.id}>
              <button
                type="button"
                aria-pressed={selected === run.id}
                onClick={() => setSelected(run.id)}
                className={`w-full text-left text-xs px-2 py-1 border ${selected === run.id ? "border-[oklch(var(--color-accent))]" : "border-[oklch(var(--color-hairline))]"}`}
              >
                <span className={MONO}>{formatDateTime(run.created_at)}</span> · {t(`assist_admin.eval.status.${run.status ?? "queued"}`)} ·{" "}
                <span className={MONO}>
                  {run.done ?? 0}/{run.total ?? 0}
                </span>{" "}
                · {run.candidates.map((c, i) => `${LABELS[i]} ${c.model}`).join(" · ")}
              </button>
            </li>
          ))}
        </ul>
        {selected != null && <RunDetail id={selected} />}
      </Section>

      <Modal
        isOpen={quote !== null}
        onClose={() => setQuote(null)}
        title={t("assist_admin.eval.confirm_title")}
        footer={
          <div className="flex justify-end gap-2">
            <Button type="button" variant="ghost" onClick={() => setQuote(null)}>
              {t("assist_admin.cancel")}
            </Button>
            <Button type="button" variant="primary" disabled={!quote?.confirm_token} loading={start.isPending} onClick={confirm}>
              {t("assist_admin.eval.confirm")}
            </Button>
          </div>
        }
      >
        {quote && (
          <dl className="grid grid-cols-[7rem_1fr] gap-2 text-sm">
            <dt className={MUTED}>{t("assist_admin.eval.scope")}</dt>
            <dd>{t(`assist_admin.eval.side_${side}`)} · {quote.candidates.map((c) => `${LABELS[c.candidate]} ${c.model}`).join(" · ")}</dd>
            <dt className={MUTED}>{t("assist_admin.eval.requests")}</dt>
            <dd className={MONO} data-testid="aa-quote-asks">
              {t("assist_admin.eval.requests_value", { count: String(quote.asks), max: String(quote.max_asks) })}
            </dd>
            <dt className={MUTED}>{t("assist_admin.eval.estimate")}</dt>
            <dd className={MONO} data-testid="aa-quote-cost">
              {money(quote.estimated_cost)} / {money(quote.spend_cap)}
            </dd>
            {quote.problems.map((p) => (
              <dd key={p} className="col-span-2 text-[oklch(var(--color-warning))]">
                {t(`assist_admin.eval.problem.${p}`)}
              </dd>
            ))}
            <dd className={`col-span-2 ${SUBTLE}`}>{t("assist_admin.eval.not_counted")}</dd>
          </dl>
        )}
      </Modal>
    </>
  );
}

function RunDetail({ id }: { id: number }) {
  const { t } = useI18n();
  const run = useEvalRun(id);
  const cases = useEvalCases();
  const [open, setOpen] = useState<string | null>(null);
  const expected = useMemo(() => new Map((cases.data ?? []).map((c) => [c.id, c.expected_tools ?? []])), [cases.data]);
  const expectedEntries = useMemo(() => new Map((cases.data ?? []).map((c) => [c.id, c.expected_entries ?? []])), [cases.data]);
  const rows = useMemo(() => groupByCase(run.data), [run.data]);

  if (!run.data) return null;
  const detail = run.data;
  return (
    <div className="mt-4" data-testid="aa-run-detail">
      {evalRunInFlight(detail.status) && (
        <p role="status" className={SUBTLE}>
          {t("assist_admin.eval.progress", { done: String(detail.done ?? 0), total: String(detail.total ?? 0) })}
        </p>
      )}
      <div className="grid gap-3 sm:grid-cols-2">
        {detail.summary.map((s) => (
          <dl key={s.candidate} className="border border-[oklch(var(--color-hairline))] p-2 text-xs grid grid-cols-2 gap-1">
            <dt className="col-span-2 text-sm">
              {LABELS[s.candidate]} · <span className={MONO}>{s.model}</span>
            </dt>
            <dt className={MUTED}>{t("assist_admin.eval.tool_accuracy")}</dt>
            <dd className={MONO}>{s.tool_accuracy == null ? <MissingValue kind="unrecorded" /> : pct(s.tool_accuracy)}</dd>
            <dt className={MUTED}>{t("assist_admin.eval.hit_rate")}</dt>
            <dd className={MONO}>{s.phrase_hit_rate == null ? <MissingValue kind="unrecorded" /> : pct(s.phrase_hit_rate)}</dd>
            <dt className={MUTED}>{t("assist_admin.eval.retrieval_hit_rate")}</dt>
            <dd className={MONO} data-testid="aa-retrieval-hit-rate">
              {s.retrieval_hit_rate == null ? <MissingValue kind="unrecorded" /> : pct(s.retrieval_hit_rate)}
            </dd>
            <dt className={MUTED}>{t("assist_admin.eval.latency")}</dt>
            <dd className={MONO}>{s.mean_latency_ms == null ? <MissingValue kind="unrecorded" /> : `${count(Math.round(s.mean_latency_ms))} ms`}</dd>
            <dt className={MUTED}>{t("assist_admin.eval.cost")}</dt>
            <dd className={MONO}>{s.cost == null ? <MissingValue kind="unrecorded" /> : money(s.cost)}</dd>
          </dl>
        ))}
      </div>
      <div className="mt-3 overflow-x-auto">
        <table className="w-full text-xs">
          <thead>
            <tr className={`text-left ${SUBTLE}`}>
              <th className="py-1 font-normal">#</th>
              <th className="py-1 font-normal">{t("assist_admin.eval.question")}</th>
              <th className="py-1 font-normal">{t("assist_admin.eval.expected")}</th>
              <th className="py-1 font-normal">{t("assist_admin.eval.retrieval")}</th>
              {detail.candidates.map((_, i) => (
                <th key={i} className="py-1 font-normal">
                  {t("assist_admin.eval.actual", { label: LABELS[i] })}
                </th>
              ))}
              <th className="py-1 font-normal text-right">{t("assist_admin.eval.latency_tokens")}</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row, n) => {
              const isOpen = open === row.key;
              const wanted = row.caseId != null ? (expectedEntries.get(row.caseId) ?? []) : [];
              const ret = retrievalOf(row.byCandidate, wanted);
              return (
                <Fragment key={row.key}>
                  <tr className="border-t border-[oklch(var(--color-hairline))] align-top">
                    <td className={`py-1 ${MONO}`}>{n + 1}</td>
                    <td className="py-1">
                      <button type="button" aria-expanded={isOpen} onClick={() => setOpen(isOpen ? null : row.key)} className="text-left underline-offset-2 hover:underline">
                        {row.question}
                      </button>
                    </td>
                    <td className={`py-1 ${MONO}`}>{(row.caseId != null ? expected.get(row.caseId) : undefined)?.join(", ") || <MissingValue kind="inapplicable" />}</td>
                    <td className={`py-1 ${MONO}`} data-testid="aa-retrieval-cell">
                      {ret ? (
                        <span className={ret.hit ? "text-[oklch(var(--color-success))]" : "text-[oklch(var(--color-danger))]"}>
                          {ret.hits}/{wanted.length}
                        </span>
                      ) : (
                        <MissingValue kind="inapplicable" />
                      )}
                    </td>
                    {detail.candidates.map((_, i) => (
                      <td key={i} className={`py-1 ${MONO}`}>
                        <Verdict result={row.byCandidate[i]} />
                      </td>
                    ))}
                    <td className={`py-1 text-right ${MONO}`}>
                      {detail.candidates.map((_, i) => {
                        const r = row.byCandidate[i];
                        return (
                          <span key={i} className="block">
                            {LABELS[i]} {r ? `${count(r.latency_ms ?? 0)} ms · ${count(tokenTotal(r))}` : <MissingValue kind="unrecorded" />}
                          </span>
                        );
                      })}
                    </td>
                  </tr>
                  {isOpen && (
                    <tr>
                      <td colSpan={5 + detail.candidates.length} className="pb-2">
                        <div className="row-expand"><div>
                        {ret && <RetrievalDetail wanted={wanted} got={ret.got} allHit={ret.hit} />}
                        <div className="grid gap-2 sm:grid-cols-2">
                          {row.byCandidate.map((r, i) =>
                            r ? (
                              <div key={i} className="border border-[oklch(var(--color-hairline))] p-2">
                                <p className={SUBTLE}>
                                  {LABELS[i]} · {missingOf(r).length ? t("assist_admin.eval.missing", { phrases: missingOf(r).join("、") }) : t("assist_admin.eval.all_hit")}
                                </p>
                                <p className="whitespace-pre-wrap text-sm">{r.answer || r.error}</p>
                              </div>
                            ) : null
                          )}
                        </div>
                        </div></div>
                      </td>
                    </tr>
                  )}
                </Fragment>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/**
 * One 检索 cell per question: retrieval depends only on the embedding settings, so A and B share it
 * (canvas note under the eval table) — read from the first candidate that answered. `retrieval_hit`
 * is the backend's verdict (it also counts the always-sent entry); the count is hits / expected.
 */
function retrievalOf(byCandidate: (AssistAdminEvalResult | undefined)[], wanted: string[]) {
  const r = byCandidate.find((x) => x && x.retrieval_hit != null);
  if (!r || wanted.length === 0) return null;
  const got = Array.isArray(r.retrieved) ? (r.retrieved as string[]) : [];
  const hit = r.retrieval_hit === true;
  return { hit, got, hits: hit ? wanted.length : wanted.filter((e) => got.includes(e)).length };
}

/** Expanded row: expected entries (hit at rank n, or missed in red) beside the actual top k, hits marked. */
function RetrievalDetail({ wanted, got, allHit }: { wanted: string[]; got: string[]; allHit: boolean }) {
  const { t } = useI18n();
  return (
    <div className="mb-2 grid gap-2 sm:grid-cols-2" data-testid="aa-retrieval-detail">
      <div className="border border-[oklch(var(--color-hairline))] p-2">
        <p className={SUBTLE}>{t("assist_admin.eval.expected_entries")}</p>
        <ul className="mt-1 grid gap-0.5">
          {wanted.map((e) => {
            const at = got.indexOf(e);
            return (
              <li key={e} className={MONO}>
                {e}{" "}
                {/* A hit that is not in the top k is the always-sent entry (corpus.PINNED): hit, no rank. */}
                {at < 0 && !allHit ? (
                  <span className="text-[oklch(var(--color-danger))]">{t("assist_admin.eval.entry_missed")}</span>
                ) : (
                  <span className="text-[oklch(var(--color-accent))]">
                    {t("assist_admin.eval.entry_hit")}
                    {at >= 0 && ` · ${at + 1}`}
                  </span>
                )}
              </li>
            );
          })}
        </ul>
      </div>
      <div className="border border-[oklch(var(--color-hairline))] p-2">
        <p className={SUBTLE}>{t("assist_admin.eval.retrieved_top", { k: String(got.length) })}</p>
        <ol className="mt-1 grid gap-0.5">
          {got.map((e, i) => (
            <li key={e} className={`${MONO} ${wanted.includes(e) ? "border-l-2 border-[oklch(var(--color-accent))] pl-1" : MUTED}`}>
              {i + 1} {e}
              {wanted.includes(e) && <span className="text-[oklch(var(--color-accent))]"> {t("assist_admin.eval.entry_hit")}</span>}
            </li>
          ))}
        </ol>
      </div>
    </div>
  );
}

function Verdict({ result }: { result: AssistAdminEvalResult | undefined }) {
  const { t } = useI18n();
  if (!result) return <MissingValue kind="unrecorded" />;
  const tools = Array.isArray(result.tools_called) ? (result.tools_called as string[]).join(", ") : "";
  return (
    <span>
      {tools || <MissingValue kind="inapplicable" />} <span className={result.passed ? "text-[oklch(var(--color-success))]" : "text-[oklch(var(--color-danger))]"}>{result.passed ? t("assist_admin.eval.passed") : t("assist_admin.eval.not_passed")}</span>
    </span>
  );
}

const tokenTotal = (r: AssistAdminEvalResult) =>
  Object.values((r.tokens ?? {}) as Record<string, number>).reduce((a, b) => a + (Number(b) || 0), 0);
const missingOf = (r: AssistAdminEvalResult) =>
  Object.entries((r.included ?? {}) as Record<string, boolean>).filter(([, hit]) => !hit).map(([p]) => p);

function groupByCase(run: AssistAdminEvalRunDetail | undefined) {
  const rows = new Map<string, { key: string; caseId: number | null; question: string; byCandidate: (AssistAdminEvalResult | undefined)[] }>();
  for (const r of run?.results ?? []) {
    const key = r.case != null ? `c${r.case}` : `q${r.question}`;
    const row = rows.get(key) ?? { key, caseId: r.case ?? null, question: r.question, byCandidate: [] };
    row.byCandidate[r.candidate] = r;
    rows.set(key, row);
  }
  return [...rows.values()];
}
