/**
 * 审判详情底部的操作区(Design 第三十四批 O-09):主按钮一次一个,其余收进左边的 ⋯。
 * 状态表在 `rules.ts::judgmentActionState`。放回要确认、不用写理由;暂缓与请求改派打开理由底页,
 * 理由必填 —— 空着点确认时输入框描边转红并在下面写提示,按钮不预先禁用,确认键用墨色(同驳回)。
 */
import { judgmentApi, type Judgment } from "@soulledger/core/api/judgment";
import { useState } from "react";
import { Pressable, View } from "react-native";

import { formatWhen } from "../format";
import { ActionButton, Row } from "../kit";
import { judgmentActionState, judgmentMoreItems, reasonBlank, type JudgmentActionState } from "../rules";
import { Input, Notice, Sheet, Txt, space, useI18n, useOnline, useTheme, useToast } from "../shared";

type Overlay = "menu" | "release" | "defer" | "request_reassign" | null;

export function JudgmentActionBar({
  data,
  me,
  reassignAsked,
  onAsked,
  onChanged,
  onWrite,
  onDesk,
}: {
  data: Judgment;
  me: number | null;
  /** 已请求改派:服务端的 `reassign_requested_at`,或本次撞到 429(见 `judgmentActionState`)。 */
  reassignAsked: boolean;
  onAsked: () => void;
  /** 服务端接受了:调用方重新取案子。 */
  onChanged: () => void;
  /** 「写评议」: 滚到评议区。 */
  onWrite: () => void;
  /** 「在电脑上继续」。 */
  onDesk: () => void;
}) {
  const { t } = useI18n();
  const theme = useTheme();
  const toast = useToast();
  const { offline } = useOnline();
  const state = judgmentActionState(data, me, reassignAsked);
  const [overlay, setOverlay] = useState<Overlay>(null);
  // 每次打开一个新 key:再次打开的底页从空白开始。
  const [opened, setOpened] = useState(0);
  const [busy, setBusy] = useState(false);
  const open = (next: Overlay) => {
    setOpened((n) => n + 1);
    setOverlay(next);
  };
  // Each sheet clears only itself. The menu's dismissal lands after its close animation -- by then the next sheet
  // (defer / reassign / release) is the overlay, and a blanket reset closed it the moment it opened.
  const closeOnly = (name: Overlay) => () => setOverlay((current) => (current === name ? null : current));
  const more = judgmentMoreItems(state);

  const run = (call: () => Promise<unknown>, doneKey: string, after?: () => void) => {
    setBusy(true);
    return call()
      .then(() => {
        toast(t(doneKey), "success");
        setOverlay(null);
        after?.();
        onChanged();
      })
      .finally(() => setBusy(false));
  };
  const claim = () => {
    if (busy) return;
    setBusy(true);
    judgmentApi
      .claim(data.id)
      .then(onChanged, () => toast(t("officer_app.queue.claim_failed"), "failure"))
      .finally(() => setBusy(false));
  };
  const undefer = () => {
    if (busy) return;
    setBusy(true);
    judgmentApi
      .undefer(data.id)
      .then(() => {
        toast(t("judgment.claim.done_undefer"), "success");
        onChanged();
      }, () => toast(t("officer_app.queue.claim_failed"), "failure"))
      .finally(() => setBusy(false));
  };

  if (state === "closed") return null;
  const hint = offline ? t("officer_app.offline.no_decide") : undefined;

  return (
    <View testID="judgment-actions" style={{ padding: space[4], gap: space[3], borderTopWidth: 1, borderTopColor: theme.hair, backgroundColor: theme.s1 }}>
      {state === "deferred" ? (
        <Txt variant="caption" tone="muted" testID="judgment-deferred-banner">
          {`◇ ${t("officer_app.case.deferred_banner", { date: formatWhen(data.deferred_at).slice(0, 10), reason: data.defer_reason ?? "" })}`}
        </Txt>
      ) : null}
      {state === "reassign" ? (
        <Txt variant="bodyLg" testID="judgment-reassign-banner">{`◐ ${t("officer_app.case.reassign_pending")}`}</Txt>
      ) : null}
      {state === "other" ? (
        <Txt variant="body" testID="judgment-with-other">{`○ ${t("officer_app.case.with_other", { name: data.claimed_by_name ?? "" })}`}</Txt>
      ) : (
        <View style={{ flexDirection: "row", gap: space[3] }}>
          {more.length > 0 ? (
            <Pressable
              testID="judgment-more"
              accessibilityRole="button"
              accessibilityLabel="⋯"
              onPress={() => open("menu")}
              style={{ width: 44, height: 44, alignItems: "center", justifyContent: "center", borderWidth: 1, borderColor: theme.inkSubtle }}
            >
              <Txt variant="nav">⋯</Txt>
            </Pressable>
          ) : null}
          {state === "unclaimed" ? (
            <ActionButton testID="judgment-claim" kind="primary" busy={busy} disabled={offline} accessibilityHint={hint} title={t("officer_app.queue.claim")} onPress={claim} style={{ flex: 1 }} />
          ) : state === "deferred" ? (
            <ActionButton testID="judgment-undefer" kind="primary" busy={busy} disabled={offline} accessibilityHint={hint} title={t("judgment.claim.undefer")} onPress={undefer} style={{ flex: 1 }} />
          ) : state === "desk" ? (
            <ActionButton testID="judgment-desk" kind="outline" title={t("officer_app.continue_on_desk")} onPress={onDesk} style={{ flex: 1 }} />
          ) : (
            <ActionButton testID="judgment-write" kind="primary" title={t("officer_app.comment.write")} onPress={onWrite} style={{ flex: 1 }} />
          )}
        </View>
      )}

      <Sheet open={overlay === "menu"} onClose={closeOnly("menu")} edge={theme.hair} closeLabel={t("soul_app.common.cancel")}>
        <View testID="judgment-menu" style={{ padding: space[5] }}>
          {more.map((item) => (
            <Row key={item} testID={`judgment-menu-${item}`} minHeight={56} title={t(`officer_app.case.${item}`)} onPress={() => open(item)} />
          ))}
        </View>
      </Sheet>

      <ConfirmSheet
        key={`release-${opened}`}
        open={overlay === "release"}
        title={t("officer_app.case.release_title")}
        body={t("officer_app.case.release_body")}
        confirmLabel={t("officer_app.case.release")}
        busy={busy}
        onClose={closeOnly("release")}
        onConfirm={() => run(() => judgmentApi.release(data.id), "officer_app.case.done_released").catch(() => toast(t("officer_app.state.error_title"), "failure"))}
      />
      <ReasonSheet
        key={`defer-${opened}`}
        open={overlay === "defer"}
        kind="defer"
        data={data}
        onClose={closeOnly("defer")}
        onSubmit={(reason) => run(() => judgmentApi.defer(data.id, reason.trim()), "officer_app.case.done_deferred")}
      />
      <ReasonSheet
        key={`reassign-${opened}`}
        open={overlay === "request_reassign"}
        kind="request_reassign"
        data={data}
        onClose={closeOnly("request_reassign")}
        onSubmit={(reason) =>
          run(() => judgmentApi.requestReassign(data.id, reason.trim()), "officer_app.case.done_reassign").catch((e: unknown) => {
            // 10 分钟内已经请求过:服务端已经通知过了,界面按「已请求」处理。
            if ((e as { response?: { status?: number } })?.response?.status === 429) {
              setOverlay(null);
              onAsked();
              return;
            }
            throw e;
          })
        }
      />
    </View>
  );
}

