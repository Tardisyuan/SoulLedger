"use client";

import { useState } from "react";
import { useI18n } from "@/src/contexts/I18nContext";
import { hallOf } from "./inside";
import { type Answer, type DemoLang, DEMO_USERNAMES, langOf, overreachRecording, read, recording } from "./store";

/**
 * 「越权四连」(be-sec 3.10 第 3 站, 作品集建议 A4): four requests a console never makes, each answered as the recorder was
 * answered (scripts/demo-record.mjs) and replayed as it was. A recording that no longer holds the refusal says so instead
 * of showing one; a request not recorded yet says that.
 *
 * - lateral: the CN judge asks for the EU hall's first soul by id (`recordInside`). 404, not 403: the other hall's record
 *   is not there to be refused, so the answer says nothing about whether it exists. Drawn muted, not red.
 * - vertical: the same judge asks the permission catalogue, a page hidden from their menu.
 * - door: a soul's own token at an officer endpoint; anon: no token at all (both in `data/overreach.<lang>.json`).
 */
type Kind = "lateral" | "vertical" | "door" | "anon";
interface Probe {
  kind: Kind;
  path: string;
  expect: number;
  code: string;
  test: string;
}
const VERTICAL = "/perm/permissions/";
const SOULS = "/souls/";
export const PROBES: Probe[] = [
  { kind: "lateral", path: SOULS, expect: 404, code: "backend/apps/souls/views.py · SoulViewSet.get_queryset → scope_to_tenant", test: "backend/tests/test_the_overreach_tour_tells_the_truth.py" },
  { kind: "vertical", path: VERTICAL, expect: 403, code: "backend/apps/perm/views.py · CanReadPermissionCatalogue", test: "backend/tests/test_perm_prefix_discloses_only_the_catalogue.py" },
  { kind: "door", path: SOULS, expect: 403, code: "backend/apps/soul_accounts/authentication.py · OfficerJWTAuthentication.get_validated_token", test: "backend/tests/test_soul_auth_boundary.py" },
  { kind: "anon", path: SOULS, expect: 401, code: "backend/apps/core/permissions.py · TenantPermission.has_permission", test: "backend/tests/test_the_overreach_tour_tells_the_truth.py" },
];

/** What was recorded for one probe, with the path it was asked at; `null` when the recordings do not hold it. */
async function answerOf(kind: Kind, lang: DemoLang): Promise<(Answer & { path: string }) | null> {
  if (kind === "vertical") return { ...read(await recording("judge", lang), VERTICAL, new URLSearchParams()), path: VERTICAL };
  if (kind === "lateral") {
    const [judge, eu] = await Promise.all([recording("judge", lang), recording("judge_eu", lang)]);
    const probe = hallOf(judge, eu).probe;
    return probe && probe.status !== null ? { status: probe.status, data: probe.body, path: probe.path } : null;
  }
  const doc = (await overreachRecording(lang))?.answers[kind];
  return doc ? { status: doc.s, data: doc.b, path: doc.path } : null;
}

export function OverreachProbe() {
  return (
    <div data-testid="demo-overreach" className="mt-3 flex flex-col gap-3 border-t border-[oklch(var(--color-line))] pt-3">
      {PROBES.map((p) => (
        <ProbeCard key={p.kind} probe={p} />
      ))}
    </div>
  );
}

