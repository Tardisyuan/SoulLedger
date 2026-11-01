/**
 * 退出登录, wherever it is offered (我的, the two-step hold, the forced password change). Signing out clears this
 * phone's unsent replies and reply drafts (A7: the next officer finds nothing), so when there are any the officer is
 * told how many first and can try sending, stay, or sign out anyway (user, 2026-11-01). With nothing pending,
 * `ask` decides: 我的 still asks (push stops on this device), the other two sign out at once as before.
 */
import { useState } from "react";
import { Pressable, View } from "react-native";

import { draftIds } from "../drafts";
import { ActionButton } from "../kit";
import { retryAll, useOutbox } from "../outbox";
import { useSession } from "../session";
import { Notice, Txt, space, useI18n, useOnline } from "../shared";

export function SignOutButton({ testID, kind, ask = false, onAsk }: { testID: string; kind: "outline" | "ink-outline"; ask?: boolean; onAsk?: () => void }) {
  const { t } = useI18n();
  const { signOut } = useSession();
  const { offline } = useOnline();
  const outbox = useOutbox();
  const [asking, setAsking] = useState(false);
  const [busy, setBusy] = useState(false);
  const unsent = outbox.length;
  // A queued reply's words are also its conversation's draft (outbox.ts): counted once, as unsent.
  const drafts = asking ? draftIds().filter((id) => !outbox.some((e) => e.id === id)).length : 0;
  const pending = unsent + drafts > 0;

  const start = () => {
    if (!ask && unsent === 0 && draftIds().length === 0) return signOut();
    setAsking(true);
  };
  const retry = () => {
    setBusy(true);
    void retryAll().finally(() => setBusy(false));
  };

  if (!asking) return <ActionButton testID={testID} kind={kind} title={t("officer_app.me.logout")} onPress={start} />;
  return (
    // Replaces the button it was asked from (the page follows it down, me.tsx).
    <View testID={`${testID}-asking`} style={{ gap: space[3] }} onLayout={onAsk}>
      {/* Signing out is not a warning (Design batch 67 §三.4): the sentence says what is at stake. */}
      <Notice tone="neutral" testID={pending ? `${testID}-pending` : undefined}>
        <Txt variant="caption">
          {pending ? t(unsent && drafts ? "officer_app.me.logout_pending" : unsent ? "officer_app.me.logout_pending_unsent" : "officer_app.me.logout_pending_drafts", { unsent: String(unsent), drafts: String(drafts) }) : t("officer_app.me.logout_title")}
        </Txt>
      </Notice>
      {pending && unsent > 0 ? (
        <ActionButton
          testID={`${testID}-retry`}
          kind="primary"
          busy={busy}
          disabled={offline}
          accessibilityHint={offline ? t("officer_app.offline.banner_bare") : undefined}
          title={t("officer_app.me.logout_retry")}
          onPress={retry}
        />
      ) : null}
      {pending ? (
        <>
          <ActionButton testID={`${testID}-cancel`} kind="outline" title={t("soul_app.common.cancel")} onPress={() => setAsking(false)} />
          <Pressable testID={`${testID}-confirm`} accessibilityRole="button" onPress={() => signOut()} hitSlop={8} style={{ alignSelf: "center", paddingVertical: space[2] }}>
            <Txt variant="caption" style={{ textDecorationLine: "underline" }}>
              {t("officer_app.me.logout_anyway")}
            </Txt>
          </Pressable>
        </>
      ) : (
        <View style={{ flexDirection: "row", gap: space[3] }}>
          <ActionButton testID={`${testID}-cancel`} kind="outline" title={t("soul_app.common.cancel")} onPress={() => setAsking(false)} />
          <ActionButton testID={`${testID}-confirm`} kind="ink" title={t("officer_app.me.logout_ok")} onPress={() => signOut()} />
        </View>
      )}
    </View>
  );
}
