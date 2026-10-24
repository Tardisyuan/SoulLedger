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
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { BackHandler, Pressable, type ScrollView, Share, View } from "react-native";

import { formatWhen } from "../format";
import { useCachedRemote } from "../readCache";
import { ActionButton, GoneContext, RefreshFailed, StateView, detailStateOf } from "../kit";
import { deskUrl, dispatchStatusLine, dispatchView, goneKey, handledNotice, todoTitle, type ItemKind, type Verdict } from "../rules";
import { useCan, useSession } from "../session";
import { Icon, Input, Notice, OneLine, Screen, SectionLabel, SmallButton, Txt, space, useI18n, useOnline, useRemote, useTheme } from "../shared";
import { LetterThread } from "./letter";
import { JudgmentActionBar } from "./judgmentActions";
import { EvidenceText, JudgmentCase } from "./judgmentCase";
import { SoulDetail, SoulLink } from "./soulDetail";
import { TodoFactsView } from "./todoFacts";
import { PickStations, WorkflowSegmentsFor } from "./pick";
import { CityGodCase } from "./cityGod";
import { CosignSheet, DecisionSheet, type CooldownFacts } from "./sheets";

export type DetailTarget =
  | { type: "todo"; kind: ItemKind; id: string }
  | { type: "judgment"; id: string }
  | { type: "soul"; id: string };

/** Opened over the detail: a soul, a judgment, or 改选 from a workflow's segments (O-3), keyed by the workflow. */
type Over = Exclude<DetailTarget, { type: "todo" }> | { type: "pick"; id: string };

export function Detail({
  target,
  from,
  onBack,
  onLeave,
  onSettled,
  onGone,
}: {
  target: DetailTarget;
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
  // A pick made from over the detail: back to it, which loads its segments again (a new key), and the list behind reloads.
  const [picked, setPicked] = useState(0);
  return (
    <View testID="detail" style={{ flex: 1, backgroundColor: theme.s0 }}>
      <Pressable
        testID="detail-back"
        accessibilityRole="button"
        accessibilityLabel={t("officer_app.back")}
        onPress={back}
        style={{ minHeight: 48, flexDirection: "row", alignItems: "center", gap: space[2], paddingHorizontal: space[5], borderBottomWidth: 1, borderBottomColor: theme.hair }}
      >
        <Icon name="back" size={16} color={theme.ink} />
        <Txt variant="nav">{t("officer_app.back")}</Txt>
      </Pressable>
      <GoneContext.Provider value={base}>
      <View style={top ? { display: "none" } : { flex: 1 }}>
        {target.type === "todo" && target.kind === "letter" ? <LetterThread key={target.id} id={target.id} onSettled={onSettled} onDone={onBack} /> : null}
        {target.type === "todo" && target.kind === "dispatch" ? <DispatchLanding key={target.id} id={target.id} onSettled={onSettled} onOpenSoul={openSoul} /> : null}
        {target.type === "todo" && target.kind === "pick" ? <PickStations id={target.id} onDone={() => { onSettled(); onBack(); }} /> : null}
        {target.type === "todo" && target.kind === "city_god" ? <CityGodCase key={target.id} id={target.id} onSettled={onSettled} onDone={onBack} /> : null}
        {target.type === "todo" && target.kind !== "letter" && target.kind !== "dispatch" && target.kind !== "pick" && target.kind !== "city_god" ? (
          <TodoDetail key={picked} kind={target.kind} id={target.id} onSettled={onSettled} onOpenSoul={openSoul} onOpenPick={openPick} />
        ) : null}
        {target.type === "judgment" ? <JudgmentDetail id={target.id} onOpenSoul={openSoul} /> : null}
        {target.type === "soul" ? <SoulDetail id={target.id} onOpenJudgment={openJudgment} footer={<ContinueOnDesk target={{ kind: "soul", id: target.id }} />} /> : null}
      </View>
      </GoneContext.Provider>
      <GoneContext.Provider value={over}>
      {top?.type === "soul" ? <SoulDetail key={`over-${stack.length}`} id={top.id} onOpenJudgment={openJudgment} footer={<ContinueOnDesk target={{ kind: "soul", id: top.id }} />} /> : null}
      {top?.type === "judgment" ? <JudgmentDetail key={`over-${stack.length}`} id={top.id} onOpenSoul={openSoul} /> : null}
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
}: {
  kind: TodoKind;
  id: string;
  onSettled: () => void;
  onOpenSoul?: (id: string) => void;
  /** 选站 / 改选 from the workflow's segments (O-3), keyed by the workflow. */
  onOpenPick?: (workflowId: string) => void;
}) {
  const { t } = useI18n();
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

  const settled = () => {
    // The list behind this screen reloads; this item is asked again, and it answers "already handled".
    // (The cooldown facts ride along in the same load.)
    void reload();
    onSettled();
  };

  if (view || !data) return <StateView state={view ?? "loading"} onRetry={reload} role={role} area={t("officer_app.areas.todo")} />;
  const note = handledNotice(data);
  return (
    <View style={{ flex: 1 }}>
      <Screen testID="todo-detail" edges={["left", "right"]}>
        <RefreshFailed data={data} error={error} onRetry={reload} />
        <View style={{ padding: space[5], gap: space[4] }}>
          {note ? (
            <Notice tone="neutral" testID="detail-handled">
              {note.kind === "handled"
                ? `○ ${t("officer_app.landing.handled", { name: note.name ?? t("officer_app.landing.someone") })}`
                : `○ ${t(`officer_app.confirm.reasons.${note.kind}`)}`}
            </Notice>
          ) : null}
          <SectionLabel>{t(`officer_app.kinds.${kind}`)}</SectionLabel>
          <Txt variant="title">{todoTitle(data, t)}</Txt>
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
      </Screen>
      {data.actionable ? <ActionBar kind={kind} onPick={pick} waitingOn={data.waiting_on_cosigner?.name ?? null} offline={offline} /> : null}
      <DecisionSheet key={`decision-${opened}`} open={sheet === "approve" || sheet === "reject"} verdict={sheet === "reject" ? "reject" : "approve"} detail={data as TodoItemDetail} cooldown={cooldown.data} onClose={() => setSheet(null)} onDone={settled} />
      <CosignSheet key={`cosign-${opened}`} open={sheet === "cosign"} kind={kind} id={id} onClose={() => setSheet(null)} onDone={() => void reload()} />
    </View>
  );
}

/** 加签 (secondary) · 驳回 (ink outline) · 批准 (primary): 44 high, square. 加签 only exists on a workflow node. */
function ActionBar({ kind, onPick, waitingOn, offline }: { kind: TodoKind; onPick: (next: Verdict | "cosign") => void; waitingOn: string | null; offline: boolean }) {
  const { t } = useI18n();
  const theme = useTheme();
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
        <ActionButton testID="action-reject" kind="ink-outline" title={t("officer_app.detail.reject")} disabled={offline} accessibilityHint={offline ? t("officer_app.offline.no_decide") : undefined} onPress={() => onPick("reject")} />
        <ActionButton testID="action-approve" kind="primary" title={t("officer_app.detail.approve")} disabled={offline || wait !== null} accessibilityHint={offline ? t("officer_app.offline.no_decide") : (wait ?? undefined)} onPress={() => onPick("approve")} />
      </View>
    </View>
  );
}

