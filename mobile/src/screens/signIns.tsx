/**
 * 登录设备与记录 (Design 第二十八批 S1), under 设置 › 账号安全: the devices signed in to this account, and the last 90 days
 * of sign-ins -- failures included, consecutive identical ones already merged by the server (`count`).
 * 「退出」 needs no password: it only makes that device sign in again. This phone has no button (the top-right sign-out is
 * the way). A row leaves the list when the server says yes; nothing is removed on a guess.
 */
import { soulApi, type SoulSignInRecord, type SoulSignInSession } from "@soulledger/core/api/soul";
import { useNavigation, type NavigationProp } from "@react-navigation/native";
import { useCallback, useState } from "react";
import { Modal, Pressable, StyleSheet, View } from "react-native";

import { useToast } from "../feedback";
import { family } from "../fonts";
import { useI18n } from "../i18n";
import { formatStamp } from "../rules";
import { Button, Empty, Screen, SectionError, SectionLabel, Skeleton, Txt, useLayout, useReloadOnRefocus, useRemote, useTheme } from "../ui";
import { useBiometry } from "../useBiometry";
import type { AppStackParams } from "./applications";

function DeviceRow({ session, busy, onSignOut }: { session: SoulSignInSession; busy: boolean; onSignOut: () => void }) {
  const theme = useTheme();
  const { t } = useI18n();
  const { gutter } = useLayout();
  return (
    <View testID={`device-${session.id}`} style={[styles.row, { paddingHorizontal: gutter, borderBottomColor: theme.hair }]}>
      <View style={styles.fill}>
        <View style={styles.titleLine}>
          <Txt variant="bodyLg">{session.current ? t("soul_app.security.this_phone") : session.label}</Txt>
          {session.current ? (
            <View testID="device-this" style={[styles.tag, { borderColor: theme.ink }]}>
              <Txt variant="label" style={styles.tagText}>
                {t("profile.devices.this")}
              </Txt>
            </View>
          ) : null}
        </View>
        <Txt variant="caption" tone="muted">
          {session.current
            ? `${session.label} · ${t("profile.devices.in_use")}`
            : t("soul_app.security.last_seen", { time: formatStamp(session.last_seen_at) ?? "" })}
        </Txt>
      </View>
      {session.current ? null : (
        <Pressable
          testID={`device-signout-${session.id}`}
          accessibilityRole="button"
          disabled={busy}
          onPress={onSignOut}
          style={[styles.signOut, busy && styles.dim]}
        >
          <Txt variant="bodyLg" style={styles.underline}>
            {t("soul_app.security.sign_out")}
          </Txt>
        </Pressable>
      )}
    </View>
  );
}

function RecordRow({ record, phone }: { record: SoulSignInRecord; phone: string | undefined }) {
  const theme = useTheme();
  const { t } = useI18n();
  const { gutter } = useLayout();
  const bio = useBiometry();
  const device = record.device === phone ? t("soul_app.security.this_phone") : record.device;
  let text: string;
  if (!record.ok) {
    const key = record.method === "mfa" ? "failed_mfa" : record.method === "face" ? "failed_face" : "failed";
    text = `! ${t(`soul_app.security.${key}`, { n: String(record.count), bio: bio.word })}`;
  } else {
    const method =
      record.method === "face" ? bio.word : record.method === "recovery" ? t("soul_app.security.method_recovery") : t("soul_app.login.password");
    text = `✓ ${method} · ${device}`;
  }
  return (
    <View testID="sign-in-record" style={[styles.record, { paddingHorizontal: gutter, borderBottomColor: theme.hair }]}>
      <Txt variant="value" tone="muted" style={styles.stamp}>
        {formatStamp(record.at) ?? ""}
      </Txt>
      <Txt variant="bodyLg" tone={record.ok ? "ink" : "negInk"} style={[styles.fill, !record.ok && styles.bold]}>
        {text}
      </Txt>
    </View>
  );
}

