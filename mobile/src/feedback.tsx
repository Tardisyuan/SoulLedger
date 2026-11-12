/**
 * Transient feedback: the toast (第三十批: card2 with a 3px rule on its left in the semantic colour, above the
 * tab bar, 16 from the sides; a success stays 4s, a notice 6s, a failure until it is closed; at most 3 stacked,
 * the newest at the bottom). It only fades — 160ms, or 0 under reduce-motion. And `Sheet`, v2's bottom sheet, at the end. The sign-out
 * confirmation is in `logout.tsx`: it reads `loginRules`, which the officer app (it shares this
 * file) has no use for.
 */
import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import {
  ANIMATION_SOURCE,
  BottomSheetBackdrop,
  BottomSheetModal,
  BottomSheetScrollView,
  useBottomSheetInternal,
  useBottomSheetTimingConfigs,
  useGestureEventsHandlersDefault,
  type BottomSheetBackdropProps,
} from "@gorhom/bottom-sheet";
import { Animated, BackHandler, Dimensions, Keyboard, Pressable, StyleSheet, View, type ScrollView, type TextInput } from "react-native";
import { Easing } from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { Icon } from "./emblems";
import { useI18n } from "./i18n";
import { radius, touch } from "./theme";
import { InSheetContext, SheetRevealContext, Txt, useReducedMotionDurations, useTheme } from "./ui";

type ToastKind = "success" | "info" | "failure";
type Show = (message: string, kind?: ToastKind) => void;
type Item = { message: string; kind: ToastKind; id: number };

/** 第三十批: at most three at once; a fourth pushes the oldest out. */
const MAX_TOASTS = 3;

/** Without a provider (a screen rendered alone in a test) a toast is a no-op, not a crash. */
const ToastContext = createContext<Show>(() => {});
export const useToast = () => useContext(ToastContext);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Item[]>([]);
  const seq = useRef(0);
  const show = useCallback<Show>((message, kind = "success") => setToasts((list) => [...list, { message, kind, id: ++seq.current }].slice(-MAX_TOASTS)), []);
  const close = useCallback((id: number) => setToasts((list) => list.filter((x) => x.id !== id)), []);
  return (
    <ToastContext.Provider value={show}>
      {children}
      {toasts.length ? (
        <View pointerEvents="box-none" style={styles.stack}>
          {toasts.map((item, i) => (
            // The newest carries `toast`: what a screen just said (older ones are `toast-earlier`).
            <Toast key={item.id} item={item} newest={i === toasts.length - 1} onGone={close} />
          ))}
        </View>
      ) : null}
    </ToastContext.Provider>
  );
}

function Toast({ item, newest, onGone }: { item: Item; newest: boolean; onGone: (id: number) => void }) {
  const t = useTheme();
  const { t: tr } = useI18n();
  const durations = useReducedMotionDurations();
  const [opacity] = useState(() => new Animated.Value(0));
  const failure = item.kind === "failure";
  const bar = failure ? t.neg : item.kind === "success" ? t.pos : t.hair2;
  const icon = failure ? "alert" : item.kind === "success" ? "check" : "info";
  const leave = useCallback(() => {
    Animated.timing(opacity, { toValue: 0, duration: durations.toast, useNativeDriver: true }).start(() => onGone(item.id));
  }, [opacity, durations.toast, onGone, item.id]);
  useEffect(() => {
    Animated.timing(opacity, { toValue: 1, duration: durations.toast, useNativeDriver: true }).start();
    // A failure often leaves a draft for the person to deal with: it stays until it is closed.
    if (failure) return;
    const timer = setTimeout(leave, item.kind === "success" ? durations.toastHold : durations.toastInfoHold);
    return () => clearTimeout(timer);
  }, [opacity, durations, failure, item.kind, leave]);
  return (
    <Animated.View
      pointerEvents={failure ? "box-none" : "none"}
      accessibilityLiveRegion="polite"
      accessibilityRole="alert"
      style={[styles.toast, { opacity, backgroundColor: t.s2, borderColor: t.hair2, borderLeftColor: bar }]}
    >
      <View style={styles.toastIcon}>
        <Icon name={icon} size={15} color={failure ? t.neg : item.kind === "success" ? t.pos : t.inkMuted} strokeWidth={1.5} />
      </View>
      <Txt testID={newest ? "toast" : "toast-earlier"} variant="body" style={styles.toastText}>
        {item.message}
      </Txt>
      {failure ? (
        <Pressable
          testID={newest ? "toast-close" : undefined}
          accessibilityRole="button"
          accessibilityLabel={tr("common.close")}
          onPress={() => onGone(item.id)}
          style={styles.toastClose}
        >
          <Icon name="close" size={14} color={t.faintText} strokeWidth={1.4} />
        </Pressable>
      ) : null}
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  // Above the tab bar, 16 from the sides (第三十批 窄屏).
  stack: { position: "absolute", left: 16, right: 16, bottom: 110, gap: 8 },
  toast: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 12,
    paddingLeft: 16,
    paddingRight: 4,
    paddingVertical: 12,
    borderWidth: 1,
    borderLeftWidth: touch.toastBar,
    borderRadius: radius.dialog,
  },
  toastIcon: { paddingVertical: 4 },
  toastText: { flex: 1, paddingVertical: 0, paddingRight: 12 },
  // The close is a 44pt target in the toast's corner.
  toastClose: { width: touch.controlSm, height: touch.controlSm, marginVertical: -12, alignItems: "center", justifyContent: "center" },
});

