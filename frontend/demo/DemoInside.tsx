"use client";

import { useEffect, useMemo, useState, type MouseEvent } from "react";
import { LanguageSwitcher } from "@/components/LanguageSwitcher";
import { LandingHeader } from "@/src/components/landing/Landing";
import { ThemeToggle } from "@/src/components/layout/ThemeToggle";
import { Seal, type SealCiv } from "@/src/components/plaque/Seal";
import { SoulStateBadge } from "@/src/components/ui/StatusBadge";
import { useI18n } from "@/src/contexts/I18nContext";
import stats from "@/src/config/landing-stats.json";
import { ROLE_OF_SKIN, useEnter } from "./DemoEntrances";
import { STEPS, auditFor, awayView, clampStep, hallOf, insideCase, totalOf, type CrossCase, type Hall } from "./inside";
import { type DemoRole, type Recording, langOf, recording } from "./store";

type Row = Record<string, unknown>;
const HALLS = [
  { skin: "cn", role: "judge" },
  { skin: "eu", role: "judge_eu" },
] as const satisfies readonly { skin: SealCiv; role: DemoRole }[];
const ROLE_OF = ROLE_OF_SKIN as Record<string, DemoRole>;
const mono = "font-mono text-2xs text-[oklch(var(--color-ink-muted))]";

/** The recordings this page reads, each `undefined` while loading and `null` if the build has none for it. */
function useRecordings(roles: DemoRole[], lang: "zh" | "en") {
  const [recs, setRecs] = useState<Partial<Record<DemoRole, Recording | null>>>({});
  const key = roles.join(",");
  useEffect(() => {
    let live = true;
    for (const role of key.split(",").filter(Boolean) as DemoRole[]) {
      void recording(role, lang).then(
        (rec) => live && setRecs((r) => ({ ...r, [role]: rec })),
        () => live && setRecs((r) => ({ ...r, [role]: null })),
      );
    }
    return () => {
      live = false;
    };
  }, [key, lang]);
  return recs;
}

/**
 * 「工程视角」(v4 第三十八批): two halls answering the same request side by side, then one cross-hall case in four steps.
 * Everything shown is a recorded answer (`inside.ts`); what the recordings do not hold yet is said, not drawn.
 * A state of the demo's home page (`/#inside`), not a route: the demo adds no route a normal build could reach.
 */
