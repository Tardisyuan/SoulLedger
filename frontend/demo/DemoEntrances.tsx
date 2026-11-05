"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { authApi, isMfaRequired } from "@soulledger/core/api";
import { api } from "@soulledger/core/api/client";
import { setAccessToken, setRefreshToken } from "@soulledger/core/platform";
import { Button } from "@/src/components/ui/Button";
import { Seal, type SealCiv } from "@/src/components/plaque/Seal";
import { useI18n } from "@/src/contexts/I18nContext";
import { useTenant } from "@/src/contexts/TenantContext";
import { defaultViewRoute } from "@/src/lib/defaultView";
import { DEMO_USERNAMES, type DemoRole } from "./store";
import type { Tour } from "./tour";

export const ROLE_OF_SKIN: Record<SealCiv, DemoRole> = { cn: "judge", eu: "judge_eu", eg: "judge_eg", gr: "judge_gr" };
export const SKINS = Object.keys(ROLE_OF_SKIN) as SealCiv[];
const ENTRANCE_EVENT = "soulledger-demo-entrance";
export const TOUR_KEY = "soulledger_demo_tour";

/** The seal's overlay lives in the layout, so it outlasts the navigation it covers (`DemoEntranceOverlay`). */
export function startEntrance(skin: SealCiv, card?: HTMLElement): void {
  const box = card?.getBoundingClientRect();
  const origin = box ? { x: box.left + box.width / 2, y: box.top + box.height / 2 } : { x: window.innerWidth / 2, y: window.innerHeight / 2 };
  window.dispatchEvent(new CustomEvent(ENTRANCE_EVENT, { detail: { skin, origin } }));
}
export const ENTRANCE = ENTRANCE_EVENT;

/** A judge opens on the soul the tour follows, and the moderator on the page made for that role; the rest on the usual default. */
async function firstPage(role: DemoRole, user: Parameters<typeof defaultViewRoute>[0]): Promise<string> {
  if (role === "moderator") return "/moderation";
  const { data } = await api.get<Tour | null>("/demo/tour/");
  return data?.steps[0]?.route ?? defaultViewRoute(user);
}

/** One sign-in, through the same `authApi.login` the real page uses (the demo answers it). The tour starts over with it. */
export function useEnter() {
  const { setUser } = useTenant();
  const router = useRouter();
  const [entering, setEntering] = useState<DemoRole | null>(null);
  const enter = async (role: DemoRole) => {
    setEntering(role);
    const { data } = await authApi.login({ username: DEMO_USERNAMES[role], password: "demo", remember: false });
    if (isMfaRequired(data)) return;
    try {
      sessionStorage.removeItem(TOUR_KEY);
    } catch {
      /* no storage: nothing to clear */
    }
    setAccessToken(data.access);
    setRefreshToken(data.refresh);
    if (data.user) setUser(data.user);
    // Soft navigation: the seal keeps playing over it, and the page does not wait for the seal.
    router.push(await firstPage(role, data.user));
  };
  return { entering, enter };
}

/** Administrator and moderator: smaller, below the four cards. */
export function DemoSecondary() {
  const { t } = useI18n();
  const { entering, enter } = useEnter();
  return (
    <div className="mt-4 flex flex-wrap items-center gap-3">
      <span className="text-xs text-[oklch(var(--color-ink-subtle))]">{t("demo.landing.others")}</span>
      {(["admin", "moderator"] as const).map((role) => (
        <Button
          key={role}
          type="button"
          variant="secondary"
          size="sm"
          disabled={entering !== null}
          loading={entering === role}
          title={t(`demo.role_${role}_desc`)}
          onClick={() => void enter(role)}
          data-testid={`demo-enter-${role}`}
        >
          {t(`demo.role_${role}`)}
        </Button>
      ))}
    </div>
  );
}

/** The login page's same ways in, as a compact list. */
export function DemoEntrances() {
  const { t } = useI18n();
  const { entering, enter } = useEnter();
  return (
    <div className="flex flex-col gap-3">
      <ul className="m-0 grid list-none grid-cols-1 gap-2 p-0">
        {SKINS.map((skin) => (
          <li key={skin} data-civ={skin}>
            <button
              type="button"
              data-testid={`demo-enter-${ROLE_OF_SKIN[skin]}`}
              disabled={entering !== null}
              aria-label={t("demo.landing.card_label", { civ: t(`demo.civ.${skin}.name`) })}
              onClick={() => void enter(ROLE_OF_SKIN[skin])}
              className="seal-on-band band-colour flex w-full items-center gap-3 p-3 text-left disabled:opacity-60"
            >
              <Seal size={36} civ={skin} glyphs={null} court={t(`demo.civ.${skin}.name`)} />
              <span className="min-w-0 flex-1">
                <span className="block font-title text-md">{t(`demo.civ.${skin}.name`)}</span>
                <span className="block text-xs">{t("demo.landing.enter_judge")} →</span>
              </span>
            </button>
          </li>
        ))}
      </ul>
      <DemoSecondary />
    </div>
  );
}
