"use client";

import Link from "next/link";
import { useI18n } from "@/src/contexts/I18nContext";

export function NavBar() {
  const { t } = useI18n();

  return (
    <nav className="border-b border-slate-800 px-6 py-3 flex items-center justify-between bg-slate-950/80 backdrop-blur-sm">
      <div className="flex items-center gap-6">
        <Link href="/" className="text-amber-400 font-bold text-lg hover:text-amber-300">
          SoulLedger
        </Link>
        <div className="flex items-center gap-4 text-sm">
          <Link href="/souls/" className="text-slate-400 hover:text-white transition-colors">
            {t("nav.souls")}
          </Link>
          <Link href="/realms/" className="text-slate-400 hover:text-white transition-colors">
            {t("nav.realms")}
          </Link>
          <Link href="/actors/" className="text-slate-400 hover:text-white transition-colors">
            {t("nav.actors")}
          </Link>
        </div>
      </div>
      <div className="flex items-center gap-3">
        <Link
          href="/souls/"
          className="px-4 py-1.5 bg-amber-700 hover:bg-amber-600 rounded text-sm font-medium transition-colors"
        >
          {t("nav.souls")}
        </Link>
      </div>
    </nav>
  );
}
