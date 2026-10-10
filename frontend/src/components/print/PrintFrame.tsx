"use client";

import { useEffect, type ReactNode } from "react";
import { BrandMark } from "@/src/components/brand/BrandMark";
import { useI18n } from "@/src/contexts/I18nContext";

/**
 * 打印时的文书框(Design 第十五批 C1):页眉左殿名、右殿印(BrandMark 线稿 24px);页脚左案号或灵魂编号,
 * 右「第 N 页 / 共 M 页」。屏幕上页眉页脚不显示,框也只是个普通块。
 *
 * 版面规则全在 `app/print.css`(按 `data-print-*` 属性);页眉页脚是表头 / 表脚组,每页重复。
 * 页码右栏是 `@page` 边距盒,目前只有 Chromium 系印得出来 —— 这里只负责把页码前后的字
 * 按语言写进根元素的 `--print-page-*`(边距盒读的是根上的变量),挂载期间有效。
 *
 * `reference`:案号或灵魂编号,字符串,页脚左边原样印;没有(还在加载)就不印这一格。
 */
export function PrintFrame({
  hall,
  reference,
  referenceLabel,
  children,
}: {
  hall?: string;
  reference?: string | null;
  referenceLabel: string;
  children: ReactNode;
}) {
  const { t } = useI18n();
  const pre = t("print.page_pre");
  const mid = t("print.page_mid");
  const post = t("print.page_post");
  useEffect(() => {
    const root = document.documentElement;
    const q = (s: string) => JSON.stringify(s);
    root.style.setProperty("--print-page-pre", q(pre));
    root.style.setProperty("--print-page-mid", q(mid));
    root.style.setProperty("--print-page-post", q(post));
    return () => {
      for (const k of ["pre", "mid", "post"]) root.style.removeProperty(`--print-page-${k}`);
    };
  }, [pre, mid, post]);

  return (
    <div data-print-doc="">
      <div data-print-head="" aria-hidden="true">
        <div>
          <span data-print-hall="">{hall}</span>
          <BrandMark size={24} tone="ink" />
        </div>
      </div>
      <div data-print-body="">{children}</div>
      <div data-print-foot="" aria-hidden="true">
        <div>
          <span data-print-reference="">{reference ? `${referenceLabel} ${reference}` : ""}</span>
          {/* 右侧页码由 @page 边距盒承担(见 print.css);不支持的浏览器这一格留空。 */}
          <span />
        </div>
      </div>
    </div>
  );
}
