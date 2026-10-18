/**
 * 第四十三批:审批流程按域分段。选站页(O-2,也是「改选」)、流程详情里的分段(O-3)和门口等待的那一块(O-4)。
 *
 * 规则在后端(`apps/workflow/segments.py`),读法在 core(`domain/workflowSegments`,官员台同一份):这里只画。
 * App 只看、只批当前站、只选本域那一段;加减站、再提醒、按默认流程走都在电脑上(Design 回复 O-3:「在电脑上继续」)。
 */
import type { ApprovalNode, ApprovalWorkflow, WorkflowSegment } from "@soulledger/core/api/workflow";
import { workflowApi } from "@soulledger/core/api/workflow";
import { circled, gateView, segmentNodes, segmentRealm, segmentRefusalOf, staleOf, stationNo, type StaleSegment } from "@soulledger/core/domain/workflowSegments";
import { useCallback, useState } from "react";
import { Pressable, Share, StyleSheet, View } from "react-native";

import { formatWhen } from "../format";
import { ActionButton, StateView, detailStateOf } from "../kit";
import { deskUrl } from "../rules";
import { useSession } from "../session";
import { Notice, Screen, SectionLabel, SmallButton, Txt, space, useI18n, useOnline, useRemote, useTheme, useToast } from "../shared";

type T = (key: string, vars?: Record<string, string>) => string;

/** 读的人自己的域(租户代码);没登录时 null。 */
function useMyTenant(): string | null {
  const { state } = useSession();
  return state.status === "signedIn" ? (state.user.tenant?.code ?? null) : null;
}

/** 选站能动的那一段:轮到我选、还没开始(没选 = AWAITING_PICK;选过、改选 = PICKED)。 */
export const pickableSegment = (workflow: Pick<ApprovalWorkflow, "segments">): WorkflowSegment | null =>
  (workflow.segments ?? []).find((s) => s.can_pick && (s.state === "AWAITING_PICK" || s.state === "PICKED")) ?? null;

/** 送回后端的跳过:只有勾掉的、不是终审的站(终审本来就点不动,这里再挡一次,后端也会 400 `final_required`)。 */
export function skipNodeIds(nodes: Pick<ApprovalNode, "id" | "is_required">[], skipped: ReadonlySet<string>): string[] {
  return nodes.filter((n) => !n.is_required && skipped.has(n.id)).map((n) => n.id);
}

/**
 * O-2 选站:本域这一段的勾选列表。默认全选;终审勾灰、点不动,理由写在站名下;「确认」不再二次弹窗。
 * 确认后回到待办,提示「已选站 · 轮到本域时通知你」。带着这一段的 `version` 提交,别人刚改过就 409
 * `segment_changed`:拦下(W-5d),「看现在的选择」换成库里现在的样子再确认,不覆盖。
 * 这一段已经开始(或不是我能选的):只剩流程详情,选站在 App 上不再有入口。
 */
