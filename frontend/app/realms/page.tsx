"use client";
import { Fragment, useEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { realmsApi, type Realm, type RealmCapacityResult } from "@soulledger/core/api";
import { CIVILIZATION_OPTIONS } from "@soulledger/core/config/civilizations";
import { useTenant } from "@/src/contexts/TenantContext";
import { useI18n } from "@/src/contexts/I18nContext";
import { Skeleton } from "@/components/ui/skeleton";
import { Castle, Cloud, Flame, CircleDot } from "lucide-react";
import { PageShell } from "@/src/components/ui/PageShell";
import { EmptyState } from "@/src/components/ui/EmptyState";
import { Badge } from "@/src/components/ui/Badge";
import { MenuGloss } from "@/src/components/layout/MenuGloss";
import { DomainEnum, MissingValue } from "@/src/components/ui/DomainValue";
import { QueryError } from "@/src/components/ui/PageError";
import { RequirePermission } from "@/src/components/rbac/RequirePermission";
import { usePermissions } from "@/src/hooks/usePermissions";
import { Drawer } from "@/src/components/ui/Drawer";
import { PermissionDenied } from "@/src/components/rbac/PermissionDenied";
import { realmStationLabel } from "@/src/components/realms/RouteTopology";
import { usePlaque } from "@/src/components/plaque/Plaque";
import { RouteMap } from "@/src/components/realms/RouteMap";
import { buildTopology, isTerminalRealm } from "@/src/lib/routeTopology";

/**
 * 界域(Design A2 · /realms):左边是这个文明的路线图(`RouteMap`,列表 + 连线,只读),
 * 右边是同一批数据的树表(名称 / 代码 / 类型 / 在押 / 容量 / 永恒)。两者都从
 * `buildTopology` / `parent_realm` 来;详情页的行程条仍是 `<RouteTopology mode="route">`,
 * 与这张图共用布局、不共用画法。切换文明只换查看的形状,匾与印仍是自己的文明;
 * 选中段是墨底,不是文明色(规范 v3:文明色只给匾、导航当前项、印、主按钮)。
 *
 * **只有容量可改。** `PATCH /realms/{id}/` 只收 `capacity`(别的字段 400),持
 * `realms.manage`(默认只 ADMIN)的人点容量数字就地改(窄屏从底部抽屉改);其余各列来自
 * 神话语料,不经接口改。不持有的人看到的仍是只读表,表下写明原因。容量降到在押人数以下
 * 是允许的(后端不拒):谁都不挪,之后发落到这里会被拒(409 `realm_full`)—— 编辑时与
 * 保存后都说出来。Design 稿那句「低于在押数的容量会被拒绝」与后端不符,没有照抄。
 *
 * 在押来自 `GET /realms/occupancy/`(未离开的行程站计数,按租户划界)。容量 null
 * 是「未记录」,不是无限。满 / 将满(≥ 90%)写「■ 满」「◐ 将满」—— 字形加字,不靠颜色。
 */

/** The switch's four entries. Keyed by civilization so a fifth one missing here is caught
 *  (src/__tests__/civilizationMapCoverage.test.ts). Short names, as the Design's switch draws them. */
const CIVILIZATION_CONFIG: Record<string, { nameKey: string }> = {
  CHINESE: { nameKey: "realms.switch.CHINESE" },
  EUROPEAN: { nameKey: "realms.switch.EUROPEAN" },
  EGYPTIAN: { nameKey: "realms.switch.EGYPTIAN" },
  GREEK: { nameKey: "realms.switch.GREEK" },
};

/**
 * The realm-type badge, drawn from the VERDICT palette — the domain layer —
 * rather than the system-feedback one it used to borrow. Shown in the tree
 * table's 类型 column for a realm that has no 殿 / 门 / 层 / 道 `kind`.
 *
 * NEUTRAL is the authored dim neutral: `RealmType.NEUTRAL` is a waypoint nobody
 * is sentenced to, so no verdict token can mirror it. Its LABEL is ink-muted
 * rather than ink-tertiary because ink-tertiary on a 10% tint of itself is
 * under the 4.5:1 floor (2.56:1 light).
 *
 * src/__tests__/statusTokenLayering.test.ts holds this map to the rule. It reads
 * these four entries AS TEXT, one line per key, and parses the
 * `x-[oklch(var(--t)/a)]` utilities out of each — so the four lines below stay
 * one-line literals and the alphas stay 0.1 / 0.3 / 1.
 */
const REALM_TYPE_CONFIG: Record<string, { icon: React.ReactNode; className: string }> = {
  HELL: { icon: <Flame className="w-4 h-4" />, className: 'bg-[oklch(var(--color-verdict-failed)/0.1)] border-[oklch(var(--color-verdict-failed)/0.3)] text-[oklch(var(--color-verdict-failed))]' },
  PURGATORY: { icon: <Cloud className="w-4 h-4" />, className: 'bg-[oklch(var(--color-verdict-purgatory)/0.1)] border-[oklch(var(--color-verdict-purgatory)/0.3)] text-[oklch(var(--color-verdict-purgatory))]' },
  BLISS: { icon: <CircleDot className="w-4 h-4" />, className: 'bg-[oklch(var(--color-verdict-passed)/0.1)] border-[oklch(var(--color-verdict-passed)/0.3)] text-[oklch(var(--color-verdict-passed))]' },
  NEUTRAL: { icon: <Castle className="w-4 h-4" />, className: 'bg-[oklch(var(--color-ink-tertiary)/0.1)] border-[oklch(var(--color-ink-tertiary)/0.3)] text-[oklch(var(--color-ink-muted))]' },
};

/** One row of the tree table: a realm and how deep it sits under `parent_realm`. */
interface TreeRow {
  realm: Realm;
  depth: number;
}

/**
 * Depth-first over `parent_realm`, in the API's order at each level. A parent
 * outside this list (another civilization, or deleted) makes the realm a root —
 * and a cycle cannot hang the page: a realm is emitted at most once.
 */
function treeRows(realms: Realm[]): TreeRow[] {
  const ids = new Set(realms.map((r) => r.id));
  const children = new Map<string, Realm[]>();
  const roots: Realm[] = [];
  for (const r of realms) {
    if (r.parent_realm && ids.has(r.parent_realm) && r.parent_realm !== r.id) {
      children.set(r.parent_realm, [...(children.get(r.parent_realm) ?? []), r]);
    } else roots.push(r);
  }
  const out: TreeRow[] = [];
  const seen = new Set<string>();
  const walk = (r: Realm, depth: number) => {
    if (seen.has(r.id)) return;
    seen.add(r.id);
    out.push({ realm: r, depth });
    for (const c of children.get(r.id) ?? []) walk(c, depth + 1);
  };
  roots.forEach((r) => walk(r, 0));
  // Anything only reachable through a cycle is still listed, flat.
  realms.forEach((r) => walk(r, 0));
  return out;
}

function RealmsPageContent() {
  const { t } = useI18n();
  const { user } = useTenant();
  const { hasPermission } = usePermissions();
  const canManage = hasPermission("realms.manage");
  const [picked, setPicked] = useState<string | null>(null);

  const realmsQuery = useQuery({
    queryKey: ["realms", user?.tenant?.code, user?.role],
    queryFn: () => realmsApi.list().then((r) => r.data.results || []),
    enabled: !!user,
  });
  const occupancyQuery = useQuery({
    queryKey: ["realms", "occupancy", user?.tenant?.code],
    queryFn: () => realmsApi.occupancy().then((r) => r.data),
    enabled: !!user,
  });

  const realms = realmsQuery.data ?? [];
  const civilization =
    picked ?? CIVILIZATION_OPTIONS.find((c) => realms.some((r) => r.civilization === c)) ?? CIVILIZATION_OPTIONS[0];
  const own = realms.filter((r) => r.civilization === civilization);
  const occupancy = new Map((occupancyQuery.data ?? []).map((o) => [o.realm_id, o.count]));
  const rows = treeRows(own);
  // 身份带(A2):题「界域 · <所看文明的界域根>」,右栏「在押 <根的在押数>」。根取树的第一行;
  // 在押没取到就不写右栏。
  const root = rows[0]?.realm;
  const rootName = root
    ? realmStationLabel(t, { id: root.id, code: root.realm_code, realm: root, state: "pending" }) ?? root.realm_code
    : undefined;
  const rootHeld = root && occupancyQuery.isSuccess ? String(occupancy.get(root.id) ?? 0) : undefined;
  usePlaque({
    title: rootName ? t("plaque.realms", { root: rootName }) : undefined,
    meta: rootHeld ? t("plaque.held", { n: rootHeld }) : undefined,
  });

  return (
    <PageShell
      variant="full"
      title={
        <>
          {t("realms.title")}
          <MenuGloss path="/realms" />
        </>
      }
      subtitle={t("realms.subtitle")}
      filters={
        <div className="flex flex-wrap items-center gap-3 w-full">
          {/* 选中段是墨底,不是文明色:文明色只给匾、导航当前项、印、主按钮(规范 v3)。 */}
          <div
            role="group"
            aria-label={t("souls.filter_civilization")}
            className="grid grid-cols-4 max-md:w-full md:inline-flex border border-[oklch(var(--color-line-strong))]"
          >
            {Object.entries(CIVILIZATION_CONFIG).map(([civ, config], i) => (
              <button
                key={civ}
                type="button"
                aria-pressed={civ === civilization}
                onClick={() => setPicked(civ)}
                className={`px-4 h-(--control-h-sm) text-sm ${i ? "border-l border-[oklch(var(--color-line-strong))]" : ""} ${
                  civ === civilization
                    ? "bg-[oklch(var(--color-ink))] text-[oklch(var(--color-surface-1))]"
                    : "text-[oklch(var(--color-ink))] hover:bg-[oklch(var(--color-surface-2))]"
                }`}
              >
                {t(config.nameKey)}
              </button>
            ))}
          </div>
          <p className="max-md:hidden text-xs text-[oklch(var(--color-ink-muted))]">{t("realms.switch_hint")}</p>
          {canManage && (
            <p className="max-md:hidden ml-auto text-xs text-[oklch(var(--color-ink-muted))]">{t("realms.manage_hint")}</p>
          )}
        </div>
      }
    >
      {realmsQuery.isError ? (
        <QueryError onRetry={() => realmsQuery.refetch()} />
      ) : realmsQuery.isLoading ? (
        <RealmsSkeleton />
      ) : realms.length === 0 ? (
        <EmptyState title={t("realms.title")} reason={t("realms.no_realms")} />
      ) : own.length === 0 ? (
        <EmptyState title={t(`realms.civilizations.${civilization}`)} reason={t("realms.table.empty_civ")} />
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-[360px_minmax(0,1fr)] gap-4 lg:gap-6 pt-2">
          <section data-testid="realm-topology" className={`${CARD} p-4 space-y-4 min-w-0`}>
            <h2 className="text-lg">{t("realms.map.title")}</h2>
            <RouteMap
              topology={buildTopology(civilization, realms)}
              civilizationName={t(config(civilization))}
              occupancy={occupancyQuery.isError ? undefined : occupancy}
            />
          </section>
          <section className="min-w-0">
            <div className={CARD}>
              <div className="flex flex-wrap items-baseline gap-x-3 px-4 py-4">
                <h2 className="text-lg">{t("realms.tree.title")}</h2>
                <span className="text-xs text-[oklch(var(--color-ink-muted))]">
                  {t(canManage ? "realms.tree.count_editable" : "realms.tree.count", { n: String(rows.length) })}
                </span>
              </div>
              <RealmTree
                rows={rows}
                occupancy={occupancy}
                occupancyFailed={occupancyQuery.isError}
                canManage={canManage}
              />
              <div className="flex flex-wrap gap-x-4 gap-y-1 px-4 py-3 border-t border-[oklch(var(--color-line))] text-xs text-[oklch(var(--color-ink-muted))]">
                <span>{t("realms.tree.legend_full")}</span>
                <span>{t("realms.tree.legend_near")}</span>
                <span>{t("realms.tree.legend_eternal")}</span>
              </div>
            </div>
            <p className="text-2xs text-[oklch(var(--color-ink-subtle))] mt-3">
              {canManage ? t("realms.table.edit_scope") : t("realms.table.read_only")}
            </p>
          </section>
        </div>
      )}
    </PageShell>
  );
}

const CARD = "bg-[oklch(var(--color-surface-1))] border border-[oklch(var(--color-line))]";
const MUTED = "text-[oklch(var(--color-ink-muted))]";
const config = (civ: string) => CIVILIZATION_CONFIG[civ]?.nameKey ?? `realms.civilizations.${civ}`;

/** Blank = null (未记录); otherwise a non-negative whole number, or `undefined` = not valid. */
function parseCapacity(draft: string): number | null | undefined {
  const s = draft.trim();
  if (s === "") return null;
  return /^\d+$/.test(s) ? Number(s) : undefined;
}

/** 将满:在押占容量 ≥ 90%(图例「◐ 将满 = ≥ 90%」)。满了另算。 */
const NEAR = 0.9;
type Load = "full" | "near" | null;
function loadOf(held: number, cap: number | null): Load {
  if (cap === null) return null;
  if (held >= cap) return "full";
  return cap > 0 && held / cap >= NEAR ? "near" : null;
}

/**
 * 树表(≥ 768)与两行卡片(< 768)是同一批行、同一个编辑状态。宽屏在行内改容量,
 * 行下一条提示;窄屏点一行从底部抽屉改(Design A2 393 稿)。
 */
function RealmTree({
  rows,
  occupancy,
  occupancyFailed,
  canManage = false,
}: {
  rows: TreeRow[];
  occupancy: ReadonlyMap<string, number>;
  occupancyFailed: boolean;
  canManage?: boolean;
}) {
  const { t } = useI18n();
  const queryClient = useQueryClient();
  const [editing, setEditing] = useState<{ id: string; via: "row" | "sheet" } | null>(null);
  const [draft, setDraft] = useState("");
  const [saved, setSaved] = useState<RealmCapacityResult | null>(null);
  const save = useMutation({
    mutationFn: ({ id, capacity }: { id: string; capacity: number | null }) =>
      realmsApi.setCapacity(id, capacity).then((r) => r.data),
    onSuccess: (result) => {
      setSaved(result);
      setEditing(null);
      void queryClient.invalidateQueries({ queryKey: ["realms"] });
    },
  });
  const parents = new Set(rows.map((r) => r.realm.parent_realm).filter(Boolean));
  const open = (realm: Realm, via: "row" | "sheet") => {
    setEditing({ id: realm.id, via });
    setDraft(realm.capacity == null ? "" : String(realm.capacity));
    setSaved(null);
    save.reset();
  };
  const cancel = () => setEditing(null);
  const nameOf = (realm: Realm) =>
    realmStationLabel(t, { id: realm.id, code: realm.realm_code, realm, state: "pending" }) ?? realm.realm_code;
  const typeOf = (realm: Realm) => {
    if (realm.kind) return t(`realms.kind.${realm.kind}`);
    const type = REALM_TYPE_CONFIG[realm.realm_type] || REALM_TYPE_CONFIG.NEUTRAL;
    return (
      <Badge glyph={type.icon} className={type.className}>
        <DomainEnum namespace="realms.types" value={realm.realm_type} />
      </Badge>
    );
  };
  const editor = (realm: Realm) => (
    <CapacityEditor
      held={occupancy.get(realm.id) ?? 0}
      draft={draft}
      onDraft={setDraft}
      pending={save.isPending}
      onCancel={cancel}
      onSave={(capacity) => save.mutate({ id: realm.id, capacity })}
    />
  );
  const sheetRealm = editing?.via === "sheet" ? rows.find((r) => r.realm.id === editing.id)?.realm : undefined;
  const th = "text-2xs font-normal uppercase tracking-widest text-[oklch(var(--color-ink-subtle))] text-left";

  /** 在押 / 容量 —— 容量可改时容量数字本身是按钮(1px 点线)。 */
  const heldCap = (realm: Realm, interactive: boolean) => {
    const held = occupancy.get(realm.id) ?? 0;
    const cap = realm.capacity ?? null;
    const load = occupancyFailed ? null : loadOf(held, cap);
    const capText = cap === null ? "—" : String(cap);
    return (
      <>
        <span className="font-mono tabular-nums">
          {occupancyFailed ? <MissingValue kind="unrecorded" reason={t("realms.table.occupancy_failed")} /> : held}
          <span className={MUTED}> / </span>
          {interactive ? (
            <button
              type="button"
              onClick={() => open(realm, "row")}
              aria-label={t("realms.table.edit_capacity_of", { name: nameOf(realm) })}
              className="inline-flex items-center min-h-(--control-h-sm) underline decoration-dotted decoration-1 underline-offset-4"
            >
              {capText}
            </button>
          ) : (
            <span>{capText}</span>
          )}
          {cap === null && <span className="sr-only"> · {t("realms.table.capacity_unrecorded")}</span>}
        </span>
        {load && (
          <span data-load={load} className="inline-block w-11 ml-2 text-left font-sans font-semibold">
            <span aria-hidden="true">{load === "full" ? "■ " : "◐ "}</span>
            {t(load === "full" ? "realms.table.full" : "realms.table.near")}
          </span>
        )}
      </>
    );
  };
  const eternal = (realm: Realm) =>
    realm.is_eternal ? (
      <>
        <span aria-hidden="true">≡ </span>
        {t("realms.table.eternal_yes")}
      </>
    ) : (
      // 「不是永恒」是一个值(false),不是缺值:写「否」,不画缺值的「—」。
      <span className="text-[oklch(var(--color-ink-subtle))]">{t("realms.table.eternal_no")}</span>
    );

  return (
    <>
      <table className="max-md:hidden w-full table-fixed border-collapse text-sm" data-testid="realm-tree">
        <caption className="sr-only">{t("realms.title")}</caption>
        <colgroup>
          <col />
          <col className="w-[120px]" />
          <col className="w-20" />
          <col className="w-[230px]" />
          <col className="w-24" />
        </colgroup>
        <thead>
          <tr className="h-10 border-y border-[oklch(var(--color-line))]">
            <th scope="col" className={`${th} pl-4`}>{t("realms.table.col_name")}</th>
            <th scope="col" className={th}>{t("realms.table.col_code")}</th>
            <th scope="col" className={th}>{t("realms.table.col_kind")}</th>
            <th scope="col" className={`${th} !text-right pr-3`}>{t("realms.table.col_held")}</th>
            <th scope="col" className={`${th} pr-4`}>{t("realms.table.col_eternal")}</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(({ realm, depth }) => {
            const held = occupancy.get(realm.id) ?? 0;
            // 第二次死亡不是地方:拓扑不画它的在押,这里也不计(同一条规则,routeTopology.isTerminalRealm)。
            const noPlace = isTerminalRealm(realm);
            const full = !noPlace && loadOf(held, realm.capacity ?? null) === "full";
            const inline = editing?.via === "row" && editing.id === realm.id;
            return (
              <Fragment key={realm.id}>
                <tr
                  data-realm-row={realm.realm_code}
                  data-depth={depth}
                  data-full={full ? "true" : undefined}
                  className={`h-(--table-row-h) ${inline ? "" : "border-b border-[oklch(var(--color-line))]"}`}
                >
                  <td title={nameOf(realm)} className={`truncate pr-3 ${depth ? "" : "font-semibold"}`} style={{ paddingLeft: 16 + depth * 20 }}>
                    <span aria-hidden="true" className="mr-2 text-[oklch(var(--color-ink-subtle))]">
                      {parents.has(realm.id) ? "▾" : "　"}
                    </span>
                    {nameOf(realm)}
                  </td>
                  <td title={realm.realm_code} className={`truncate pr-3 font-mono text-xs ${MUTED}`}>{realm.realm_code}</td>
                  <td title={realm.kind ? t(`realms.kind.${realm.kind}`) : realm.realm_type} className={`truncate pr-3 ${MUTED}`}>{typeOf(realm)}</td>
                  <td data-testid="realm-held" className="pr-3 text-right whitespace-nowrap">
                    {noPlace ? (
                      <span className={MUTED}>{t("realms.table.not_a_place")}</span>
                    ) : inline ? (
                      editor(realm)
                    ) : (
                      heldCap(realm, canManage)
                    )}
                  </td>
                  <td className={`pr-4 ${MUTED}`}>{eternal(realm)}</td>
                </tr>
                {inline && (
                  <tr className="border-b border-[oklch(var(--color-line))]">
                    <td colSpan={5} className="pb-3 pl-12 pr-4 text-xs bg-[oklch(var(--color-ink)/0.04)]">
                      <EditHint held={held} draft={draft} failed={save.isError} />
                    </td>
                  </tr>
                )}
              </Fragment>
            );
          })}
        </tbody>
      </table>

      <ul className="md:hidden border-t border-[oklch(var(--color-line))]" data-testid="realm-cards">
        {rows.map(({ realm, depth }) => {
          const noPlace = isTerminalRealm(realm);
          const body = (
            <span className={`grid grid-cols-[1fr_auto] items-center gap-x-3 gap-y-0.5 min-h-16 py-2 pr-3 ${depth ? "pl-8" : "pl-3"}`}>
              <span title={nameOf(realm)} className={`truncate ${depth ? "" : "font-semibold"}`}>
                {parents.has(realm.id) && <span aria-hidden="true" className="mr-2 text-[oklch(var(--color-ink-subtle))]">▾</span>}
                {nameOf(realm)}
              </span>
              <span className="whitespace-nowrap text-sm">
                {noPlace ? <span className={MUTED}>{t("realms.table.not_a_place")}</span> : heldCap(realm, false)}
              </span>
              <span title={realm.realm_code} className={`col-span-2 truncate font-mono text-2xs ${MUTED}`}>
                {realm.realm_code} · {realm.kind ? t(`realms.kind.${realm.kind}`) : <DomainEnum namespace="realms.types" value={realm.realm_type} />}
                {realm.is_eternal && <> · ≡ {t("realms.table.eternal_yes")}</>}
              </span>
            </span>
          );
          return (
            <li key={realm.id} data-realm-card={realm.realm_code} className="border-b border-[oklch(var(--color-line))]">
              {canManage && !noPlace ? (
                <button
                  type="button"
                  onClick={() => open(realm, "sheet")}
                  aria-label={t("realms.table.edit_capacity_of", { name: nameOf(realm) })}
                  className="block w-full text-left hover:bg-[oklch(var(--color-surface-2))]"
                >
                  {body}
                </button>
              ) : (
                body
              )}
            </li>
          );
        })}
      </ul>
      {canManage && <p className={`md:hidden px-3 py-2 text-xs ${MUTED}`}>{t("realms.tree.sheet_hint")}</p>}

      <Drawer variant="layer" isOpen={!!sheetRealm} onClose={cancel} title={sheetRealm ? nameOf(sheetRealm) : ""}>
        {sheetRealm && (
          <div className="space-y-3 text-sm">
            {editor(sheetRealm)}
            <EditHint held={occupancy.get(sheetRealm.id) ?? 0} draft={draft} failed={save.isError} />
          </div>
        )}
      </Drawer>

      {saved && (
        <p data-testid="capacity-saved" role="status" className={`text-xs px-4 py-2 ${MUTED}`}>
          {saved.is_full
            ? t("realms.table.saved_full", {
                code: saved.realm_code,
                held: String(saved.held),
                cap: String(saved.capacity ?? ""),
              })
            : t("realms.table.saved", { code: saved.realm_code })}
        </p>
      )}
    </>
  );
}

