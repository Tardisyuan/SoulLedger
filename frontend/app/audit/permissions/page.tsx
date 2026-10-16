"use client";

import { useMemo, useState, type ReactNode } from "react";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { auditApi, type AuditLogEntry } from "@soulledger/core/api";
import { useI18n } from "@/src/contexts/I18nContext";
import { usePlaque } from "@/src/components/plaque/Plaque";
import { useHall } from "@/src/components/plaque/useHall";
import { usePermissions } from "@/src/hooks/usePermissions";
import { PageShell } from "@/src/components/ui/PageShell";
import { EmptyState } from "@/src/components/ui/EmptyState";
import { QueryError } from "@/src/components/ui/PageError";
import { Spinner } from "@/src/components/ui/Spinner";
import { Button } from "@/src/components/ui/Button";
import { DomainEnum, MissingValue } from "@/src/components/ui/DomainValue";
import { FilterChipSelect } from "@/src/components/ui/FilterChip";
import { MenuGloss } from "@/src/components/layout/MenuGloss";
import { Segments } from "@/src/components/dashboard/TrendsPanel";
import { AuditTabs } from "@/src/components/audit/AuditTabs";
import { auditResourceLabel, datePresetStart, PERMISSION_RESOURCES, type DatePreset } from "@/src/components/audit/auditLabels";
import { localDayKey } from "@/lib/auditGrouping";

/** 「显示更多」依次取到的条数;最后一档就是后端的 `TIMELINE_MAX_LIMIT`。 */
const LIMITS = [50, 200, 500] as const;
/** 每条直接展开的变更行数，其余写「另 N 项」。 */
const SHOWN_FIELDS = 3;

/** One change row. `before` is undefined when the entry carries no before (a plain value, or a create). */
interface ChangeRow {
  field: string;
  before?: unknown;
  after?: unknown;
}

/** 信号写 `{field: [old, new]}`,权限授予写 `{field: {old, new}}`;别的形状只当「后」。 */
function changeRows(changes: AuditLogEntry["changes"]): ChangeRow[] {
  if (!changes) return [];
  return Object.entries(changes).map(([field, value]) => {
    if (Array.isArray(value) && value.length === 2) return { field, before: value[0], after: value[1] };
    if (value && typeof value === "object" && "old" in value && "new" in value) {
      const pair = value as { old: unknown; new: unknown };
      return { field, before: pair.old, after: pair.new };
    }
    return { field, after: value };
  });
}

function show(value: unknown): ReactNode {
  if (value === null || value === undefined) return <MissingValue kind="unrecorded" />;
  if (Array.isArray(value)) return value.map((v) => (typeof v === "string" ? v : JSON.stringify(v))).join(", ");
  return typeof value === "string" ? value : JSON.stringify(value);
}

function TimelineEntry({ log }: { log: AuditLogEntry }) {
  const { t, formatDate } = useI18n();
  const isCreate = log.action === "CREATE";
  const rows = changeRows(log.changes);
  const shown = rows.slice(0, SHOWN_FIELDS);
  const more = rows.length - shown.length;
  return (
    <li data-testid="timeline-entry" className="relative pl-6 pb-4">
      {/* 实心点 = 修改 / 删除 / 其余，空心点 = 新建。方角:规范 v2 A2,状态点不用圆角。 */}
      <span
        aria-hidden="true"
        data-dot={isCreate ? "hollow" : "filled"}
        className={`absolute left-[-5px] top-1.5 size-2.5 border-2 border-[oklch(var(--color-ink))] ${
          isCreate ? "bg-[oklch(var(--color-canvas))]" : "bg-[oklch(var(--color-ink))]"
        }`}
      />
      <div className="flex flex-wrap items-baseline gap-x-2 text-sm">
        <time dateTime={log.timestamp} className="font-mono text-xs text-[oklch(var(--color-ink-tertiary))]">
          {formatDate(log.timestamp, { hour: "2-digit", minute: "2-digit" })}
        </time>
        <span className="text-[oklch(var(--color-ink))]">{log.user_display}</span>
        <DomainEnum namespace="audit.actions" value={log.action} className="font-semibold" />
        <span title={log.resource}>{auditResourceLabel(t, log.resource)}</span>
        {log.resource_id && <span className="font-mono text-xs text-[oklch(var(--color-ink-tertiary))]">{`#${log.resource_id}`}</span>}
      </div>
      {shown.length > 0 &&
        (isCreate ? (
          // 新建没有「前」:只列字段名。
          <p data-testid="timeline-fields" className="mt-1 font-mono text-xs text-[oklch(var(--color-ink-muted))]">
            {shown.map((r) => r.field).join(" · ")}
          </p>
        ) : (
          <dl className="mt-1 grid grid-cols-[auto_1fr] gap-x-3 text-xs">
            {shown.map((r) => (
              <div key={r.field} data-testid="timeline-change" className="contents">
                <dt className="text-[oklch(var(--color-ink-subtle))]">{r.field}</dt>
                <dd className="min-w-0 break-all font-mono">
                  {r.before !== undefined && (
                    <>
                      <span className="text-[oklch(var(--color-ink-muted))] line-through">{show(r.before)}</span>
                      {" → "}
                    </>
                  )}
                  <span className="text-[oklch(var(--color-ink))]">{show(r.after)}</span>
                </dd>
              </div>
            ))}
          </dl>
        ))}
      <p className="mt-1 text-xs">
        {more > 0 && (
          <span className="text-[oklch(var(--color-ink-muted))]">{t("audit.timeline.more_fields", { n: String(more) })} · </span>
        )}
        <Link href={`/audit/${log.id}`} className="text-[oklch(var(--color-accent-ink))] underline underline-offset-2">
          {t("audit.timeline.details")}
        </Link>
      </p>
    </li>
  );
}

