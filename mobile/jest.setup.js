/* global jest */
// Shared doubles and guards: jest.setup.shared.js. This file keeps what is the soul app's own.
require("./jest.setup.shared");

jest.mock("expo-secure-store", () => {
  // The app's secure port reads through a memory copy (platform.ts); a test that writes this store directly
  // (`__store.set`, `clear()`) drops that copy, as a fresh process would start without one.
  const changed = () => require("./src/platform").forgetSecureCache?.();
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

// The cold start (src/coldStart.tsx) plays once per process; for every suite but its own
// (which unmocks it) that once has already happened — otherwise it would sit over each
// rendered app, with timers. A mock, not `require(...).coldStart.played = true`: requiring
// it here loads ui.tsx before a suite's own jest.mock of @react-navigation/native, and
// the circle feed then fetched twice (2026-09-30, two suites red).
jest.mock("./src/coldStart", () => ({ coldStart: { played: true }, ColdStart: () => null }));