export default function DemoInside({ onHome }: { onHome: () => void }) {
  const { t, locale } = useI18n();
  const lang = langOf(locale);
  const { entering, enter } = useEnter();
  const [pick, setPick] = useState<SealCiv>("cn");
  const [step, setStep] = useState(1);
  const base = useRecordings(["judge", "judge_eu", "admin"], lang);
  const theCase = useMemo(() => (base.judge ? insideCase(base.judge) : null), [base.judge]);
  const awayRole = theCase?.awaySkin ? ROLE_OF[theCase.awaySkin] : undefined;
  const awayRecs = useRecordings(awayRole ? [awayRole] : [], lang);
  const away = awayRole ? (base[awayRole] ?? awayRecs[awayRole]) : undefined;
  const hallName = (skin: string) => (skin === "cn" ? t("demo.home.cta_hall") : t(`demo.home.hall.${skin}`));
  const total = base.admin === undefined ? null : totalOf(base.admin);

  return (
    <div data-civ="all" data-testid="demo-inside" className="flex min-h-dvh flex-col bg-[oklch(var(--color-canvas))]">
      <LandingHeader>
        <span className="max-md:hidden">
          <LanguageSwitcher />
        </span>
        <ThemeToggle />
        <a href={stats.github} target="_blank" rel="noreferrer" className="text-sm text-[oklch(var(--color-ink-muted))] underline-offset-2 hover:underline max-md:hidden">
          GitHub <span aria-hidden="true">↗</span>
        </a>
      </LandingHeader>

      <main className="flex-1 landing-gutter pt-6 pb-8">
        <nav aria-label={t("demo.inside.crumb")} className="text-xs text-[oklch(var(--color-ink-subtle))]">
          <button type="button" onClick={onHome} className="underline-offset-2 hover:underline">{t("demo.inside.crumb")}</button>
          <span aria-hidden="true"> › </span>
          <span>{t("demo.inside.eyebrow")}</span>
        </nav>
        <p className="demo-home-eyebrow m-0 mt-3 text-xs font-semibold max-md:hidden">{t("demo.inside.eyebrow")}</p>
        <h1 className="m-0 mt-1 font-title text-xl text-[oklch(var(--color-ink))]">{t("demo.inside.title")}</h1>
        <p className="m-0 mt-2 max-w-[44em] text-sm text-[oklch(var(--color-ink-muted))]">{t("demo.inside.lede")}</p>

        <p className="m-0 mt-6 flex flex-wrap items-center gap-2 text-xs text-[oklch(var(--color-ink-subtle))]">
          {t("demo.inside.same_request")}
          <code data-testid="demo-inside-request" className="bg-[oklch(var(--color-surface-2))] px-2 py-1 font-mono text-xs text-[oklch(var(--color-ink))]">GET /api/v1/souls/?page=1</code>
        </p>

        <div role="tablist" aria-label={t("demo.inside.pick_hall")} className="mt-3 grid grid-cols-2 border border-[oklch(var(--color-line))] p-1 md:hidden">
          {HALLS.map(({ skin }) => (
            <button
              key={skin}
              type="button"
              role="tab"
              aria-selected={pick === skin}
              data-testid={`demo-inside-pick-${skin}`}
              onClick={() => setPick(skin)}
              className="flex min-h-10 items-center justify-center gap-2 text-sm aria-selected:bg-[oklch(var(--color-surface-2))] aria-selected:text-[oklch(var(--color-ink))] text-[oklch(var(--color-ink-muted))]"
            >
              <Seal size={14} civ={skin} glyphs={null} decorative />
              {t(`demo.home.hall.${skin}`)}
            </button>
          ))}
        </div>

        <div className="mt-3 grid grid-cols-1 gap-4 md:grid-cols-2">
          {HALLS.map(({ skin, role }, i) => {
            const rec = base[role];
            const other = base[HALLS[1 - i].role];
            return (
              <div key={skin} className={pick === skin ? "" : "max-md:hidden"}>
                <HallColumn skin={skin} name={hallName(skin)} rec={rec} hall={rec ? hallOf(rec, other ?? null) : null} total={total} />
              </div>
            );
          })}
        </div>
        <p className="m-0 mt-3 text-xs text-[oklch(var(--color-ink-muted))]">
          <span aria-hidden="true">ⓘ </span>
          {t("demo.inside.narrowed")}
        </p>

        <Flow step={step} setStep={setStep} theCase={theCase} away={away} admin={base.admin} hallName={hallName} />

        <div className="mt-8 flex flex-wrap items-center gap-x-6 gap-y-3 border-t border-[oklch(var(--color-line))] pt-6 text-sm">
          <button
            type="button"
            data-testid="demo-inside-guard"
            disabled={entering !== null}
            onClick={(e: MouseEvent<HTMLButtonElement>) => void enter("admin", e.currentTarget, { guard: true })}
            className="demo-home-peek-link disabled:opacity-60"
          >
            {t("demo.inside.more_guard")} <span aria-hidden="true">→</span>
          </button>
          <a href={`${stats.github}/blob/main/backend/tests/test_tenant_isolation.py`} target="_blank" rel="noreferrer" className="demo-home-peek-link">
            {t("demo.inside.more_code")}
          </a>
          <button type="button" data-testid="demo-inside-home" onClick={onHome} className="demo-home-peek-link md:ml-auto">
            <span aria-hidden="true">← </span>
            {t("demo.inside.back_home")}
          </button>
        </div>
        {/* Under 768 the step buttons are fixed to the bottom: room for them, so the footer links are not under them. */}
        <div aria-hidden="true" className="h-20 md:hidden" />
      </main>
    </div>
  );
}

