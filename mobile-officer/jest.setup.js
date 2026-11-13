/* global jest, afterEach */
// Shared doubles and guards: ../mobile/jest.setup.shared.js. This file keeps what is the officer app's own.
require("../mobile/jest.setup.shared");
// Typed text kept across a tab switch lives for the process (src/keptText.ts): one test's words must not open the next one's screen.
afterEach(() => require("./src/keptText").clearKeptText());

jest.mock("expo-secure-store", () => {
  // The app's secure port reads through a memory copy (mobile/src/platform.ts); a test that writes this store
  // directly drops that copy, as a fresh process would start without one.
  const changed = () => require("../mobile/src/platform").forgetSecureCache?.();
  class Store extends Map {
    set(key, value) {
      super.set(key, value);
      changed();
      return this;
    }
    delete(key) {
      const had = super.delete(key);
      changed();
      return had;
    }
    clear() {
      super.clear();
      changed();
    }
  }
  const store = new Store();
  return {
    __store: store,
    getItem: (key) => (store.has(key) ? store.get(key) : null),
    setItem: (key, value) => void store.set(key, value),
    deleteItemAsync: async (key) => void store.delete(key),
  };
});

// The cold start (src/coldStart.tsx) plays once per process; for every suite but its own
// (which unmocks it) that once has already happened — otherwise it would sit over each
// rendered app, with timers. A mock, not `require(...).coldStart.played = true`: requiring
// it here loads ui.tsx before a suite's own jest.mock of @react-navigation/native, and
// the circle feed then fetched twice (2026-09-30, two suites red).
jest.mock("./src/coldStart", () => ({ coldStart: { played: true }, ColdStart: () => null }));

// The phone's own check (src/deviceCheck.ts). By default a phone with a passcode that recognises its owner;
// `__state.level` 0 is no screen lock at all, `__state.success` false a check that did not pass -- unrecognised by
// default, `__state.error = "user_cancel"` for one the officer cancelled.
jest.mock("expo-local-authentication", () => {
  const state = { level: 1, success: true, types: [2], error: "authentication_failed" };
  return {
    __state: state,
    SecurityLevel: { NONE: 0, SECRET: 1, BIOMETRIC_WEAK: 2, BIOMETRIC_STRONG: 3 },
    AuthenticationType: { FINGERPRINT: 1, FACIAL_RECOGNITION: 2, IRIS: 3 },
    getEnrolledLevelAsync: async () => state.level,
    supportedAuthenticationTypesAsync: async () => state.types,
    authenticateAsync: jest.fn(async () => (state.success ? { success: true } : { success: false, error: state.error })),
  };
});
