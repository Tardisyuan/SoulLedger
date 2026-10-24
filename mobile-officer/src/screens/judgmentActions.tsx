/**
 * 审判详情底部的操作区(Design 第三十四批 O-09):主按钮一次一个,其余收进左边的 ⋯。
 * 状态表在 `rules.ts::judgmentActionState`。放回要确认、不用写理由;暂缓与请求改派打开理由底页,
 * 理由必填 —— 空着点确认时输入框描边转红并在下面写提示,按钮不预先禁用,确认键用墨色(同驳回)。
 *
 * 别人手上的案子(Design 第四十批 O-a):本殿管理员(`judgment.assign`)的 ⋯ 里是「改派给… · 替{name}放回 ·
 * 暂缓 / 取消暂缓」(`judgmentAdminItems`)。四项都要理由,因为是替别人做决定,原经办人会收到通知(服务端发)。
 * 有人请求改派时主按钮就是「改派给…」;没有就只有 ⋯。改派的选人底页与转信同一个(`PeoplePickerSheet`)。
 */
import { judgmentApi, type AssignableOfficer, type Judgment } from "@soulledger/core/api/judgment";
import { isHeldUntilFatedDate } from "@soulledger/core/domain/dates";
import { useCallback, useState } from "react";
import { Pressable, View } from "react-native";

import { formatWhen } from "../format";
import { ActionButton, Row } from "../kit";
import {
  judgmentActionState,
  judgmentAdminItems,
  judgmentMoreItems,
  reasonBlank,
  reassignCandidates,
  type AdminAction,
  type JudgmentActionState,
} from "../rules";
import { useCan } from "../session";
import { Input, Notice, Sheet, Txt, space, useI18n, useOnline, useRemote, useTheme, useToast } from "../shared";
import { PeoplePickerSheet, type PickPerson } from "./letterActions";

type Overlay = "menu" | "release" | "defer" | "request_reassign" | "reassign_to" | "release_for" | "defer_for" | "undefer_for" | null;

