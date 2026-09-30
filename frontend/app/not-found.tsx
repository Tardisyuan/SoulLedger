"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useI18n } from "@/src/contexts/I18nContext";
import { Plaque } from "@/src/components/plaque/Plaque";
import { Button, buttonVariants } from "@/src/components/ui/Button";

/**
 * 404(规范 v2 补足 C15「404 · 500 · App 离线」):匾题「404」,正文一句 20 / 600,
 * 下面是没找到的路径(等宽 ink3),两颗次按钮「回首页」「返回」。匾按当前租户的文明
 * 变色;没登录(中性皮)时 Plaque 自己就是中性的、没有印。
 */
export default function NotFound() {
  const { t } = useI18n();
  const pathname = usePathname();
  const router = useRouter();

  return (
    <div className="bg-[oklch(var(--color-canvas))]">
      <Plaque title="404" />
      <div className="px-4 py-8 md:px-8">
        <h1 className="text-lg font-semibold text-[oklch(var(--color-ink))]">{t("not_found.title")}</h1>
        <p className="mt-1 text-sm text-[oklch(var(--color-ink-muted))]">{t("not_found.description")}</p>
        {pathname && <p className="mt-2 font-mono text-2xs text-[oklch(var(--color-ink-subtle))]">{pathname}</p>}
        <div className="mt-4 flex flex-wrap gap-2">
          <Link href="/" className={buttonVariants({ variant: "secondary" })}>
            {t("not_found.home")}
          </Link>
          <Button type="button" variant="secondary" onClick={() => router.back()}>
            {t("common.back")}
          </Button>
        </div>
      </div>
    </div>
  );
}
