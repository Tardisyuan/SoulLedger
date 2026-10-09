/** Providers every component test needs: platform ports, safe area, language, the hall's theme, a session. */
import type { LoginUser } from "@soulledger/core/api/auth";
import { render } from "@testing-library/react-native";
import type { ReactElement } from "react";
import { SafeAreaProvider } from "react-native-safe-area-context";

import { SessionContext, type Session } from "../session";
import { I18nProvider, ThemeContext, installMobilePlatform, themeFor } from "../shared";

installMobilePlatform();

export const OFFICER: LoginUser = {
  id: 7,
  username: "yama",
  email: "yama@example.com",
  role: "JUDGE",
  display_name: "阎罗",
  permissions: ["workflow.approve"],
  // What the API really sends: the code and the database's English display name.
  tenant: { code: "CN_DIYU", display_name: "Chinese Afterlife", civilization: "CHINESE_UNDERWORLD" },
  mfa_enabled: true,
  mfa_required: true,
};

export function sessionOf(user: LoginUser | null, over: Partial<Session> = {}): Session {
  return {
    state: user ? { status: "signedIn", user } : { status: "signedOut" },
    signIn: jest.fn(async () => ({ kind: "done" as const })),
    verifyMfa: jest.fn(async () => {}),
    signOut: jest.fn(),
    ...over,
  };
}

export function renderOfficer(ui: ReactElement, { user = OFFICER, session }: { user?: LoginUser | null; session?: Session } = {}) {
  return render(
    <SafeAreaProvider initialMetrics={{ frame: { x: 0, y: 0, width: 393, height: 852 }, insets: { top: 0, left: 0, right: 0, bottom: 0 } }}>
      <I18nProvider>
        <ThemeContext.Provider value={themeFor(user?.tenant?.civilization, "light")}>
          <SessionContext.Provider value={session ?? sessionOf(user)}>{ui}</SessionContext.Provider>
        </ThemeContext.Provider>
      </I18nProvider>
    </SafeAreaProvider>
  );
}

/** An axios-shaped failure. */
export const httpError = (status: number, data?: unknown) => Object.assign(new Error(`HTTP ${status}`), { response: { status, data } });