function HallColumn({ skin, name, rec, hall, total }: { skin: SealCiv; name: string; rec: Recording | null | undefined; hall: Hall | null; total: number | null }) {
  const { t } = useI18n();
  const tenant = (rec?.login.user.tenant as Row | null | undefined)?.code;
  return (
    <section data-civ={skin} data-testid={`demo-inside-hall-${skin}`} className="demo-inside-dossier border border-[oklch(var(--color-line))] bg-[oklch(var(--color-surface-1))] p-4">
      <h2 className="m-0 flex flex-wrap items-center gap-2 font-title text-md text-[oklch(var(--color-ink))]">
        <Seal size={20} civ={skin} glyphs={null} decorative />
        {t("demo.inside.as_judge", { hall: name })}
        {typeof tenant === "string" && <span className={`ml-auto ${mono}`}>tenant={tenant}</span>}
      </h2>
      {hall && hall.count !== null && total !== null && (
        <p data-testid={`demo-inside-count-${skin}`} className="m-0 mt-2 text-xs text-[oklch(var(--color-ink-muted))]">
          {t("demo.inside.count", { n: String(hall.count), total: String(total) })}
        </p>
      )}
      <ul className="m-0 mt-2 list-none p-0">
        {(hall?.rows ?? []).map((row) => (
          <li key={String(row.id)} data-testid="demo-inside-row" className="flex items-center gap-3 border-t border-[oklch(var(--color-line))] py-2">
            <span className="min-w-0 flex-1 truncate font-title text-md text-[oklch(var(--color-ink))]">{String(row.name)}</span>
            <span className={mono}>{String(row.id).slice(0, 8)}</span>
            <SoulStateBadge state={row.current_state as string | null} />
          </li>
        ))}
      </ul>
      {hall?.probe && <Probe probe={hall.probe} />}
    </section>
  );
}

function Probe({ probe }: { probe: NonNullable<Hall["probe"]> }) {
  const { t } = useI18n();
  return (
    <div data-testid="demo-inside-probe" className="mt-3 bg-[oklch(var(--color-surface-2))] p-3">
      <p className="m-0 text-xs text-[oklch(var(--color-ink))]">{t("demo.inside.probe_title")}</p>
      <p className="m-0 mt-2 font-mono text-2xs break-all text-[oklch(var(--color-ink))]">GET /api/v1{probe.path}</p>
      {probe.status === null ? (
        <p data-testid="demo-inside-probe-pending" className="m-0 mt-2 text-xs text-[oklch(var(--color-ink-muted))]">{t("demo.inside.probe_pending")}</p>
      ) : (
        <>
          <p data-testid="demo-inside-probe-status" className="m-0 mt-2 inline-block border border-[oklch(var(--color-danger))] px-1 text-xs text-[oklch(var(--color-danger))]">
            {probe.status === 404 ? t("demo.inside.probe_result", { status: "404" }) : String(probe.status)}
          </p>
          {probe.status !== 404 && <pre className={`m-0 mt-1 whitespace-pre-wrap ${mono}`}>{JSON.stringify(probe.body)}</pre>}
          <p className="m-0 mt-1 text-2xs text-[oklch(var(--color-ink-subtle))]">● {t("demo.inside.recorded_short")}</p>
        </>
      )}
    </div>
  );
}

/** The recorded fields each step stands on: the joint judgment, the seat, the stop it filled, the plan's stops. */
function facts(c: CrossCase, step: number): string[] {
  const awayStop = c.nodes.find((n) => n.tenant_code === c.away);
  const stop = (n: CrossCase["nodes"][number]) => `sentence_node · order=${n.order} · ${n.realm_code} · sentence_years=${n.sentence_years ?? "∞"} · ${n.status}`;
  if (step === 1) return c.cross ? [`cross_tenant_judgment · ${c.cross.title}`, `participant · ${c.away} · node_order=${awayStop?.order ?? "?"}`] : [];
  if (step === 2) return awayStop ? [stop(awayStop)] : [];
  if (step === 3) return [`${c.cross ? `cross_tenant_judgment · status=${c.cross.status}` : ""}`, `sentence_plan ${c.planId.slice(0, 8)} · ${c.soulName}`].filter(Boolean);
  return [`sentence_plan ${c.planId.slice(0, 8)} · status=${c.planStatus}`, ...c.nodes.map(stop)];
}

