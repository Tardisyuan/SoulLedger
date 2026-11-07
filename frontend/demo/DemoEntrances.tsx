"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { authApi, isMfaRequired } from "@soulledger/core/api";
import { api } from "@soulledger/core/api/client";
import { getLocale, setAccessToken, setRefreshToken } from "@soulledger/core/platform";
import { Button } from "@/src/components/ui/Button";
import { Seal, type SealCiv } from "@/src/components/plaque/Seal";
import { useI18n } from "@/src/contexts/I18nContext";
import { useTenant } from "@/src/contexts/TenantContext";
import { defaultViewRoute } from "@/src/lib/defaultView";
import { DEMO_USERNAMES, type DemoRole, langOf, recording } from "./store";
import { type Tour, tourOf } from "./tour";

export const ROLE_OF_SKIN: Record<SealCiv, DemoRole> = { cn: "judge", eu: "judge_eu", eg: "judge_eg", gr: "judge_gr" };
export const SKINS = Object.keys(ROLE_OF_SKIN) as SealCiv[];
const ENTRANCE_EVENT = "soulledger-demo-entrance";
export const TOUR_KEY = "soulledger_demo_tour";

/**
 * What covers the way in. The administrator's console belongs to no underworld: a neutral cover (`null`). The moderator's
 * hall is 中国地府's (the recording's tenant is CN_DIYU) and the console opens in its colours, so its seal.
 */
const SKIN_OF_ROLE: Record<DemoRole, SealCiv | null> = { judge: "cn", judge_eu: "eu", judge_eg: "eg", judge_gr: "gr", moderator: "cn", admin: null };

/** A rectangle on screen, and its corner radius: where the cover and the seal start from (`EntranceOverlay`). */
export type EntranceBox = { x: number; y: number; w: number; h: number; r: number };
export type EntranceDetail = { skin: SealCiv | null; from: EntranceBox | null; mark: EntranceBox | null };

function boxOf(el: Element): EntranceBox {
  const b = el.getBoundingClientRect();
  return { x: b.left, y: b.top, w: b.width, h: b.height, r: parseFloat(getComputedStyle(el).borderTopLeftRadius) || 0 };
}

/**
 * The seal's overlay lives in the layout, so it outlasts the navigation it covers (`EntranceOverlay`). It starts as the
 * thing clicked: the card's box, and the card's emblem (or seal) as where the seal comes from.
 */
function startEntrance(skin: SealCiv | null, card?: HTMLElement): void {
  const mark = card?.querySelector("[data-testid='civ-emblem'], [data-testid='seal']");
  const detail: EntranceDetail = { skin, from: card ? boxOf(card) : null, mark: mark ? boxOf(mark) : null };
  window.dispatchEvent(new CustomEvent(ENTRANCE_EVENT, { detail }));
}
export const ENTRANCE = ENTRANCE_EVENT;
/** Sent by `enter` with the route it pushed. */
export const ENTERED = "soulledger-demo-entered";

/** A judge opens on the soul the tour follows, and the moderator on the page made for that role; the rest on the usual default. */
async function firstPage(role: DemoRole, user: Parameters<typeof defaultViewRoute>[0]): Promise<string> {
  if (role === "moderator") return "/moderation";
  const { data } = await api.get<Tour | null>("/demo/tour/");
  return data?.steps[0]?.route ?? defaultViewRoute(user);
}

/**
 * Ahead of the click (hover, focus, press): the role's recording (1–5 MB; the sign-in waits on it) and the page it opens
 * on. Without it the seal played out over a landing page still waiting for both. Only a head start: `enter` still asks
 * `/demo/tour/` where to go.
 */
export function useWarm() {
  const router = useRouter();
  return (role: DemoRole) => {
    void recording(role, langOf(getLocale())).then(async (rec) => {
      const user = rec.login.user as unknown as Parameters<typeof defaultViewRoute>[0];
      router.prefetch(role === "moderator" ? "/moderation" : (tourOf(rec)?.steps[0]?.route ?? (await defaultViewRoute(user))));
    });
  };
}

/**
 * One sign-in, through the same `authApi.login` the real page uses (the demo answers it). The tour starts over with it.
 * Every way in goes behind the cover, started here rather than by each caller: the administrator and moderator buttons
 * and the login page's list called only this, and the landing page stood still, the button spinning, until the console
 * replaced it (about 1 s on a desktop, 3.5 s on a slow phone).
 */
export function useEnter() {
  const { setUser } = useTenant();
  const router = useRouter();
  const warm = useWarm();
  const [entering, setEntering] = useState<DemoRole | null>(null);
  const enter = async (role: DemoRole, from?: HTMLElement) => {
    startEntrance(SKIN_OF_ROLE[role], from);
    setEntering(role);
    warm(role);
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
    const route = await firstPage(role, data.user);
    router.push(route);
    // The seal, if one is up, holds until this route is on screen (`EntranceOverlay`).
    window.dispatchEvent(new CustomEvent(ENTERED, { detail: { route } }));
  };
  return { entering, enter, warm };
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
          onClick={(e) => void enter(role, e.currentTarget)}
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
              onClick={(e) => void enter(ROLE_OF_SKIN[skin], e.currentTarget)}
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