export function PickStations({ id, onDone }: { id: string; onDone: () => void }) {
  const { t } = useI18n();
  const theme = useTheme();
  const toast = useToast();
  const { offline } = useOnline();
  const { state } = useSession();
  const role = state.status === "signedIn" ? state.user.role : "";
  const load = useCallback(async () => (await workflowApi.get(id)).data, [id]);
  const { data, error, reload } = useRemote(load);
  const segment = data ? pickableSegment(data) : null;
  const [skipped, setSkipped] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [stale, setStale] = useState<StaleSegment | null>(null);
  const [failed, setFailed] = useState(false);

  // 勾选从库里来(改选时就是上一次的选择);库里的版本一变(「看现在的选择」重取到别人的改动)就重新从库里来。
  const [seeded, setSeeded] = useState<number | null>(null);
  if (data && segment && seeded !== segment.version) {
    setSeeded(segment.version);
    setSkipped(new Set(segmentNodes(data, segment.order).filter((n) => n.status === "SKIPPED").map((n) => n.id)));
  }

  const view = detailStateOf({ data, error });
  if (view || !data) return <StateView state={view ?? "loading"} onRetry={reload} role={role} area={t("officer_app.areas.todo")} />;
  if (!segment) {
    return (
      <Screen testID="pick-readonly" edges={["left", "right"]}>
        <View style={{ padding: space[5], gap: space[4] }}>
          <SectionLabel>{t("workflow.pick_group.title")}</SectionLabel>
          <Txt variant="title">{data.soul_name ?? ""}</Txt>
        </View>
        <WorkflowSegments workflow={data} />
      </Screen>
    );
  }

  const nodes = segmentNodes(data, segment.order);
  const skippable = nodes.filter((n) => !n.is_required);
  const skipCount = skippable.filter((n) => skipped.has(n.id)).length;
  const before = (data.segments ?? []).filter((s) => s.order < segment.order);
  const toggle = (nodeId: string) =>
    setSkipped((prev) => {
      const next = new Set(prev);
      if (next.has(nodeId)) next.delete(nodeId);
      else next.add(nodeId);
      return next;
    });
  const confirm = () => {
    setBusy(true);
    setFailed(false);
    workflowApi
      .pickSegment(id, segment.order, { skip_node_ids: skipNodeIds(nodes, skipped), version: segment.version })
      .then(() => {
        toast(t("workflow.pick.confirmed"), "success");
        onDone();
      })
      .catch((e: unknown) => {
        const changed = staleOf(segmentRefusalOf(e));
        if (changed) setStale(changed);
        else setFailed(true);
      })
      .finally(() => setBusy(false));
  };

  return (
    <View style={{ flex: 1 }}>
      <Screen testID="pick-stations" edges={["left", "right"]}>
        <View style={{ padding: space[5], gap: space[1], borderBottomWidth: 1, borderBottomColor: theme.hair }}>
          <SectionLabel>{t("workflow.pick_group.title")}</SectionLabel>
          <Txt variant="title">{data.soul_name ?? ""}</Txt>
          {before.length > 0 ? (
            <Txt variant="caption" tone="muted" testID="pick-position">
              {t("workflow.pick.position", {
                order: String(segment.order),
                prev: before.map((s) => segmentRealm(t, s)).join("、"),
                n: String(before.reduce((sum, s) => sum + s.go, 0)),
              })}
            </Txt>
          ) : null}
          {segment.at_gate && segment.gate_days != null ? (
            <Txt variant="bodyLg" testID="pick-at-gate">{t("workflow.pick_group.at_gate", { n: String(segment.gate_days) })}</Txt>
          ) : null}
        </View>
        {stale ? (
          <View testID="pick-stale" style={{ padding: space[5], gap: space[2] }}>
            <Notice tone="neutral">{t("workflow.pick.stale_title")}</Notice>
            {stale.by ? (
              <Txt variant="body" testID="pick-stale-body">
                {t("workflow.pick.stale_body", { by: stale.by, time: stale.at ? formatWhen(stale.at) : "" })}
              </Txt>
            ) : null}
            <SmallButton
              testID="pick-stale-view"
              title={t("workflow.pick.stale_view")}
              onPress={() => {
                setStale(null);
                void reload();
              }}
            />
          </View>
        ) : null}
        <View accessibilityRole="list" accessibilityLabel={t("workflow.pick.title")}>
          {nodes.map((n) => (
            <StationRow key={n.id} node={n} on={!!n.is_required || !skipped.has(n.id)} onToggle={() => toggle(n.id)} />
          ))}
        </View>
        {skipCount > 0 && skipCount === skippable.length ? (
          // W-1b: 只剩终审 —— 提示,不拦。
          <View testID="pick-only-final" style={{ padding: space[5] }}>
            <Notice tone="neutral">{t("workflow.pick.only_final_title")}</Notice>
          </View>
        ) : null}
      </Screen>
      <View testID="pick-bar" style={[styles.bar, { borderTopColor: theme.hair, backgroundColor: theme.s1 }]}>
        <View style={styles.summary}>
          <Txt variant="body" tone="muted" testID="pick-summary" style={{ flex: 1 }}>
            {t("workflow.pick.summary", { go: String(nodes.length - skipCount), skip: String(skipCount) })}
          </Txt>
          {skipCount > 0 ? <SmallButton testID="pick-restore-all" title={t("workflow.pick.restore_all")} onPress={() => setSkipped(new Set())} /> : null}
        </View>
        {failed ? <Notice tone="neg" testID="pick-failed">{t("workflow.segment.error")}</Notice> : null}
        {offline ? <Txt variant="caption" tone="muted" testID="pick-offline">{`◇ ${t("officer_app.offline.no_decide")}`}</Txt> : null}
        <ActionButton
          testID="pick-confirm"
          kind="primary"
          title={t("common.confirm")}
          busy={busy}
          disabled={offline || stale !== null}
          accessibilityHint={offline ? t("officer_app.offline.no_decide") : undefined}
          onPress={confirm}
        />
      </View>
    </View>
  );
}

