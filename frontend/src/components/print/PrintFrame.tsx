"use client";

import { useEffect, type ReactNode } from "react";
import { BrandMark } from "@/src/components/brand/BrandMark";
import { useI18n } from "@/src/contexts/I18nContext";

const N = "\uE000";
const M = "\uE001";

/** 「第 {n} 页 / 共 {m} 页」→ ["第 ", " 页 / 共 ", " 页"];缺哪个占位符,对应的段就并进相邻段。 */
export function splitPageLabel(label: string): [string, string, string] {
  const i = label.indexOf(N);
  const j = label.indexOf(M);
  if (i < 0 || j < i) return [label.replace(N, "").replace(M, ""), "", ""];
  return [label.slice(0, i), label.slice(i + 1, j), label.slice(j + 1)];
}

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
  // 整句键 print.page_label 带 {{n}} 与 {{m}};用两个私用区字符占位,再拆成前 / 中 / 后三段
  // (后段可以是空串 —— 那是这里的值,不是语言包里的值,语言包不许放空串)。
  const [pre, mid, post] = splitPageLabel(t("print.page_label", { n: N, m: M }));
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
