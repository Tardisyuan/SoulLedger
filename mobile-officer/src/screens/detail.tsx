/**
 * Item details: a waiting item (with the decision bar), a judgment (claim / read) and a soul
 * (read-only). Each ends with 「在电脑上继续」, a link to the desk's same page that the officer can
 * send to a computer.
 */
import { JUDGMENT_COMMENT_MAX, judgmentApi } from "@soulledger/core/api/judgment";
import { officerAppApi, type TodoItemDetail, type TodoKind } from "@soulledger/core/api/officer-app";
import { soulAccountsApi } from "@soulledger/core/api/soul-accounts";
import { soulsApi, type Soul } from "@soulledger/core/api/souls";
import { useCallback, useState } from "react";
import { Pressable, Share, View } from "react-native";

import { formatWhen } from "../format";
import { ActionButton, StateView, viewStateOf } from "../kit";
import { deskUrl, handledNotice, isDenied, type Verdict } from "../rules";
import { useSession } from "../session";
import { Icon, Input, Notice, Screen, SectionLabel, Txt, space, useI18n, useRemote, useTheme } from "../shared";
import { CosignSheet, DecisionSheet, type CooldownFacts } from "./sheets";

export type DetailTarget =
  | { type: "todo"; kind: TodoKind; id: string }
  | { type: "judgment"; id: string }
  | { type: "soul"; id: string };