/** ⋯ 里的管理员一项打开哪一个底页(自己的暂缓与替别人的暂缓不是同一个:理由写给谁不同)。 */
const ADMIN_OVERLAY: Record<AdminAction, Overlay> = {
  reassign_to: "reassign_to",
  release_for: "release_for",
  defer: "defer_for",
  undefer: "undefer_for",
};

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
  // 认领 / 放回 / 暂缓 / 恢复 / 请求改派 都要 `judgment.execute`(只有 judgment.read 的角色点了只会 403):没有就不画。
  const canExecute = useCan("judgment.execute");
  const more = canExecute ? judgmentMoreItems(state) : [];
  // 替别人做的四件事要 `judgment.assign`(与服务端 `_may_override` 同一码名)。
  const admin = judgmentAdminItems(data, me, useCan("judgment.assign"));
  const holder = data.claimed_by_name ?? "";

  const run = (call: () => Promise<unknown>, doneKey: string, after?: () => void, values?: Record<string, string>) => {
    setBusy(true);
    return call()
      .then(() => {
        toast(t(doneKey, values), "success");
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
  const moreButton = (
    <Pressable
      testID="judgment-more"
      accessibilityRole="button"
      accessibilityLabel="⋯"
      onPress={() => open("menu")}
      style={{ width: 44, height: 44, alignItems: "center", justifyContent: "center", borderWidth: 1, borderColor: theme.inkSubtle }}
    >
      <Txt variant="nav">⋯</Txt>
    </Pressable>
  );
  const adminLabel = (item: AdminAction) =>
    item === "reassign_to"
      ? t("officer_app.case.reassign_to")
      : item === "release_for"
        ? t("officer_app.case.release_for", { name: holder })
        : item === "defer"
          ? t("officer_app.case.defer")
          : t("judgment.claim.undefer");
  // 理由写给原经办人:四个底页都用同一句标签「理由 · 必填,{name}会收到」。
  const forReason = t("officer_app.reassign.reason", { name: holder });

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
      {state === "other" && admin.length > 0 ? (
        <>
          <Txt variant="body" testID="judgment-admin-context">{`○ ${t("officer_app.case.admin_context", { name: holder })}`}</Txt>
          <View style={{ flexDirection: "row", gap: space[3] }}>
            {moreButton}
            {data.reassign_requested_at ? (
              <ActionButton testID="judgment-reassign-to" kind="primary" disabled={offline} accessibilityHint={hint} title={t("officer_app.case.reassign_to")} onPress={() => open("reassign_to")} style={{ flex: 1 }} />
            ) : null}
          </View>
        </>
      ) : state === "other" ? (
        <Txt variant="body" testID="judgment-with-other">{`○ ${t("officer_app.case.with_other", { name: holder })}`}</Txt>
      ) : (
        <View style={{ flexDirection: "row", gap: space[3] }}>
          {more.length > 0 ? moreButton : null}
          {state === "unclaimed" && canExecute && isHeldUntilFatedDate(data) ? (
            // 枉死城(第五十一批):候至阳寿那天,不放一个点了必然被拒的「认领」。
            <Txt variant="caption" tone="muted" testID="judgment-claim-held" style={{ flex: 1 }}>
              {`${t("judgment.held_until", { date: data.held_until as string })} · ${t("judgment.claim.held_short")}`}
            </Txt>
          ) : state === "unclaimed" && canExecute ? (
            <ActionButton testID="judgment-claim" kind="primary" busy={busy} disabled={offline} accessibilityHint={hint} title={t("officer_app.queue.claim")} onPress={claim} style={{ flex: 1 }} />
          ) : state === "deferred" && canExecute ? (
            <ActionButton testID="judgment-undefer" kind="primary" busy={busy} disabled={offline} accessibilityHint={hint} title={t("judgment.claim.undefer")} onPress={undefer} style={{ flex: 1 }} />
          ) : state === "desk" || state === "deferred" ? (
            <ActionButton testID="judgment-desk" kind="outline" title={t("officer_app.continue_on_desk")} onPress={onDesk} style={{ flex: 1 }} />
          ) : (
            <ActionButton testID="judgment-write" kind="primary" title={t("officer_app.comment.write")} onPress={onWrite} style={{ flex: 1 }} />
          )}
        </View>
      )}

      <Sheet open={overlay === "menu"} onClose={closeOnly("menu")} edge={theme.hair} closeLabel={t("soul_app.common.cancel")}>
        <View testID="judgment-menu" style={{ padding: space[5] }}>
          {state === "other"
            ? admin.map((item) => (
                <Row key={item} testID={`judgment-menu-${item}`} minHeight={56} title={adminLabel(item)} onPress={() => open(ADMIN_OVERLAY[item])} />
              ))
            : more.map((item) => (
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
        testID="judgment-defer-sheet"
        title={t("officer_app.case.defer_title")}
        body={t("officer_app.case.defer_body")}
        label={t("officer_app.case.defer_reason")}
        confirm={t("officer_app.case.defer_confirm")}
        data={data}
        onClose={closeOnly("defer")}
        onSubmit={(reason) => run(() => judgmentApi.defer(data.id, reason.trim()), "officer_app.case.done_deferred")}
      />
      <ReasonSheet
        key={`reassign-${opened}`}
        open={overlay === "request_reassign"}
        testID="judgment-request_reassign-sheet"
        title={t("officer_app.case.request_reassign")}
        body={t("officer_app.case.reassign_body")}
        label={t("officer_app.case.reassign_reason")}
        confirm={t("officer_app.case.reassign_confirm")}
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

      {/* 管理员替别人做的三件(改派另走选人底页)。 */}
      <ReasonSheet
        key={`release-for-${opened}`}
        open={overlay === "release_for"}
        testID="judgment-release_for-sheet"
        title={t("officer_app.case.release_for", { name: holder })}
        body={t("officer_app.case.release_body")}
        label={forReason}
        confirm={t("officer_app.case.release_for", { name: holder })}
        data={data}
        onClose={closeOnly("release_for")}
        onSubmit={(reason) => run(() => judgmentApi.release(data.id, reason.trim()), "officer_app.case.done_released")}
      />
      <ReasonSheet
        key={`defer-for-${opened}`}
        open={overlay === "defer_for"}
        testID="judgment-defer_for-sheet"
        title={t("officer_app.case.defer_title")}
        label={forReason}
        confirm={t("officer_app.case.defer_confirm")}
        data={data}
        onClose={closeOnly("defer_for")}
        onSubmit={(reason) => run(() => judgmentApi.defer(data.id, reason.trim()), "officer_app.case.done_deferred")}
      />
      <ReasonSheet
        key={`undefer-for-${opened}`}
        open={overlay === "undefer_for"}
        testID="judgment-undefer_for-sheet"
        title={t("judgment.claim.undefer")}
        label={forReason}
        confirm={t("judgment.claim.undefer")}
        data={data}
        onClose={closeOnly("undefer_for")}
        onSubmit={(reason) => run(() => judgmentApi.undefer(data.id, reason.trim()), "judgment.claim.done_undefer")}
      />
      {overlay === "reassign_to" ? (
        <ReassignSheet
          key={`reassign-to-${opened}`}
          data={data}
          holder={holder}
          onClose={closeOnly("reassign_to")}
          onDone={(name) => {
            toast(t("officer_app.reassign.done", { name }), "success");
            setOverlay(null);
            onChanged();
          }}
        />
      ) : null}
    </View>
  );
}

/**
 * 改派给…:本殿能审判的官员(`assignable-officers/`,与服务端改派校验同一条规则),现经办人不在里面,
 * 手上件数少的在前;件数取不到就不显示那一行字。理由必填,空着点确认才标红(同其他理由底页)。
 */
function ReassignSheet({ data, holder, onClose, onDone }: { data: Judgment; holder: string; onClose: () => void; onDone: (name: string) => void }) {
  const { t } = useI18n();
  const load = useRemote<AssignableOfficer[]>(useCallback(() => judgmentApi.assignableOfficers([data.id]).then((r) => r.data), [data.id]));
  const [reason, setReason] = useState("");
  const [flagged, setFlagged] = useState(false);
  const find = useCallback(
    (q: string): PickPerson[] => {
      const { rows, counts } = reassignCandidates(load.data ?? [], data.claimed_by, q);
      return rows.map((o) => ({
        id: o.id,
        name: o.display_name || o.username,
        line: counts ? t("officer_app.reassign.load", { n: String(o.in_hand) }) : null,
      }));
    },
    [load.data, data.claimed_by, t],
  );
  return (
    <PeoplePickerSheet
      open
      prefix="reassign"
      title={t("officer_app.reassign.title")}
      hint={t("officer_app.reassign.hint")}
      searchLabel={t("officer_app.reassign.search")}
      find={find}
      loading={load.loading}
      failed={!!load.error}
      confirmTitle={(name) => t("officer_app.reassign.confirm", { name })}
      idleTitle={t("officer_app.case.reassign_to")}
      onClose={onClose}
      onConfirm={(person) => {
        if (reasonBlank(reason)) {
          setFlagged(true);
          return Promise.resolve();
        }
        return judgmentApi.reassign(data.id, person.id, reason.trim()).then(() => onDone(person.name));
      }}
    >
      <Input
        testID="reassign-reason"
        label={t("officer_app.reassign.reason", { name: holder })}
        multiline
        maxLength={500}
        value={reason}
        onChangeText={setReason}
        error={flagged && reasonBlank(reason) ? t("officer_app.case.reason_required") : null}
      />
    </PeoplePickerSheet>
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

/** 理由底页:暂缓 / 请求改派,以及管理员替别人放回 / 暂缓 / 取消暂缓。同一版式,理由必填,空着点确认才标红。失败保留已写的字。 */
function ReasonSheet({
  open,
  testID,
  title,
  body,
  label,
  confirm: confirmLabel,
  data,
  onClose,
  onSubmit,
}: {
  open: boolean;
  testID: string;
  title: string;
  body?: string;
  label: string;
  confirm: string;
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
      <View testID={testID} style={{ padding: space[5], gap: space[4] }}>
        <Txt variant="title">{title}</Txt>
        <Txt variant="bodyLg">{`${data.soul_name} · ${data.case_number}`}</Txt>
        {body ? <Txt variant="body" tone="muted">{body}</Txt> : null}
        <Input
          testID="judgment-reason"
          label={label}
          multiline
          maxLength={500}
          value={reason}
          onChangeText={setReason}
          error={flagged && reasonBlank(reason) ? t("officer_app.case.reason_required") : null}
        />
        {failed ? <Notice tone="neg" testID="judgment-reason-failed">{t("officer_app.state.error_title")}</Notice> : null}
        <View style={{ flexDirection: "row", gap: space[3] }}>
          <ActionButton testID="judgment-sheet-cancel" kind="outline" title={t("soul_app.common.cancel")} onPress={onClose} />
          <ActionButton testID="judgment-sheet-confirm" kind="ink" busy={busy} title={confirmLabel} onPress={confirm} />
        </View>
      </View>
    </Sheet>
  );
}

export type { JudgmentActionState };