function ConfirmSheet({
  open,
  title,
  body,
  confirmLabel,
  busy,
  onClose,
  onConfirm,
}: {
  open: boolean;
  title: string;
  body: string;
  confirmLabel: string;
  busy: boolean;
  onClose: () => void;
  onConfirm: () => void;
}) {
  const { t } = useI18n();
  const theme = useTheme();
  return (
    <Sheet open={open} onClose={onClose} edge={theme.hair} closeLabel={t("soul_app.common.cancel")}>
      <View testID="judgment-release-sheet" style={{ padding: space[5], gap: space[4] }}>
        <Txt variant="title">{title}</Txt>
        <Txt variant="body" tone="muted">{body}</Txt>
        <View style={{ flexDirection: "row", gap: space[3] }}>
          <ActionButton testID="judgment-sheet-cancel" kind="outline" title={t("soul_app.common.cancel")} onPress={onClose} />
          <ActionButton testID="judgment-sheet-confirm" kind="ink" busy={busy} title={confirmLabel} onPress={onConfirm} />
        </View>
      </View>
    </Sheet>
  );
}

/** 暂缓 / 请求改派的理由底页:同一版式,理由必填,空着点确认才标红。失败保留已写的字。 */
function ReasonSheet({
  open,
  kind,
  data,
  onClose,
  onSubmit,
}: {
  open: boolean;
  kind: "defer" | "request_reassign";
  data: Judgment;
  onClose: () => void;
  onSubmit: (reason: string) => Promise<unknown>;
}) {
  const { t } = useI18n();
  const theme = useTheme();
  const [reason, setReason] = useState("");
  const [flagged, setFlagged] = useState(false);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const defer = kind === "defer";
  const confirm = () => {
    if (reasonBlank(reason)) {
      setFlagged(true);
      return;
    }
    setBusy(true);
    setFailed(false);
    onSubmit(reason)
      .catch(() => setFailed(true))
      .finally(() => setBusy(false));
  };
  return (
    <Sheet open={open} onClose={onClose} edge={theme.hair} closeLabel={t("soul_app.common.cancel")}>
      <View testID={`judgment-${kind}-sheet`} style={{ padding: space[5], gap: space[4] }}>
        <Txt variant="title">{t(defer ? "officer_app.case.defer_title" : "officer_app.case.request_reassign")}</Txt>
        <Txt variant="bodyLg">{`${data.soul_name} · ${data.case_number}`}</Txt>
        <Txt variant="body" tone="muted">{t(defer ? "officer_app.case.defer_body" : "officer_app.case.reassign_body")}</Txt>
        <Input
          testID="judgment-reason"
          label={t(defer ? "officer_app.case.defer_reason" : "officer_app.case.reassign_reason")}
          multiline
          maxLength={500}
          value={reason}
          onChangeText={setReason}
          error={flagged && reasonBlank(reason) ? t("officer_app.case.reason_required") : null}
        />
        {failed ? <Notice tone="neg" testID="judgment-reason-failed">{t("officer_app.state.error_title")}</Notice> : null}
        <View style={{ flexDirection: "row", gap: space[3] }}>
          <ActionButton testID="judgment-sheet-cancel" kind="outline" title={t("soul_app.common.cancel")} onPress={onClose} />
          <ActionButton
            testID="judgment-sheet-confirm"
            kind="ink"
            busy={busy}
            title={t(defer ? "officer_app.case.defer_confirm" : "officer_app.case.reassign_confirm")}
            onPress={confirm}
          />
        </View>
      </View>
    </Sheet>
  );
}

export type { JudgmentActionState };
