/** Locale 的常量与纯函数,**不带 `"use client"`**,所以服务端和客户端都能用。
 *
 * WHY THIS FILE EXISTS。这些定义原本住在 `src/contexts/I18nContext.tsx` 里,而那是
 * 一个 `"use client"` 模块。`app/layout.tsx` 要在服务端根据 cookie 决定
 * `<html lang>`,于是从那里 import 了 `isLocale()` —— 运行时直接 500:
 *
 *     Error: Attempted to call isLocale() from the server but isLocale is on
 *     the client.
 *
 * 值得记的是它是怎么被发现的:`npx tsc --noEmit` 通过、`eslint` 干净、
 * `npm run build` 成功、`npm test` 1689 个全过。**四个绿灯,首页 500。**
 * `"use client"` 的边界是运行时语义,不是类型;类型检查看不见它,构建也不求值
 * layout,而 jest 里没有服务端渲染。只有真的把页面打开才会知道。
 *
 * `middleware.ts` 同样从这里取值 —— 它此前把 cookie 名和支持的 locale 列表各自
 * 抄了一份字面量,与 I18nContext 里的两份并存。三份同源常量没有任何东西保证一致。 */

export type Locale = "zh-Hans" | "en" | "egy";

export const LOCALE_COOKIE = "soulledger-locale";

export const SUPPORTED_LOCALES: readonly Locale[] = ["zh-Hans", "en", "egy"];

export const DEFAULT_LOCALE: Locale = "zh-Hans";

/** `<html lang>` 该写什么。
 *
 * 不能直接写 locale:`egy` 不是有效的界面语言标签,对屏幕阅读器没有意义 ——
 * 一个 `lang="egy"` 的页面,读屏软件不知道该用哪套发音规则。埃及语界面的**文案**
 * 是英文(`messages/egy.json` 是英文底稿加术语替换),所以它对外应当声明为 `en`,
 * 与 `I18nContext` 里 `INTL_LOCALE` 把 egy 映射到 en 出于同一个理由。
 *
 * 两张表刻意分开而不是复用一张:它们回答的是不同的问题(「日期用哪种历法与格式」
 * vs「这段文字该用哪种语言念」),今天答案相同不代表永远相同。 */
export const HTML_LANG: Record<Locale, string> = {
  "zh-Hans": "zh-Hans",
  en: "en",
  egy: "en",
};

export function isLocale(value: string | undefined | null): value is Locale {
  return value === "zh-Hans" || value === "en" || value === "egy";
}
