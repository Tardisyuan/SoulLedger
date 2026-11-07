"use client";

/**
 * The soul app's screens, drawn in the browser for the demo only (v4 第十批第 1 条): 本世, 书信, 朋友圈, 转生
 * (地府 and 希腊 only) and the lock screen's live progress. They read one soul's recording (`soulRecording`,
 * `data/soul_<civ>.<lang>.json`) and lay it out as the app does; they are not the app's code, which is React Native.
 * Where the place on the road comes from is the app's own reading (`soulRoute`, packages/core), so the two agree.
 */
import type { MeProfile, MeRebirthApplicationList, MeSentencePlan } from "@soulledger/core/api/soul";
import type { PaginatedSoulPosts } from "@soulledger/core/api/soul-social";
import { thisLifeLabel } from "@soulledger/core/domain/lifeLabel";
import { liveContent, soulRoute, type SoulRoute } from "@soulledger/core/domain/soulRoute";
import { Seal, type SealCiv } from "@/src/components/plaque/Seal";
import { useI18n } from "@/src/contexts/I18nContext";
import letters from "./data/soul-letters.json";
import { read, type Recording } from "./store";

export type SoulScreen = "life" | "letters" | "circle" | "rebirth" | "lock";
/** v4: 转生 is a tab only where souls go round. */
export const REBIRTH_CIVS: ReadonlySet<SealCiv> = new Set<SealCiv>(["cn", "gr"]);

type T = (key: string, params?: Record<string, string>) => string;

function doc<D>(rec: Recording, path: string): D | null {
  const { status, data } = read(rec, path, new URLSearchParams());
  // `read` answers a path it never saw with an empty list (`emptyLike`): that is "not recorded", not a profile.
  return status === 200 && data && typeof data === "object" && !(Array.isArray(data) && data.length === 0) ? (data as D) : null;
}

/** What the screens read off one recording; `me` is null when the soul's `/me/` was not recorded. */
export function soulView(rec: Recording, civ: SealCiv, t: T) {
  const me = doc<MeProfile>(rec, "/me/");
  const plan = doc<MeSentencePlan>(rec, "/me/sentence-plan/");
  const route = me ? soulRoute({ me, civ, plan, hall: "", now: Date.now() }, t) : null;
  const n = (me?.account?.cycle ?? 0) + 1;
  const life = me ? thisLifeLabel(t, me.civilization, n) ?? t("soul_app.life.cycle", { cycle: String(n) }) : "";
  return { rec, me, plan, route, life };
}
export type SoulView = ReturnType<typeof soulView>;

const word = (t: T, key: string, fallback: string) => (t(key) === key ? t(fallback) : t(key));
const signed = (b: number) => (b > 0 ? `+${b}` : b < 0 ? `−${-b}` : "0");

const SECTION = "border-b border-[oklch(var(--color-line))] px-4 py-4";
const EYEBROW = "m-0 text-2xs uppercase text-[oklch(var(--color-metal))]";

export function SoulScreenBody({ screen, view, civ }: { screen: SoulScreen; view: SoulView; civ: SealCiv }) {
  if (screen === "letters") return <Letters civ={civ} />;
  if (screen === "circle") return <Circle view={view} />;
  if (screen === "rebirth") return <Rebirth view={view} />;
  if (screen === "lock") return <Lock view={view} />;
  return <Life view={view} civ={civ} />;
}