/**
 * /audit/permissions —「谁、在什么时候、改了谁的权限」(第三十七批 W-9a)。
 * 按日分组的竖线，不是表格;每一步都画出来，不像列表那样折叠 ×N。
 */
export default function PermissionChangesPage() {
  const { t, formatDate } = useI18n();
  usePlaque({ hall: useHall(t("plaque.office.records")) });
  const { hasPermission } = usePermissions();
  const canReadAudit = hasPermission("audit.read");

  const [resource, setResource] = useState("");
  const [action, setAction] = useState("");
  const [datePreset, setDatePreset] = useState<DatePreset>("");
  const [limitStep, setLimitStep] = useState(0);
  const limit = LIMITS[limitStep];
  const changeFilter = <V,>(set: (v: V) => void) => (v: V) => {
    set(v);
    setLimitStep(0);
  };

  const { data: actionValues = [] } = useQuery({
    queryKey: ["audit-actions"],
    queryFn: async () => (await auditApi.actions()).data.map((a) => a.value),
    enabled: canReadAudit,
    staleTime: Infinity,
  });

  const startDate = datePresetStart(datePreset);
  const { data, isPending, isError, refetch } = useQuery({
    queryKey: ["audit-timeline", resource, action, startDate, limit],
    queryFn: async () =>
      (
        await auditApi.timeline({
          limit,
          ...(resource ? { resource } : {}),
          ...(action ? { action } : {}),
          ...(startDate ? { start_date: startDate } : {}),
        })
      ).data,
    enabled: canReadAudit,
    placeholderData: (previous) => previous,
  });
  const returned = data?.length ?? 0;
  // 后端的 `resource` 是 icontains:选「角色」也会拿回「角色权限」,选「菜单」也会拿回「菜单按钮」。
  // 这里只留选中的那一类;「显示更多」和 cap_reached 仍按后端返回的条数算。
  const logs = useMemo(() => (data ?? []).filter((log) => !resource || log.resource === resource), [data, resource]);
  const days = useMemo(() => {
    const out: { key: string; logs: AuditLogEntry[] }[] = [];
    for (const log of logs) {
      const key = localDayKey(log.timestamp);
      const last = out[out.length - 1];
      if (last?.key === key) last.logs.push(log);
      else out.push({ key, logs: [log] });
    }
    return out;
  }, [logs]);

  const title = (
    <>
      {t("audit.title")}
      <MenuGloss path="/audit" />
    </>
  );
  if (!canReadAudit) {
    return (
      <PageShell variant="full" title={title}>
        <EmptyState title={t("audit.access_denied")} reason={t("audit.needs_audit_read")} />
      </PageShell>
    );
  }

  let body: ReactNode;
  if (isError && !data) body = <QueryError onRetry={() => void refetch()} detail={t("audit.timeline.failed")} />;
  else if (isPending) body = <Spinner />;
  else if (logs.length === 0) body = <EmptyState title={t(datePreset ? "audit.timeline.empty" : "audit.timeline.empty_all")} />;
  else
    body = (
      <>
        {days.map((day) => (
          <section key={day.key} className="mb-4">
            <h3 className="mb-2 text-sm font-medium text-[oklch(var(--color-ink))]">
              {formatDate(day.logs[0].timestamp, { year: "numeric", month: "long", day: "numeric", weekday: "short" })}
            </h3>
            <ol className="ml-1 border-l border-[oklch(var(--color-line))]">
              {day.logs.map((log) => (
                <TimelineEntry key={log.id} log={log} />
              ))}
            </ol>
          </section>
        ))}
        {returned >= LIMITS[LIMITS.length - 1] ? (
          <p className="text-xs text-[oklch(var(--color-ink-muted))]">{t("audit.timeline.cap_reached")}</p>
        ) : (
          returned >= limit && (
            <Button type="button" variant="secondary" size="sm" onClick={() => setLimitStep((s) => s + 1)}>
              {t("audit.timeline.show_more")}
            </Button>
          )
        )}
      </>
    );

  return (
    <PageShell
      variant="full"
      title={title}
      tabs={<AuditTabs />}
      filters={
        <>
          <FilterChipSelect
            label={t("audit.filter_resource")}
            value={resource}
            options={[
              { value: "", label: t("audit.timeline.all_resources") },
              ...PERMISSION_RESOURCES.map((r) => ({ value: r, label: auditResourceLabel(t, r) })),
            ]}
            clearLabel={t("filter.clear_one", { name: t("audit.filter_resource") })}
            onChange={changeFilter(setResource)}
          />
          <FilterChipSelect
            label={t("audit.filter_action")}
            value={action}
            options={[
              { value: "", label: t("audit.all_actions") },
              ...actionValues.map((a) => ({ value: a, label: t(`audit.actions.${a}`) })),
            ]}
            clearLabel={t("filter.clear_one", { name: t("audit.filter_action") })}
            onChange={changeFilter(setAction)}
          />
          <Segments<DatePreset>
            label={t("audit.timestamp")}
            value={datePreset}
            options={[
              { key: "", text: t("audit.date_all") },
              { key: "7d", text: t("audit.date_7d") },
              { key: "30d", text: t("audit.date_30d") },
            ]}
            onChange={changeFilter(setDatePreset)}
          />
        </>
      }
    >
      {body}
    </PageShell>
  );
}
