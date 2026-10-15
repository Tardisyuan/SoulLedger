/**
 * 导出我的资料 (Design 第二十八批 S3), under 设置 › 我的资料: what the file holds and does not hold, the request (it needs
 * the password -- or the face when 面容 login is on: being signed in is not being the owner, and the file is the whole
 * record), and the two states of a request: 「◐ 正在准备」 (the soul may leave; a push says when it is ready) and
 * 「✓ 已准备好」 (the zip's name, size and last day, and 「保存或发送…」, which opens the system share sheet).
 *
 * Generation is queued on the server, one at a time per account. The page shows what the server last said: it reads
 * again on every focus, and while a request is in preparation it asks every `POLL_MS`. A button never claims a state the
 * server did not report.
 */
import { soulApi, soulErrorStatus, soulMfaFailure, type SoulDataExport } from "@soulledger/core/api/soul";
import { useCallback, useEffect, useRef, useState } from "react";
import { StyleSheet, TextInput, View } from "react-native";

import { EXPORT_PROMPT, bioEnabled, readCredential } from "../deviceLogin";
import { formatBytes, saveExport } from "../dataExport";
import { useToast } from "../feedback";
import { family } from "../fonts";
import { useI18n } from "../i18n";
import { stateOfFailure, type StepState } from "../mfa";
import { formatStamp } from "../rules";
import { Button, Input, Screen, SectionError, SectionLabel, Skeleton, Txt, useLayout, useReloadOnRefocus, useRemote, useTheme } from "../ui";
import { useBiometry } from "../useBiometry";
import { ButtonPair, MfaSheet, StepNotice } from "./mfaParts";

/** While a request is in preparation, ask the server this often. A push also says when it is ready. */
export const POLL_MS = 20_000;

/** What the file holds (Design's list, in its order) and what it does not. The keys are written out so the copy harvest sees them. */
const INCLUDED = [
  ["included-profile", "soul_app.export.included_profile"],
  ["included-merit", "soul_app.export.included_merit"],
  ["included-judgments", "soul_app.export.included_judgments"],
  ["included-letters", "soul_app.export.included_letters"],
  ["included-sign-ins", "soul_app.export.included_sign_ins"],
] as const;
const EXCLUDED = [
  ["excluded-deliberation", "soul_app.export.excluded_deliberation"],
  ["excluded-letters", "soul_app.export.excluded_letters"],
] as const;

function Bullets({ rows, muted }: { rows: readonly (readonly [string, string])[]; muted?: boolean }) {
  const { t } = useI18n();
  return (
    <View style={styles.bullets}>
      {rows.map(([id, key]) => (
        <View key={id} style={styles.bullet}>
          <Txt variant="bodyLg" tone={muted ? "muted" : "ink"}>
            ·
          </Txt>
          <Txt testID={id} variant="bodyLg" tone={muted ? "muted" : "ink"} style={styles.fill}>
            {t(key)}
          </Txt>
        </View>
      ))}
    </View>
  );
}

/** The password, asked in a sheet. A wrong one keeps the sheet; 409 means a request is already in preparation. */
function RequestSheet({ open, onClose, onDone }: { open: boolean; onClose: () => void; onDone: () => void }) {
  const { t } = useI18n();
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [state, setState] = useState<StepState>({ kind: "idle" });
  const field = useRef<TextInput>(null);
  const close = () => {
    setPassword("");
    setState({ kind: "idle" });
    onClose();
  };
  const next = async () => {
    if (!password || busy || state.kind === "rate_limited") return;
    setBusy(true);
    setState({ kind: "idle" });
    try {
      await soulApi.requestDataExport({ password });
      close();
      onDone();
    } catch (e) {
      if (soulErrorStatus(e) === 409) {
        // One is already in preparation: the page is wrong, not the password.
        close();
        onDone();
      } else {
        setState(stateOfFailure(soulMfaFailure(e)));
        field.current?.focus();
      }
    } finally {
      setBusy(false);
    }
  };
  return (
    <MfaSheet testID="export-sheet" open={open} onClose={close} closeLabel={t("soul_app.common.cancel")}>
      <Txt accessibilityRole="header" style={styles.sheetTitle}>
        {t("soul_app.export.sheet_title")}
      </Txt>
      <Txt variant="bodyLg">{t("soul_app.export.sheet_body")}</Txt>
      <Input
        testID="export-password"
        inputRef={field}
        label={t("soul_app.login.password")}
        value={password}
        onChangeText={setPassword}
        editable={!busy}
        invalid={state.kind === "wrong"}
        secureTextEntry
        secureToggle={{ show: t("soul_app.common.show"), hide: t("soul_app.common.hide") }}
        autoComplete="current-password"
        onSubmitEditing={() => void next()}
      />
      <StepNotice state={state} password />
      <ButtonPair>
        <Button testID="export-cancel" kind="secondary" title={t("soul_app.common.cancel")} onPress={close} disabled={busy} style={styles.fill} />
        <Button testID="export-next" title={t("soul_app.export.sheet_next")} onPress={() => void next()} busy={busy} disabled={!password || state.kind === "rate_limited"} style={styles.fill} />
      </ButtonPair>
    </MfaSheet>
  );
}

function Card({ testID, strong, children }: { testID: string; strong?: boolean; children: React.ReactNode }) {
  const theme = useTheme();
  return (
    <View testID={testID} style={[styles.card, { borderColor: strong ? theme.ink : theme.inkSubtle }]}>
      {children}
    </View>
  );
}

