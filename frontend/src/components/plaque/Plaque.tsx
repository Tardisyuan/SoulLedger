"use client";

import { createContext, useContext, useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore, type ReactNode, type RefObject } from "react";
import { flushSync } from "react-dom";
import Link from "next/link";
import { useI18n } from "@/src/contexts/I18nContext";
import { CaseNumber, MissingValue } from "@/src/components/ui/DomainValue";
import { Seal } from "./Seal";
import { useRealm } from "./useHall";

/**
 * 页头的标题行(规范 v4 `.ph`,用户 2026-11-07:去掉 v3 的 156px 满幅身份带,「页头光 + 纹样 + 水印 + 标题行」)。
 * canvas 上一片文明光(与上面的工具条接成一片)+ 文明纹样 + 水印巨印 + 44 的印 + 殿名小字 + 题字。样式在
 * globals.css 的 `.identity-band*`(类名沿用 v3,E2E 与演示站入场动画按它找);文明由 <html data-civ> 选定。
 * 组件名与 `data-testid="plaque"` 是 v2 匾的旧名,沿用。
 *
 * 题字是 Noto Serif SC 600(`font-title`),按**实测宽度**降档,不按字数(C14):28 放得下就 28(v4 稿的 h1 是
 * 26/34,七档字号里最近的是 28/36);放不下 20;还放不下 20、最多两行、末尾截断,完整文字在 title 里。
 * ≤ 768 从 20 起。降档仍然需要:egy 的页面标题最长 28 个字符。每一档都是 WCAG 大号文字(plaqueTitleStaysLargeText)。
 *
 * `collapsible`(壳里的那一条):吸在工具条下沿,页面滚过 60px 收成 44px,只留小印与殿名。
 */

/**
 * 页面给身份带的题字 / 殿名 / 右栏(用户 2026-10-02 拍板)。没给的那一项退回壳的默认:题字 =
 * 面包屑最后一段,殿名 = 租户展示名,右栏空。详情页的面包屑末段是「详情」或原始 id,所以
 * 这些页自己报题字。值只来自 API —— 页面拿不到的部分传 undefined,不编。
 *
 * `caseNumber`(审判台,用户 2026-10-02):右栏是 v3 的 `identity-case` ——「案号」小字 + 可复制的
 * `<CaseNumber>`(CASE_NUMBER_POLICY)。是一个具名的字符串槽,不是 ReactNode:`usePlaque` 的依赖
 * 按值比较,传节点会每次渲染都换引用、每次都重设一遍壳的状态。给了它就不画 `meta`。
 */
export type PlaqueText = { title?: string; meta?: string; hall?: string; caseNumber?: string; caseRef?: PlaqueCase };

/**
 * `caseRef`(灵魂详情,用户 2026-10-10 · Design 第十五批):灵魂不对应单个案子,所以右栏写的是
 * 「它的案号 · 状态」。有 `number` 就是一个指向审判详情的链接(`href`)加后缀字(`label`:未结 / 已结);
 * `{}`(没有 `number`)是「没有审判」—— 标签「案号」保留,值是 `MissingValue`。不给就没有这一栏。
 * 与 `caseNumber`(审判台自己那一场、可复制)互斥,`caseNumber` 优先。
 */
export type PlaqueCase = {
  number?: string;
  href?: string;
  label?: string;
  /** 审判不止一场时,案号下面的「全部 N 场 ›」:`allHref` 是这个灵魂的审判列表,`allCount` 是列表接口的总数。 */
  allHref?: string;
  allCount?: number;
};

const PlaqueContext = createContext<(text: PlaqueText | null) => void>(() => {});
/** AppLayout 用:把 setter 交给页面。壳外(测试、登录页)没有 Provider,`usePlaque` 什么都不做。 */
export const PlaqueProvider = PlaqueContext.Provider;

/** 页面调用:挂载期间身份带用这几样;卸载时还给壳。 */
export function usePlaque({ title, meta, hall, caseNumber, caseRef }: PlaqueText): void {
  const set = useContext(PlaqueContext);
  // 依赖按值比较:`caseRef` 是对象,每次渲染都是新引用,所以以它的 JSON 为键,进 effect 再还原。
  const caseKey = caseRef ? JSON.stringify(caseRef) : "";
  useEffect(() => {
    set({
      title: title || undefined,
      meta: meta || undefined,
      hall: hall || undefined,
      caseNumber: caseNumber || undefined,
      caseRef: caseKey ? (JSON.parse(caseKey) as PlaqueCase) : undefined,
    });
    return () => set(null);
  }, [set, title, meta, hall, caseNumber, caseKey]);
}

