import type { Metadata, Viewport } from "next";
import { cookies } from "next/headers";
// CJK 两支:包自带的 index.css 各含 101 条 @font-face,每条带自己的 unicode-range,
// 浏览器只取页面真正用到的分片。必须在 globals.css 之前 import,让 Tailwind 的
// base 层能覆盖它们带来的任何默认值。见 app/fonts.ts 顶部关于为何不走 next/font/local。
import "@fontsource-variable/noto-sans-sc";
import "@fontsource-variable/noto-serif-sc";
import "./globals.css";
import { fontVariables } from "./fonts";
import { ToastProvider } from "@/src/contexts/ToastContext";
import { I18nProvider } from "@/src/contexts/I18nContext";
import { HTML_LANG, isLocale, LOCALE_COOKIE } from "@soulledger/core/config/locale";
import { ThemeProvider } from "@/src/contexts/ThemeContext";
import { TenantProvider } from "@/src/contexts/TenantContext";
import { WebSocketProvider } from "@/src/contexts/WebSocketContext";
import { SocialEventBusProvider } from "@/hooks/useSocialEventBus";
import { QueryProvider } from "@/src/components/providers/QueryProvider";
import { PlatformProvider } from "@/src/components/providers/PlatformProvider";
import { Suspense } from "react";
import { RouteProgress } from "@/src/components/layout/RouteProgress";
import { AppLayoutWrapper } from "@/src/components/layout/AppLayoutWrapper";

/** 没有这个,真机上整个应用按约 980px 的默认布局视口渲染,再整体缩小塞进屏幕
 * —— 字号全部缩水、点击目标低于可用下限,而在桌面浏览器里一切正常,所以它一直
 * 没被发现。
 *
 * 实测(2026-08-28,Playwright `devices["Pixel 5"]`,设备宽 393):加这段之前
 * `window.innerWidth` 报 **738**;Pixel 5 的 393 与它对不上,差的就是这一段。
 * mobile-chrome 上那三条长期失败的 E2E 也源于此 —— 布局视口与设备视口不一致时,
 * 点击坐标映射会和实际绘制位置错开。
 *
 * `initialScale: 1` 与 `width: "device-width"` 必须成对:只给宽度,iOS Safari 在
 * 横竖屏切换后仍会自己缩放。刻意**不**设 `maximumScale` 或 `userScalable: false`
 * —— 禁用缩放是无障碍倒退,而这份配置本来就是为修无障碍缺陷而加的。 */
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
};

export const metadata: Metadata = {
  title: "SoulLedger",
  description: "Cross-civilization soul management system",
};

/** 首帧就把主题类写到 `<html>` 上,在 React 接管之前。
 *
 * `ThemeProvider` 在 mount 后会同步 classList,所以偏好 light 的用户**最终**看到
 * 的是对的 —— 但在那之前会先闪一帧深色。这段脚本是标准的 anti-FOUC 做法:它是
 * blocking 的,在 HTML 解析阶段就跑完,所以没有任何一帧是错的。
 *
 * 之所以不能靠服务端渲染解决:主题存在 localStorage 里,服务端读不到。语言存在
 * cookie 里,所以语言可以在服务端定(见下),主题不行。
 *
 * try/catch 不是装饰:localStorage 在隐私模式、或站点数据被禁用时会直接抛异常,
 * 而这段脚本一旦抛出就会中断解析。默认 dark 与 ThemeProvider 的默认值一致。 */
const THEME_BOOTSTRAP = `(function(){try{var t=localStorage.getItem("soulledger_theme");var d=t!=="light";document.documentElement.classList.toggle("dark",d);document.documentElement.classList.toggle("light",!d);}catch(e){document.documentElement.classList.add("dark");}})();`;

export default async function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  // `<html lang>` 必须在服务端定下来。此前它是硬编码的 `zh-Hans`,而 locale 只活在
  // 客户端 state 里,两者从未同步 —— 用户切到 en 之后 lang **永久**停在 zh-Hans,
  // 读屏软件会用中文发音去念英文,`:lang()` 选择器和浏览器翻译提示也全错,而且不会
  // 自愈。这与主题不同:主题错的是首帧,语言错的是全程。
  //
  // 代价:读 cookie 让整棵树退出静态渲染。这里本来就不是静态的 —— middleware.ts
  // 每个请求都在读写同一个 cookie,且全站页面都要认证。
  const cookieLocale = (await cookies()).get(LOCALE_COOKIE)?.value;
  const locale = isLocale(cookieLocale) ? cookieLocale : undefined;

  return (
    // suppressHydrationWarning 只作用于这一个元素的属性,是 anti-FOUC 脚本的必要配套:
    // THEME_BOOTSTRAP 在 React 注水之前就往 className 里加了 dark 或 light,于是客户端
    // 首次读到的 className 必然与服务端渲染的那份不同 —— React 会报 hydration mismatch。
    // 服务端读不到 localStorage,所以这个差异无法消除,只能声明它是预期的。
    // 实测过:不加这一行,首页在 dev overlay 里稳定报一条 "1 Issue"。
    <html
      lang={locale ? HTML_LANG[locale] : HTML_LANG["zh-Hans"]}
      className={fontVariables}
      suppressHydrationWarning
    >
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_BOOTSTRAP }} />
      </head>
      <body className="antialiased min-h-screen">
        <PlatformProvider />
        <QueryProvider>
          <I18nProvider initialLocale={locale}>
            <ThemeProvider>
              <TenantProvider>
                <WebSocketProvider>
                  <SocialEventBusProvider>
                    <ToastProvider>
                      {/* useSearchParams needs a Suspense boundary or the whole
                          tree opts out of static rendering. */}
                      <Suspense fallback={null}>
                        <RouteProgress />
                      </Suspense>
                    <AppLayoutWrapper>
                      {children}
                    </AppLayoutWrapper>
                  </ToastProvider>
                  </SocialEventBusProvider>
                </WebSocketProvider>
              </TenantProvider>
            </ThemeProvider>
          </I18nProvider>
        </QueryProvider>
      </body>
    </html>
  );
}
