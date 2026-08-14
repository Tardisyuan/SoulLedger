"use client";

import { DataGrid, EnumBadge, type DataGridColumn, type EnumTone } from "@/components/ui/data-grid";
import { useI18n } from "@/src/contexts/I18nContext";
import { resolveEnumDisplay } from "@/src/lib/domainDisplay";
import { formatHistoricalDate } from "@/lib/utils";
import type { QueueLedger, QueueLedgerRecord, QueuePriorCycle, QueueRealm, QueueSoul } from "@/lib/api";

/**
 * The read-only half of the triage card: everything §4.2 says must be on
 * screen at the moment of decision — identity, the karma ledger, prior cycles,
 * and the realms this verdict can send the soul to.
 *
 * Rendered through the shared data-grid rather than hand-rolled tables: the
 * column taxonomy already owns alignment, mono/sans, and — the part that
 * matters here — the empty-state wording, so "no prior lives" reads as "first
 * cycle" instead of a bare dash. Badge fills come from EnumBadge, which is the
 * only place the 10% status tint is declared (see
 * src/__tests__/dataGridToneContract.test.ts).
 */

/** Karma reads as a signed ledger, so the sign is part of the value, not decoration. */
export function signed(n: number): string {
  return n > 0 ? `+${n}` : String(n);
}

export function karmaTone(n: number): "success" | "error" | "neutral" {
  if (n > 0) return "success";
  if (n < 0) return "error";
  return "neutral";
}

const STATE_TONE: Record<string, EnumTone> = {
  ALIVE: "success",
  JUDGING: "warning",
  DISPOSED: "info",
  REINCARNATING: "info",
  SETTLED: "neutral",
  LOST: "error",
};

export function SoulIdentityPanel({ soul }: { soul: QueueSoul }) {
  const { t } = useI18n();
  const birth = formatHistoricalDate(soul.birth_date);
  const death = formatHistoricalDate(soul.death_date);

  const rows: { label: string; value: string | null }[] = [
    { label: t("judgment.queue.field_birth_name"), value: soul.birth_name || null },
    { label: t("judgment.queue.field_birth"), value: birth },
    { label: t("judgment.queue.field_death"), value: death },
    { label: t("judgment.queue.field_origin"), value: soul.origin_location || null },
  ];

  return (
    <section aria-labelledby="queue-identity-heading" className="rounded-lg border border-[hsl(var(--color-hairline))] bg-[hsl(var(--color-surface-1))] p-4">
      <h3 id="queue-identity-heading" className="text-xs font-semibold uppercase tracking-wide text-[hsl(var(--color-ink-muted))] mb-3">
        {t("judgment.queue.identity")}
      </h3>
      <div className="flex items-center gap-2 flex-wrap mb-3">
        <span className="text-lg font-bold text-[hsl(var(--color-ink))]">{soul.name}</span>
        {/* The state badge carries the translated label alone. §4.6: the raw
            enum and its translation side by side ("ALIVE — 存活") is the leak
            this codebase is trying to stop, so the machine value stays in the
            tooltip.

            `resolveEnumDisplay`, not a bare `t()` template. `t()` echoes its
            key back on a miss, so a state or civilization the bundle does not
            cover put the dotted path `souls.states.ASCENDED` on screen as the
            badge's own text — the same leak in a different costume. The helper
            returns translated "unrecognized" copy instead and keeps the raw
            member in `title`, where it stays diagnosable. */}
        <EnumBadge
          value={{
            tone: STATE_TONE[soul.current_state] ?? "neutral",
            label: resolveEnumDisplay(t, "souls.states", soul.current_state).label,
            title: soul.current_state,
          }}
        />
        <EnumBadge
          value={{
            tone: "neutral",
            label: resolveEnumDisplay(t, "souls.civilizations", soul.civilization).label,
            title: soul.civilization,
          }}
        />
      </div>
      <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
        {rows.map((row) => (
          <div key={row.label}>
            <dt className="text-xs text-[hsl(var(--color-ink-muted))]">{row.label}</dt>
            <dd className={row.value ? "text-[hsl(var(--color-ink))]" : "text-[hsl(var(--color-ink-tertiary))]"}>
              {row.value ?? t("judgment.queue.not_recorded")}
            </dd>
          </div>
        ))}
      </dl>
      {soul.description && (
        <p className="mt-3 text-sm text-[hsl(var(--color-ink-muted))] whitespace-pre-line">{soul.description}</p>
      )}
    </section>
  );
}