/** 编辑态:「在押 /」+ 输入框 + ✓ + ✕。Enter 保存、Esc 取消。 */
function CapacityEditor({
  held,
  draft,
  onDraft,
  pending,
  onCancel,
  onSave,
}: {
  held: number;
  draft: string;
  onDraft: (v: string) => void;
  pending: boolean;
  onCancel: () => void;
  onSave: (capacity: number | null) => void;
}) {
  const { t } = useI18n();
  const value = parseCapacity(draft);
  const input = useRef<HTMLInputElement>(null);
  // 点开就能打字:焦点送进输入框(内联编辑打开时的规定动作,不是页面加载抢焦点)。
  useEffect(() => input.current?.focus(), []);
  const submit = () => {
    if (value !== undefined && !pending) onSave(value);
  };
  return (
    <span className="inline-flex items-center justify-end gap-2" data-testid="capacity-editor">
      <span className="font-mono tabular-nums">
        {held} <span className={MUTED}>/</span>
      </span>
      <input
        ref={input}
        type="number"
        min={0}
        step={1}
        inputMode="numeric"
        value={draft}
        onChange={(e) => onDraft(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            submit();
          } else if (e.key === "Escape") {
            e.preventDefault();
            onCancel();
          }
        }}
        aria-label={t("realms.table.capacity_label")}
        placeholder={t("realms.table.capacity_unrecorded")}
        className="w-16 h-(--control-h-sm) rounded-(--radius-control) border border-[oklch(var(--color-ink))] bg-[oklch(var(--color-surface-1))] px-2 text-right font-mono outline-none focus:shadow-[0_0_0_2px_oklch(var(--color-focus)/0.35)]"
      />
      <button
        type="button"
        aria-label={t("common.save")}
        disabled={value === undefined || pending}
        onClick={submit}
        className="size-(--control-h-sm) border border-[oklch(var(--color-line-strong))] hover:bg-[oklch(var(--color-surface-2))] disabled:opacity-50"
      >
        <span aria-hidden="true">✓</span>
      </button>
      <button type="button" aria-label={t("common.cancel")} onClick={onCancel} className={`w-5 h-(--control-h-sm) ${MUTED}`}>
        <span aria-hidden="true">✕</span>
      </button>
    </span>
  );
}

