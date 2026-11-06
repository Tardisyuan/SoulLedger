import { notFound } from "next/navigation";
import { VerdictPrintSheet, type VerdictDocumentProps } from "@/src/components/judgment/VerdictDocument";

/**
 * 判决文书的 PDF 打印页(用户 2026-11-07;路径见 `backend/apps/judgment/verdict_pdf.py`)。
 *
 * 只给无头 Chromium(Gotenberg)打开:`/verdict-print?key=<一次性键>`。不要登录(`proxy.ts` 的公开路由),
 * 键就是凭据 —— 后端在下载人自己的请求里按详情的权限序列化好这件案子,存进缓存,这里拿键在**服务端**取回
 * (`VERDICT_PRINT_API_URL`,compose 网络里直连后端,不经 nginx;nginx 对外拒绝那条路径)。
 * 渲染的是审判页上同一个 `VerdictPaper`、同一份 `verdict-doc.css` 与 `print.css`,所以 PDF 与浏览器打印出来的一样。
 * 键不对、过期、或没配地址:404,Gotenberg 据此报错,后端答 503,网页退回浏览器打印。
 */
export const dynamic = "force-dynamic";

const KEY = /^[A-Za-z0-9_-]{32,64}$/;

export default async function VerdictPrintPage({ searchParams }: { searchParams: Promise<{ key?: string }> }) {
  const { key } = await searchParams;
  const api = process.env.VERDICT_PRINT_API_URL;
  if (!api || !key || !KEY.test(key)) notFound();
  const res = await fetch(`${api.replace(/\/$/, "")}/judgment/verdict-print/${key}/`, {
    cache: "no-store",
    // 后端在 DEBUG 关时把明文 http 重定向到 https;这条请求在 compose 网络里,不经 TLS 终点,按 https 算。
    headers: { "X-Forwarded-Proto": "https" },
  });
  if (!res.ok) notFound();
  const data = (await res.json()) as Pick<VerdictDocumentProps, "judgment" | "soul">;
  return <VerdictPrintSheet judgment={data.judgment} soul={data.soul} />;
}
