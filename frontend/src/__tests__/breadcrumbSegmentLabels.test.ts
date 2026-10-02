/**
 * Routes outside the menu tree read their crumb — and so the identity band's title, which is the
 * last crumb — from `breadcrumb.<segment>` (`useBreadcrumbs`). Without a key the raw path segment
 * shows: the band on /notifications read「notifications」, /profile「profile」, /welcome「welcome」,
 * /menus/buttons「buttons」, /admin/assistant「assistant」(v3 pages audit, 2026-10-02).
 *
 * Each label is the page's own title in that bundle, so crumb, band and <h1> say the same thing.
 */
import zh from "@soulledger/core/messages/zh-Hans.json";
import en from "@soulledger/core/messages/en.json";
import egy from "@soulledger/core/messages/egy.json";

type Bundle = Record<string, unknown>;
const get = (b: Bundle, path: string): unknown =>
  path.split(".").reduce<unknown>((o, k) => (o as Record<string, unknown> | undefined)?.[k], b);

const SEGMENT_TITLE: Record<string, string> = {
  notifications: "notifications.title",
  profile: "profile.title",
  welcome: "nav.home",
  buttons: "menu_buttons.title",
  admin: "breadcrumb.menu.group_settings",
  assistant: "assist_admin.title",
  usage: "assist_admin.tabs.usage",
};

describe.each([
  ["zh-Hans", zh],
  ["en", en],
  ["egy", egy],
] as const)("%s", (_name, bundle) => {
  it.each(Object.entries(SEGMENT_TITLE))("breadcrumb.%s is the page's own title (%s)", (segment, titleKey) => {
    const label = get(bundle as Bundle, `breadcrumb.${segment}`);
    expect(typeof label).toBe("string");
    expect(label).not.toBe(segment);
    expect(label).toBe(get(bundle as Bundle, titleKey));
  });
});
