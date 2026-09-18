/* global jest */
// Native storage has no JS implementation under jest. These doubles keep the
// one property the tests depend on — two SEPARATE stores — and expose their
// contents (`__store`) so a test can assert which store a value went to.
jest.mock("@react-native-async-storage/async-storage", () =>
  require("@react-native-async-storage/async-storage/jest/async-storage-mock")
);

// The system side of push: a permission, a token and two listeners. `__state`
// lets a test set the permission, make the token fail, or tap a notification.
// It behaves like the OS does — granting is the system's answer, not the app's.
jest.mock("expo-notifications", () => {
  const state = {
    status: "undetermined",
    answer: "granted",
    requests: 0,
    token: "ExponentPushToken[test-device-0001]",
    tokenError: null,
    lastResponse: null,
    responseListeners: new Set(),
    tokenListeners: new Set(),
  };
  const sub = (set, fn) => {
    set.add(fn);
    return { remove: () => set.delete(fn) };
  };
  return {
    __state: state,
    AndroidImportance: { DEFAULT: 3 },
    getPermissionsAsync: async () => ({ status: state.status, granted: state.status === "granted" }),
    requestPermissionsAsync: async () => {
      state.requests += 1;
      if (state.status === "undetermined") state.status = state.answer;
      return { status: state.status, granted: state.status === "granted" };
    },
    getExpoPushTokenAsync: async () => {
      if (state.tokenError) throw state.tokenError;
      return { type: "expo", data: state.token };
    },
    setNotificationChannelAsync: async () => null,
    setNotificationHandler: () => {},
    addPushTokenListener: (fn) => sub(state.tokenListeners, fn),
    addNotificationResponseReceivedListener: (fn) => sub(state.responseListeners, fn),
    getLastNotificationResponseAsync: async () => state.lastResponse,
  };
});

// No EAS project by default — the development build's real state.
jest.mock("expo-constants", () => ({ __esModule: true, default: { expoConfig: { version: "0.1.0", extra: {} }, easConfig: null } }));

jest.mock("expo-secure-store", () => {
  const store = new Map();
  return {
    __store: store,
    getItem: (key) => (store.has(key) ? store.get(key) : null),
    setItem: (key, value) => void store.set(key, value),
    deleteItemAsync: async (key) => void store.delete(key),
  };
});
