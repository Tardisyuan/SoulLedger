"use client";

import { createContext, useContext, useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore, type ReactNode, type RefObject } from "react";
import { useI18n } from "@/src/contexts/I18nContext";
import { useTenant } from "@/src/contexts/TenantContext";
import { Seal } from "./Seal";

/**
 * 身份带(规范 v3 `IdentityBand`,2026-10-01 用户拍板取代 v2 的匾):匾色压暗 10% 的实底
 * (`color-mix(main 90%, #111)`)+ 每个文明一种淡纹样(地府方格、欧洲同心弧、埃及竖线、
 * 希腊斜线,自左向右淡出)+ 品牌小字 + 印 + 殿名小字 + 题字。样式在 globals.css 的
 * `.identity-band*`;文明由 <html data-civ> 选定。
 *
 * 题字是 Noto Serif SC 600(`font-title`),按**实测宽度**降档,不按字数(C14):40 放得下
 * 就 40;放不下 28;还放不下 20、最多两行、末尾截断,完整文字在 title 里。≤ 768 从 28 起
 * (v3 手机身份带的题字就是 28 / 20)。降档仍然需要:egy 的页面标题最长 28 个字符,
 * v3 自己也给埃及画了 28 两行与 20 两行。每一档都是 WCAG 大号文字(plaqueTitleStaysLargeText)。
 *
 * `collapsible`(壳里的那一条):吸在工具条下沿,页面滚过 60px 收成 48px,只留印与殿名
 * (v3 `is-compact`)。案号:后端没有这个字段,不画(用户 2026-10-01)。
 */

/**
 * 页面给身份带的题字 / 殿名 / 右栏(用户 2026-10-02 拍板)。没给的那一项退回壳的默认:题字 =
 * 面包屑最后一段,殿名 = 租户展示名,右栏空。详情页的面包屑末段是「详情」或原始 id,所以
 * 这些页自己报题字。值只来自 API —— 页面拿不到的部分传 undefined,不编。
 */
export type PlaqueText = { title?: string; meta?: string; hall?: string };

const PlaqueContext = createContext<(text: PlaqueText | null) => void>(() => {});
/** AppLayout 用:把 setter 交给页面。壳外(测试、登录页)没有 Provider,`usePlaque` 什么都不做。 */
export const PlaqueProvider = PlaqueContext.Provider;

/** 页面调用:挂载期间身份带用这几样;卸载时还给壳。 */
export function usePlaque({ title, meta, hall }: PlaqueText): void {
  const set = useContext(PlaqueContext);
  useEffect(() => {
    set({ title: title || undefined, meta: meta || undefined, hall: hall || undefined });
    return () => set(null);
  }, [set, title, meta, hall]);
}

const TIER_CLASS = [
  "font-title text-display whitespace-nowrap",
  "font-title text-xl font-semibold whitespace-nowrap",
  "font-title text-lg line-clamp-2",
] as const;

const tierClass = (tier: 0 | 1 | 2) => `min-w-0 overflow-hidden ${TIER_CLASS[tier]}`;

/** 从 `start` 起逐档试,第一个不溢出的档就是它;都溢出就是两行 20。导出给测试。 */
export function fitTier(el: HTMLElement, start: 0 | 1 | 2 = 0): 0 | 1 | 2 {
  for (const tier of ([0, 1, 2] as const).slice(start)) {
    // 先把这一档的样式写到元素上再量 —— React 随后按同一档重渲染,写的是同一个值。
    el.dataset.tier = String(tier);
    el.className = tierClass(tier);
    if (tier === 2 || el.scrollWidth <= el.clientWidth) return tier;
  }
  return 2;
}

const NARROW = "(max-width: 768px)";
/** ≤ 768(底栏那一档)。没有 matchMedia(jsdom)按宽屏算。 */
function useNarrow(): boolean {
  return useSyncExternalStore(
    (onChange) => {
      if (typeof window.matchMedia !== "function") return () => {};
      const mq = window.matchMedia(NARROW);
      mq.addEventListener("change", onChange);
      return () => mq.removeEventListener("change", onChange);
    },
    () => typeof window.matchMedia === "function" && window.matchMedia(NARROW).matches,
    () => false
  );
}

/**
 * 矮带(v3 `.queue-product` / `.soul-product` 的 `.identity-band`):审判队列与灵魂详情两页,
 * 桌面 116 高、题字从 28 起;≤ 768 约 105 高、印 38、题字从 20 起。按路由选,页面文件不知道。
 */
export const shortBandFor = (pathname: string) => pathname === "/judgment/queue" || /^\/souls\/[^/]+$/.test(pathname);

