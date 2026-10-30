/**
 * Transient feedback: the toast (bottom, 110pt up, 4s, success / failure). It only fades —
 * 160ms, or 0 under reduce-motion. And `Sheet`, v2's bottom sheet, at the end. The sign-out
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
import { Animated, BackHandler, Dimensions, Keyboard, StyleSheet, View, type ScrollView, type TextInput } from "react-native";
import { Easing } from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { Icon } from "./emblems";
import { radius } from "./theme";
import { InSheetContext, SheetRevealContext, GUTTER, Txt, useReducedMotionDurations, useTheme } from "./ui";

type ToastKind = "success" | "failure";
type Show = (message: string, kind?: ToastKind) => void;

/** Without a provider (a screen rendered alone in a test) a toast is a no-op, not a crash. */
const ToastContext = createContext<Show>(() => {});
export const useToast = () => useContext(ToastContext);

export function ToastProvider({ children }: { children: ReactNode }) {
  const t = useTheme();
  const durations = useReducedMotionDurations();
  const [toast, setToast] = useState<{ message: string; kind: ToastKind; id: number } | null>(null);
  const [opacity] = useState(() => new Animated.Value(0));
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const show = useCallback<Show>((message, kind = "success") => setToast({ message, kind, id: Date.now() }), []);

  useEffect(() => {
    if (!toast) return;
    const duration = durations.toast;
    Animated.timing(opacity, { toValue: 1, duration, useNativeDriver: true }).start();
    timer.current = setTimeout(() => {
      Animated.timing(opacity, { toValue: 0, duration, useNativeDriver: true }).start(() => setToast(null));
    }, durations.toastHold);
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, [toast, opacity, durations]);

  return (
    <ToastContext.Provider value={show}>
      {children}
      {toast ? (
        <Animated.View
          pointerEvents="none"
          accessibilityLiveRegion="polite"
          accessibilityRole="alert"
          style={[
            styles.toast,
            { opacity, backgroundColor: toast.kind === "failure" ? t.negBg : t.ink, borderColor: toast.kind === "failure" ? t.negStrong : t.ink },
          ]}
        >
          <Icon name={toast.kind === "failure" ? "alert" : "check"} size={15} color={toast.kind === "failure" ? t.neg : t.s0} strokeWidth={1.5} />
          <Txt testID="toast" variant="caption" style={[styles.toastText, { color: toast.kind === "failure" ? t.negInk : t.s0 }]}>
            {toast.message}
          </Txt>
        </Animated.View>
      ) : null}
    </ToastContext.Provider>
  );
}

const styles = StyleSheet.create({
  toast: {
    position: "absolute",
    left: GUTTER,
    right: GUTTER,
    bottom: 110,
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingHorizontal: 16,
    paddingVertical: 16,
    borderWidth: 1,
  },
  toastText: { flex: 1, fontSize: 13 },
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