function ProbeCard({ probe }: { probe: Probe }) {
  const { t, locale } = useI18n();
  const [answer, setAnswer] = useState<(Answer & { path: string }) | null | undefined>(undefined);
  const { kind } = probe;
  const ask = () => void answerOf(kind, langOf(locale)).then(setAnswer);
  const who = kind === "lateral" ? `${DEMO_USERNAMES.judge} (CN)` : kind === "vertical" ? DEMO_USERNAMES.judge : t(`demo.probe.${kind}.who`);
  const shown = kind === "lateral" ? `${SOULS}${t("demo.probe.lateral.target")}/` : probe.path;
  const muted = probe.expect === 404;
  const badge = muted
    ? "border-[oklch(var(--color-ink-muted))] text-[oklch(var(--color-ink-muted))]"
    : "border-[oklch(var(--color-danger))] text-[oklch(var(--color-danger))]";
  return (
    <div data-testid={`demo-overreach-${kind}`} data-probe={kind}>
      <button
        type="button"
        data-testid={`demo-overreach-try-${kind}`}
        onClick={ask}
        aria-expanded={answer !== undefined}
        className="min-h-9 w-full border border-[oklch(var(--color-ink))] px-3 text-left text-sm text-[oklch(var(--color-ink))]"
      >
        {t(kind === "vertical" ? "demo.probe.try" : `demo.probe.${kind}.try`)}
        <span className="block font-mono text-2xs break-all text-[oklch(var(--color-ink-muted))]">
          GET /api/v1{shown} · {who}
        </span>
      </button>
      {/* Each card its own live region: pressing one announces that one's answer, not the other three's. */}
      <div data-testid={`demo-overreach-answer-${kind}`} role="status" className="mt-2">
        {answer === undefined ? null : answer === null ? (
          <p className="m-0 text-xs text-[oklch(var(--color-ink-muted))]">{t("demo.probe.pending")}</p>
        ) : answer.status === probe.expect ? (
          <>
            <p className="m-0 flex flex-wrap items-baseline gap-2 text-sm text-[oklch(var(--color-ink))]">
              <span data-testid={`demo-overreach-status-${kind}`} data-tone={muted ? "muted" : "danger"} className={`border px-1 font-mono text-xs ${badge}`}>
                {answer.status}
              </span>
              {muted && <span className="text-xs text-[oklch(var(--color-ink-muted))]">{t("demo.probe.lateral.quiet")}</span>}
              <span className="font-mono text-2xs break-all text-[oklch(var(--color-ink-muted))]">GET /api/v1{answer.path}</span>
            </p>
            <pre className="mt-2 mb-0 overflow-x-auto bg-[oklch(var(--color-surface-2))] p-2 font-mono text-2xs whitespace-pre-wrap text-[oklch(var(--color-ink))]">
              {JSON.stringify(answer.data, null, 2)}
            </pre>
            <p className="mt-1 mb-0 text-2xs text-[oklch(var(--color-ink-subtle))]">{t("demo.probe.recorded", { user: who })}</p>
            {kind === "vertical" ? (
              <>
                <p className="mt-3 mb-0 text-xs font-semibold text-[oklch(var(--color-ink))]">{t("demo.probe.why_title")}</p>
                <p className="mt-1 mb-0 text-xs text-[oklch(var(--color-ink-muted))]">{t("demo.probe.why_front")}</p>
                <p className="mt-1 mb-0 text-xs text-[oklch(var(--color-ink-muted))]">{t("demo.probe.why_back")}</p>
              </>
            ) : (
              <p className="mt-3 mb-0 text-xs text-[oklch(var(--color-ink-muted))]">{t(`demo.probe.${kind}.why`)}</p>
            )}
            <dl className="mt-2 mb-0 grid grid-cols-[auto_minmax(0,1fr)] gap-x-2 gap-y-1 text-2xs">
              <dt className="text-[oklch(var(--color-ink-subtle))]">{t("demo.probe.code")}</dt>
              <dd className="m-0 font-mono break-all text-[oklch(var(--color-ink))]">{probe.code}</dd>
              <dt className="text-[oklch(var(--color-ink-subtle))]">{t("demo.probe.test")}</dt>
              <dd className="m-0 font-mono break-all text-[oklch(var(--color-ink))]">{probe.test}</dd>
            </dl>
          </>
        ) : (
          <p className="m-0 text-xs text-[oklch(var(--color-ink-muted))]">{t("demo.probe.not_recorded", { status: String(answer.status) })}</p>
        )}
      </div>
    </div>
  );
}
