/**
 * Item details: a waiting item (with the decision bar), a judgment (claim / read) and a soul
 * (read-only, `soulDetail.tsx`), plus a letter thread (待回书信, `letter.tsx`). Each ends with 「在电脑上继续」, a link to the desk's same page that the officer can
 * send to a computer.
 *
 * A soul's name in a waiting item or a judgment opens that soul over the detail, and a judgment row in the soul
 * opens that judgment over it in turn: a small stack inside this one detail, 返回 pops it (the shell still has one
 * level). The detail underneath stays mounted, so an open decision sheet or a typed comment is still there.
 */
import { JUDGMENT_COMMENT_MAX, judgmentApi } from "@soulledger/core/api/judgment";
import { courtLabel } from "@soulledger/core/domain/courts";
import { dispatchApi } from "@soulledger/core/api/dispatch";
import { officerAppApi, type TodoFacts, type TodoItemDetail, type TodoKind } from "@soulledger/core/api/officer-app";
import { soulAccountsApi } from "@soulledger/core/api/soul-accounts";
import type { SoulRecordEntry } from "@soulledger/core/api/souls";
import { type ReactNode, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { BackHandler, Pressable, type ScrollView, Share, View } from "react-native";

import { formatWhen } from "../format";
import { useKeptText } from "../keptText";
import { useCachedRemote } from "../readCache";
import { noteOpened } from "../recentOpened";
import { ActionButton, GoneContext, RefreshFailed, StateView, detailStateOf } from "../kit";
import { deskUrl, dispatchStatusLine, dispatchView, goneKey, handledNotice, todoTitle, verdictsAllowed, type ItemKind, type Verdict } from "../rules";
import { useCan, useSession } from "../session";
import { Icon, Input, Notice, OneLine, Screen, SectionLabel, SmallButton, Txt, family, radius, space, useI18n, useOnline, useRemote, useTheme } from "../shared";
import { LetterThread } from "./letter";
import { JudgmentActionBar } from "./judgmentActions";
import { SealSheet } from "./sealSheet";
import { DossierSeal } from "../dossierSeal";
import { EvidenceText, JudgmentCase } from "./judgmentCase";
import { SoulDetail, SoulLink } from "./soulDetail";
import { TodoFactsView } from "./todoFacts";
import { PickStations, WorkflowSegmentsFor } from "./pick";
import { CityGodCase } from "./cityGod";
import { JudgmentFlowBlock } from "./judgmentFlow";
import { WangsiReview } from "./wangsi";
import { CosignSheet, DecisionSheet, type CooldownFacts } from "./sheets";

export type DetailTarget =
  | { type: "todo"; kind: ItemKind; id: string }
  | { type: "judgment"; id: string }
  | { type: "soul"; id: string };

/**
 * Opened over the detail: a soul, a judgment, 改选 from a workflow's segments (O-3), keyed by the workflow, or a
 * judgment's approval flow (「查看审批流程」, 第五十九批 M-1), keyed by the workflow too.
 */
type Over = Exclude<DetailTarget, { type: "todo" }> | { type: "pick"; id: string } | { type: "flow"; id: string };

export function Detail({
  target,
  from,
  onBack,
  onLeave,
  onSettled,
  onGone,
  backLabel,
  position,
  next,
  last,
}: {
  target: DetailTarget;
  /**
   * The next row of the list it was opened from (D1; Design 第五十批 C1): after a decision the bar offers 「下一件」 with
   * 「{name} · 还剩 {n} 件」 under it, beside 「回到待办」. Never followed for the officer. Absent: only 「回到待办」.
   */
  next?: NextItem;
  /** It was the list's last row: the lone 「回到待办」 says 「今天的都办完了」 under it. */
  last?: boolean;
  /** The back row's words when opened from a list that names itself (「‹ 案卷台」); 「返回」 otherwise and over a layer. */
  backLabel?: string;
  /** Where the case sits in that list (「第 1 / 7 件」), at the right of the back row. */
  position?: string;
  /** The list it was opened from, for 「回到{from}」 when what it shows is gone (O-c). */
  from?: string;
  onBack: () => void;
  /** 「回到{from}」: back to the list it came from (the shell also switches back to that tab). Defaults to `onBack`. */
  onLeave?: () => void;
  onSettled: () => void;
  /** What it shows is gone: the shell greys the row that opened it (keyed by `goneKey`). */
  onGone?: (key: string) => void;
}) {
  const { t } = useI18n();
  const theme = useTheme();
  const key = goneKey(target);
  // 「回到{from}」 closes the whole detail, from any layer: that is where the officer came from. Only the base target
  // greys a row; an opened-over soul or judgment has no row of its own in that list.
  const leave = onLeave ?? onBack;
  const base = useMemo(() => (from ? { from, onBack: leave, onGone: () => onGone?.(key) } : null), [from, leave, onGone, key]);
  const over = useMemo(() => (from ? { from, onBack: leave } : null), [from, leave]);
  const [stack, setStack] = useState<Over[]>([]);
  const top = stack.length > 0 ? stack[stack.length - 1] : null;
  const push = (next: Over) => setStack((s) => [...s, next]);
  const back = () => (top ? setStack((s) => s.slice(0, -1)) : onBack());
  useEffect(() => {
    if (!top) return;
    // Registered after the shell's, so it is asked first: the hardware back pops the stack before it closes the detail.
    const sub = BackHandler.addEventListener("hardwareBackPress", () => {
      setStack((s) => s.slice(0, -1));
      return true;
    });
    return () => sub.remove();
  }, [top]);
  const openSoul = (id: string) => push({ type: "soul", id });
  const openJudgment = (id: string) => push({ type: "judgment", id });
  const openPick = (id: string) => push({ type: "pick", id });
  const openFlow = (id: string) => push({ type: "flow", id });
  // A pick made from over the detail: back to it, which loads its segments again (a new key), and the list behind reloads.
  const [picked, setPicked] = useState(0);
  // The base item was decided here (approved / rejected / sealed): its action bar gives way to NextBar.
  const [decided, setDecided] = useState(false);
  const onDecided = () => setDecided(true);
  return (
    <View testID="detail" style={{ flex: 1, backgroundColor: theme.s0 }}>
      <Pressable
        testID="detail-back"
        accessibilityRole="button"
        accessibilityLabel={(!top && backLabel) || t("officer_app.back")}
        onPress={back}
        style={{ minHeight: 48, flexDirection: "row", alignItems: "center", gap: space[2], paddingHorizontal: space[5], borderBottomWidth: 1, borderBottomColor: theme.hair }}
      >
        <Icon name="back" size={16} color={theme.ink} />
        <Txt variant="nav" style={{ flex: 1 }}>
          {(!top && backLabel) || t("officer_app.back")}
        </Txt>
        {!top && position ? (
          <Txt testID="detail-position" variant="caption" tone="muted">
            {position}
          </Txt>
        ) : null}
      </Pressable>
      <GoneContext.Provider value={base}>
      <View style={top ? { display: "none" } : { flex: 1 }}>
        {target.type === "todo" && target.kind === "letter" ? <LetterThread key={target.id} id={target.id} onSettled={onSettled} onDone={onBack} /> : null}
        {target.type === "todo" && target.kind === "dispatch" ? <DispatchLanding key={target.id} id={target.id} onSettled={onSettled} onOpenSoul={openSoul} /> : null}
        {target.type === "todo" && target.kind === "pick" ? <PickStations id={target.id} onDone={() => { onSettled(); onBack(); }} /> : null}
        {target.type === "todo" && target.kind === "city_god" ? <CityGodCase key={target.id} id={target.id} onSettled={onSettled} onDone={onBack} /> : null}
        {target.type === "todo" && target.kind === "wangsi" ? <WangsiReview key={target.id} id={target.id} onSettled={onSettled} onDone={onBack} /> : null}
        {target.type === "todo" && target.kind !== "letter" && target.kind !== "dispatch" && target.kind !== "pick" && target.kind !== "city_god" && target.kind !== "wangsi" ? (
          <TodoDetail key={picked} kind={target.kind} id={target.id} onSettled={onSettled} onOpenSoul={openSoul} onOpenPick={openPick} onDecided={onDecided} />
        ) : null}
        {target.type === "judgment" ? <JudgmentDetail id={target.id} onOpenSoul={openSoul} onOpenFlow={openFlow} onDecided={onDecided} /> : null}
        {target.type === "soul" ? <SoulDetail id={target.id} onOpenJudgment={openJudgment} footer={<ContinueOnDesk target={{ kind: "soul", id: target.id }} />} /> : null}
        {decided ? <NextBar next={next} last={last} from={from} onLeave={leave} /> : null}
      </View>
      </GoneContext.Provider>
      <GoneContext.Provider value={over}>
      {top?.type === "soul" ? <SoulDetail key={`over-${stack.length}`} id={top.id} onOpenJudgment={openJudgment} footer={<ContinueOnDesk target={{ kind: "soul", id: top.id }} />} /> : null}
      {top?.type === "judgment" ? <JudgmentDetail key={`over-${stack.length}`} id={top.id} onOpenSoul={openSoul} onOpenFlow={openFlow} /> : null}
      {top?.type === "flow" ? (
        // 官员 7(2026-10-29):审判看得到而流程不在本殿范围(跨域、本殿没有自己那一段;后端 todo 模块的 _workflows)时
        // 服务端答 404。流程并没有不在 —— 不说「已不在」,说清为什么这里看不到。
        <TodoDetail
          key={`over-${stack.length}`}
          kind="approval"
          id={top.id}
          onSettled={onSettled}
          onOpenSoul={openSoul}
          onOpenPick={openPick}
          whenGone={<Notice tone="neutral" testID="flow-not-here">{t("officer_app.judgment.flow_not_here")}</Notice>}
        />
      ) : null}
      {top?.type === "pick" ? (
        <PickStations
          key={`over-${stack.length}`}
          id={top.id}
          onDone={() => {
            setStack((s) => s.slice(0, -1));
            setPicked((n) => n + 1);
            onSettled();
          }}
        />
      ) : null}
      </GoneContext.Provider>
    </View>
  );
}

/** 第五十批 C1: a decided item stays on screen at this strength, for looking back at only. */
const DONE_OPACITY = 0.55;

/** The row after this one in the list it was opened from: who it is and how many rows are left after this one. */
export type NextItem = { name: string; left: number; onNext: () => void };

/**
 * After a decision (D1; Design 第五十批 C1): outline 「回到待办」 and ink 「下一件」, 1.6 × as wide and 56 high, with
 * 「{name} · 还剩 {n} 件」 under it -- who comes next, not 「3/7」. No next row: one full-width ink 「回到待办」, and
 * 「今天的都办完了」 under it when this was the list's last row. Opened from another list (案卷台, 通知): 「回到{from}」.
 */
function NextBar({ next, last, from, onLeave }: { next?: NextItem; last?: boolean; from?: string; onLeave: () => void }) {
  const { t } = useI18n();
  const theme = useTheme();
  const leaveTitle = !from ? t("officer_app.back") : from === t("officer_app.tabs.todo") ? t("officer_app.detail.back_to_todo") : t("state.gone_back", { from });
  return (
    <View testID="next-bar" style={{ flexDirection: "row", gap: space[3], padding: space[4], borderTopWidth: 1, borderTopColor: theme.hair, backgroundColor: theme.s0 }}>
      {next ? (
        <>
          <BarButton testID="detail-leave" ink={false} grow={1} title={leaveTitle} onPress={onLeave} />
          <BarButton
            testID="detail-next"
            ink
            grow={1.6}
            title={t("officer_app.detail.next")}
            caption={t("officer_app.detail.next_meta", { name: next.name, n: String(next.left) })}
            label={t("officer_app.detail.next_aria", { name: next.name, n: String(next.left) })}
            onPress={next.onNext}
          />
        </>
      ) : (
        <BarButton testID="detail-leave" ink grow={1} title={leaveTitle} caption={last ? t("officer_app.detail.all_done") : undefined} onPress={onLeave} />
      )}
    </View>
  );
}

/** The bar's two buttons: 56 high, a second line in small type under the title when there is one. */
function BarButton({ testID, ink, grow, title, caption, label, onPress }: { testID: string; ink: boolean; grow: number; title: string; caption?: string; label?: string; onPress: () => void }) {
  const theme = useTheme();
  const fg = ink ? theme.s0 : theme.ink;
  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={label ?? (caption ? `${title}, ${caption}` : title)}
      onPress={onPress}
      style={({ pressed }) => ({
        flex: grow,
        minHeight: 56,
        borderWidth: 1,
        borderRadius: radius.control,
        borderColor: ink ? theme.ink : theme.hair2,
        backgroundColor: ink ? theme.ink : "transparent",
        alignItems: "center",
        justifyContent: "center",
        paddingHorizontal: space[3],
        opacity: pressed ? 0.7 : 1,
      })}
    >
      <Txt variant="nav" style={{ color: fg, letterSpacing: 0 }}>
        {title}
      </Txt>
      {caption ? (
        <OneLine testID={`${testID}-caption`} variant="caption" style={{ color: fg, opacity: 0.8 }}>
          {caption}
        </OneLine>
      ) : null}
    </Pressable>
  );
}