export function LedgerPanel({ ledger }: { ledger: QueueLedger }) {
  const { t, formatDateTime } = useI18n();

  const columns: DataGridColumn<QueueLedgerRecord>[] = [
    {
      key: "record_type",
      type: "enum",
      header: t("judgment.queue.ledger_type"),
      value: (row) => ({
        tone: row.record_type === "MERIT" ? "success" : "error",
        label: row.record_type === "MERIT" ? t("judgment.queue.merit") : t("judgment.queue.demerit"),
      }),
    },
    {
      key: "description",
      type: "text",
      header: t("judgment.queue.ledger_description"),
      value: (row) => row.description,
      emptyLabel: t("judgment.queue.not_recorded"),
    },
    {
      key: "weight",
      type: "numeric",
      header: t("judgment.queue.ledger_weight"),
      value: (row) => row.effective_weight ?? row.weight,
      format: signed,
      tone: karmaTone,
      width: "10ch",
    },
    {
      key: "recorded_at",
      type: "timestamp",
      header: t("judgment.queue.ledger_recorded"),
      value: (row) => row.recorded_at,
      format: (value) => formatDateTime(value as string),
      emptyLabel: t("judgment.queue.not_recorded"),
      width: "18ch",
    },
  ];

  return (
    <section aria-labelledby="queue-ledger-heading" className="rounded-lg border border-[hsl(var(--color-hairline))] bg-[hsl(var(--color-surface-1))] p-4">
      <h3 id="queue-ledger-heading" className="text-xs font-semibold uppercase tracking-wide text-[hsl(var(--color-ink-muted))] mb-3">
        {t("judgment.queue.ledger")}
      </h3>
      <div className="flex gap-6 mb-4">
        <div>
          <div className="text-xs text-[hsl(var(--color-ink-muted))]">{t("judgment.queue.merit")}</div>
          <div className="font-mono tabular-nums text-lg text-[hsl(var(--color-status-success))]">{signed(ledger.merit_score)}</div>
        </div>
        <div>
          <div className="text-xs text-[hsl(var(--color-ink-muted))]">{t("judgment.queue.demerit")}</div>
          <div className="font-mono tabular-nums text-lg text-[hsl(var(--color-status-error))]">{signed(-Math.abs(ledger.demerit_score))}</div>
        </div>
        <div>
          <div className="text-xs text-[hsl(var(--color-ink-muted))]">{t("judgment.queue.balance")}</div>
          <div className="font-mono tabular-nums text-lg font-bold text-[hsl(var(--color-ink))]">{signed(ledger.karmic_balance)}</div>
        </div>
      </div>
      <DataGrid<QueueLedgerRecord>
        caption={t("judgment.queue.ledger")}
        columns={columns}
        data={ledger.records}
        density="compact"
        keyExtractor={(row, i) => row.id ?? String(i)}
        emptyMessage={t("judgment.queue.ledger_empty")}
      />
    </section>
  );
}

export function PriorCyclesPanel({ cycles }: { cycles: QueuePriorCycle[] }) {
  const { t, formatDateTime } = useI18n();

  const columns: DataGridColumn<QueuePriorCycle>[] = [
    {
      key: "cycle_count",
      type: "numeric",
      header: t("judgment.queue.cycle"),
      value: (row) => row.cycle_count,
      width: "8ch",
    },
    {
      key: "previous_realm",
      type: "identifier",
      header: t("judgment.queue.from_realm"),
      value: (row) => row.previous_realm,
      emptyLabel: t("judgment.queue.not_recorded"),
    },
    {
      key: "target_realm",
      type: "identifier",
      header: t("judgment.queue.to_realm"),
      value: (row) => row.target_realm,
      emptyLabel: t("judgment.queue.not_recorded"),
    },
    {
      key: "new_identity",
      type: "text",
      header: t("judgment.queue.new_identity"),
      value: (row) => row.new_identity,
      emptyLabel: t("judgment.queue.not_recorded"),
    },
    {
      key: "reincarnated_at",
      type: "timestamp",
      header: t("judgment.queue.reborn_at"),
      value: (row) => row.reincarnated_at,
      format: (value) => formatDateTime(value as string),
      emptyLabel: t("judgment.queue.not_recorded"),
      width: "18ch",
    },
  ];

  return (
    <section aria-labelledby="queue-cycles-heading" className="rounded-lg border border-[hsl(var(--color-hairline))] bg-[hsl(var(--color-surface-1))] p-4">
      <h3 id="queue-cycles-heading" className="text-xs font-semibold uppercase tracking-wide text-[hsl(var(--color-ink-muted))] mb-3">
        {t("judgment.queue.prior_cycles")}
      </h3>
      <DataGrid<QueuePriorCycle>
        caption={t("judgment.queue.prior_cycles")}
        columns={columns}
        data={cycles}
        density="compact"
        keyExtractor={(row, i) => row.id ?? String(i)}
        // "Not yet" rather than "no data" — a soul on its first pass through
        // has no prior lives, which is a fact about the soul, not a gap.
        emptyMessage={t("judgment.queue.cycles_empty")}
      />
    </section>
  );
}

export function RealmOptionsPanel({ realms }: { realms: QueueRealm[] }) {
  const { t } = useI18n();

  return (
    <section aria-labelledby="queue-realms-heading" className="rounded-lg border border-[hsl(var(--color-hairline))] bg-[hsl(var(--color-surface-1))] p-4">
      <h3 id="queue-realms-heading" className="text-xs font-semibold uppercase tracking-wide text-[hsl(var(--color-ink-muted))] mb-1">
        {t("judgment.queue.realm_options")}
      </h3>
      {/* The verdict picks the realm, not the operator — routing is
          DispositionService's job. These are shown so the operator can see
          where each outcome leads before choosing, which is the whole reason
          §4.2 lists "applicable realm options" as decision context. */}
      <p className="text-xs text-[hsl(var(--color-ink-subtle))] mb-3">{t("judgment.queue.realm_options_hint")}</p>
      {realms.length === 0 ? (
        <p className="text-sm text-[hsl(var(--color-ink-tertiary))]">{t("judgment.queue.realms_empty")}</p>
      ) : (
        <ul className="flex flex-wrap gap-1.5">
          {realms.map((realm) => (
            <li key={realm.id}>
              <EnumBadge
                value={{
                  tone: realm.is_eternal ? "warning" : "neutral",
                  label: realm.display_name || realm.name_local || realm.realm_code,
                  title: realm.realm_code,
                }}
              />
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
