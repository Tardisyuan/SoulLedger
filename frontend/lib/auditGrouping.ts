import type { AuditLogEntry } from '@soulledger/core/api/audit'

/**
 * Groups audit rows into events (design doc §9, "events, not writes").
 *
 * The doc's own audit-egy.png count was 20 rows for what turned out to be a
 * handful of user actions — every login writes a `loginlog` row and an
 * `outstandingtoken` row at the same instant, so one event showed up as two
 * database writes. The doc asked whether grouping needs a new backend
 * correlation id or a client-side actor+verb+timestamp heuristic; neither is
 * needed. `AuditLog.trace_id` (backend/apps/audit/models.py) already exists:
 * `_get_trace_id()` (backend/apps/audit/signals.py) assigns one id per HTTP
 * request and caches it on `request._audit_trace_id`, so every write inside
 * one request shares it. Grouping by trace_id is exact, not a heuristic, so
 * there is no "ungroup" affordance to build — there is nothing to get wrong.
 *
 * Entries with no trace_id (blank on rows written outside a request, or on
 * anything created before this field existed) group with nobody: each is its
 * own singleton event rather than being folded into an unrelated row.
 */
export interface AuditGroup {
  /** Stable React key — the trace_id, or the row id for a singleton. */
  key: string
  traceId: string
  /** Earliest timestamp among the group's rows. */
  time: string
  username: string | null
  userDisplay: string
  /** The group's dominant action (its first row's). */
  action: string
  /** Distinct actions across the group's rows — >1 means the action badge should say so. */
  distinctActions: string[]
  /** Distinct resource types touched, e.g. ["loginlog", "outstandingtoken"]. */
  resources: string[]
  /** Mono "resource#id" pairs for every row in the group, in original order. */
  resourceDetail: string
  /** Distinct non-empty descriptions, for building a human summary line. */
  descriptions: string[]
  ip: string | null
  entries: AuditLogEntry[]
}

export function groupAuditLogsByTrace(entries: AuditLogEntry[]): AuditGroup[] {
  const order: string[] = []
  const buckets = new Map<string, AuditLogEntry[]>()

  for (const entry of entries) {
    const key = entry.trace_id ? `trace:${entry.trace_id}` : `single:${entry.id}`
    let bucket = buckets.get(key)
    if (!bucket) {
      bucket = []
      buckets.set(key, bucket)
      order.push(key)
    }
    bucket.push(entry)
  }

  return order.map((key) => {
    const group = buckets.get(key) as AuditLogEntry[]
    const byTimeAsc = [...group].sort((a, b) => a.timestamp.localeCompare(b.timestamp))
    const first = byTimeAsc[0]
    const dedupe = (values: (string | null | undefined)[]) =>
      Array.from(new Set(values.filter((v): v is string => Boolean(v))))

    return {
      key,
      traceId: first.trace_id ?? '',
      time: first.timestamp,
      username: first.username,
      userDisplay: first.user_display,
      action: first.action,
      distinctActions: dedupe(group.map((e) => e.action)),
      resources: dedupe(group.map((e) => e.resource)),
      resourceDetail: group.map((e) => (e.resource_id ? `${e.resource}#${e.resource_id}` : e.resource)).join(', '),
      descriptions: dedupe(group.map((e) => e.description)),
      ip: first.ip_address,
      entries: group,
    }
  })
}

/**
 * 合并同类(第三类 D 组答复:/audit「十行一模一样」)。
 *
 * `groupAuditLogsByTrace` folds the writes of ONE request into one event, and
 * that is exact. This is the second, looser fold: consecutive EVENTS by the
 * same actor, with the same action(s), on the same resource type(s), each
 * within `REPEAT_WINDOW_MS` of the one before it, become one run shown as
 * "×N · 展开". It is a heuristic, so unlike the trace fold it IS reversible —
 * every run expands back to its members.
 *
 * WHY FIVE MINUTES, measured between neighbours rather than from the first:
 * the shape this exists for is a burst — an operator restoring ten rows, a
 * retry loop, a page polling VIEW — whose members land seconds apart. Five
 * minutes covers a human working down a list at a normal pace; the same
 * action an hour later is a separate sitting and keeps its own row. Chaining
 * on the gap means a steady burst of any length stays one run.
 *
 * A run never crosses a local calendar day, so it never straddles one of the
 * page's day headers. Resource IDs are deliberately NOT compared — "restored
 * ten different souls" is the ten identical rows; the IDs are what 展开 shows.
 */
export const REPEAT_WINDOW_MS = 5 * 60 * 1000

export interface AuditRun {
  /** The first member's key — stable while the run is on screen. */
  key: string
  members: AuditGroup[]
}

/** Local calendar day, the unit of the page's group headers. */
export function localDayKey(timestamp: string): string {
  const d = new Date(timestamp)
  return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`
}

const sameKind = (a: AuditGroup, b: AuditGroup) =>
  a.username === b.username &&
  a.distinctActions.join('|') === b.distinctActions.join('|') &&
  a.resources.join('|') === b.resources.join('|')

export function collapseRepeats(groups: AuditGroup[], windowMs = REPEAT_WINDOW_MS): AuditRun[] {
  const runs: AuditRun[] = []
  for (const group of groups) {
    const run = runs[runs.length - 1]
    const prev = run?.members[run.members.length - 1]
    if (
      prev &&
      sameKind(prev, group) &&
      Math.abs(Date.parse(prev.time) - Date.parse(group.time)) <= windowMs &&
      localDayKey(prev.time) === localDayKey(group.time)
    ) {
      run.members.push(group)
    } else {
      runs.push({ key: group.key, members: [group] })
    }
  }
  return runs
}