/**
 * 「已落印」 (第五十批 C1): under the title, on card2, radius 10 -- the hall's seal at 44 (one of the four places a
 * civilization's colour goes), 「已落印 · 进入审批」 and the time with 「驳回会重开一案」.
 */
function SealedStrip({ civilization, court, at }: { civilization: string | null | undefined; court?: string | null; at?: string | null }) {
  const { t } = useI18n();
  const theme = useTheme();
  return (
    <View testID="detail-sealed" style={{ flexDirection: "row", alignItems: "center", gap: space[3], padding: space[3], borderRadius: 10, backgroundColor: theme.s2 }}>
      <DossierSeal testID="detail-sealed-seal" civilization={civilization} court={court} size={44} stamp label={t("officer_app.seal.a11y")} />
      <View style={{ flex: 1, gap: 2 }}>
        <Txt style={{ fontFamily: family.ui[600], fontSize: 15, lineHeight: 21 }}>{t("officer_app.detail.sealed")}</Txt>
        <Txt variant="caption" tone="muted">
          {t("officer_app.detail.sealed_meta", { time: formatWhen(at) })}
        </Txt>
      </View>
    </View>
  );
}

/** 「在电脑上继续」: the desk's same page, as a link the officer sends to a computer. */
function ContinueOnDesk({ target }: { target: Parameters<typeof deskUrl>[0] }) {
  const { t } = useI18n();
  return (
    <ActionButton
      testID="continue-on-desk"
      kind="outline"
      title={t("officer_app.continue_on_desk")}
      onPress={() => void Share.share({ message: deskUrl(target) }).catch(() => {})}
    />
  );
}

