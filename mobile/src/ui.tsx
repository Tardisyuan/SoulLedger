import type { SoulErrorMessage } from "@soulledger/core/api/soul";
import type { EnumDisplay } from "@soulledger/core/domain/enumDisplay";
import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import {
  ActivityIndicator,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
  type TextInputProps,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { useI18n } from "./i18n";
import { paletteFor, type Palette } from "./theme";

export const PaletteContext = createContext<Palette>(paletteFor(null, "dark"));
export const usePalette = () => useContext(PaletteContext);

/** Loading / error / data for one request, with a `reload` for pull-to-refresh and retry. */
export function useRemote<T>(fetcher: () => Promise<T>) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [loading, setLoading] = useState(true);
  const run = useCallback(
    () =>
      fetcher()
        .then(
          (value) => {
            setData(value);
            setError(null);
          },
          (e: unknown) => setError(e)
        )
        .finally(() => setLoading(false)),
    [fetcher]
  );
  useEffect(() => {
    void run();
  }, [run]);
  const reload = useCallback(() => {
    setLoading(true);
    return run();
  }, [run]);
  return { data, error, loading, reload };
}

export function Screen({
  children,
  refreshing,
  onRefresh,
  scroll = true,
}: {
  children: ReactNode;
  refreshing?: boolean;
  onRefresh?: () => void;
  scroll?: boolean;
}) {
  const p = usePalette();
  const body = scroll ? (
    <ScrollView
      contentContainerStyle={styles.screenBody}
      keyboardShouldPersistTaps="handled"
      refreshControl={
        onRefresh ? <RefreshControl refreshing={!!refreshing} onRefresh={onRefresh} tintColor={p.accent} /> : undefined
      }
    >
      {children}
    </ScrollView>
  ) : (
    <View style={styles.screenBody}>{children}</View>
  );
  return (
    <SafeAreaView edges={["left", "right", "bottom"]} style={[styles.fill, { backgroundColor: p.canvas }]}>
      {body}
    </SafeAreaView>
  );
}

export function Card({ children, testID }: { children: ReactNode; testID?: string }) {
  const p = usePalette();
  return (
    <View testID={testID} style={[styles.card, { backgroundColor: p.surface1, borderColor: p.hairline }]}>
      {children}
    </View>
  );
}

export function Heading({ children }: { children: ReactNode }) {
  const p = usePalette();
  return <Text style={[styles.heading, { color: p.accent }]}>{children}</Text>;
}

export function Body({ children, muted, testID }: { children: ReactNode; muted?: boolean; testID?: string }) {
  const p = usePalette();
  return (
    <Text testID={testID} style={[styles.body, { color: muted ? p.inkMuted : p.ink }]}>
      {children}
    </Text>
  );
}

export function Field({ label, children }: { label: string; children: ReactNode }) {
  const p = usePalette();
  return (
    <View style={styles.field}>
      <Text style={[styles.fieldLabel, { color: p.inkSubtle }]}>{label}</Text>
      <Text style={[styles.body, { color: p.ink }]}>{children}</Text>
    </View>
  );
}

/** The string form of `<EnumText>`, for where a component cannot go (a translation parameter). */
export function enumText(d: EnumDisplay, t: (key: string) => string): string {
  if (d.state === "missing") return t("common.value.unrecorded");
  return d.state === "unrecognized" ? `${d.label} (${d.raw})` : d.label;
}

/**
 * An enum as text. Unknown members are shown as "unrecognized value" PLUS the
 * raw member, in italics; a missing value is "not recorded". Neither is ever
 * dropped or shown as a dotted key.
 */
export function EnumText({ namespace, value }: { namespace: string; value: string | null | undefined }) {
  const { enumLabel, t } = useI18n();
  const p = usePalette();
  const d = enumLabel(namespace, value);
  if (d.state === "known") return <Text>{d.label}</Text>;
  return (
    <Text style={{ color: p.inkSubtle, fontStyle: d.state === "unrecognized" ? "italic" : "normal" }}>
      {enumText(d, t)}
    </Text>
  );
}

export function Input(props: TextInputProps & { label: string }) {
  const p = usePalette();
  const { label, style, ...rest } = props;
  return (
    <View style={styles.field}>
      <Text style={[styles.fieldLabel, { color: p.inkSubtle }]}>{label}</Text>
      <TextInput
        accessibilityLabel={label}
        placeholderTextColor={p.inkSubtle}
        style={[styles.input, { color: p.ink, borderColor: p.hairline, backgroundColor: p.surface2 }, style]}
        autoCapitalize="none"
        autoCorrect={false}
        {...rest}
      />
    </View>
  );
}

export function Button({
  title,
  onPress,
  disabled,
  kind = "primary",
  testID,
}: {
  title: string;
  onPress: () => void;
  disabled?: boolean;
  kind?: "primary" | "secondary";
  testID?: string;
}) {
  const p = usePalette();
  const primary = kind === "primary";
  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      accessibilityState={{ disabled: !!disabled }}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [
        styles.button,
        {
          backgroundColor: primary ? p.mark : "transparent",
          borderColor: primary ? p.mark : p.hairline,
          opacity: disabled ? 0.45 : pressed ? 0.8 : 1,
        },
      ]}
    >
      <Text style={[styles.buttonText, { color: primary ? p.canvas : p.ink }]}>{title}</Text>
    </Pressable>
  );
}

export function ErrorText({ error, testID }: { error: SoulErrorMessage | null; testID?: string }) {
  const { t } = useI18n();
  const p = usePalette();
  if (!error) return null;
  return (
    <Text testID={testID} accessibilityRole="alert" style={[styles.body, { color: p.error }]}>
      {t(error.key, error.params)}
    </Text>
  );
}

export function Loading() {
  const p = usePalette();
  const { t } = useI18n();
  return (
    <View style={styles.center}>
      <ActivityIndicator color={p.accent} accessibilityLabel={t("soul_app.common.loading")} />
    </View>
  );
}

export function Failure({ error, onRetry }: { error: SoulErrorMessage; onRetry: () => void }) {
  const { t } = useI18n();
  return (
    <View style={styles.center}>
      <ErrorText error={error} testID="failure" />
      <Button kind="secondary" title={t("soul_app.common.retry")} onPress={onRetry} />
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  screenBody: { padding: 16, gap: 12 },
  card: { borderWidth: StyleSheet.hairlineWidth, borderRadius: 12, padding: 14, gap: 8 },
  heading: { fontSize: 17, fontWeight: "600" },
  body: { fontSize: 15, lineHeight: 21 },
  field: { gap: 4 },
  fieldLabel: { fontSize: 12, letterSpacing: 0.3 },
  input: { borderWidth: 1, borderRadius: 8, paddingHorizontal: 12, paddingVertical: 10, fontSize: 16 },
  button: { borderWidth: 1, borderRadius: 10, paddingVertical: 12, alignItems: "center" },
  buttonText: { fontSize: 16, fontWeight: "600" },
  center: { padding: 24, gap: 12, alignItems: "stretch" },
});
