/**
 * 扫交付单上的码 (第二十批 §一.6). Full-screen camera, QR only, a 248 frame, a flashlight.
 * A good code buzzes once and goes back to the sign-in page with the number filled in; a code that is not ours puts a
 * red bar up for 4 seconds (restarted by every further bad scan) and the camera never stops. A refused camera
 * permission is a page of its own with two ways on.
 * 「从相册选」 (S4, 2026-11-15): a photo of the slip, read by expo-camera's `scanFromURLAsync` -- the same answer as a
 * live scan. Needs no camera permission, so the refused page offers it too.
 * Design 第五十二批 F3: 「从相册选」 and 「手电筒」 side by side under the frame, the same outlined capsule (44 high);
 * 「手动输入编号」 a text link under them; one privacy line for both camera and album (`privacy_both`). A picture with
 * no code in it is a light two-line notice at the bottom, in place of the link and that line -- the page and the
 * camera stay; a code in the picture that is not ours is the same red bar as a live one.
 */
import { parseSoulCodeQr } from "@soulledger/core/domain/soulCode";
import { useNavigation } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { CameraView, scanFromURLAsync, useCameraPermissions } from "expo-camera";
import * as Haptics from "expo-haptics";
import * as ImagePicker from "expo-image-picker";
import { useCallback, useEffect, useRef, useState } from "react";
import { Linking, StyleSheet, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Svg, { Path } from "react-native-svg";

import { family } from "../fonts";
import { useI18n } from "../i18n";
import { INVALID_BANNER_MS } from "../loginRules";
import { Button, Screen, Txt, useTheme, Press } from "../ui";

/** What the sign-in page receives: a fresh `at` per scan, so the same code twice still lands. */
export type ScannedParams = { scanned: string; at: number };

const WHITE = "#FFFFFF";

function Corner({ style }: { style: object }) {
  return <View style={[styles.corner, style]} />;
}

function PhotoGlyph({ color }: { color: string }) {
  return (
    <Svg width={16} height={16} viewBox="0 0 16 16" fill="none" stroke={color} strokeWidth={1.4} strokeLinejoin="round">
      <Path d="M2 3h12v10H2ZM2 11l3.5-3.5L8 10l2-2 4 4" />
    </Svg>
  );
}

/** The no-code notice: a light card on the camera's dark (v4 light --card2 / --ink / --sub), not themed. */
const NOTICE = { ground: "#F3F3F1", ink: "#16171A", sub: "#54575C" };

export function ScanScreen() {
  const theme = useTheme();
  const { t } = useI18n();
  const insets = useSafeAreaInsets();
  const navigation = useNavigation<NativeStackNavigationProp<{ Login: ScannedParams | undefined; ScanCode: undefined }>>();
  const [permission, request] = useCameraPermissions();
  const [torch, setTorch] = useState(false);
  // The red bar: a code that is not ours (live or from a picture). A picture with no code: the bottom notice.
  const [invalid, setInvalid] = useState<"invalid" | "photo_none" | null>(null);
  const [reading, setReading] = useState(false);
  const done = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (permission && !permission.granted && permission.canAskAgain) void request();
  }, [permission, request]);
  useEffect(() => () => void (timer.current && clearTimeout(timer.current)), []);

  const close = useCallback(() => navigation.goBack(), [navigation]);

  const warn = (which: "invalid" | "photo_none") => {
    setInvalid(which);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setInvalid(null), INVALID_BANNER_MS);
  };
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
    warn("invalid");
  };

  const fromAlbum = async () => {
    if (reading || done.current) return;
    setReading(true);
    try {
      // The system picker (iOS PHPicker, Android Photo Picker) asks for no permission itself.
      const res = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ["images"], exif: false });
      const uri = res.canceled ? null : res.assets?.[0]?.uri;
      if (!uri) return;
      const found = await scanFromURLAsync(uri, ["qr"]);
      if (!found.length) return warn("photo_none");
      // Several codes in one picture: ours, if any is.
      scanned(found.find((r) => parseSoulCodeQr(r.data)) ?? found[0]);
    } catch {
      warn("photo_none");
    } finally {
      setReading(false);
    }
  };
  // The capsule: outlined, 44 high; white on the camera, the ink on the refused page's paper.
  const album = (ink: string) => (
    <Press testID="scan-album" accessibilityRole="button" accessibilityState={{ busy: reading }} onPress={() => void fromAlbum()} style={[styles.capsule, { borderColor: ink }]}>
      <PhotoGlyph color={ink} />
      <Txt variant="bodyLg" style={{ color: ink }}>
        {t("soul_app.scan.from_photos")}
      </Txt>
    </Press>
  );
  const banner = (top: number) =>
    invalid === "invalid" ? (
      <View testID="scan-invalid" accessibilityRole="alert" accessibilityLiveRegion="assertive" style={[styles.invalid, { top, backgroundColor: theme.s1, borderColor: theme.neg }]}>
        <Txt style={[styles.invalidTitle, { color: theme.negInk }]}>{t("soul_app.scan.invalid")}</Txt>
        <Txt variant="caption" tone="muted">
          {t("soul_app.scan.invalid_body")}
        </Txt>
      </View>
    ) : null;
  // In place of the link and the privacy line while it is up.
  const photoNone = (
    <View testID="scan-photo-none" accessibilityRole="alert" accessibilityLiveRegion="polite" style={styles.notice}>
      <Txt style={[styles.noticeTitle, { color: NOTICE.ink }]}>{t("soul_app.scan.photo_none")}</Txt>
      <Txt variant="caption" style={{ color: NOTICE.sub }}>
        {t("soul_app.scan.photo_none_body")}
      </Txt>
    </View>
  );

  if (!permission) return <View testID="scan-loading" style={styles.dark} />;

  if (!permission.granted && !permission.canAskAgain) {
    return (
      <Screen testID="scan-denied" edges={["top", "left", "right", "bottom"]}>
        <View style={styles.barFlow}>
          <Press testID="scan-close" accessibilityRole="button" accessibilityLabel={t("soul_app.scan.close")} onPress={close} style={styles.close}>
            <Txt style={styles.closeGlyph}>×</Txt>
          </Press>
        </View>
        <View style={styles.denied}>
          <Txt accessibilityRole="header" style={styles.deniedTitle}>
            {t("soul_app.scan.denied_title")}
          </Txt>
          <Txt variant="bodyLg">{t("soul_app.scan.denied_body")}</Txt>
          <Button testID="scan-open-settings" title={t("soul_app.scan.open_settings")} onPress={() => void Linking.openSettings()} />
          <Button testID="scan-manual" kind="secondary" title={t("soul_app.scan.manual")} onPress={close} />
          {album(theme.ink)}
          {invalid === "photo_none" ? (
            photoNone
          ) : (
            <Txt testID="scan-privacy" variant="caption" tone="muted">
              {t("soul_app.scan.privacy_both")}
            </Txt>
          )}
        </View>
        {banner(insets.top + 64)}
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
        <Press testID="scan-close" accessibilityRole="button" accessibilityLabel={t("soul_app.scan.close")} onPress={close} style={styles.close}>
          <Txt style={[styles.closeGlyph, { color: WHITE }]}>×</Txt>
        </Press>
        <Txt accessibilityRole="header" style={styles.title}>
          {t("soul_app.scan.title")}
        </Txt>
      </View>
      {banner(insets.top + 64)}
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
        <View testID="scan-capsules" style={styles.capsules}>
          {album(WHITE)}
          <Press
            testID="scan-torch"
            accessibilityRole="switch"
            accessibilityState={{ checked: torch }}
            accessibilityLabel={t("soul_app.scan.torch")}
            onPress={() => setTorch((v) => !v)}
            style={[styles.capsule, { borderColor: WHITE }, torch && { backgroundColor: WHITE }]}
          >
            <Txt testID="scan-torch-label" variant="bodyLg" style={[{ color: torch ? "#1A1A18" : WHITE }, torch && { fontFamily: family.ui[600] }]}>
              {t(torch ? "soul_app.scan.torch_on" : "soul_app.scan.torch")}
            </Txt>
          </Press>
        </View>
        {invalid === "photo_none" ? (
          photoNone
        ) : (
          <>
            <Press testID="scan-manual" accessibilityRole="link" onPress={close} style={styles.manual}>
              <Txt variant="bodyLg" style={styles.manualText}>
                {t("soul_app.scan.manual")}
              </Txt>
            </Press>
            <Txt testID="scan-privacy" variant="caption" style={styles.privacy}>
              {t("soul_app.scan.privacy_both")}
            </Txt>
          </>
        )}
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
  bottom: { position: "absolute", left: 16, right: 16, alignItems: "center", gap: 16 },
  capsules: { flexDirection: "row", justifyContent: "center", gap: 12 },
  capsule: { height: 44, borderWidth: 1, borderRadius: 22, paddingHorizontal: 16, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, alignSelf: "center" },
  manual: { minHeight: 44, justifyContent: "center" },
  manualText: { color: WHITE, textDecorationLine: "underline" },
  privacy: { color: "#D8D8D2", textAlign: "center" },
  notice: { alignSelf: "stretch", backgroundColor: NOTICE.ground, borderRadius: 12, paddingVertical: 12, paddingHorizontal: 16, gap: 2 },
  noticeTitle: { fontFamily: family.ui[600], fontSize: 15, lineHeight: 22 },
  denied: { padding: 24, gap: 16 },
  deniedTitle: { fontFamily: family.ui[600], fontSize: 24, lineHeight: 32 },
});