/**
 * What a dispatch notice lands on. The record decides, not the notice's type (`dispatchView`): this hall is the
 * receiver and the proposal is still open -> the actionable detail (批准 / 驳回); anything else -> the same
 * layout read-only, with one status line where the action bar would be. Read through the desk's own endpoint
 * (`dispatch/records/<id>/`, which lets both parties in); a record this officer cannot read is the same
 * denied / error state every other detail shows.
 */
function DispatchLanding({ id, onSettled, onOpenSoul }: { id: string; onSettled: () => void; onOpenSoul: (id: string) => void }) {
  const { t } = useI18n();
  const { state } = useSession();
  const role = state.status === "signedIn" ? state.user.role : "";
  const ownHall = state.status === "signedIn" ? state.user.tenant?.code : null;
  const load = useCallback(() => dispatchApi.get(id).then((r) => r.data), [id]);
  const { data, error, reload } = useCachedRemote(`detail:dispatch:${id}`, load);
  const view = detailStateOf({ data, error });
  if (view || !data) return <StateView state={view ?? "loading"} onRetry={reload} role={role} area={t("officer_app.areas.todo")} />;
  const mode = dispatchView(data, ownHall);
  if (mode.mode === "act") return <TodoDetail kind="reassignment" id={id} onSettled={onSettled} onOpenSoul={onOpenSoul} />;
  const line = dispatchStatusLine(data, mode.side);
  return (
    <Screen testID="dispatch-readonly" edges={["left", "right"]}>
      <View style={{ padding: space[5], gap: space[4] }}>
        <SectionLabel>{t("officer_app.kinds.reassignment")}</SectionLabel>
        <Txt variant="title">{data.soul_name ?? ""}</Txt>
        <OneLine variant="caption" tone="muted">
          {formatWhen(data.proposed_at)}
        </OneLine>
        <View style={{ gap: space[1] }}>
          <Txt variant="bodyLg" testID="dispatch-status">{[line.glyph, t(line.key)].filter(Boolean).join(" ")}</Txt>
          {line.reason ? <Txt variant="body" testID="dispatch-status-reason">{t("officer_app.dispatch_status.reason", { reason: line.reason })}</Txt> : null}
        </View>
        <ContinueOnDesk target={{ kind: "reassignment", id }} />
      </View>
    </Screen>
  );
}