/** 收起的身份带高度(globals.css `.identity-band[data-compact]`)。 */
const COMPACT_PX = 48;
/** 滚过多少收起(v3 `scrollTop > 60`)。 */
const COLLAPSE_AT = 60;

/**
 * 滚过 60 收起,回到顶才展开。只在**收得下**时收:收起让文档短了「展开高 − 48」,页面不够长
 * 时一收,浏览器把滚动位置夹回 0,于是又展开 —— 在页底来回跳。
 */
function useCompact(enabled: boolean, band: RefObject<HTMLElement | null>): boolean {
  const [compact, setCompact] = useState(false);
  useEffect(() => {
    if (!enabled) return;
    const onScroll = () =>
      setCompact((was) => {
        const y = window.scrollY;
        if (was) return y > 0;
        const room = document.documentElement.scrollHeight - window.innerHeight;
        const shrink = (band.current?.offsetHeight ?? COMPACT_PX) - COMPACT_PX;
        return y > COLLAPSE_AT && room - shrink > COLLAPSE_AT;
      });
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, [enabled, band]);
  return enabled && compact;
}

/**
 * 吸顶的身份带把自己此刻的高度写到 <html> 的 `--identity-band` 上:筛选栏吸在
 * `--below-band`(工具条 52 + 这个高度)。页面短到收不起来时身份带一直是 156,
 * 筛选栏若按 48 算就会压在它下半截上 —— 所以读实际高度,不读常量。
 */
function useBandHeightVar(enabled: boolean, band: RefObject<HTMLElement | null>) {
  useLayoutEffect(() => {
    const el = band.current;
    if (!enabled || !el) return;
    const root = document.documentElement.style;
    const write = () => root.setProperty("--identity-band", `${el.offsetHeight}px`);
    write();
    const observer = typeof ResizeObserver === "function" ? new ResizeObserver(write) : null;
    observer?.observe(el);
    return () => {
      observer?.disconnect();
      root.removeProperty("--identity-band");
    };
  }, [enabled, band]);
}

export function Plaque({
  title,
  meta,
  hall,
  heading = false,
  collapsible = false,
  short = false,
}: {
  title: string;
  /** 右栏(v3 的案号位)。≤ 768 不显示。 */
  meta?: ReactNode;
  /** 殿名;不给就是租户展示名。 */
  hall?: string;
  /** 壳外页(登录)没有 PageShell,那一页唯一的 <h1> 就是题字。 */
  heading?: boolean;
  /** 壳里的身份带:滚动时收成 48px。 */
  collapsible?: boolean;
  /** 矮带(`shortBandFor`):116 高、题字从 28 起。 */
  short?: boolean;
}) {
  const { t } = useI18n();
  const { user } = useTenant();
  const band = useRef<HTMLDivElement>(null);
  const ref = useRef<HTMLHeadingElement & HTMLDivElement>(null);
  const Title = heading ? "h1" : "div";
  const narrow = useNarrow();
  const compact = useCompact(collapsible, band);
  useBandHeightVar(collapsible, band);
  const start = ((narrow ? 1 : 0) + (short ? 1 : 0)) as 0 | 1 | 2;
  const [tier, setTier] = useState<0 | 1 | 2>(start);
  const court = hall || user?.tenant?.display_name || null;
  const product = t("nav.title");

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    let live = true;
    const fit = () => {
      if (live) setTier(fitTier(el, start));
    };
    fit();
    // 字体是 swap 加载的:字到了宽度才对,所以字到之后再量一次;容器变宽窄也要再量。
    void document.fonts?.ready.then(fit);
    const observer = typeof ResizeObserver === "function" ? new ResizeObserver(fit) : null;
    observer?.observe(el.parentElement ?? el);
    return () => {
      live = false;
      observer?.disconnect();
    };
  }, [title, start, compact]);

  return (
    <div
      ref={band}
      data-testid="plaque"
      data-compact={compact ? "" : undefined}
      data-short={short ? "" : undefined}
      className="identity-band"
    >
      <div aria-hidden="true" className="identity-pattern" />
      <div className="identity-brand">
        SOULLEDGER{product.toUpperCase() !== "SOULLEDGER" ? <span> {product}</span> : null}
      </div>
      <div className="identity-title">
        <Seal size={compact ? 30 : narrow ? (short ? 38 : 48) : 64} />
        <div className="min-w-0">
          {court ? <small className="identity-court">{court}</small> : null}
          <Title ref={ref} data-tier={tier} title={title} className={tierClass(tier)}>
            {title}
          </Title>
        </div>
      </div>
      {meta ? <div className="identity-case">{meta}</div> : null}
    </div>
  );
}
