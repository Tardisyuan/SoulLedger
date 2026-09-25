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

export async function hydratePersistentStore(): Promise<void> {
  try {
    const keys = await AsyncStorage.getAllKeys();
    for (const [key, value] of await AsyncStorage.multiGet(keys)) {
      if (value !== null) persistentCache.set(key, value);
    }
  } catch {
    // An unreadable store is an empty one: defaults apply, nothing secret lives here.
  }
}

/**
 * `deleteItemAsync` is the only delete expo-secure-store offers. Overwriting
 * with "" first makes the removal visible to the very next synchronous `get`
 * (read as absent), so a sign-out followed at once by a read cannot see the
 * old refresh token while the async delete is still in flight.
 */
export const secureStore: KeyValueStore = {
  get: (key) => SecureStore.getItem(key) || null,
  set: (key, value) => SecureStore.setItem(key, value),
  remove: (key) => {
    SecureStore.setItem(key, "");
    SecureStore.deleteItemAsync(key).catch(() => {});
  },
};

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
  onSessionResume(handler) {
    let previous = AppState.currentState;
    const sub = AppState.addEventListener("change", (state) => {
      if (state === "active" && previous === "background") handler();
      previous = state;
    });
    return () => sub.remove();
  },
  notify(message, _kind) {
    const text = render(message);
    if (Platform.OS === "android") ToastAndroid.show(text, ToastAndroid.SHORT);
    else Alert.alert(text);
  },
};

export function installMobilePlatform(): void {
  configurePlatform(mobilePlatform);
}