function TodoDetail({
  kind: askedKind,
  id: askedId,
  onSettled,
  onOpenSoul,
  onOpenPick,
  whenGone,
  onDecided,
}: {
  kind: TodoKind;
  /** Approved or rejected here: the action bar goes and the detail offers 「下一件」 (D1). */
  onDecided?: () => void;
  id: string;
  onSettled: () => void;
  onOpenSoul?: (id: string) => void;
  /** 选站 / 改选 from the workflow's segments (O-3), keyed by the workflow. */
  onOpenPick?: (workflowId: string) => void;
  /** Shown instead of the shared 「已不在」 when a 404 means "not readable from this hall", not "gone". */
  whenGone?: ReactNode;
}) {
  const { t, locale } = useI18n();
  const { state } = useSession();
  const role = state.status === "signedIn" ? state.user.role : "";
  const { offline } = useOnline();
  // The item and (for a cooldown) its facts are ONE cache entry, so the 20-detail cap counts details, not requests.
  const load = useCallback(
    async (): Promise<{ item: TodoItemDetail; cooldown: CooldownFacts | null }> => {
      const facts =
        askedKind === "cooldown"
          ? soulAccountsApi.cooldownShortening(askedId).then(
              (r): CooldownFacts => ({ reason: r.data.reason, remainingDays: r.data.remaining_days, approved: r.data.status === "APPROVED", desiredDays: r.data.desired_remaining_days ?? null }),
              () => null
            )
          : Promise.resolve(null);
      const [item, cooldown] = await Promise.all([officerAppApi.item(askedKind, askedId).then((r) => r.data), facts]);
      return { item, cooldown };
    },
    [askedKind, askedId]
  );
  const { data: loaded, error, reload } = useCachedRemote(`detail:${askedKind}:${askedId}`, load);
  const data = loaded?.item ?? null;
  // An old rebirth notice names the workflow (`approval`); the server answers with the application's own item.
  // Everything below -- cosign, the desk link, the label -- goes by what it answered, not by what was asked.
  const kind = (data?.kind as TodoKind | undefined) ?? askedKind;
  const id = data?.id ?? askedId;
  const cooldown = { data: loaded?.cooldown ?? null };
  const [sheet, setSheet] = useState<Verdict | "cosign" | null>(null);
  // A new key per opening: a sheet opened again starts clean.
  const [opened, setOpened] = useState(0);
  const pick = (next: Verdict | "cosign") => {
    setOpened((n) => n + 1);
    setSheet(next);
  };
  const view = detailStateOf({ data, error });
  const [decided, setDecided] = useState(false);

  const settled = () => {
    // The list behind this screen reloads; this item is asked again, and it answers "already handled".
    // (The cooldown facts ride along in the same load.)
    void reload();
    onSettled();
    setDecided(true);
    onDecided?.();
  };

  if (view === "gone" && whenGone) return <View style={{ padding: space[5] }}>{whenGone}</View>;
  if (view || !data) return <StateView state={view ?? "loading"} onRetry={reload} role={role} area={t("officer_app.areas.todo")} />;
  const note = handledNotice(data);
  // Decided here (第五十批 C1): what stays on screen is for looking back at, at 55 %.
  const done = decided && !!onDecided;
  return (
    <View style={{ flex: 1 }}>
      <Screen testID="todo-detail" edges={["left", "right"]}>
        <RefreshFailed data={data} error={error} onRetry={reload} />
        <View testID={done ? "detail-dimmed" : undefined} style={{ opacity: done ? DONE_OPACITY : 1 }}>
        <View style={{ padding: space[5], gap: space[4] }}>
          {note ? (
            <Notice tone="neutral" testID="detail-handled">
              {note.kind === "handled"
                ? `○ ${t("officer_app.landing.handled", { name: note.name ?? t("officer_app.landing.someone") })}`
                : `○ ${t(`officer_app.confirm.reasons.${note.kind}`)}`}
            </Notice>
          ) : null}
          <SectionLabel>{t(`officer_app.kinds.${kind}`)}</SectionLabel>
          <Txt variant="title">{todoTitle(data, t, locale)}</Txt>
          {data.soul_code ? (
            <OneLine variant="caption" tone="muted" testID="detail-soul-code">
              {data.soul_code}
            </OneLine>
          ) : null}
          <OneLine variant="caption" tone="muted">
            {formatWhen(data.created_at)}
          </OneLine>
          {data.actionable ? (
            <Txt variant="bodyLg" testID="detail-your-step">{`◐ ${t("officer_app.detail.your_step")}`}</Txt>
          ) : null}
          {kind === "reassignment" && (data.facts as TodoFacts | undefined)?.status === "APPROVED" ? (
            // O-f: approved is not moved -- the receiving hall (this one) still executes it on the desk.
            <Txt variant="bodyLg" testID="detail-awaiting-receiver">{t("officer_app.dispatch.awaiting_receiver")}</Txt>
          ) : null}
          <TodoFactsView detail={data} onOpenSoul={onOpenSoul} />
          {cooldown.data && !data.facts ? (
            // An older server sends no `facts`: the cooldown request's own lines stand in for them.
            <View style={{ gap: space[2] }}>
              <Txt variant="body">{cooldown.data.reason}</Txt>
              <Txt variant="caption" tone="muted">
                {t(cooldown.data.approved ? "officer_app.confirm.remaining_after" : "officer_app.confirm.remaining_days", { n: String(cooldown.data.remainingDays) })}
              </Txt>
              {cooldown.data.desiredDays != null ? (
                <Txt variant="caption" tone="muted" testID="detail-desired">
                  {t("officer_app.confirm.desired", { n: String(cooldown.data.desiredDays) })}
                </Txt>
              ) : null}
            </View>
          ) : null}
          {data.cosigners && data.cosigners.length > 0 ? (
            // 加签: who was added to this step and whether they have signed. An owed signature is a ◐ row.
            <View testID="detail-cosigners" style={{ gap: space[1] }}>
              {data.cosigners.map((c) => (
                <Txt key={c.user_id} variant="body" testID={`cosigner-${c.user_id}`}>
                  {c.signed ? `✓ ${c.name}` : `◐ ${c.name} · ${t("officer_app.detail.cosigner_pending")}`}
                </Txt>
              ))}
            </View>
          ) : null}
        </View>
        {/* O-3: a workflow merged with a cross-realm judgment, by realm; nothing for one without segments. */}
        {kind === "approval" && data.workflow_id ? (
          <WorkflowSegmentsFor workflowId={data.workflow_id} onPick={onOpenPick ? () => onOpenPick(data.workflow_id!) : undefined} />
        ) : null}
        <View style={{ padding: space[5] }}>
          <ContinueOnDesk target={{ kind, id }} />
        </View>
        </View>
      </Screen>
      {data.actionable && !done ? <ActionBar kind={kind} onPick={pick} waitingOn={data.waiting_on_cosigner?.name ?? null} offline={offline} /> : null}
      <DecisionSheet key={`decision-${opened}`} open={sheet === "approve" || sheet === "reject"} verdict={sheet === "reject" ? "reject" : "approve"} detail={data as TodoItemDetail} cooldown={cooldown.data} onClose={() => setSheet(null)} onDone={settled} />
      <CosignSheet key={`cosign-${opened}`} open={sheet === "cosign"} kind={kind} id={id} onClose={() => setSheet(null)} onDone={() => void reload()} />
    </View>
  );
}

