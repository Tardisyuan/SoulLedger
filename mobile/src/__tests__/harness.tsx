/**
 * The frame every soul-app component test wraps its tree in: safe area (a 390 x 844 phone, no insets), then language.
 * Nothing else -- no theme, no session, no navigation, no platform ports -- because a provider the suite did not
 * ask for answers with its own default and quietly changes what the test measures; a suite that needs one puts it
 * inside, as the officer app's `renderOfficer` (mobile-officer/src/__tests__/harness.tsx) does for its own.
 *
 * `inSoulFrame` is a plain function, not a component: it adds no layer to the tree, so a suite that wrapped these
 * two providers by hand and one that calls it render the same element tree.
 */
import { render } from "@testing-library/react-native";
import type { ReactElement } from "react";
import { SafeAreaProvider } from "react-native-safe-area-context";

import { I18nProvider } from "../i18n";

export function inSoulFrame(ui: ReactElement) {
  return (
    <SafeAreaProvider initialMetrics={{ frame: { x: 0, y: 0, width: 390, height: 844 }, insets: { top: 0, left: 0, right: 0, bottom: 0 } }}>
      <I18nProvider>{ui}</I18nProvider>
    </SafeAreaProvider>
  );
}

export function renderSoul(ui: ReactElement) {
  return render(inSoulFrame(ui));
}