function Queued({ exp }: { exp: SoulDataExport }) {
  const { t } = useI18n();
  return (
    <Card testID="export-queued">
      <Txt variant="section">{`◐ ${t("soul_app.export.queued")}`}</Txt>
      <Txt variant="caption" tone="muted">
        {t("soul_app.export.requested_at", { time: formatStamp(exp.requested_at) ?? "" })}
      </Txt>
    </Card>
  );
}

function Ready({ exp, onShare, sharing }: { exp: SoulDataExport; onShare: () => void; sharing: boolean }) {
  const { t } = useI18n();
  return (
    <Card testID="export-ready" strong>
      <Txt variant="section">{`✓ ${t("soul_app.export.ready")}`}</Txt>
      <Txt variant="caption" tone="muted">
        <Txt testID="export-file-name" variant="value" tone="muted" style={styles.mono}>
          {exp.file_name}
        </Txt>
        {exp.byte_size ? ` · ${formatBytes(exp.byte_size)}` : ""}
        {"\n"}
        {t("soul_app.export.available_until", { time: formatStamp(exp.expires_at) ?? "" })}
      </Txt>
      <Button testID="export-share" title={t("soul_app.export.share")} onPress={onShare} busy={sharing} />
    </Card>
  );
}

export function DataExportScreen() {
  const { t } = useI18n();
  const toast = useToast();
  const { gutter } = useLayout();
  const bio = useBiometry();
  const remote = useRemote(soulApi.dataExport);
  useReloadOnRefocus(remote.reload);
  const [asking, setAsking] = useState(false);
  const [working, setWorking] = useState(false);
  const [sharing, setSharing] = useState(false);
  const exp = remote.data?.export ?? null;
  const preparing = exp?.status === "QUEUED" || exp?.status === "RUNNING";

  const { reload } = remote;
  useEffect(() => {
    if (!preparing) return;
    const timer = setInterval(() => void reload(), POLL_MS);
    return () => clearInterval(timer);
  }, [preparing, reload]);

  /** The face first when it is on; a face that does not answer falls back to the password sheet. */
  const request = useCallback(async () => {
    if (working) return;
    if (!bioEnabled()) return setAsking(true);
    setWorking(true);
    try {
      const read = await readCredential(EXPORT_PROMPT);
      if (read.status === "ok") {
        try {
          await soulApi.requestDataExport({ credential: read.credential });
          void reload();
          return;
        } catch (e) {
          if (soulErrorStatus(e) === 409) return void reload();
        }
      }
      setAsking(true);
    } finally {
      setWorking(false);
    }
  }, [working, reload]);

  const share = async () => {
    if (sharing) return;
    setSharing(true);
    try {
      const outcome = await saveExport(t("soul_app.export.share"));
      if (outcome === "expired") void reload();
      else if (outcome === "download_failed") toast(t("soul_app.export.download_failed"), "failure");
      else if (outcome === "share_failed" || outcome === "unavailable") toast(t("soul_app.export.share_failed"), "failure");
    } finally {
      setSharing(false);
    }
  };

  return (
    <Screen testID="data-export" refreshing={remote.loading && !!remote.data} onRefresh={remote.reload}>
      {!remote.data ? (
        remote.error ? (
          <SectionError testID="export-error" onRetry={remote.reload} />
        ) : (
          <View style={[styles.pad, { paddingHorizontal: gutter }]}>
            <Skeleton lines={4} testID="export-loading" />
          </View>
        )
      ) : (
        <View style={[styles.pad, { paddingHorizontal: gutter }]}>
          {exp && (exp.status === "QUEUED" || exp.status === "RUNNING") ? <Queued exp={exp} /> : null}
          {exp?.status === "READY" ? <Ready exp={exp} onShare={() => void share()} sharing={sharing} /> : null}
          {exp?.status === "READY" ? (
            <Txt testID="export-share-note" variant="body" tone="muted">
              {t("soul_app.export.share_note")}
            </Txt>
          ) : null}
          {exp?.status === "EXPIRED" ? (
            <Txt testID="export-expired" variant="bodyLg" tone="muted">
              {t("soul_app.export.expired")}
            </Txt>
          ) : null}
          {exp?.status === "FAILED" ? (
            <Txt testID="export-failed" variant="bodyLg" tone="negInk">
              {t("soul_app.export.failed")}
            </Txt>
          ) : null}
          {!exp || exp.status === "EXPIRED" || exp.status === "FAILED" ? (
            <>
              <Txt variant="bodyLg">{t("soul_app.export.intro")}</Txt>
              <SectionLabel>{t("soul_app.export.included")}</SectionLabel>
              <Bullets rows={INCLUDED} />
              <SectionLabel>{t("soul_app.export.excluded")}</SectionLabel>
              <Bullets rows={EXCLUDED} muted />
              <Txt variant="caption" tone="muted">
                {t("soul_app.export.timing")}
              </Txt>
              <Button
                testID="export-request"
                title={bioEnabled() ? t("soul_app.export.request_face", { bio: bio.word }) : t(exp ? "soul_app.export.request_again" : "soul_app.export.request")}
                onPress={() => void request()}
                busy={working}
              />
            </>
          ) : null}
        </View>
      )}
      <RequestSheet open={asking} onClose={() => setAsking(false)} onDone={() => void reload()} />
    </Screen>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  pad: { paddingVertical: 24, gap: 16 },
  bullets: { gap: 4 },
  bullet: { flexDirection: "row", gap: 8 },
  card: { borderWidth: 1, padding: 16, gap: 8 },
  mono: { fontFamily: family.mono[400] },
  sheetTitle: { fontFamily: family.ui[600], fontSize: 20, lineHeight: 28 },
});