/** 加签 (secondary) · 驳回 (ink outline) · 批准 (primary): 44 high, square. 加签 only exists on a workflow node. */
function ActionBar({ kind, onPick, waitingOn, offline }: { kind: TodoKind; onPick: (next: Verdict | "cosign") => void; waitingOn: string | null; offline: boolean }) {
  const { t } = useI18n();
  const theme = useTheme();
  const { state } = useSession();
  const may = verdictsAllowed(kind, state.status === "signedIn" ? state.user.permissions : undefined);
  // The added signer has not approved yet: 批准 is greyed and the sentence above says why (and is the
  // button's hint). 驳回 and 加签 are never held.
  const wait = waitingOn !== null ? t("officer_app.detail.wait_cosigner", { name: waitingOn }) : null;
  return (
    <View testID="action-bar" style={{ padding: space[4], gap: space[3], borderTopWidth: 1, borderTopColor: theme.hair, backgroundColor: theme.s1 }}>
      {offline ? <Txt variant="caption" tone="muted" testID="detail-offline-reason">{`◇ ${t("officer_app.offline.no_decide")}`}</Txt> : null}
      {wait ? <Txt variant="caption" tone="muted" testID="detail-wait-cosigner">{`◇ ${wait}`}</Txt> : null}
      <View style={{ flexDirection: "row", gap: space[3] }}>
        {kind === "approval" || kind === "rebirth" ? (
          <ActionButton testID="action-cosign" kind="outline" title={t("officer_app.detail.cosign")} disabled={offline} onPress={() => onPick("cosign")} />
        ) : null}
        {may.reject ? (
          <ActionButton testID="action-reject" kind="ink-outline" title={t("officer_app.detail.reject")} disabled={offline} accessibilityHint={offline ? t("officer_app.offline.no_decide") : undefined} onPress={() => onPick("reject")} />
        ) : null}
        {may.approve ? (
          <ActionButton testID="action-approve" kind="primary" title={t("officer_app.detail.approve")} disabled={offline || wait !== null} accessibilityHint={offline ? t("officer_app.offline.no_decide") : (wait ?? undefined)} onPress={() => onPick("approve")} />
        ) : null}
      </View>
    </View>
  );
}

