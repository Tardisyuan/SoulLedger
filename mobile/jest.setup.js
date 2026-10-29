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
    receivedListeners: new Set(),
    tokenListeners: new Set(),
  };
  const sub = (set, fn) => {
    set.add(fn);
    return { remove: () => set.delete(fn) };
  };
  return {
    __state: state,
    AndroidImportance: { DEFAULT: 3 },
    AndroidNotificationVisibility: { UNKNOWN: 0, PUBLIC: 1, PRIVATE: 2, SECRET: 3 },
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
    // A notification arriving while the app is in front (not tapped).
    addNotificationReceivedListener: (fn) => sub(state.receivedListeners, fn),
    // Like the OS: the last response stays until cleared.
    getLastNotificationResponseAsync: async () => state.lastResponse,
    clearLastNotificationResponse: () => void (state.lastResponse = null),
  };
});

// No EAS project by default — the development build's real state.
jest.mock("expo-constants", () => ({ __esModule: true, default: { expoConfig: { version: "0.1.0", extra: {} }, easConfig: null } }));

jest.mock("expo-secure-store", () => {
  const store = new Map();
  // Items kept with `requireAuthentication` (the 面容 / 指纹 login credential) live apart, as the Keychain's
  // biometric class does, and come back only when the system "verifies": `__auth.error` is what the native
  // module throws (null = the face / finger matched). `prompts` records the reason text shown.
  const guarded = new Map();
  const auth = { error: null, prompts: [] };
  return {
    __store: store,
    __guarded: guarded,
    __auth: auth,
    getItem: (key) => (store.has(key) ? store.get(key) : null),
    setItem: (key, value) => void store.set(key, value),
    deleteItemAsync: async (key) => {
      store.delete(key);
      guarded.delete(key);
    },
    getItemAsync: async (key, options) => {
      if (!options?.requireAuthentication) return store.has(key) ? store.get(key) : null;
      auth.prompts.push(options.authenticationPrompt);
      if (auth.error) throw auth.error;
      return guarded.has(key) ? guarded.get(key) : null;
    },
    setItemAsync: async (key, value, options) => {
      if (!options?.requireAuthentication) return void store.set(key, value);
      auth.prompts.push(options.authenticationPrompt);
      if (auth.error) throw auth.error;
      guarded.set(key, value);
    },
  };
});

// The phone's face / finger. Not enrolled by default: a sign-in test must not meet the 「下次用面容登录？」 sheet
// it did not ask for. A test that wants it sets `__state.enrolled`.
jest.mock("expo-local-authentication", () => {
  const state = { hardware: true, enrolled: false, types: [2], recognised: true, gate: null, prompts: [] };
  return {
    __state: state,
    AuthenticationType: { FINGERPRINT: 1, FACIAL_RECOGNITION: 2, IRIS: 3 },
    hasHardwareAsync: async () => state.hardware,
    isEnrolledAsync: async () => state.enrolled,
    supportedAuthenticationTypesAsync: async () => state.types,
    // `authenticateAsync` (the app lock): `__state.recognised` is whether the face / finger matched; `prompts` records the reasons.
    authenticateAsync: async (options) => {
      state.prompts.push(options?.promptMessage);
      if (state.gate) await state.gate; // a test holds the system prompt open by setting `gate`
      return state.recognised ? { success: true } : { success: false, error: "user_cancel" };
    },
  };
});

// The camera: `__state.last` holds the props of the last CameraView render (a test calls `last.onBarcodeScanned`),
// `__state.permission` is what the OS answers, `answer` what a request turns an undetermined one into.
jest.mock("expo-camera", () => {
  const React = require("react");
  const { View } = require("react-native");
  const state = { permission: { status: "granted", granted: true, canAskAgain: true }, answer: "granted", requests: 0, last: null };
  const settle = (status) => ({ status, granted: status === "granted", canAskAgain: status === "undetermined" });
  return {
    __state: state,
    CameraView: (props) => {
      state.last = props;
      return React.createElement(View, { testID: props.testID });
    },
    useCameraPermissions: () => {
      const [permission, setPermission] = React.useState(state.permission);
      const request = async () => {
        state.requests += 1;
        const next = state.permission.status === "undetermined" ? settle(state.answer) : state.permission;
        state.permission = next;
        setPermission(next);
        return next;
      };
      return [permission, request];
    },
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
// 恢复码「存为文件」:内存里的缓存目录 + 一个只记调用的分享面板。`__files` 是缓存里现在有什么,
// `__share` 的实现可被测试改写(成功 / 取消 / 抛错),测试据此断言「面板关闭后文件已删」。
jest.mock("expo-file-system", () => {
  const files = new Map();
  // 导出我的资料 downloads: every call is recorded; `__download.fail` makes the next ones throw.
  const downloads = [];
  const download = { fail: false };
  class File {
    static async downloadFileAsync(url, destination, options) {
      downloads.push({ url, options, name: destination.name });
      if (download.fail) throw new Error("download failed");
      destination.create();
      destination.write("zip-bytes");
      return destination;
    }
    constructor(dir, name) {
      this.name = name ?? String(dir).split("/").pop();
      this.uri = `file:///cache/${this.name}`;
    }
    create() {
      files.set(this.uri, "");
    }
    write(text) {
      files.set(this.uri, text);
    }
    delete() {
      files.delete(this.uri);
    }
    get exists() {
      return files.has(this.uri);
    }
  }
  const Paths = { cache: { uri: "file:///cache/", list: () => [...files.keys()].map((uri) => new File("", uri.split("/").pop())) } };
  return { __esModule: true, File, Paths, __files: files, __downloads: downloads, __download: download };
});
jest.mock("expo-sharing", () => ({
  __esModule: true,
  isAvailableAsync: jest.fn(async () => true),
  shareAsync: jest.fn(async () => undefined),
}));

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
jest.mock("expo-splash-screen", () => ({
  preventAutoHideAsync: jest.fn(async () => true),
  hideAsync: jest.fn(async () => true),
  setOptions: jest.fn(),
}));

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
    BottomSheetScrollView: Pass,
    // Sheet's inputs: the real one only adds keyboard bookkeeping to a TextInput.
    BottomSheetTextInput: require("react-native").TextInput,
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
