/**
 * A letter's hand-over actions (Design batch 34, O-04): the ⋯ menu (转给别人 · 放回 · 归档 / 取消归档), the picker for 转给谁,
 * the one confirm (放回), and the bar an unassigned letter wears instead of the reply box (由我来回 · 转给别人).
 *
 * The picker is laid out like the 加签 sheet: a search box that is always there (a hall can have dozens of officers),
 * rows, a confirm button that names the person. The server's list (`assignable/`) is every officer of the hall who may
 * reply, with no load figure and no search -- so the search is local and 「手上 N 封」 is shown only if a row ever
 * carries a number. The caller is never in the list.
 */
import { soulInboxApi, type InboxOfficer } from "@soulledger/core/api/soul-inbox";
import { useCallback, useMemo, useState } from "react";
import { View } from "react-native";

import { ActionButton, Row } from "../kit";
import { assignableOthers } from "../letterActions";
import { Button, FieldError, Input, Notice, Sheet, SmallButton, Txt, space, useI18n, useRemote, useTheme } from "../shared";

/** How many people a picker lists before 「更多」 (here and in the 加签 sheet). */
export const PEOPLE_SHOWN = 6;

/** The ⋯ sheet. Which rows exist is decided by the caller from the thread's state (`menuActions`). */
export function LetterMenuSheet({
  open,
  actions,
  onPick,
  onClose,
}: {
  open: boolean;
  actions: ("assign" | "unassign" | "archive" | "unarchive")[];
  onPick: (action: "assign" | "unassign" | "archive" | "unarchive") => void;
  onClose: () => void;
}) {
  const { t } = useI18n();
  const theme = useTheme();
  const glyph = { assign: "→", unassign: "↺", archive: "□", unarchive: "□" } as const;
  return (
    <Sheet open={open} onClose={onClose} edge={theme.hair} closeLabel={t("soul_app.common.cancel")}>
      <View testID="sheet-letter-menu" style={{ paddingVertical: space[3] }}>
        {actions.map((action) => (
          <Row
            key={action}
            testID={`letter-menu-${action}`}
            minHeight={56}
            glyph={glyph[action]}
            title={t(`officer_app.letter.${action}`)}
            lines={action === "unassign" ? [t("officer_app.letter.unassign_hint")] : []}
            onPress={() => onPick(action)}
          />
        ))}
      </View>
    </Sheet>
  );
}