function JudgmentDetail({
  id,
  onOpenSoul,
  onOpenFlow,
  onDecided,
}: {
  id: string;
  onOpenSoul: (id: string) => void;
  onOpenFlow?: (workflowId: string) => void;
  /** Sealed here: the action bar goes and the detail offers 「下一件」 (D1). */
  onDecided?: () => void;
}) {
  const { t, locale } = useI18n();
  const { state } = useSession();
  const me = state.status === "signedIn" ? state.user.id : null;
  const load = useCallback(() => judgmentApi.get(id).then((r) => r.data), [id]);
  const { data, error, reload } = useCachedRemote(`detail:judgment:${id}`, load);
  const scroll = useRef<ScrollView>(null);
  // 「已请求」以服务端的 `reassign_requested_at` 为准(`judgmentActionState` 读它);`asked` 只补一种情形:429(10 分钟内问过,但标记已随认领人变动清掉)。
  const [asked, setAsked] = useState(false);
  const [record, setRecord] = useState<SoulRecordEntry | null>(null);
  const canAssign = useCan("judgment.assign");
  // 「判」抽屉(第三十批 八.6);落印成功后收起,卷宗头下的小印 40 播一次落印动效(`sealed`)。
  const [judging, setJudging] = useState(false);
  // Each opening is a new key: the drawer starts blank, like the action bar's sheets.
  const [openings, setOpenings] = useState(0);
  const [sealed, setSealed] = useState(false);
  const view = detailStateOf({ data, error });
  // 查询's 「最近打开」 (D2): every case opened, from any list or link, once it has loaded.
  const caseNumber = data?.case_number;
  const soulName = data?.soul_name;
  useEffect(() => {
    if (caseNumber) noteOpened({ type: "judgment", id, title: caseNumber, line: soulName });
  }, [id, caseNumber, soulName]);
  if (view || !data) return <StateView state={view ?? "loading"} onRetry={reload} />;
  if (record) return <EvidenceText record={record} onBack={() => setRecord(null)} />;
  // Sealed here (第五十批 C1): the 「已落印」 strip under the title takes the seal; the rest is for looking back at.
  const done = sealed && !!onDecided;
  return (
    <View style={{ flex: 1 }}>
      <Screen testID="judgment-detail" edges={["left", "right"]} scrollRef={scroll}>
        <RefreshFailed data={data} error={error} onRetry={reload} />
        <View style={{ padding: space[5], gap: space[4] }}>
          <View style={{ flexDirection: "row", alignItems: "flex-start", gap: space[3] }}>
            <View style={{ flex: 1, gap: space[4] }}>
              <SectionLabel>{data.case_number}</SectionLabel>
              {data.soul ? <SoulLink testID="judgment-soul-link" variant="title" name={data.soul_name} onOpen={() => onOpenSoul(data.soul)} /> : <Txt variant="title">{data.soul_name}</Txt>}
            </View>
            {data.concluded_at && !done ? <DossierSeal testID="judgment-seal" civilization={data.civilization} court={data.court} size={40} stamp={sealed} label={t("officer_app.seal.a11y")} /> : null}
          </View>
          {done ? <SealedStrip civilization={data.civilization} court={data.court} at={data.concluded_at} /> : null}
          <View testID={done ? "detail-dimmed" : undefined} style={{ gap: space[4], opacity: done ? DONE_OPACITY : 1 }}>
          <Txt variant="caption" tone="muted">{[courtLabel(t, data.court, locale), data.claimed_by_name].filter(Boolean).join(" · ")}</Txt>
          {!data.is_final ? <Txt variant="bodyLg">{`◇ ${t("officer_app.queue.desk_only")}`}</Txt> : null}
          {/* 滞留(`stale_since`,定时任务盖章,不结案):与队列行同一句「◐ 滞留 · 30 天无进展」。 */}
          {data.stale_since ? <Txt variant="bodyLg" testID="judgment-stale">{`◐ ${t("judgment.stale.label")} · ${t("judgment.stale.hint")}`}</Txt> : null}
          {/* O-a:有人请求改派,能改派的人在页头下就看到请求与理由(主按钮随之是「改派给…」)。 */}
          {canAssign && data.reassign_requested_at && data.claimed_by !== me ? (
            <View testID="judgment-reassign-request" style={{ gap: space[1] }}>
              <Txt variant="bodyLg">
                {`◐ ${t("officer_app.case.reassign_request", { name: data.reassign_requested_by_name ?? data.claimed_by_name ?? "", time: formatWhen(data.reassign_requested_at) })}`}
              </Txt>
              {data.reassign_reason ? <Txt variant="body">{t("officer_app.dispatch_status.reason", { reason: data.reassign_reason })}</Txt> : null}
            </View>
          ) : null}
          {/* 第五十九批 M-1:罪目一行与审批流程那一块,只读;执行只在网页上,这里不画执行按钮。 */}
          <JudgmentFlowBlock data={data} onOpenFlow={onOpenFlow} />
          <JudgmentCase data={data} onOpenRecord={setRecord} />
          <JudgmentComments id={id} concludedAt={data.concluded_at} readOnly={!!data.deferred_at && data.claimed_by === me} />
          <Txt variant="caption" tone="muted">{t("officer_app.queue.scope_note")}</Txt>
          <ContinueOnDesk target={{ kind: "judgment", id }} />
          </View>
        </View>
      </Screen>
      {done ? null : <JudgmentActionBar
        data={data}
        me={me}
        reassignAsked={asked}
        onAsked={() => setAsked(true)}
        onChanged={() => void reload()}
        onWrite={() => scroll.current?.scrollToEnd({ animated: true })}
        onDesk={() => void Share.share({ message: deskUrl({ kind: "judgment", id }) }).catch(() => {})}
        onJudge={() => {
          setOpenings((n) => n + 1);
          setJudging(true);
        }}
      />}
      <SealSheet
        key={`seal-${openings}`}
        open={judging}
        judgment={data}
        onClose={() => setJudging(false)}
        onSealed={() => {
          setJudging(false);
          setSealed(true);
          void reload();
          onDecided?.();
        }}
      />
    </View>
  );
}

