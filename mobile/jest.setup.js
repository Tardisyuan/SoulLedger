/* global jest, afterEach, afterAll */
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
    // canAskAgain unset = iOS: only "undetermined" can still be asked.
    getPermissionsAsync: async () => ({
      status: state.status,
      granted: state.status === "granted",
      canAskAgain: state.canAskAgain ?? state.status === "undetermined",
    }),
    requestPermissionsAsync: async () => {
      state.requests += 1;
      if (state.status === "undetermined" || state.canAskAgain) {
        state.status = state.answer;
        state.canAskAgain = undefined;
      }
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
    // Like the OS: the last response stays until cleared.
    getLastNotificationResponseAsync: async () => state.lastResponse,
    clearLastNotificationResponse: () => void (state.lastResponse = null),
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

// An act() warning means a state update landed after the test stopped looking —
// the assertion ran against a screen that was still changing (one of the nine
// found 2026-09-19 made `push-denied` absent only because the permission had not
// been read yet). They printed and the suite stayed green, so none was noticed.
// Now the test that caused one fails; the message still prints.
//
// RNTL is required FIRST so its auto-cleanup afterEach (flush pending promises,
// then unmount) is registered before ours and runs before ours: an update the test
// left running lands during that flush and is charged to THIS test, not the next.
require("@testing-library/react-native");
const actWarnings = [];
const consoleError = console.error;
console.error = (...args) => {
  if (String(args[0]).includes("not wrapped in act")) actWarnings.push(String(args[0]).split("\n")[0].replace("%s", args[1]));
  consoleError(...args);
};
const failOnActWarnings = () => {
  if (actWarnings.length === 0) return;
  const found = actWarnings.splice(0);
  throw new Error(`act() warning(s) — await the update before the test ends:\n${found.join("\n")}`);
};
afterEach(failOnActWarnings);
afterAll(failOnActWarnings);

// findBy/waitFor wait 5 s, not RNTL's default 1 s. Most suites here boot the whole
// app (session, navigator, every tab) and wait for a screen that follows a mocked
// response. Measured 2026-09-24, "401 whose refresh the server refuses": 138–160 ms
// idle, 466–650 ms with 12 busy processes on 4 cores, and once past 1000 ms. That run
// failed "Unable to find … login-submit" while the tree it printed contained
// login-submit. The screen was right and the budget was too short. Jest's own
// per-test timeout goes to 15 s (jest.config.js) so that a real miss still reports
// what it could not find, instead of "Exceeded timeout of 5000 ms".
const { configure } = require("@testing-library/react-native");
configure({ asyncUtilTimeout: 5000 });

// A FlatList re-windows its rows 50 ms after every update it sees
// (VirtualizedList `_scheduleCellsToRenderUpdate`: a setTimeout, then setState).
// Under jest there is no layout, so that timer is all that moves the window, and
// it lands outside act() whenever a test runs on for 50 ms after the list last
// changed: the guard above then fails whichever test that was (2026-09-29, the
// circle feed's first FlatList: 3–4 of 28 circle tests per run, a different set
// each time). Here the period is zero and the re-window runs at once, inside the
// commit that asked for it — rows the list would add still appear, just before
// the next assertion instead of after the test.
const { VirtualizedList } = require("@react-native/virtualized-lists").default;
const scheduleWindow = VirtualizedList.prototype._scheduleCellsToRenderUpdate;
VirtualizedList.prototype._scheduleCellsToRenderUpdate = function () {
  scheduleWindow.call(this);
  if (this._updateCellsToRenderTimeoutID != null) {
    clearTimeout(this._updateCellsToRenderTimeoutID);
    this._updateCellsToRenderTimeoutID = null;
    this._updateCellsToRender();
  }
};

// v2 motion libraries — native modules with no JS implementation under jest — get
// their own published mocks, as their docs give them. Reanimated 4's mock still
// imports react-native-worklets, whose real entry calls into the native module at
// load, so worklets takes its own mock first.
require("react-native-gesture-handler/jestSetup");
jest.mock("react-native-worklets", () => require("react-native-worklets/src/mock"));
jest.mock("react-native-reanimated", () => require("react-native-reanimated/mock"));

// expo-network: the OS's view of the network. `__set` changes it and tells the listeners,
// as the OS does; `getNetworkStateAsync` answers from the same state. Connected by default.
jest.mock("expo-network", () => {
  const listeners = new Set();
  const state = { current: { type: "WIFI", isConnected: true, isInternetReachable: true } };
  return {
    __set: (next) => {
      state.current = { ...state.current, ...next };
      listeners.forEach((fn) => fn(state.current));
    },
    __reset: () => {
      listeners.clear();
      state.current = { type: "WIFI", isConnected: true, isInternetReachable: true };
    },
    getNetworkStateAsync: jest.fn(async () => state.current),
    addNetworkStateListener: (fn) => {
      listeners.add(fn);
      return { remove: () => listeners.delete(fn) };
    },
  };
});

// expo-splash-screen: a native module with no JS side under jest. A double that records
// what was asked (jest.fn) and does nothing else.
jest.mock("expo-splash-screen", () => ({ preventAutoHideAsync: jest.fn(async () => true), hideAsync: jest.fn(async () => true) }));

// @gorhom/bottom-sheet: its published mock renders a modal's children ALWAYS — present()
// and dismiss() do nothing — so a closed sheet would still be on screen and "closing it
// works" could never go red. This double keeps the one behaviour the app depends on:
// nothing until present(); dismiss() hides it and calls onDismiss, as the real one does.
// It also keeps the real one's trap (traced on the emulator, 2026-10-01): dismiss() on a sheet
// that is not up leaves the modal stuck, and every later present() shows nothing.
// `global.__sheetSelfClose()` closes every open sheet the way a drag or the scrim does.
jest.mock("@gorhom/bottom-sheet", () => {
  const React = require("react");
  const Pass = ({ children }) => children;
  const selfClosers = new Set();
  global.__sheetSelfClose = () => selfClosers.forEach((close) => close());
  const BottomSheetModal = React.forwardRef(function BottomSheetModal({ children, onDismiss }, ref) {
    const [open, setOpen] = React.useState(false);
    const was = React.useRef(false);
    const isOpen = React.useRef(false);
    const stuck = React.useRef(false);
    isOpen.current = open;
    React.useEffect(() => {
      if (was.current && !open) onDismiss?.();
      was.current = open;
    }, [open, onDismiss]);
    React.useEffect(() => {
      const close = () => isOpen.current && setOpen(false);
      selfClosers.add(close);
      return () => selfClosers.delete(close);
    }, []);
    React.useImperativeHandle(ref, () => ({
      present: () => {
        if (!stuck.current) setOpen(true);
      },
      dismiss: () => {
        if (!isOpen.current) stuck.current = true;
        setOpen(false);
      },
    }));
    return open ? children : null;
  });
  return {
    __esModule: true,
    default: Pass,
    BottomSheetModal,
    BottomSheetModalProvider: Pass,
    BottomSheetView: Pass,
    BottomSheetBackdrop: () => null,
    useBottomSheetTimingConfigs: (config) => config,
  };
});

// The cold start (src/coldStart.tsx) plays once per process; for every suite but its own
// (which unmocks it) that once has already happened — otherwise it would sit over each
// rendered app, with timers. A mock, not `require(...).coldStart.played = true`: requiring
// it here loads ui.tsx before a suite's own jest.mock of @react-navigation/native, and
// the circle feed then fetched twice (2026-09-30, two suites red).
jest.mock("./src/coldStart", () => ({ coldStart: { played: true }, ColdStart: () => null }));