/**
 * A bottom sheet (v2 动效, 交互与动效 第 2 轮 原型 06) on @gorhom/bottom-sheet: it opens
 * over 200ms (`motion.sheetIn`), closes over 120 (`motion.sheetOut`; both 0 under
 * reduce-motion), drags down to close past 90pt or 0.6pt/ms (`useSheetGestures`), and also
 * closes on the scrim, on Android's back key, and from whatever button the caller puts
 * in it. Controlled — `open` in, `onClose` out, whichever way it was closed — so a
 * caller holds one boolean, as it did with the `Modal` this replaces. Square, no
 * shadow, a 1px top edge in `edge` (补足 A2). Needs `BottomSheetModalProvider` above
 * (navigation.tsx); the sheet renders in that provider, so it sees only its contexts.
 */
/** 交互与动效 第 2 轮 原型 06: a release past 90pt, or faster than 0.6pt/ms downward, closes. */
export const SHEET_CLOSE_DRAG_PT = 90;
export const SHEET_CLOSE_SPEED_PT_PER_MS = 0.6;

/** 第 2 轮 §一 ease.exit / ease.standard. */
const EASE_EXIT = Easing.bezier(0.4, 0, 1, 1);
const EASE_STANDARD = Easing.bezier(0.2, 0, 0, 1);

/** `velocityY` is Gesture Handler's, in pt per SECOND. */
export function sheetReleaseCloses(translationY: number, velocityY: number): boolean {
  "worklet";
  return translationY > SHEET_CLOSE_DRAG_PT || velocityY / 1000 > SHEET_CLOSE_SPEED_PT_PER_MS;
}

/**
 * The library's own drag handling, with its release swapped for the prototype's: it
 * decides by snap-point projection, which has no distance or speed to name. Closing
 * runs `sheetOut` (fast 120), springing back `sheetIn` (base 200); both 0 under
 * reduce-motion. The upward pull keeps the library's resistance (√d × 2.5: ≈16pt at 40).
 */
export function useSheetGestures() {
  const handlers = useGestureEventsHandlersDefault();
  const { animatedDetentsState, animateToPosition } = useBottomSheetInternal();
  const { sheetIn, sheetOut } = useReducedMotionDurations();
  const handleOnEnd: typeof handlers.handleOnEnd = useCallback(
    (source, payload) => {
      "worklet";
      const { closedDetentPosition, highestDetentPosition } = animatedDetentsState.get();
      if (closedDetentPosition === undefined || highestDetentPosition === undefined) return handlers.handleOnEnd(source, payload);
      const close = sheetReleaseCloses(payload.translationY, payload.velocityY);
      animateToPosition(close ? closedDetentPosition : highestDetentPosition, ANIMATION_SOURCE.GESTURE, 0, {
        duration: close ? sheetOut : sheetIn,
        easing: close ? EASE_EXIT : EASE_STANDARD,
      });
    },
    [handlers, animatedDetentsState, animateToPosition, sheetIn, sheetOut]
  );
  return { ...handlers, handleOnEnd };
}