const TIER_CLASS = [
  "font-title text-xl font-semibold whitespace-nowrap",
  "font-title text-lg whitespace-nowrap",
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

/** 收起的标题行高度(globals.css `.identity-band[data-compact]`)。v3 的「矮带」(队列与灵魂详情 116)随 v4 撤掉:标题行本来就矮。 */
const COMPACT_PX = 44;
/** 滚过多少收起(v3 `scrollTop > 60`)。 */
const COLLAPSE_AT = 60;

/**
 * 滚过 60 收起,回到顶才展开。只在**收得下**时收:收起让文档短了「展开高 − 48」,页面不够长
 * 时一收,浏览器把滚动位置夹回 0,于是又展开 —— 在页底来回跳。
 *
 * scroll 里用 flushSync(2026-11-08):标题行在 AppLayout 里,跨页不重挂。从滚过的页软导航,Next 在新页提交时
 * 把滚动设回 0,浏览器在下一帧画之前派发 scroll —— 普通的 setState 排在画之后,于是新页在顶上、标题行还收着,
 * 画出一帧再长回去(E2E mobile-chrome 逐帧采样两次都抓到:/souls y=0 compact,下一帧才展开)。
 * 同步提交让这次展开落在同一帧里。状态没变时 React 直接跳过,滚动中不多渲染。
 */
function useCompact(enabled: boolean, band: RefObject<HTMLElement | null>): boolean {
  const [compact, setCompact] = useState(false);
  useEffect(() => {
    if (!enabled) return;
    const judge = () =>
      setCompact((was) => {
        const y = window.scrollY;
        if (was) return y > 0;
        const room = document.documentElement.scrollHeight - window.innerHeight;
        const shrink = (band.current?.offsetHeight ?? COMPACT_PX) - COMPACT_PX;
        return y > COLLAPSE_AT && room - shrink > COLLAPSE_AT;
      });
    const onScroll = () => flushSync(judge);
    judge();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, [enabled, band]);
  return enabled && compact;
}

/**
 * 吸顶的身份带把自己此刻的高度写到 <html> 的 `--identity-band` 上:筛选栏吸在
 * `--below-band`(工具条 52 + 这个高度)。页面短到收不起来时标题行一直是展开高(96;
 * ≤ 768 随题字长高),筛选栏若按 44 算就会压在它下半截上 —— 所以读实际高度,不读常量。
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
  caseNumber,
  caseRef,
  hall,
  heading = false,
  collapsible = false,
}: {
  title: string;
  /** 右栏的一般文字。≤ 768 不显示。 */
  meta?: ReactNode;
  /** 右栏的案号(v3 `identity-case`):可复制;收起时与 ≤ 768 都还在(v3 `is-compact` / `is-mobile`)。 */
  caseNumber?: string;
  /** 灵魂详情的右栏:最相关一场审判的案号 + 状态,或「没有审判」。见 `PlaqueCase`。 */
  caseRef?: PlaqueCase;
  /** 殿名;不给就是文明的冥界名(`useRealm`)。 */
  hall?: string;
  /** 壳外页(登录)没有 PageShell,那一页唯一的 <h1> 就是题字。 */
  heading?: boolean;
  /** 壳里的标题行:滚动时收成 44px。 */
  collapsible?: boolean;
}) {
  const { t } = useI18n();
  const band = useRef<HTMLDivElement>(null);
  const ref = useRef<HTMLHeadingElement & HTMLDivElement>(null);
  const Title = heading ? "h1" : "div";
  const narrow = useNarrow();
  const compact = useCompact(collapsible, band);
  useBandHeightVar(collapsible, band);
  const start: 0 | 1 = narrow ? 1 : 0;
  const [tier, setTier] = useState<0 | 1 | 2>(start);
  const realm = useRealm();
  const court = hall || realm || null;

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
      className="identity-band"
    >
      <div aria-hidden="true" className="identity-pattern" />
      {/* 水印巨印(v4 `.wm`):140 宽(≤ 768 是 112),压出右上角,文明字色 7%(浅色 9%)。收起时不画。 */}
      <div aria-hidden="true" className="identity-watermark">
        <Seal size={narrow ? 112 : 140} decorative />
      </div>
      <div className="identity-title">
        <Seal size={compact ? 24 : narrow ? 36 : 44} />
        <div className="min-w-0">
          {court ? <small className="identity-court">{court}</small> : null}
          <Title ref={ref} data-tier={tier} title={title} className={tierClass(tier)}>
            {title}
          </Title>
        </div>
      </div>
      {caseNumber ? (
        <div className="identity-case" data-case="">
          <span>{t("judgment.case_number")}</span>
          <CaseNumber value={caseNumber} variant="band" />
        </div>
      ) : caseRef ? (
        <div className="identity-case" data-case="">
          <span>{t("judgment.case_number")}</span>
          {caseRef.number ? (
            <div data-case-ref="" className="inline-block">
              <CaseNumber value={caseRef.number} href={caseRef.href} variant="band" />
              {caseRef.label ? <span className="text-xs"> · {caseRef.label}</span> : null}
              {caseRef.allHref && caseRef.allCount ? (
                <Link href={caseRef.allHref} data-case-all="" className="block text-xs underline underline-offset-2">
                  {t("souls.detail.case_all", { n: String(caseRef.allCount) })}
                </Link>
              ) : null}
            </div>
          ) : (
            // 匾色底上 MissingValue 自己的灰看不见 —— 字色随带。
            <div data-case-ref="" className="inline-block [&_[data-missing]]:text-current">
              <MissingValue kind="unrecorded" />
            </div>
          )}
        </div>
      ) : meta ? (
        <div className="identity-case">{meta}</div>
      ) : null}
    </div>
  );
}