/** 一站,整行可点。终审:勾灰(不是透明 —— iOS 上 `opacity: 0` 的视图收不到触摸,这里也不需要它)、点不动、理由在下。 */
function StationRow({ node, on, onToggle }: { node: ApprovalNode; on: boolean; onToggle: () => void }) {
  const { t, enumLabel } = useI18n();
  const theme = useTheme();
  const locked = !!node.is_required;
  const who = node.approver_role ? enumLabel("users.roles", node.approver_role).label : null;
  const sub = locked ? t("workflow.pick.final_reason") : [node.court_code, who].filter(Boolean).join(" · ");
  const label = locked ? `${stationNo(node)} · ${node.node_name} · ${t("workflow.pick.final_badge")}` : `${stationNo(node)} · ${node.node_name}`;
  return (
    <Pressable
      testID={`pick-station-${node.id}`}
      accessibilityRole="checkbox"
      accessibilityLabel={label}
      accessibilityState={{ checked: on, disabled: locked }}
      disabled={locked}
      onPress={onToggle}
      style={({ pressed }) => [styles.station, { minHeight: locked ? 72 : 56, borderBottomColor: theme.hair, backgroundColor: pressed ? theme.hair : "transparent" }]}
    >
      <View
        style={[
          styles.box,
          locked
            ? { backgroundColor: theme.inkSubtle, borderColor: theme.inkSubtle }
            : on
              ? { backgroundColor: theme.plaqueFill, borderColor: theme.plaqueFill }
              : { backgroundColor: "transparent", borderColor: theme.inkMuted },
        ]}
      >
        {on ? <Txt variant="body" style={{ color: locked ? theme.s0 : theme.onPlaque }}>✓</Txt> : null}
      </View>
      <View style={{ flex: 1 }}>
        <Txt variant="bodyLg" tone={on ? "ink" : "muted"} style={on ? undefined : styles.struck}>
          {label}
        </Txt>
        {sub ? (
          <Txt variant="caption" tone="muted" testID={locked ? `pick-final-reason-${node.id}` : undefined}>
            {sub}
          </Txt>
        ) : null}
      </View>
    </Pressable>
  );
}

// ── O-3 / O-4:流程详情里的分段 ─────────────────────────────────────────

/** 两种跳过同一个符号 ⤼,文字区分(Design W-3a)。 */
const SKIP_KEY: Record<string, string> = {
  AT_PICK: "workflow.node_state.skipped_at_pick",
  LATER: "workflow.node_state.skipped_later",
};

/** 一站的字形与文字:当前 ◇、待走 ·、已通过 ✓、已驳回 ✕、跳过 ⤼(划线)。状态名走 `enumLabel`,不印原值。 */
export function nodeLook(node: ApprovalNode, isCurrent: boolean, t: T, statusLabel: (raw: string) => string): { glyph: string; text: string; skipped: boolean } {
  if (isCurrent) return { glyph: "◇", text: t("workflow.detail.current"), skipped: false };
  if (node.status === "SKIPPED") {
    const key = SKIP_KEY[node.skip_kind ?? ""];
    return { glyph: "⤼", text: key ? t(key) : statusLabel(node.status), skipped: true };
  }
  if (node.status === "PENDING") return { glyph: "·", text: t("workflow.detail.not_reached"), skipped: false };
  const refused = node.status === "REJECTED" || node.verdict === "FAILED" || node.verdict === "REJECTED";
  return { glyph: refused ? "✕" : "✓", text: statusLabel(node.status), skipped: false };
}

/** 有分段时才画(老流程没有 `segments`):流程详情(O-3)里的那一块,按 `workflowId` 自己取。取不到就不画。 */
export function WorkflowSegmentsFor({ workflowId, onPick }: { workflowId: string; onPick?: () => void }) {
  const load = useCallback(async () => (await workflowApi.get(workflowId)).data, [workflowId]);
  const { data } = useRemote(load);
  if (!data || (data.segments ?? []).length === 0) return null;
  return <WorkflowSegments workflow={data} onPick={onPick} />;
}

/**
 * O-3:每一域一个分段头(序号 · 域名 · 要走 / 默认站数),站号在段内重排;跳过的站划线、不隐藏;已走完的域只留
 * 分段头,点开才展开。停在门口时先画 O-4 那一块。「加减站」卡片只对 `can_adjust` 的人显示,按钮是「在电脑上继续」。
 * `onPick`:本域那一段还能选(没选或改选)时的入口。
 */