export function Sheet({ open, onClose, edge, closeLabel, children }: { open: boolean; onClose: () => void; edge: string; closeLabel: string; children: ReactNode }) {
  const t = useTheme();
  const ref = useRef<BottomSheetModal>(null);
  const { sheetIn, sheetOut } = useReducedMotionDurations();
  const timing = useBottomSheetTimingConfigs({ duration: sheetIn, easing: Easing.bezier(0, 0, 0.2, 1) });
  // Dismiss only a sheet that is up. Calling `dismiss()` on one that never opened (the mount,
  // `open` false) or already closed itself (a drag, the scrim) left @gorhom's modal status stuck at
  // DISMISSING, and every later `present()` rendered an empty portal: the long-lamp confirm did
  // not open on a post's first tap, and never again after a drag-close (emulator, 2026-10-01,
  // traced with the library's own logging: `handlePresent … status:6`).
  const up = useRef(false);
  useEffect(() => {
    if (open && !up.current) {
      up.current = true;
      ref.current?.present();
    } else if (!open && up.current) {
      up.current = false;
      ref.current?.dismiss({ duration: sheetOut, easing: EASE_EXIT });
    }
  }, [open, sheetOut]);
  const dismissed = useCallback(() => {
    up.current = false;
    onClose();
  }, [onClose]);
  useEffect(() => {
    if (!open) return;
    const sub = BackHandler.addEventListener("hardwareBackPress", () => {
      onClose();
      return true;
    });
    return () => sub.remove();
  }, [open, onClose]);
  const sheetInsets = useSafeAreaInsets();
  // The sheet is already as tall as the screen when its content is long (改派: six people, a reason, 确认), so the
  // keyboard cannot lift it: instead the content gets the keyboard's height as room at the bottom, and a focused
  // field is scrolled until it and about one button under it sit above the keyboard (2026-10-17 simulator).
  const scrollRef = useRef<ScrollView>(null);
  const [keyboardHeight, setKeyboardHeight] = useState(0);
  const pending = useRef<TextInput | null>(null);
  const BELOW_FIELD = 80;
  const offset = useRef(0);
  const scrollToField = useCallback((field: TextInput | null, height: number) => {
    if (!field || !height) return;
    field.measureInWindow((_x, y, _w, h) => {
      const keyboardTop = Dimensions.get("window").height - height;
      const overlap = y + h + BELOW_FIELD - keyboardTop;
      if (overlap > 0) scrollRef.current?.scrollTo({ y: offset.current + overlap, animated: true });
    });
  }, []);
  useEffect(() => {
    const show = Keyboard.addListener("keyboardDidShow", (e) => {
      const height = e.endCoordinates.height;
      setKeyboardHeight(height);
      scrollToField(pending.current, height);
    });
    const hide = Keyboard.addListener("keyboardDidHide", () => {
      setKeyboardHeight(0);
      pending.current = null;
    });
    return () => {
      show.remove();
      hide.remove();
    };
  }, [scrollToField]);
  const reveal = useCallback(
    (field: TextInput | null) => {
      pending.current = field;
      if (keyboardHeight) scrollToField(field, keyboardHeight);
    },
    [keyboardHeight, scrollToField]
  );
  const backdrop = useCallback(
    (props: BottomSheetBackdropProps) => (
      <BottomSheetBackdrop
        {...props}
        appearsOnIndex={0}
        disappearsOnIndex={-1}
        opacity={1}
        pressBehavior="close"
        accessibilityLabel={closeLabel}
        style={[props.style, { backgroundColor: t.scrim }]}
      />
    ),
    [t.scrim, closeLabel]
  );
  return (
    <BottomSheetModal
      ref={ref}
      onDismiss={dismissed}
      animationConfigs={timing}
      gestureEventsHandlersHook={useSheetGestures}
      backdropComponent={backdrop}
      backgroundStyle={{ backgroundColor: t.s1, borderRadius: 0, borderTopLeftRadius: radius.dialog, borderTopRightRadius: radius.dialog, borderTopWidth: 1, borderTopColor: edge }}
      handleIndicatorStyle={{ backgroundColor: t.hair2 }}
      // The keyboard lifts the sheet with the focused field (its Inputs are BottomSheetTextInput, see
      // InSheetContext); a drag on the sheet puts the keyboard away, and closing it puts the sheet back.
      keyboardBehavior="interactive"
      keyboardBlurBehavior="restore"
      enableBlurKeyboardOnGesture
      android_keyboardInputMode="adjustResize"
      // Content taller than the screen (改派: six people, 更多, a reason, 确认) scrolls inside the sheet instead of
      // running off the bottom, and the sheet stops under the status bar (2026-10-17 simulator: 确认 was unreachable).
      topInset={sheetInsets.top}
    >
      <BottomSheetScrollView
        ref={scrollRef as never}
        keyboardShouldPersistTaps="handled"
        onScroll={(e) => {
          offset.current = e.nativeEvent.contentOffset.y;
        }}
        contentContainerStyle={{ paddingBottom: keyboardHeight }}
      >
        <InSheetContext.Provider value>
          <SheetRevealContext.Provider value={reveal}>{children}</SheetRevealContext.Provider>
        </InSheetContext.Provider>
      </BottomSheetScrollView>
    </BottomSheetModal>
  );
}