/** 转给谁？ -- pick one officer, then the button reads 「转给{name}」. */
export function AssignSheet({
  open,
  id,
  selfId,
  onClose,
  onAssigned,
}: {
  open: boolean;
  id: string;
  selfId: number | undefined;
  onClose: () => void;
  /** Called with the picked officer's name once the server accepted it. */
  onAssigned: (name: string) => void;
}) {
  const { t } = useI18n();
  const theme = useTheme();
  const [q, setQ] = useState("");
  const [picked, setPicked] = useState<InboxOfficer | null>(null);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState(false);
  // The first PEOPLE_SHOWN, then 「更多」 shows the rest (the search narrows them too).
  const [all, setAll] = useState(false);
  const load = useRemote<InboxOfficer[]>(useCallback(() => (open ? soulInboxApi.assignable(id).then((r) => r.data) : Promise.resolve([] as InboxOfficer[])), [id, open]));
  const people = useMemo(() => assignableOthers(load.data ?? [], selfId, q), [load.data, selfId, q]);

  const confirm = () => {
    if (!picked) return;
    setBusy(true);
    setProblem(false);
    soulInboxApi
      .assign(id, picked.user_id)
      .then(() => {
        onAssigned(picked.display_name);
        onClose();
      })
      .catch(() => setProblem(true))
      .finally(() => setBusy(false));
  };

  return (
    <Sheet open={open} onClose={onClose} edge={theme.hair} closeLabel={t("soul_app.common.cancel")}>
      <View testID="sheet-assign" style={{ paddingVertical: space[5], gap: space[4] }}>
        <View style={{ paddingHorizontal: space[5], gap: space[3] }}>
          <Txt variant="title">{t("officer_app.letter.assign_title")}</Txt>
          <Txt variant="caption" tone="muted" testID="assign-hint">{t("officer_app.letter.assign_hint")}</Txt>
          <Input testID="assign-search" label={t("officer_app.cosign.search")} value={q} onChangeText={setQ} />
          {load.error ? <FieldError text={t("officer_app.state.error_title")} /> : null}
        </View>
        {people.length === 0 && !load.loading && !load.error ? (
          <Txt variant="caption" tone="muted" style={{ paddingHorizontal: space[5] }}>
            {t("officer_app.cosign.empty")}
          </Txt>
        ) : null}
        {(all ? people : people.slice(0, PEOPLE_SHOWN)).map((person) => {
          const load_ = (person as { load?: number | null }).load;
          return (
            <Row
              key={person.user_id}
              testID={`assign-${person.user_id}`}
              minHeight={56}
              strong={picked?.user_id === person.user_id}
              title={person.display_name}
              lines={typeof load_ === "number" ? [t("officer_app.letter.assign_load", { n: String(load_) })] : []}
              right={<Txt variant="nav">{picked?.user_id === person.user_id ? "✓" : "○"}</Txt>}
              onPress={() => setPicked(person)}
            />
          );
        })}
        {!all && people.length > PEOPLE_SHOWN ? (
          <View style={{ paddingHorizontal: space[5], alignItems: "flex-start" }}>
            <SmallButton testID="assign-more" title={t("officer_app.cosign.more", { n: String(people.length - PEOPLE_SHOWN) })} onPress={() => setAll(true)} />
          </View>
        ) : null}
        <View style={{ paddingHorizontal: space[5], gap: space[3] }}>
          {problem ? <Notice tone="neg" testID="assign-problem">{t("officer_app.state.error_title")}</Notice> : null}
          <Button
            testID="assign-confirm"
            title={picked ? t("officer_app.letter.assign_confirm", { name: picked.display_name }) : t("officer_app.letter.assign")}
            busy={busy}
            disabled={!picked}
            onPress={confirm}
          />
        </View>
      </View>
    </Sheet>
  );
}

/** 放回这封信？ -- one confirm; archive and unarchive need none. */
export function UnassignSheet({ open, busy, onConfirm, onClose }: { open: boolean; busy: boolean; onConfirm: () => void; onClose: () => void }) {
  const { t } = useI18n();
  const theme = useTheme();
  return (
    <Sheet open={open} onClose={onClose} edge={theme.hair} closeLabel={t("soul_app.common.cancel")}>
      <View testID="sheet-unassign" style={{ padding: space[5], gap: space[4] }}>
        <Txt variant="title">{t("officer_app.letter.unassign_title")}</Txt>
        <Txt variant="body" tone="muted">{t("officer_app.letter.unassign_body")}</Txt>
        <View style={{ flexDirection: "row", gap: space[3] }}>
          <ActionButton testID="unassign-cancel" kind="outline" title={t("soul_app.common.cancel")} onPress={onClose} />
          <ActionButton testID="unassign-confirm" kind="ink" busy={busy} title={t("officer_app.letter.unassign")} onPress={onConfirm} />
        </View>
      </View>
    </Sheet>
  );
}

/** What an unassigned letter wears in place of the reply box: 转给别人 (outline) and 由我来回 (primary). */
export function TakeBar({ busy, offline = false, onTake, onAssign }: { busy: boolean; offline?: boolean; onTake: () => void; onAssign: () => void }) {
  const { t } = useI18n();
  const theme = useTheme();
  const hint = offline ? t("officer_app.offline.banner_bare") : undefined;
  return (
    <View testID="letter-take-bar" style={{ padding: space[4], flexDirection: "row", gap: space[3], borderTopWidth: 1, borderTopColor: theme.hair, backgroundColor: theme.s1 }}>
      <ActionButton testID="letter-assign" kind="outline" disabled={offline} accessibilityHint={hint} title={t("officer_app.letter.assign")} onPress={onAssign} />
      <ActionButton testID="letter-take" kind="primary" busy={busy} disabled={offline} accessibilityHint={hint} title={t("officer_app.letter.take")} onPress={onTake} />
    </View>
  );
}