export function WorkflowSegments({ workflow, onPick }: { workflow: ApprovalWorkflow; onPick?: () => void }) {
  const { t, enumLabel } = useI18n();
  const theme = useTheme();
  const myTenant = useMyTenant();
  const [open, setOpen] = useState<ReadonlySet<number>>(new Set());
  const segments = [...(workflow.segments ?? [])].sort((a, b) => a.order - b.order);
  const running = workflow.status !== "COMPLETED" && workflow.status !== "REJECTED";
  const gate = segments.find((s) => s.order === workflow.awaiting_segment) ?? null;
  const statusLabel = (raw: string) => enumLabel("workflow.status", raw).label ?? raw;

  const meta = (s: WorkflowSegment) => {
    const count = t("workflow.segment.count", { go: String(s.go), total: String(s.total) });
    if (s.state === "AWAITING_PICK") return t("workflow.segment.not_picked");
    return s.state === "DONE" ? `${count} · ${t("workflow.segment.done")}` : count;
  };

  return (
    <View testID="workflow-segments">
      {gate && running ? <GateBlock workflow={workflow} segment={gate} myTenant={myTenant} onPick={gate.can_pick ? onPick : undefined} /> : null}
      {segments.map((s) => {
        const mine = myTenant !== null && s.tenant_code === myTenant;
        const folded = s.state === "DONE" && !open.has(s.order);
        const pickable = !!onPick && s.can_pick && (s.state === "AWAITING_PICK" || s.state === "PICKED");
        const head = `${circled(s.order)} ${segmentRealm(t, s)}${mine ? ` · ${t("workflow.segment.local")}` : ""}`;
        return (
          <View key={s.order} testID={`segment-${s.order}`}>
            <Pressable
              testID={`segment-head-${s.order}`}
              accessibilityRole={s.state === "DONE" ? "button" : "header"}
              accessibilityState={s.state === "DONE" ? { expanded: !folded } : undefined}
              disabled={s.state !== "DONE"}
              onPress={() =>
                setOpen((prev) => {
                  const next = new Set(prev);
                  if (next.has(s.order)) next.delete(s.order);
                  else next.add(s.order);
                  return next;
                })
              }
              style={[styles.head, { backgroundColor: theme.s2, borderTopColor: theme.hair }]}
            >
              <Txt variant="label" style={{ flex: 1 }}>{head}</Txt>
              <Txt variant="caption" tone="muted" testID={`segment-meta-${s.order}`}>{meta(s)}</Txt>
            </Pressable>
            {s.state === "AWAITING_PICK" ? (
              <View testID={`segment-awaiting-${s.order}`} style={[styles.node, { borderBottomColor: theme.hair }]}>
                <Txt variant="body" tone="muted" style={styles.glyph}>◌</Txt>
                <Txt variant="body" tone="muted" style={{ flex: 1 }}>
                  {t("workflow.node_state.awaiting_pick", { n: String(s.default_node_count) })}
                </Txt>
                {pickable && s !== gate ? <SmallButton testID={`segment-pick-${s.order}`} title={t("workflow.pick_group.action")} onPress={() => onPick?.()} /> : null}
              </View>
            ) : folded ? null : (
              <>
                {segmentNodes(workflow, s.order).map((node) => {
                  const isCurrent = running && workflow.current_node === node.id;
                  const look = nodeLook(node, isCurrent, t, statusLabel);
                  const right = node.is_required ? `${look.text} · ${t("workflow.pick.final_badge")}` : look.text;
                  return (
                    <View
                      key={node.id}
                      testID={`segment-node-${node.id}`}
                      style={[
                        styles.node,
                        { borderBottomColor: theme.hair },
                        isCurrent ? { borderLeftWidth: 3, borderLeftColor: theme.plaqueFill, paddingLeft: space[5] - 3 } : null,
                      ]}
                    >
                      <Txt variant="body" tone={look.skipped ? "subtle" : "ink"} style={styles.glyph}>{look.glyph}</Txt>
                      <Txt variant={isCurrent ? "bodyLg" : "body"} tone={look.skipped ? "subtle" : "ink"} style={[{ flex: 1 }, look.skipped ? styles.struck : null]}>
                        {`${stationNo(node)} ${node.node_name}`}
                      </Txt>
                      <Txt variant="caption" tone={look.skipped ? "subtle" : "muted"} testID={`segment-node-state-${node.id}`}>{right}</Txt>
                    </View>
                  );
                })}
                {pickable && s.state === "PICKED" ? (
                  <View style={{ paddingHorizontal: space[5], paddingVertical: space[2] }}>
                    <SmallButton testID={`segment-repick-${s.order}`} title={t("workflow.pick.repick")} onPress={() => onPick?.()} />
                  </View>
                ) : null}
              </>
            )}
          </View>
        );
      })}
      <View style={{ padding: space[5], gap: space[4] }}>
        <Txt variant="caption" tone="subtle">{t("workflow.legend")}</Txt>
        {workflow.can_adjust && running ? (
          <View testID="segment-adjust-desk" style={[styles.card, { borderColor: theme.hair }]}>
            <View style={{ flex: 1, gap: space[1] }}>
              <Txt variant="bodyLg">{t("workflow.adjust.open")}</Txt>
              <Txt variant="caption" tone="muted">{t("workflow.adjust.desk_body")}</Txt>
            </View>
            <SmallButton
              testID="segment-adjust-desk-go"
              title={t("officer_app.continue_on_desk")}
              onPress={() => void Share.share({ message: deskUrl({ kind: "approval", id: workflow.id }) }).catch(() => {})}
            />
          </View>
        ) : null}
      </View>
    </View>
  );
}

