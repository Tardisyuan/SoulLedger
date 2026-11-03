import type { AxiosInstance, AxiosResponse } from "axios";
import { getLocale } from "@soulledger/core/platform";
import names from "@/src/lib/i18n/referenceNames.en.json";

/**
 * Reference data the backend only has in Chinese: court, organization, workflow and station names, permission names. An
 * English reader gets them in English, in one place, by exact match on a whole string, so nothing a person typed
 * (a soul's name, a note) is touched unless it is word for word one of these.
 *
 * ponytail: this is a display table, not a data migration. Whatever is not listed stays Chinese, and a name an
 * administrator renames stops matching. The real fix is `name_en` columns on those tables.
 *
 * Skipped where the response fills an edit form, and undone on every write (`originalNames`): a form filled from a
 * translated list row would otherwise send the English back as the new name. So English values are unique.
 *
 * Not in the table: the menu's group names (the sidebar finds them by their Chinese name, `useSidebarMenus.ts`,
 * `menuI18n.ts`) and the corpus, which stays in its original language.
 */
const EDIT_FORMS = /^\/?(workflow\/templates\/|organizations\/\d+\/$|perm\/permissions\/\d+\/$|nodes\/)/;
const TABLE = names as Record<string, string>;
const PREFIXES: [string, string][] = [["转生申请: ", "Rebirth application: "]];

export function englishNames(value: unknown): unknown {
  if (typeof value === "string") {
    const whole = TABLE[value];
    if (whole) return whole;
    const prefix = PREFIXES.find(([zh]) => value.startsWith(zh));
    return prefix ? prefix[1] + value.slice(prefix[0].length) : value;
  }
  if (Array.isArray(value)) return value.map(englishNames);
  if (value && typeof value === "object" && !(value instanceof Blob)) {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, englishNames(v)]));
  }
  return value;
}

const REVERSED: Record<string, string> = Object.fromEntries(Object.entries(TABLE).map(([zh, en]) => [en, zh]));

/** What goes back to the server, undone: a form filled from a translated row must not rename the record in English. */
export function originalNames(value: unknown): unknown {
  if (typeof value === "string") return REVERSED[value] ?? value;
  if (Array.isArray(value)) return value.map(originalNames);
  if (value && typeof value === "object" && Object.getPrototypeOf(value) === Object.prototype) {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, originalNames(v)]));
  }
  return value;
}

export function isTranslated(url: string | undefined, method: string | undefined): boolean {
  return getLocale() === "en" && (method ?? "get").toLowerCase() === "get" && !EDIT_FORMS.test(url ?? "");
}

export function installEnglishNames(api: AxiosInstance): void {
  api.interceptors.request.use((config) => {
    if (getLocale() === "en" && (config.method ?? "get").toLowerCase() !== "get") config.data = originalNames(config.data);
    return config;
  });
  api.interceptors.response.use((res: AxiosResponse) => {
    if (isTranslated(res.config.url, res.config.method)) res.data = englishNames(res.data);
    return res;
  });
}