/** 写评议: read the others' comments and add one. A comment changes nothing about the case. */
/** Like the desk: the latest 3 show, 「展开其余 N 条」 opens the rest, and 「结案后」 marks the first comment after the verdict. */
const COMMENTS_SHOWN = 3;

function JudgmentComments({ id, concludedAt, readOnly }: { id: string; concludedAt?: string | null; readOnly?: boolean }) {
  const { t } = useI18n();
  const { offline } = useOnline();
  const load = useCallback(() => judgmentApi.comments(id).then((r) => r.data), [id]);
  const { data, error, reload } = useRemote(load);
  // Kept across a tab switch (keptText.ts): the shell unmounts the detail, and a half-written comment went with it.
  const [body, setBody, dropBody] = useKeptText(`comment:${id}`);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const [showAll, setShowAll] = useState(false);
  const all = data ?? [];
  const shown = showAll ? all : all.slice(-COMMENTS_SHOWN);
  const hidden = all.length - shown.length;
  const firstAfter = concludedAt ? all.find((c) => c.created_at > concludedAt)?.id : undefined;
  const send = () => {
    const text = body.trim();
    if (text === "") return;
    setBusy(true);
    setFailed(false);
    judgmentApi
      .addComment(id, text)
      .then(() => {
        dropBody();
        void reload();
      })
      .catch(() => setFailed(true))
      .finally(() => setBusy(false));
  };
  return (
    <View testID="judgment-comments" style={{ gap: space[3] }}>
      <SectionLabel>{t("officer_app.comment.title")}</SectionLabel>
      {data && data.length === 0 ? (
        <Txt variant="caption" tone="muted">{t("officer_app.comment.empty")}</Txt>
      ) : null}
      {data === null && error ? (
        <Notice tone="neg" onRetry={() => void reload()} testID="comments-failed">
          {t("officer_app.comment.load_failed")}
        </Notice>
      ) : null}
      {hidden > 0 ? <SmallButton testID="comments-show-rest" title={t("officer_app.comment.show_rest", { n: String(hidden) })} onPress={() => setShowAll(true)} /> : null}
      {shown.map((c) => (
        <View key={c.id} testID={`comment-${c.id}`} style={{ gap: space[1] }}>
          {c.id === firstAfter ? <Txt testID="comments-after-close" variant="caption" tone="muted">{`— ${t("officer_app.comment.after_close")} —`}</Txt> : null}
          <OneLine variant="caption" tone="muted">{`${c.author_name} · ${formatWhen(c.created_at)}`}</OneLine>
          <Txt variant="body">{c.body}</Txt>
        </View>
      ))}
      {readOnly ? null : (
        // 暂缓期间不能写评议(O-09);「恢复」之后回来。
        <>
          <Input testID="comment-input" label={t("officer_app.comment.write")} multiline maxLength={JUDGMENT_COMMENT_MAX} value={body} onChangeText={setBody} />
          {failed ? <Notice tone="neg" testID="comment-failed">{t("officer_app.comment.failed")}</Notice> : null}
          <ActionButton
            testID="comment-send"
            kind="outline"
            busy={busy}
            disabled={offline}
            accessibilityHint={offline ? t("officer_app.offline.banner_bare") : undefined}
            title={t("officer_app.comment.send")}
            onPress={send}
          />
        </>
      )}
    </View>
  );
}