/**
 * O-4:流程停在一段门口。召集这边写「等待外域选站 · 埃及 · 第 N 天」(不写外域判官的名字),满 3 天写「每天提醒一次」;
 * 那个域没人能选时写 ⚠;那个域自己看到「流程在等本域选站」和「选站」。再提醒、按默认流程走在电脑上。
 */
function GateBlock({ workflow, segment, myTenant, onPick }: { workflow: ApprovalWorkflow; segment: WorkflowSegment; myTenant: string | null; onPick?: () => void }) {
  const { t } = useI18n();
  const theme = useTheme();
  const realm = segmentRealm(t, segment);
  const earlier = (workflow.segments ?? []).filter((s) => s.order < segment.order).sort((a, b) => a.order - b.order);
  const previous = earlier[earlier.length - 1];
  const view = gateView(segment, myTenant);
  const [title, body] =
    view === "foreign"
      ? [`◌ ${t("workflow.gate.foreign_title")}`, t("workflow.gate.foreign_body", { soul: workflow.soul_name ?? "", realm: segmentRealm(t, previous) })]
      : view === "no_picker"
        ? // U+FE0E: iOS draws a bare ⚠ as a colour emoji (same reason `translate()` marks the north-east arrow).
          [`⚠︎ ${t("workflow.gate.no_picker_title", { realm })}`, t("workflow.gate.no_picker_body", { realm })]
        : [
            `◌ ${t("workflow.gate.waiting_title", { realm, n: String(segment.gate_days ?? 1) })}`,
            t(view === "overdue" ? "workflow.gate.overdue_body" : "workflow.gate.waiting_body", { realm }),
          ];
  return (
    <View testID="segment-gate" accessibilityLiveRegion="polite" style={[styles.gate, { borderColor: theme.hair, backgroundColor: theme.s1 }]}>
      <Txt variant="bodyLg" testID="segment-gate-title">{title}</Txt>
      <Txt variant="body" tone="muted" testID="segment-gate-body">{body}</Txt>
      {view === "foreign" && onPick ? <ActionButton testID="segment-gate-pick" kind="primary" title={t("workflow.pick_group.action")} onPress={onPick} /> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  bar: { padding: space[4], gap: space[3], borderTopWidth: 1 },
  summary: { flexDirection: "row", alignItems: "center", gap: space[3] },
  station: { flexDirection: "row", alignItems: "center", gap: space[3], paddingHorizontal: space[5], paddingVertical: space[2], borderBottomWidth: 1 },
  box: { width: 22, height: 22, borderRadius: 4, borderWidth: 1.5, alignItems: "center", justifyContent: "center" },
  struck: { textDecorationLine: "line-through" },
  head: { flexDirection: "row", alignItems: "center", gap: space[3], minHeight: 44, paddingHorizontal: space[5], paddingVertical: space[2], borderTopWidth: 1 },
  node: { flexDirection: "row", alignItems: "center", gap: space[2], minHeight: 44, paddingHorizontal: space[5], paddingVertical: space[2], borderBottomWidth: 1 },
  glyph: { width: 20, textAlign: "center" },
  card: { flexDirection: "row", alignItems: "center", gap: space[3], padding: space[4], borderWidth: 1, borderRadius: 8 },
  gate: { margin: space[5], padding: space[4], gap: space[2], borderWidth: 1 },
});