function JudgmentDetail({ id, onOpenSoul }: { id: string; onOpenSoul: (id: string) => void }) {
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
  const view = detailStateOf({ data, error });
  if (view || !data) return <StateView state={view ?? "loading"} onRetry={reload} />;
  if (record) return <EvidenceText record={record} onBack={() => setRecord(null)} />;
  return (
    <View style={{ flex: 1 }}>
      <Screen testID="judgment-detail" edges={["left", "right"]} scrollRef={scroll}>
        <RefreshFailed data={data} error={error} onRetry={reload} />
        <View style={{ padding: space[5], gap: space[4] }}>
          <SectionLabel>{data.case_number}</SectionLabel>
          {data.soul ? <SoulLink testID="judgment-soul-link" variant="title" name={data.soul_name} onOpen={() => onOpenSoul(data.soul)} /> : <Txt variant="title">{data.soul_name}</Txt>}
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
          <JudgmentCase data={data} onOpenRecord={setRecord} />
          <JudgmentComments id={id} concludedAt={data.concluded_at} readOnly={!!data.deferred_at && data.claimed_by === me} />
          <Txt variant="caption" tone="muted">{t("officer_app.queue.scope_note")}</Txt>
          <ContinueOnDesk target={{ kind: "judgment", id }} />
        </View>
      </Screen>
      <JudgmentActionBar
        data={data}
        me={me}
        reassignAsked={asked}
        onAsked={() => setAsked(true)}
        onChanged={() => void reload()}
        onWrite={() => scroll.current?.scrollToEnd({ animated: true })}
        onDesk={() => void Share.share({ message: deskUrl({ kind: "judgment", id }) }).catch(() => {})}
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
  const [body, setBody] = useState("");
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
        setBody("");
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