export function SignInsScreen() {
  const theme = useTheme();
  const { t } = useI18n();
  const toast = useToast();
  const { gutter } = useLayout();
  const navigation = useNavigation<NavigationProp<AppStackParams>>();
  const devices = useRemote(soulApi.signInSessions);
  const records = useRemote(soulApi.signInRecords);
  const [gone, setGone] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState<string | null>(null);
  const [asking, setAsking] = useState(false);
  const { reload: reloadDevices } = devices;
  const { reload: reloadRecords } = records;
  const reload = useCallback(() => {
    setGone(new Set());
    return Promise.all([reloadDevices(), reloadRecords()]);
  }, [reloadDevices, reloadRecords]);
  useReloadOnRefocus(reload);

  const signOut = (id: string) => {
    if (busy) return;
    setBusy(id);
    soulApi.revokeSignInSession(id).then(
      () => setGone((prev) => new Set(prev).add(id)),
      () => toast(t("soul_app.security.sign_out_failed"), "failure")
    ).finally(() => setBusy(null));
  };

  const signOutOthers = () => {
    if (busy) return;
    setBusy("others");
    soulApi.revokeOtherSignInSessions().then(
      () => {
        setAsking(false);
        void reload();
      },
      () => toast(t("soul_app.security.sign_out_failed"), "failure")
    ).finally(() => setBusy(null));
  };

  const rows = devices.data ? [...devices.data].sort((a, b) => Number(b.current) - Number(a.current)).filter((s) => !gone.has(s.id)) : null;
  const phone = devices.data?.find((s) => s.current)?.label;
  const others = rows ? rows.filter((s) => !s.current).length : 0;

  return (
    <Screen testID="sign-ins" refreshing={(devices.loading || records.loading) && rows !== null} onRefresh={() => void reload()}>
      <View style={[styles.head, { paddingHorizontal: gutter }]}>
        <SectionLabel>{t("soul_app.security.devices")}</SectionLabel>
      </View>
      {rows ? (
        <>
          {rows.map((s) => <DeviceRow key={s.id} session={s} busy={busy === s.id} onSignOut={() => signOut(s.id)} />)}
          {others > 0 ? (
            <View style={{ paddingHorizontal: gutter, paddingTop: 12 }}>
              <Button testID="sign-out-others" kind="secondary" title={t("profile.devices.sign_out_others")} onPress={() => setAsking(true)} />
            </View>
          ) : null}
        </>
      ) : devices.error ? (
        <SectionError testID="devices-error" onRetry={() => void devices.reload()} />
      ) : (
        <View style={{ paddingHorizontal: gutter }}>
          <Skeleton lines={2} testID="devices-loading" />
        </View>
      )}

      <View style={[styles.head, { paddingHorizontal: gutter }]}>
        <SectionLabel>{t("soul_app.security.history_keep")}</SectionLabel>
      </View>
      {records.data ? (
        records.data.length === 0 ? (
          <Empty testID="records-empty" text={t("soul_app.security.no_records")} />
        ) : (
          records.data.map((r, i) => <RecordRow key={`${r.at}-${i}`} record={r} phone={phone} />)
        )
      ) : records.error ? (
        <SectionError testID="records-error" onRetry={() => void records.reload()} />
      ) : (
        <View style={{ paddingHorizontal: gutter }}>
          <Skeleton lines={3} testID="records-loading" />
        </View>
      )}

      <View style={[styles.stranger, { marginHorizontal: gutter, borderColor: theme.hair2, backgroundColor: theme.s1 }]}>
        <Txt variant="bodyLg" style={styles.bold}>
          {t("soul_app.security.stranger_title")}
        </Txt>
        <Txt variant="caption" tone="muted">
          {t("soul_app.security.stranger_body")}
        </Txt>
        <Button testID="sign-ins-change-password" title={t("profile.change_password")} onPress={() => navigation.navigate("AccountPassword")} />
      </View>
      <Modal visible={asking} transparent animationType="fade" onRequestClose={() => setAsking(false)}>
        <View style={[styles.scrim, { backgroundColor: theme.scrim }]}>
          <View testID="sign-out-others-sheet" accessibilityViewIsModal style={[styles.sheet, { backgroundColor: theme.s1, borderTopColor: theme.negStrong }]}>
            <Txt variant="bodyLg" style={styles.bold}>
              {t("profile.devices.confirm_title", { n: String(others) })}
            </Txt>
            <Txt variant="caption" tone="muted">
              {t("profile.devices.confirm_body")}
            </Txt>
            <Button
              testID="sign-out-others-confirm"
              kind="danger"
              title={t("profile.devices.confirm_action", { n: String(others) })}
              busy={busy === "others"}
              onPress={signOutOthers}
            />
            <Button testID="sign-out-others-cancel" kind="secondary" title={t("soul_app.common.cancel")} onPress={() => setAsking(false)} />
          </View>
        </View>
      </Modal>
    </Screen>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  head: { paddingTop: 24, paddingBottom: 8 },
  row: { minHeight: 64, flexDirection: "row", alignItems: "center", gap: 12, paddingVertical: 12, borderBottomWidth: 1 },
  titleLine: { flexDirection: "row", alignItems: "center", gap: 8 },
  tag: { borderWidth: 1, paddingHorizontal: 8, paddingVertical: 2 },
  tagText: { fontSize: 11, letterSpacing: 0.4 },
  signOut: { minHeight: 44, minWidth: 44, justifyContent: "center", alignItems: "center", paddingHorizontal: 8 },
  underline: { textDecorationLine: "underline" },
  dim: { opacity: 0.5 },
  record: { minHeight: 48, flexDirection: "row", alignItems: "center", gap: 12, paddingVertical: 12, borderBottomWidth: 1 },
  stamp: { fontSize: 12, letterSpacing: 0.4 },
  bold: { fontFamily: family.ui[600] },
  scrim: { flex: 1, justifyContent: "flex-end" },
  sheet: { borderTopWidth: 3, padding: 20, gap: 12 },
  stranger: { marginTop: 32, marginBottom: 32, borderWidth: 1, padding: 16, gap: 12 },
});
