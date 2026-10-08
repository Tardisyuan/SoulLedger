"use client";

import { useEffect, useRef } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { authApi } from "@soulledger/core/api";
import { useI18n } from "@/src/contexts/I18nContext";

/**
 * 官员邮件的语言跟界面语言走。界面语言只存在浏览器 cookie 里,服务端没有,所以发信时读的
 * `preferences.email_locale` 要由前端保持同步:界面语言**变动**时(不是每次加载 ——
 * 首次渲染不发任何请求),邮件开着且记的语言不同,就把它改成新的。邮件只有 zh-Hans / en,egy 落到 en。
 * 只挂在登录后的壳里(`AppLayout`);登录页切语言时没有账号可改。失败静默:下次切换再同步。
 */
export function useSyncEmailLocale() {
  const { locale } = useI18n();
  const queryClient = useQueryClient();
  const last = useRef(locale);

  useEffect(() => {
    if (last.current === locale) return;
    last.current = locale;
    const want = locale === "zh-Hans" ? "zh-Hans" : "en";
    (async () => {
      const { data } = await authApi.preferences();
      if (data.email_notifications !== true || data.email_locale === want) return;
      const next = await authApi.updatePreferences({ email_locale: want });
      queryClient.setQueryData(["profile", "preferences"], next.data);
    })().catch(() => {});
  }, [locale, queryClient]);
}
