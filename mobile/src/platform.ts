/**
 * The React Native implementation of `@soulledger/core/platform`'s ports.
 * The web counterpart is `frontend/lib/platform/web.ts`; the table in
 * `docs/ARCHITECTURE-soul-app-and-domain-split.md` §6.5 is the plan this follows.
 *
 *   session     in-memory Map — dies with the process, like a tab's sessionStorage
 *   persistent  AsyncStorage behind a synchronous cache (the port is sync;
 *               AsyncStorage is not), hydrated once before the app renders
 *   secure      expo-secure-store — Keychain on iOS, Keystore-backed on Android.
 *               The refresh token lives here and nowhere else.
 *   onUnauthorized        whatever the session layer registered: reset to the login stack
 *   onSessionSuspend/Resume  AppState background ↔ active
 *   notify      ToastAndroid on Android, Alert on iOS
 */
import AsyncStorage from "@react-native-async-storage/async-storage";
import { DEFAULT_LOCALE, isLocale } from "@soulledger/core/config/locale";
import {
  configurePlatform,
  getLocale,
  type KeyValueStore,
  type NotifyMessage,
  type PlatformAdapter,
} from "@soulledger/core/platform";
import * as SecureStore from "expo-secure-store";
import { Alert, AppState, Platform, ToastAndroid } from "react-native";

import { translate } from "./i18n";

const memory = new Map<string, string>();
export const sessionStore: KeyValueStore = {
  get: (key) => memory.get(key) ?? null,
  set: (key, value) => void memory.set(key, value),
  remove: (key) => void memory.delete(key),
};

const persistentCache = new Map<string, string>();
export const persistentStore: KeyValueStore = {
  get: (key) => persistentCache.get(key) ?? null,
  set: (key, value) => {
    persistentCache.set(key, value);
    AsyncStorage.setItem(key, value).catch(() => {});
  },
  remove: (key) => {
    persistentCache.delete(key);
    AsyncStorage.removeItem(key).catch(() => {});
  },
};

/**
 * One `multiGet` for the lot; if it throws, key by key. Android's AsyncStorage throws for the WHOLE `multiGet`
 * when one row is past its cursor window (~2 MB) -- that one oversized value used to cost every key: theme,
 * sign-in memory, drafts, the outbox (opt-apps2 N5). Now only the unreadable key is lost.
 */
export async function hydratePersistentStore(): Promise<void> {
  let keys: readonly string[];
  try {
    keys = await AsyncStorage.getAllKeys();
  } catch {
    return; // An unreadable store is an empty one: defaults apply, nothing secret lives here.
  }
  let rows: readonly (readonly [string, string | null])[];
  try {
    rows = await AsyncStorage.multiGet(keys);
  } catch {
    rows = await Promise.all(keys.map((key) => AsyncStorage.getItem(key).then((value) => [key, value] as const, () => [key, null] as const)));
  }
  for (const [key, value] of rows) {
    if (value !== null) persistentCache.set(key, value);
  }
}

/**
 * Reads go through a memory copy (opt-apps2 S5): every request asked the Keychain / Keystore for the refresh
 * token synchronously. Writes and removals through this port update the copy at once. Only this port's entries
 * are kept here; the 面容 / 指纹 credential (`requireAuthentication`, deviceLogin.ts) is read with its own
 * SecureStore call each time and never passes through this cache.
 *
 * `deleteItemAsync` is the only delete expo-secure-store offers. Overwriting
 * with "" first makes the removal visible to the very next synchronous `get`
 * (read as absent), so a sign-out followed at once by a read cannot see the
 * old refresh token while the async delete is still in flight.
 */
const secureCache = new Map<string, string | null>();
export const secureStore: KeyValueStore = {
  get: (key) => {
    if (!secureCache.has(key)) secureCache.set(key, SecureStore.getItem(key) || null);
    return secureCache.get(key) ?? null;
  },
  set: (key, value) => {
    SecureStore.setItem(key, value);
    secureCache.set(key, value || null);
  },
  remove: (key) => {
    SecureStore.setItem(key, "");
    secureCache.set(key, null);
    SecureStore.deleteItemAsync(key).catch(() => {});
  },
};

/** The memory copy is dropped: the next read asks the native store. For a store changed behind the port (tests). */
export function forgetSecureCache(): void {
  secureCache.clear();
}

/**
 * A return from the background: `background → active` only. iOS also goes `inactive → active` after the face /
 * finger sheet, a system alert or Control Center, which is not a return (opt-apps2 N2: 4–5 needless requests per
 * face check). The same rule as `onSessionResume` below.
 */
export function onForeground(handler: () => void): () => void {
  let previous = AppState.currentState;
  const sub = AppState.addEventListener("change", (state) => {
    if (state === "active" && previous === "background") handler();
    previous = state;
  });
  return () => sub.remove();
}

let unauthorizedHandler: () => void = () => {};
export function setUnauthorizedHandler(handler: () => void): void {
  unauthorizedHandler = handler;
}

function render(message: NotifyMessage): string {
  const locale = getLocale();
  const active = isLocale(locale) ? locale : DEFAULT_LOCALE;
  if (typeof message === "string") return translate(active, message);
  if ("text" in message) return message.text;
  return translate(active, message.key, message.params);
}

export function defaultApiBaseUrl(): string {
  // The Android emulator reaches the host machine at 10.0.2.2; iOS simulators share its loopback.
  return (
    process.env.EXPO_PUBLIC_API_URL ||
    (Platform.OS === "android" ? "http://10.0.2.2:8000/api/v1" : "http://localhost:8000/api/v1")
  );
}

export const mobilePlatform: PlatformAdapter = {
  session: sessionStore,
  persistent: persistentStore,
  secure: secureStore,
  baseUrl: defaultApiBaseUrl(),
  onUnauthorized: () => unauthorizedHandler(),
  onSessionSuspend(handler) {
    const sub = AppState.addEventListener("change", (state) => {
      if (state === "background") handler("transient");
    });
    return () => sub.remove();
  },
  onSessionResume: onForeground,
  notify(message, _kind) {
    const text = render(message);
    if (Platform.OS === "android") ToastAndroid.show(text, ToastAndroid.SHORT);
    else Alert.alert(text);
  },
};

export function installMobilePlatform(): void {
  configurePlatform(mobilePlatform);
}
