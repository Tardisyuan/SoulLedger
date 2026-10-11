/**
 * 扫交付单上的码 (第二十批 §一.6). Full-screen camera, QR only, a 248 frame, a flashlight; no photo library on purpose.
 * A good code buzzes once and goes back to the sign-in page with the number filled in; a code that is not ours puts a
 * red bar up for 4 seconds (restarted by every further bad scan) and the camera never stops. A refused camera
 * permission is a page of its own with two ways on.
 */
import { parseSoulCodeQr } from "@soulledger/core/domain/soulCode";
import { useNavigation } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { CameraView, useCameraPermissions } from "expo-camera";
import * as Haptics from "expo-haptics";
import { useCallback, useEffect, useRef, useState } from "react";
import { Linking, Pressable, StyleSheet, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Svg, { Path } from "react-native-svg";

import { family } from "../fonts";
import { useI18n } from "../i18n";
import { INVALID_BANNER_MS } from "../loginRules";
import { Button, Screen, Txt, useTheme } from "../ui";

/** What the sign-in page receives: a fresh `at` per scan, so the same code twice still lands. */
export type ScannedParams = { scanned: string; at: number };

const WHITE = "#FFFFFF";

function Corner({ style }: { style: object }) {
  return <View style={[styles.corner, style]} />;
}

function TorchGlyph({ color }: { color: string }) {
  return (
    <Svg width={24} height={24} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={1.5} strokeLinejoin="round">
      <Path d="M8 3h8l-1.5 5h-5L8 3ZM9.5 8v3.5L12 14l2.5-2.5V8M12 14v7" />
    </Svg>
  );
}

export function ScanScreen() {
  const theme = useTheme();
  const { t } = useI18n();
  const insets = useSafeAreaInsets();
  const navigation = useNavigation<NativeStackNavigationProp<{ Login: ScannedParams | undefined; ScanCode: undefined }>>();
  const [permission, request] = useCameraPermissions();
  const [torch, setTorch] = useState(false);
  const [invalid, setInvalid] = useState(false);
  const done = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (permission && !permission.granted && permission.canAskAgain) void request();
  }, [permission, request]);
  useEffect(() => () => void (timer.current && clearTimeout(timer.current)), []);

  const close = useCallback(() => navigation.goBack(), [navigation]);

  const scanned = ({ data }: { data: string }) => {
    if (done.current) return;
    const code = parseSoulCodeQr(data);
    if (code) {
      done.current = true;
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
      // popTo: the sign-in page is below this one in the stack; `navigate` would stack a second one.
      navigation.popTo("Login", { scanned: code, at: Date.now() });
      return;
    }
    setInvalid(true);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setInvalid(false), INVALID_BANNER_MS);
  };

  if (!permission) return <View testID="scan-loading" style={styles.dark} />;

  if (!permission.granted && !permission.canAskAgain) {
    return (
      <Screen testID="scan-denied" edges={["top", "left", "right", "bottom"]}>
        <View style={styles.barFlow}>
          <Pressable testID="scan-close" accessibilityRole="button" accessibilityLabel={t("soul_app.scan.close")} onPress={close} style={styles.close}>
            <Txt style={styles.closeGlyph}>×</Txt>
          </Pressable>
        </View>
        <View style={styles.denied}>
          <Txt accessibilityRole="header" style={styles.deniedTitle}>
            {t("soul_app.scan.denied_title")}
          </Txt>
          <Txt variant="bodyLg">{t("soul_app.scan.denied_body")}</Txt>
          <Button testID="scan-open-settings" title={t("soul_app.scan.open_settings")} onPress={() => void Linking.openSettings()} />
          <Button testID="scan-manual" kind="secondary" title={t("soul_app.scan.manual")} onPress={close} />
          <Txt variant="caption" tone="muted">
            {t("soul_app.scan.privacy")}
          </Txt>
        </View>
      </Screen>
    );
  }

  return (
    <View testID="scan" style={styles.dark}>
      {permission.granted ? (
        <CameraView
          testID="scan-camera"
          style={StyleSheet.absoluteFill}
          facing="back"
          enableTorch={torch}
          barcodeScannerSettings={{ barcodeTypes: ["qr"] }}
          onBarcodeScanned={scanned}
        />
      ) : null}
      <View style={[styles.bar, { top: insets.top }]}>
        <Pressable testID="scan-close" accessibilityRole="button" accessibilityLabel={t("soul_app.scan.close")} onPress={close} style={styles.close}>
          <Txt style={[styles.closeGlyph, { color: WHITE }]}>×</Txt>
        </Pressable>
        <Txt accessibilityRole="header" style={styles.title}>
          {t("soul_app.scan.title")}
        </Txt>
      </View>
      {invalid ? (
        <View testID="scan-invalid" accessibilityRole="alert" accessibilityLiveRegion="assertive" style={[styles.invalid, { top: insets.top + 64, backgroundColor: theme.s1, borderColor: theme.neg }]}>
          <Txt style={[styles.invalidTitle, { color: theme.negInk }]}>{t("soul_app.scan.invalid")}</Txt>
          <Txt variant="caption" tone="muted">
            {t("soul_app.scan.invalid_body")}
          </Txt>
        </View>
      ) : null}
      <View pointerEvents="none" style={styles.aim}>
        <View style={styles.frame}>
          <Corner style={{ left: 0, top: 0, borderLeftWidth: 3, borderTopWidth: 3 }} />
          <Corner style={{ right: 0, top: 0, borderRightWidth: 3, borderTopWidth: 3 }} />
          <Corner style={{ left: 0, bottom: 0, borderLeftWidth: 3, borderBottomWidth: 3 }} />
          <Corner style={{ right: 0, bottom: 0, borderRightWidth: 3, borderBottomWidth: 3 }} />
        </View>
        <View style={styles.hint}>
          <Txt style={styles.hintTitle}>{t("soul_app.scan.hint")}</Txt>
          <Txt variant="body" style={styles.hintSub}>
            {t("soul_app.scan.hint_sub")}
          </Txt>
        </View>
      </View>
      <View style={[styles.bottom, { bottom: 32 + insets.bottom }]}>
        <Pressable
          testID="scan-torch"
          accessibilityRole="switch"
          accessibilityState={{ checked: torch }}
          accessibilityLabel={t("soul_app.scan.torch")}
          onPress={() => setTorch((v) => !v)}
          style={styles.torch}
        >
          <View style={[styles.torchDisc, torch ? { backgroundColor: WHITE } : { borderColor: WHITE, borderWidth: 1.5 }]}>
            <TorchGlyph color={torch ? "#1A1A18" : WHITE} />
          </View>
          <Txt testID="scan-torch-label" variant="body" style={[styles.torchLabel, torch && { fontFamily: family.ui[600] }]}>
            {t(torch ? "soul_app.scan.torch_on" : "soul_app.scan.torch")}
          </Txt>
        </Pressable>
        <Pressable testID="scan-manual" accessibilityRole="link" onPress={close} style={styles.manual}>
          <Txt variant="bodyLg" style={styles.manualText}>
            {t("soul_app.scan.manual")}
          </Txt>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  dark: { flex: 1, backgroundColor: "#2A2B28" },
  bar: { position: "absolute", left: 0, right: 0, height: 56, flexDirection: "row", alignItems: "center", gap: 4, paddingLeft: 4, paddingRight: 16 },
  barFlow: { height: 56, flexDirection: "row", alignItems: "center", paddingLeft: 4 },
  close: { width: 44, height: 44, alignItems: "center", justifyContent: "center" },
  closeGlyph: { fontSize: 28, lineHeight: 32 },
  title: { color: WHITE, fontFamily: family.ui[600], fontSize: 17, lineHeight: 24 },
  invalid: { position: "absolute", left: 16, right: 16, borderWidth: 1, paddingVertical: 12, paddingHorizontal: 16, gap: 2 },
  invalidTitle: { fontFamily: family.ui[600], fontSize: 15, lineHeight: 22 },
  aim: { position: "absolute", left: 24, right: 24, top: "28%", alignItems: "center", gap: 24 },
  frame: { width: 248, height: 248 },
  corner: { position: "absolute", width: 32, height: 32, borderColor: WHITE },
  hint: { alignItems: "center", gap: 4 },
  hintTitle: { color: WHITE, fontFamily: family.ui[500], fontSize: 15, lineHeight: 24, textAlign: "center" },
  hintSub: { color: "#D8D8D2", textAlign: "center" },
  bottom: { position: "absolute", left: 0, right: 0, alignItems: "center", gap: 16 },
  torch: { alignItems: "center", gap: 8, minWidth: 80 },
  torchDisc: { width: 56, height: 56, alignItems: "center", justifyContent: "center" },
  torchLabel: { color: WHITE },
  manual: { minHeight: 44, justifyContent: "center" },
  manualText: { color: WHITE, textDecorationLine: "underline" },
  denied: { padding: 24, gap: 16 },
  deniedTitle: { fontFamily: family.ui[600], fontSize: 24, lineHeight: 32 },
});