/** 编辑态下面那一条:满 / 将满 的后果(按填的数算)、保存失败,右侧键位。 */
function EditHint({ held, draft, failed }: { held: number; draft: string; failed: boolean }) {
  const { t } = useI18n();
  const value = parseCapacity(draft);
  const load = typeof value === "number" ? loadOf(held, value) : null;
  return (
    <span className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
      <span className="flex-1 min-w-0 space-y-1">
        {load === "full" && (
          <span data-testid="capacity-full-warning" className="block">
            <span aria-hidden="true">■ </span>
            {t("realms.table.full_warning", { held: String(held) })}
          </span>
        )}
        {load === "near" && (
          <span data-testid="capacity-near-warning" className="block">
            <span aria-hidden="true">◐ </span>
            {t("realms.table.near_warning", {
              held: String(held),
              cap: String(value),
              pct: String(Math.round((held / (value as number)) * 100)),
            })}
          </span>
        )}
        {failed && (
          <span role="alert" className="block text-[oklch(var(--color-danger))]">
            {t("realms.table.save_failed")}
          </span>
        )}
      </span>
      <span className={`max-md:hidden ${MUTED}`}>{t("realms.table.keys")}</span>
    </span>
  );
}

/** 路线图与树表同时出骨架;文明切换先渲染(它在 filters 槽里,不等数据)。 */
function RealmsSkeleton() {
  return (
    <div aria-busy="true" data-testid="realms-skeleton" className="grid grid-cols-1 lg:grid-cols-[360px_minmax(0,1fr)] gap-6 pt-2">
      <div className="space-y-3">
        {Array.from({ length: 10 }).map((_, i) => (
          <Skeleton key={i} className="h-5 w-3/4" />
        ))}
      </div>
      <div className="space-y-2">
        {Array.from({ length: 8 }).map((_, i) => (
          <Skeleton key={i} className="h-(--table-row-h) w-full" />
        ))}
      </div>
    </div>
  );
}

/* 页级门。**后端才是正解,这里是纵深** —— `apps/realms/views.py` 已经挂了
   `CodenamePermission`,这道门挡不住任何直接打接口的人;它挡的是侧边栏的菜单过滤
   **只藏链接、不挡路由**。`fallback={<PermissionDenied />}` 而不是空白:没有权限的人
   应当看到「你没有这个权限」,而不是一个看起来加载失败的页面。 */
export default function RealmsPage() {
  return (
    <RequirePermission permissions="realms.read" fallback={<PermissionDenied />}>
      <RealmsPageContent />
    </RequirePermission>
  );
}
