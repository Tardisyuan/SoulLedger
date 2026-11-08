/**
 * 「锁屏上看不到进度」, once (用户 2026-11-08 决定): Android 12 and below, notifications off for the app, and the first
 * live progress has something to show (`shouldOfferNotifySettings`, liveProgress.ts). Same sheet as 「下次用指纹登录？」;
 * held while that one or the welcome is still to come, so the two never stack. Either button ends it for good.
 */
import Constants from "expo-constants";
import { useSyncExternalStore } from "react";
import { Linking, StyleSheet } from "react-native";

import { useI18n } from "../i18n";
import { dismissNotifySettingsHint, useNotifySettingsHint } from "../liveProgress";
import { Button, Txt } from "../ui";
import { SheetTitle } from "./bio";
import { ButtonPair, MfaSheet } from "./mfaParts";

/** This app's own notification page; the app's settings page where a ROM does not have that one. */
async function openNotificationSettings(): Promise<void> {
  const pkg = Constants.expoConfig?.android?.package;
  try {
    if (!pkg) throw new Error("no package");
    await Linking.sendIntent("android.settings.APP_NOTIFICATION_SETTINGS", [{ key: "android.provider.extra.APP_PACKAGE", value: pkg }]);
  } catch {
    await Linking.openSettings().catch(() => {});
  }
}

/*
 * Whether the face / finger question is settled, kept outside React: SignedInOverlays used to hold it in state, and
 * BioAsk's late `bio.ready` then re-rendered the overlays after tests had ended (act() warnings in every signed-in
 * test). Only a hint that is actually due subscribes to it.
 */
let bioSettled = false;
const bioListeners = new Set<() => void>();
export function setBioSettled(settled: boolean): void {
  if (settled === bioSettled) return;
  bioSettled = settled;
  bioListeners.forEach((l) => l());
}
const subscribeBio = (l: () => void) => (bioListeners.add(l), () => void bioListeners.delete(l));

export function NotifySettingsHint() {
  return useNotifySettingsHint() ? <DueHint /> : null;
}

function DueHint() {
  const { t } = useI18n();
  const held = !useSyncExternalStore(subscribeBio, () => bioSettled);
  const due = true;
  const open = () => {
    dismissNotifySettingsHint();
    void openNotificationSettings();
  };
  return (
    <MfaSheet testID="notify-hint" open={due && !held} onClose={dismissNotifySettingsHint} closeLabel={t("soul_app.bio.ask_later")}>
      <SheetTitle>{t("soul_app.push.live_hint_title")}</SheetTitle>
      <Txt variant="bodyLg">{t("soul_app.push.live_hint_body")}</Txt>
      <ButtonPair>
        <Button testID="notify-hint-later" kind="secondary" title={t("soul_app.bio.ask_later")} onPress={dismissNotifySettingsHint} style={styles.fill} />
        <Button testID="notify-hint-open" title={`${t("soul_app.settings.open_system_settings")} ↗︎`} onPress={open} style={styles.fill} />
      </ButtonPair>
    </MfaSheet>
  );
}

const styles = StyleSheet.create({ fill: { flex: 1 } });