function Flow({ step, setStep, theCase, away, admin, hallName }: {
  step: number;
  setStep: (n: number) => void;
  theCase: CrossCase | null;
  away: Recording | null | undefined;
  admin: Recording | null | undefined;
  hallName: (skin: string) => string;
}) {
  const { t } = useI18n();
  const awaySkin = theCase?.awaySkin ?? "gr";
  const awayName = hallName(awaySkin);
  const homeName = hallName("cn");
  const vars = { hall: awayName };
  const seen = theCase ? awayView(away ?? null, theCase) : null;
  const audit = theCase ? auditFor(admin ?? null, theCase, step) : null;
  const go = (n: number) => setStep(clampStep(n));
  const body = <p className="m-0 mt-2 font-title text-md text-[oklch(var(--color-ink))]">{t(`demo.inside.step.${step}.body`, vars)}</p>;

  return (
    <section aria-labelledby="demo-inside-flow" className="mt-8">
      <h2 id="demo-inside-flow" className="m-0 font-title text-lg text-[oklch(var(--color-ink))]">{t("demo.inside.flow_title")}</h2>
      <p className="m-0 mt-1 text-sm text-[oklch(var(--color-ink-muted))]">{t("demo.inside.flow_sub", vars)}</p>

      <ol data-testid="demo-inside-steps" className="demo-inside-spine m-0 mt-6 list-none p-0 md:grid md:grid-cols-4">
        {STEPS.map((n) => (
          <li key={n} data-state={n < step ? "done" : n === step ? "now" : "todo"} className="relative flex gap-3 pb-4 md:flex-col md:items-center md:text-center">
            <button type="button" onClick={() => go(n)} aria-current={n === step ? "step" : undefined} className="demo-inside-dot shrink-0" aria-label={t(`demo.inside.step.${n}.name`)}>
              {n}
            </button>
            <span className="min-w-0">
              <span className="block text-sm text-[oklch(var(--color-ink))]">{t(`demo.inside.step.${n}.name`)}</span>
              <span className="block text-xs text-[oklch(var(--color-ink-subtle))]">{t(`demo.inside.step.${n}.who`, vars)}</span>
              {n === step && <span className="block md:hidden">{body}</span>}
            </span>
          </li>
        ))}
      </ol>

      <div className="mt-4 grid grid-cols-1 gap-4 md:grid-cols-[1.1fr_1fr_1fr]">
        <div data-testid="demo-inside-step" className="border border-[oklch(var(--color-line))] p-4 max-md:hidden">
          <p className="m-0 text-xs text-[oklch(var(--color-ink-subtle))]">{t("demo.tour.progress", { n: String(step), total: "4" })}</p>
          <p className="m-0 mt-1 font-title text-lg text-[oklch(var(--color-ink))]">{t(`demo.inside.step.${step}.name`)}</p>
          {body}
          <p className="m-0 mt-2 text-xs text-[oklch(var(--color-ink-muted))]">{t(`demo.inside.step.${step}.who`, vars)}</p>
          {theCase && (
            <ul className="m-0 mt-3 flex list-none flex-col gap-1 p-0">
              {facts(theCase, step).map((f) => (
                <li key={f} className={`bg-[oklch(var(--color-surface-2))] px-2 py-1 break-all ${mono}`}>{f}</li>
              ))}
            </ul>
          )}
        </div>
        <div data-testid="demo-inside-sees" className="border border-[oklch(var(--color-line))] p-4">
          {([["cn", homeName, "home"], [awaySkin, awayName, "away"]] as const).map(([skin, name, side]) => (
            <div key={side} data-civ={skin} className="flex gap-2 border-b border-[oklch(var(--color-line))] py-2 last:border-b-0">
              <Seal size={16} civ={skin} glyphs={null} decorative />
              <span className="min-w-0">
                <span className="block text-sm text-[oklch(var(--color-ink))]">{t("demo.inside.hall_sees", { hall: name })}</span>
                <span className="block text-xs text-[oklch(var(--color-ink-muted))]">{t(`demo.inside.sees.${step}.${side}`)}</span>
              </span>
            </div>
          ))}
          {/* The recorded ground for the last two lines: the other hall's own recording reads the plan and does not list the soul. */}
          {seen && step >= 3 && (
            <p data-testid="demo-inside-away-evidence" className={`m-0 mt-2 ${mono}`}>
              {`${ROLE_OF[awaySkin]}: GET /sentence-plans/${theCase!.planId.slice(0, 8)}… ${seen.readsPlan ? "200" : "—"} · /souls/ ${seen.listsSoul ? "∋" : "∌"} ${theCase!.soulName}`}
            </p>
          )}
        </div>
        <div data-testid="demo-inside-audit" className="border border-[oklch(var(--color-line))] p-4">
          <p className="m-0 text-xs text-[oklch(var(--color-ink-subtle))]">{t("demo.inside.audit_title")}</p>
          {audit === null || audit.length === 0 ? (
            <p data-testid="demo-inside-audit-pending" className="m-0 mt-2 text-xs text-[oklch(var(--color-ink-muted))]">{t("demo.inside.audit_pending")}</p>
          ) : (
            <ul className="m-0 mt-2 list-none p-0">
              {audit.map((r) => (
                <li key={String(r.id)} data-testid="demo-inside-audit-row" className={`border-t border-[oklch(var(--color-line))] py-2 ${mono}`}>
                  <span className="block text-[oklch(var(--color-ink))]">{`${String(r.timestamp).slice(5, 16).replace("T", " ")} · ${r.tenant_code ?? "—"} · ${r.user_display ?? ""}`}</span>
                  <span className="block break-all">{`${r.resource} ${String(r.resource_id).slice(0, 8)} · ${r.action}${changesOf(r)}`}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>

      <div className="demo-inside-nav mt-4 flex items-center gap-3 max-md:fixed max-md:inset-x-0 max-md:bottom-0 max-md:z-10 max-md:border-t max-md:border-[oklch(var(--color-line))] max-md:bg-[oklch(var(--color-canvas))] max-md:p-3">
        <span className="text-xs text-[oklch(var(--color-ink-subtle))] max-md:hidden">{t("demo.tour.progress", { n: String(step), total: "4" })}</span>
        <button type="button" data-testid="demo-inside-restart" onClick={() => go(1)} className="ml-auto text-sm text-[oklch(var(--color-ink-muted))] max-md:hidden">
          {t("demo.inside.restart")}
        </button>
        <button type="button" data-testid="demo-inside-prev" disabled={step === 1} onClick={() => go(step - 1)} className="min-h-11 border border-[oklch(var(--color-line-strong))] px-4 text-sm text-[oklch(var(--color-ink))] disabled:opacity-40 max-md:flex-1">
          {t("demo.tour.prev")}
        </button>
        <button type="button" data-testid="demo-inside-next" disabled={step === 4} onClick={() => go(step + 1)} className="demo-home-cta min-h-11 px-4 text-sm disabled:opacity-40 max-md:flex-[2]">
          {t("demo.tour.next")} <span aria-hidden="true">→</span>
        </button>
      </div>
    </section>
  );
}

function changesOf(row: Row): string {
  const changes = row.changes as Record<string, [unknown, unknown]> | null;
  if (!changes || typeof changes !== "object") return "";
  return Object.entries(changes)
    .slice(0, 2)
    .map(([field, pair]) => ` · ${field}: ${Array.isArray(pair) ? `${String(pair[0] ?? "—").slice(0, 24)} → ${String(pair[1] ?? "—").slice(0, 24)}` : ""}`)
    .join("");
}
