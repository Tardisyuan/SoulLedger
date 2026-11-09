"use client";

import { useEffect, useState, type CSSProperties } from "react";
import dynamic from "next/dynamic";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useI18n } from "@/src/contexts/I18nContext";
import { BrandMark } from "@/src/components/brand/BrandMark";
import { buttonVariants } from "@/src/components/ui/Button";
import type { SealCiv } from "@/src/components/plaque/Seal";
import { readGoodbye } from "@/src/lib/goodbye";
import { prefersReducedMotion } from "@/lib/motion";

// 嵌彩徽记的 SVG 原文在落地页的模块里(约 340 KB):单独成块,按需加载。
const LandingEmblem = dynamic(() => import("@/src/components/landing/LandingEmblem").then((m) => m.LandingEmblem), { ssr: false });

/** 自动回首页之前停留的秒数。 */
export const GOODBYE_SECONDS = 6;
const EMBERS = 14;
const IS_DEMO = process.env.NEXT_PUBLIC_DEMO_MODE === "1";

/**
 * 退出登录之后的「再会」(2026-11-10 用户:演示版与正式版都要)。AppLayout 退出时把名字与文明写进
 * sessionStorage(`src/lib/goodbye.ts`),这里读一次就删:刷新或直接打开这页时是中性的「簿已合上」。
 *
 * 画面:本殿的嵌彩徽记描线出现,两秒后像灯熄一样暗下去;魂火的余烬往上飘;六秒后回首页(可以立刻点)。
 * 减少动态效果时没有描线、余烬与暗下,倒计时照旧。公开页,没有外壳(AppLayoutWrapper / proxy.ts 的 PUBLIC_PATHS)。
 */
export default function GoodbyePage() {
  const { t } = useI18n();
  const router = useRouter();
  // 服务端没有 sessionStorage:首帧两边都是中性的,挂上之后再读(不然水合对不上)。
  const [note, setNote] = useState<ReturnType<typeof readGoodbye>>(null);
  const [still, setStill] = useState(false);
  const [left, setLeft] = useState(GOODBYE_SECONDS);
  useEffect(() => {
    // 读完就删;开发模式下这段会跑两遍,第二遍读到空,不要把第一遍的便条盖掉。
    const n = readGoodbye();
    if (n) setNote(n);
    setStill(prefersReducedMotion());
  }, []);

  useEffect(() => {
    if (left <= 0) {
      router.replace("/");
      return;
    }
    const id = setTimeout(() => setLeft((n) => n - 1), 1000);
    return () => clearTimeout(id);
  }, [left, router]);

  const civ = note?.civ ?? null;
  return (
    <main data-testid="goodbye" data-civ={civ ?? undefined} data-still={still ? "" : undefined} className="goodbye">
      {!still && (
        <div aria-hidden="true" className="goodbye-embers">
          {Array.from({ length: EMBERS }, (_, i) => (
            <span key={i} style={{ "--x": `${(i * 37) % 100}%`, "--d": `${(i * 0.53) % 4}s`, "--s": `${4 + (i % 4)}s` } as CSSProperties} />
          ))}
        </div>
      )}
      <div className="goodbye-body">
        <div aria-hidden="true" className="goodbye-mark">
          {civ ? <LandingEmblem civ={civ as SealCiv} size={168} /> : <BrandMark size={96} />}
        </div>
        <h1 className="goodbye-title font-title">{note?.name ? t("auth.goodbye.title_named", { name: note.name }) : t("auth.goodbye.title")}</h1>
        <p className="goodbye-line">{t(`auth.goodbye.line.${civ ?? "neutral"}`)}</p>
        <p role="status" className="goodbye-status">
          {t("auth.goodbye.signed_out")} · {t("auth.goodbye.returning", { n: String(Math.max(left, 0)) })}
        </p>
        <div aria-hidden="true" className="goodbye-timer">
          <span style={{ animationDuration: `${GOODBYE_SECONDS}s` }} />
        </div>
        <div className="goodbye-actions">
          <Link href="/" className={buttonVariants({ variant: "secondary" })}>
            {t("auth.goodbye.home")}
          </Link>
          {/* 演示版的首页就是选身份进入的那一页;正式版去登录页。 */}
          <Link href={IS_DEMO ? "/" : "/login"} className={buttonVariants({ variant: "primary" })}>
            {t("auth.goodbye.login")}
          </Link>
        </div>
      </div>
    </main>
  );
}