function Life({ view, civ }: { view: SoulView; civ: SealCiv }) {
  const { t } = useI18n();
  const { me, route, life } = view;
  if (!me) return <Unrecorded />;
  const meta = [t(`souls.civilizations.${me.civilization}`), life].join(" · ");
  return (
    <div data-testid="demo-soul-life">
      <header className={`${SECTION} flex items-center gap-4`}>
        <Seal size={64} civ={civ} glyphs={null} court={t(`demo.civ.${civ}.name`)} />
        <div className="min-w-0">
          <p className="m-0 truncate text-xs text-[oklch(var(--color-ink-muted))]">{meta}</p>
          <h2 className="m-0 mt-1 font-title text-xl text-[oklch(var(--color-ink))]">{me.name}</h2>
          <p className="m-0 mt-1 font-mono text-xs text-[oklch(var(--color-ink-muted))]">{me.soul_code}</p>
        </div>
      </header>
      <section className={SECTION} aria-labelledby="demo-soul-here">
        <p id="demo-soul-here" className={EYEBROW}>{t("soul_app.life.here")}</p>
        {route ? <Route route={route} /> : <p className="m-0 mt-2 font-title text-lg">{t(`soul_app.soul_states.${me.current_state}`)}</p>}
      </section>
      {/* The balance on a v4 panel (surface-1, hairline, rounded-panel), the number font-title 28 in ink as the web soul page draws 功 / 过. */}
      <section className={SECTION}>
        <div className="flex items-end gap-6 rounded-panel border border-[oklch(var(--color-line))] bg-[oklch(var(--color-surface-1))] p-4">
          <div className="flex-1">
            <p className="m-0 text-xs text-[oklch(var(--color-ink-subtle))]">{t("soul_app.life.balance")}</p>
            <p className="m-0 mt-1 font-title text-xl font-semibold tabular-nums text-[oklch(var(--color-ink))]">{signed(me.merit_score - me.demerit_score)}</p>
          </div>
          {(["merit", "demerit"] as const).map((w) => (
            <div key={w}>
              <p className="m-0 text-xs text-[oklch(var(--color-ink-subtle))]">{word(t, `soul_app.lexicon.${civ}.${w}`, `soul_app.life.${w}`)}</p>
              <p className="m-0 font-mono text-md text-[oklch(var(--color-ink))]">{w === "merit" ? me.merit_score : me.demerit_score}</p>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}

/** v4 「你现在在哪」: the place, its sentence, then the road top to bottom (walked solid, here, ahead dashed). */
function Route({ route }: { route: SoulRoute }) {
  const { t } = useI18n();
  return (
    <>
      <p data-testid="demo-soul-place" className="m-0 mt-2 font-title text-xl text-[oklch(var(--color-ink))]">{route.place}</p>
      {route.line && <p className="m-0 mt-2 text-sm text-[oklch(var(--color-ink-muted))]">{route.line}</p>}
      <ol className="m-0 mt-4 list-none p-0" aria-label={t("map.soul.here")}>
        {route.steps.map((step, i) => {
          const kind = i < route.at ? "walked" : i === route.at ? "here" : "ahead";
          return (
            <li key={step.id} data-route-step={kind} className="relative flex gap-3 pb-3 pl-1">
              <span
                aria-hidden="true"
                className={`mt-1 size-3 shrink-0 rounded-full border-2 ${
                  kind === "walked" ? "border-[oklch(var(--color-main-ink))] bg-[oklch(var(--color-main-ink))]" : "border-[oklch(var(--color-line-strong))]"
                } ${kind === "here" ? (step.end ? "border-[oklch(var(--color-danger))]" : "border-[oklch(var(--color-ink))]") : ""}`}
              />
              <span className={kind === "ahead" ? "text-sm text-[oklch(var(--color-ink-muted))]" : "text-sm text-[oklch(var(--color-ink))]"}>
                {kind === "here" && <span className="block text-2xs uppercase text-[oklch(var(--color-ink-subtle))]">{t("map.soul.here")}</span>}
                <span className={kind === "here" ? "font-title text-md" : undefined}>{step.label}</span>
                {kind === "here" && step.sub && <span className="block text-xs text-[oklch(var(--color-ink-muted))]">{step.sub}</span>}
              </span>
            </li>
          );
        })}
      </ol>
    </>
  );
}

function Letters({ civ }: { civ: SealCiv }) {
  const { t, locale, formatDateTime } = useI18n();
  const lang = locale === "zh-Hans" ? "zh" : "en";
  const thread = letters.letters[civ];
  const hall = t(`plaque.realm.${civ}`);
  return (
    <div data-testid="demo-soul-letters">
      <header className={SECTION}>
        <p className={EYEBROW}>{t("soul_app.chat.section.hall")}</p>
        <h2 className="m-0 mt-1 font-title text-lg">{t("soul_app.chat.hall.title", { hall })}</h2>
        <p className="m-0 mt-1 text-xs text-[oklch(var(--color-ink-muted))]">{t("soul_app.chat.hall.subtitle")}</p>
      </header>
      <ol className="m-0 flex list-none flex-col gap-3 p-4">
        {thread.map((m, i) => (
          <li key={i} className={m.from === "me" ? "self-end" : "self-start"}>
            <p
              className={`m-0 max-w-[18rem] rounded-panel border border-[oklch(var(--color-line))] px-3 py-2 text-sm ${
                m.from === "me" ? "bg-[oklch(var(--color-surface-2))]" : "bg-[oklch(var(--color-surface-1))]"
              }`}
            >
              {m[lang]}
            </p>
            <p className={`m-0 mt-1 text-2xs text-[oklch(var(--color-ink-subtle))] ${m.from === "me" ? "text-right" : ""}`}>
              {formatDateTime(new Date(Date.now() - m.minutes_ago * 60000).toISOString())}
            </p>
          </li>
        ))}
      </ol>
    </div>
  );
}

function Circle({ view }: { view: SoulView }) {
  const { t, formatDateTime } = useI18n();
  const feed = doc<PaginatedSoulPosts>(view.rec, "/me/social/feed/");
  const posts = feed?.results ?? [];
  return (
    <div data-testid="demo-soul-circle">
      <header className={SECTION}>
        <h2 className="m-0 font-title text-lg">{t("soul_app.circle.tab")}</h2>
      </header>
      {posts.length === 0 ? (
        <p className="m-0 p-4 text-sm text-[oklch(var(--color-ink-muted))]">{t("soul_app.circle.feed.empty_title")}</p>
      ) : (
        <ul className="m-0 list-none p-0">
          {posts.map((post) => (
            <li key={post.id} className={SECTION}>
              <p className="m-0 text-sm font-semibold text-[oklch(var(--color-ink))]">{post.author.display_name}</p>
              <p className="m-0 mt-1 text-sm text-[oklch(var(--color-ink))]">{post.content}</p>
              <p className="m-0 mt-2 text-2xs text-[oklch(var(--color-ink-subtle))]">
                {formatDateTime(post.create_time)} · ♡ {post.reaction_count} · ✉ {post.comment_count}
              </p>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function Rebirth({ view }: { view: SoulView }) {
  const { t, formatDateTime } = useI18n();
  const list = doc<MeRebirthApplicationList>(view.rec, "/me/rebirth-applications/");
  const apps = list?.results ?? [];
  return (
    <div data-testid="demo-soul-rebirth">
      <header className={SECTION}>
        <h2 className="m-0 font-title text-lg">{t("soul_app.tabs.rebirth")}</h2>
      </header>
      {apps.length === 0 ? (
        <p className="m-0 p-4 text-sm text-[oklch(var(--color-ink-muted))]">{t("soul_app.life.no_applications")}</p>
      ) : (
        <ul className="m-0 list-none p-0">
          {apps.map((a) => (
            <li key={a.id} className={SECTION}>
              <p className="m-0 flex items-baseline justify-between gap-3">
                <span className="font-title text-md">{t(`reincarnation.forms.${a.desired_form}`)}</span>
                <span className="text-xs text-[oklch(var(--color-ink-muted))]">{t(`soul_app.status.${a.status}`)}</span>
              </p>
              {a.statement && <p className="m-0 mt-2 text-sm text-[oklch(var(--color-ink))]">{a.statement}</p>}
              <p className="m-0 mt-2 text-2xs text-[oklch(var(--color-ink-subtle))]">{formatDateTime(a.created_at)}</p>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** The lock screen's live progress (V4Batch07 「锁屏 · 实时活动」), as an extra screen marked 「只在演示里」. */
function Lock({ view }: { view: SoulView }) {
  const { t, locale } = useI18n();
  const live = view.route && view.me ? liveContent(view.route, view.me.name, t) : null;
  const now = new Date();
  return (
    <div data-testid="demo-soul-lock" className="flex min-h-full flex-col items-center bg-[oklch(var(--color-ink))] px-4 pt-12 text-[oklch(var(--color-canvas))]">
      <p className="m-0 text-sm opacity-70">{now.toLocaleDateString(locale, { weekday: "long", month: "long", day: "numeric" })}</p>
      <p className="m-0 font-title text-display-lg">{now.toLocaleTimeString(locale, { hour: "2-digit", minute: "2-digit" })}</p>
      <div className="mt-8 w-full rounded-panel bg-[oklch(var(--color-canvas)/0.12)] p-4">
        <p className="m-0 text-2xs uppercase opacity-70">{live?.title ?? t("live.title")}</p>
        {live ? (
          <>
            <p className="m-0 mt-2 flex items-baseline justify-between gap-2">
              <span className="font-title text-md">{live.headline}</span>
              <span className="font-mono text-xs opacity-70">{live.count}</span>
            </p>
            <div aria-hidden="true" className="mt-3 h-1 rounded-full bg-[oklch(var(--color-canvas)/0.2)]">
              <div className={`h-1 rounded-full ${live.ended ? "bg-[oklch(var(--color-danger))]" : "bg-[oklch(var(--color-canvas))]"}`} style={{ width: `${live.progress * 100}%` }} />
            </div>
            <p className="m-0 mt-2 flex justify-between text-2xs opacity-70">
              <span>{live.first}</span>
              <span>{live.last}</span>
            </p>
          </>
        ) : (
          <p className="m-0 mt-2 text-sm">{view.me ? t(`soul_app.soul_states.${view.me.current_state}`) : t("common.value.unrecorded")}</p>
        )}
      </div>
    </div>
  );
}

export function Unrecorded() {
  const { t } = useI18n();
  return <p className="m-0 p-4 text-sm text-[oklch(var(--color-ink-muted))]">{t("common.value.unrecorded")}</p>;
}
