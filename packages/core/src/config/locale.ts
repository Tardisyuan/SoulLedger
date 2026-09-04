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

/** 存放当前 locale 的**键名**。这个包里没有任何一行读它或写它。
 *
 * 名字里带 `COOKIE`,而这个包声称与平台无关,React Native 没有 cookie jar ——
 * 与当初触发整轮审计的 `NEXT_PUBLIC_API_URL` 是同一类形状。所以它被审过一遍,
 * 结论是**留下**,理由写在这里,免得下次再审一遍得出相反结论。
 *
 * 一、这里没有机制,只有一个字符串。读写全在宿主:`frontend/middleware.ts`
 * (edge,`request.cookies`)、`frontend/app/layout.tsx`(server component,
 * `await cookies()`)、`frontend/src/contexts/I18nContext.tsx`(`document.cookie`)。
 * 常量本身不假设任何存储机制,它只是个键。`platform/index.ts` 里的
 * `TENANT_ID_KEY` / `ACCESS_TOKEN_KEY` 是同样的东西,住在同样的位置。
 *
 * 二、**搬到 persistent 端口后面会真的坏掉,不是保守而是不能。** 端口是模块级
 * 单例(`platform/index.ts` 的 `adapter`),由 `PlatformProvider` 这个
 * `"use client"` 模块安装。上面两个宿主读取点跑在服务端:middleware 在 edge,
 * layout 是 async server component,两者都是**按请求**读各自的 cookie jar。
 * 服务端拿到的是 `nullAdapter`,`get` 恒返回 `null` —— `<html lang>` 会永久停在
 * 默认语言,而这正是这个文件头记着的那次 500 的同一类故障:四个绿灯,首页错。
 *
 * 三、web 那份 `persistent.set` 写死了 refresh token 的属性(`max-age=604800`,
 * 见 `frontend/lib/platform/web.ts`)。语言 cookie 现在写的是一年。走端口意味着
 * 语言偏好从一年悄悄缩成七天,没有任何东西会报出来。
 *
 * 需要改的时候要改的是**名字**(`LOCALE_STORAGE_KEY` 之类),不是位置;那要同时
 * 动 `middleware.ts`、`I18nContext.tsx` 和 `middlewareAuthGate.test.ts`。 */
export const LOCALE_COOKIE = "soulledger-locale";

export const SUPPORTED_LOCALES: readonly Locale[] = ["zh-Hans", "en", "egy"];

export const DEFAULT_LOCALE: Locale = "zh-Hans";

/** 这段界面文字**该被当成哪种语言念**,写成 BCP 47 标签。
 *
 * 不能直接写 locale:`egy` 不是有效的界面语言标签,对屏幕阅读器没有意义 ——
 * 一个 `lang="egy"` 的页面,读屏软件不知道该用哪套发音规则。埃及语界面的**文案**
 * 是英文(`messages/egy.json` 是英文底稿加术语替换),所以它对外应当声明为 `en`,
 * 与 `I18nContext` 里 `INTL_LOCALE` 把 egy 映射到 en 出于同一个理由。
 *
 * 两张表刻意分开而不是复用一张:它们回答的是不同的问题(「日期用哪种历法与格式」
 * vs「这段文字该用哪种语言念」),今天答案相同不代表永远相同。
 *
 * 曾经叫 `HTML_LANG`,而这个包里没有 HTML。**内容是可移植的,只有名字不是** ——
 * 上面那段推理在任何平台都成立,值本身在 React Native 上直接就是
 * `accessibilityLanguage` 要的东西。所以改的是名字而不是位置:一张按 locale 查
 * BCP 47 标签的表,宿主拿去填 `<html lang>` 还是填 `accessibilityLanguage`,
 * 是宿主的事。 */
export const BCP47_FOR_LOCALE: Record<Locale, string> = {
  "zh-Hans": "zh-Hans",
  en: "en",
  egy: "en",
};

export function isLocale(value: string | undefined | null): value is Locale {
  return value === "zh-Hans" || value === "en" || value === "egy";
}