export function Detail({ target, onBack, onSettled }: { target: DetailTarget; onBack: () => void; onSettled: () => void }) {
  const { t } = useI18n();
  const theme = useTheme();
  return (
    <View testID="detail" style={{ flex: 1, backgroundColor: theme.s0 }}>
      <Pressable
        testID="detail-back"
        accessibilityRole="button"
        accessibilityLabel={t("officer_app.back")}
        onPress={onBack}
        style={{ minHeight: 48, flexDirection: "row", alignItems: "center", gap: space[2], paddingHorizontal: space[5], borderBottomWidth: 1, borderBottomColor: theme.hair }}
      >
        <Icon name="back" size={16} color={theme.ink} />
        <Txt variant="nav">{t("officer_app.back")}</Txt>
      </Pressable>
      {target.type === "todo" ? <TodoDetail kind={target.kind} id={target.id} onSettled={onSettled} /> : null}
      {target.type === "judgment" ? <JudgmentDetail id={target.id} /> : null}
      {target.type === "soul" ? <SoulDetail id={target.id} /> : null}
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

function TodoDetail({ kind, id, onSettled }: { kind: TodoKind; id: string; onSettled: () => void }) {
  const { t } = useI18n();
  const { state } = useSession();
  const role = state.status === "signedIn" ? state.user.role : "";
  const load = useCallback(() => officerAppApi.item(kind, id).then((r) => r.data), [kind, id]);
  const { data, error, reload } = useRemote(load);
  const loadCooldown = useCallback(
    (): Promise<CooldownFacts | null> =>
      kind === "cooldown"
        ? soulAccountsApi.cooldownShortening(id).then((r) => ({ reason: r.data.reason, remainingDays: r.data.remaining_days, desiredDays: r.data.desired_remaining_days ?? null }))
        : Promise.resolve(null),
    [kind, id]
  );
  const cooldown = useRemote(loadCooldown);
  const [sheet, setSheet] = useState<Verdict | "cosign" | null>(null);
  // A new key per opening: a sheet opened again starts clean.
  const [opened, setOpened] = useState(0);
  const pick = (next: Verdict | "cosign") => {
    setOpened((n) => n + 1);
    setSheet(next);
  };
  const view = viewStateOf({ data, error }, () => false, isDenied);

  const settled = () => {
    // The list behind this screen reloads; this item is asked again, and it answers "already handled".
    void reload();
    onSettled();
  };

  if (view || !data) return <StateView state={view ?? "loading"} onRetry={reload} role={role} area={t("officer_app.areas.todo")} />;
  const note = handledNotice(data);
  return (
    <View style={{ flex: 1 }}>
      <Screen testID="todo-detail" edges={["left", "right"]}>
        <View style={{ padding: space[5], gap: space[4] }}>
          {note ? (
            <Notice tone="neutral" testID="detail-handled">
              {note.kind === "handled"
                ? `○ ${t("officer_app.landing.handled", { name: note.name ?? t("officer_app.landing.someone") })}`
                : `○ ${t(`officer_app.confirm.reasons.${note.kind}`)}`}
            </Notice>
          ) : null}
          <SectionLabel>{t(`officer_app.kinds.${kind}`)}</SectionLabel>
          <Txt variant="title">{data.title}</Txt>
          <Txt variant="caption" tone="muted">
            {formatWhen(data.created_at)}
          </Txt>
          {data.actionable ? (
            <Txt variant="bodyLg" testID="detail-your-step">{`◐ ${t("officer_app.detail.your_step")}`}</Txt>
          ) : null}
          {cooldown.data ? (
            <View style={{ gap: space[2] }}>
              <Txt variant="body">{cooldown.data.reason}</Txt>
              <Txt variant="caption" tone="muted">
                {t("officer_app.confirm.remaining_days", { n: String(cooldown.data.remainingDays) })}
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
          <ContinueOnDesk target={{ kind, id }} />
        </View>
      </Screen>
      {data.actionable ? <ActionBar kind={kind} onPick={pick} waitingOn={data.waiting_on_cosigner?.name ?? null} /> : null}
      <DecisionSheet key={`decision-${opened}`} open={sheet === "approve" || sheet === "reject"} verdict={sheet === "reject" ? "reject" : "approve"} detail={data as TodoItemDetail} cooldown={cooldown.data} onClose={() => setSheet(null)} onDone={settled} />
      <CosignSheet key={`cosign-${opened}`} open={sheet === "cosign"} kind={kind} id={id} onClose={() => setSheet(null)} onDone={() => void reload()} />
    </View>
  );
}

/** 加签 (secondary) · 驳回 (ink outline) · 批准 (primary): 44 high, square. 加签 only exists on a workflow node. */
function ActionBar({ kind, onPick, waitingOn }: { kind: TodoKind; onPick: (next: Verdict | "cosign") => void; waitingOn: string | null }) {
  const { t } = useI18n();
  const theme = useTheme();
  // The added signer has not approved yet: 批准 is greyed and the sentence above says why (and is the
  // button's hint). 驳回 and 加签 are never held.
  const wait = waitingOn !== null ? t("officer_app.detail.wait_cosigner", { name: waitingOn }) : null;
  return (
    <View testID="action-bar" style={{ padding: space[4], gap: space[3], borderTopWidth: 1, borderTopColor: theme.hair, backgroundColor: theme.s1 }}>
      {wait ? <Txt variant="caption" tone="muted" testID="detail-wait-cosigner">{`◇ ${wait}`}</Txt> : null}
      <View style={{ flexDirection: "row", gap: space[3] }}>
        {kind === "approval" || kind === "rebirth" ? (
          <ActionButton testID="action-cosign" kind="outline" title={t("officer_app.detail.cosign")} onPress={() => onPick("cosign")} />
        ) : null}
        <ActionButton testID="action-reject" kind="ink-outline" title={t("officer_app.detail.reject")} onPress={() => onPick("reject")} />
        <ActionButton testID="action-approve" kind="primary" title={t("officer_app.detail.approve")} disabled={wait !== null} accessibilityHint={wait ?? undefined} onPress={() => onPick("approve")} />
      </View>
    </View>
  );
}

function JudgmentDetail({ id }: { id: string }) {
  const { t } = useI18n();
  const load = useCallback(() => judgmentApi.get(id).then((r) => r.data), [id]);
  const { data, error, reload } = useRemote(load);
  const view = viewStateOf({ data, error }, () => false, isDenied);
  if (view || !data) return <StateView state={view ?? "loading"} onRetry={reload} />;
  return (
    <Screen testID="judgment-detail" edges={["left", "right"]}>
      <View style={{ padding: space[5], gap: space[4] }}>
        <SectionLabel>{data.case_number}</SectionLabel>
        <Txt variant="title">{data.soul_name}</Txt>
        <Txt variant="caption" tone="muted">{[data.court, data.claimed_by_name].filter(Boolean).join(" · ")}</Txt>
        {!data.is_final ? <Txt variant="bodyLg">{`◇ ${t("officer_app.queue.desk_only")}`}</Txt> : null}
        <Txt variant="caption" tone="muted">{t("officer_app.queue.scope_note")}</Txt>
        <JudgmentComments id={id} />
        <ContinueOnDesk target={{ kind: "judgment", id }} />
      </View>
    </Screen>
  );
}

/** 写评议: read the others' comments and add one. A comment changes nothing about the case. */
function JudgmentComments({ id }: { id: string }) {
  const { t } = useI18n();
  const load = useCallback(() => judgmentApi.comments(id).then((r) => r.data), [id]);
  const { data, reload } = useRemote(load);
  const [body, setBody] = useState("");
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
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
      {(data ?? []).map((c) => (
        <View key={c.id} testID={`comment-${c.id}`} style={{ gap: space[1] }}>
          <Txt variant="caption" tone="muted">{`${c.author_name} · ${formatWhen(c.created_at)}`}</Txt>
          <Txt variant="body">{c.body}</Txt>
        </View>
      ))}
      <Input testID="comment-input" label={t("officer_app.comment.write")} multiline maxLength={JUDGMENT_COMMENT_MAX} value={body} onChangeText={setBody} />
      {failed ? <Notice tone="neg" testID="comment-failed">{`! ${t("officer_app.comment.failed")}`}</Notice> : null}
      <ActionButton testID="comment-send" kind="outline" busy={busy} title={t("officer_app.comment.send")} onPress={send} />
    </View>
  );
}

function dateText(d: { year: number; month?: number | null; day?: number | null } | null | undefined): string {
  return d ? [d.year, d.month, d.day].filter((x) => x != null).join("-") : "—";
}

function SoulDetail({ id }: { id: string }) {
  const { t } = useI18n();
  const load = useCallback(() => soulsApi.get(id).then((r) => r.data), [id]);
  const { data, error, reload } = useRemote<Soul>(load);
  const view = viewStateOf({ data, error }, () => false, isDenied);
  if (view || !data) return <StateView state={view ?? "loading"} onRetry={reload} />;
  const facts: [string, string][] = [
    [t("souls.state"), t(`souls.states.${data.current_state}`)],
    [t("souls.civilization"), data.civilization],
    [t("souls.detail.birth"), dateText(data.birth_date)],
    [t("souls.detail.death"), dateText(data.death_date)],
  ];
  return (
    <Screen testID="soul-detail" edges={["left", "right"]}>
      <View style={{ padding: space[5], gap: space[4] }}>
        <Txt variant="title">{data.name}</Txt>
        {data.is_residing ? (
          // Another civilization's temporary resident: named in words and a glyph, never in its colour.
          <Txt variant="bodyLg" testID="soul-residing">{t("officer_app.search.residing", { where: data.home_tenant?.display_name ?? data.home_civilization ?? "" })}</Txt>
        ) : null}
        {facts.map(([label, value]) => (
          <View key={label} style={{ gap: space[1] }}>
            <Txt variant="caption" tone="muted">{label}</Txt>
            <Txt variant="bodyLg">{value}</Txt>
          </View>
        ))}
        <Txt variant="caption" tone="muted">{t("officer_app.search.read_only")}</Txt>
        <ContinueOnDesk target={{ kind: "soul", id }} />
      </View>
    </Screen>
  );
}
