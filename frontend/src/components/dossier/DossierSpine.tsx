"use client";

import { useI18n } from "@/src/contexts/I18nContext";
import type { SpineCiv, SpineNow } from "./spineModel";
import s from "./dossier.module.css";

/**
 * 卷宗脊(Design 第三十批 第 3 步第 2 条,定稿):页头下方,高 `--spine-h`。四家位置、高度、左右留白一样,只有形状不同。
 * 已行 = 文明色(civT)实线实心;待行 = 灰虚线空心;现在 = 全图唯一的 metal,外加一圈 `--now-breath` 的呼吸
 * (减少动效时不呼吸)。几何照 Design 的 940×44 定稿 SVG(`spines/spine-*.svg`);颜色不写死,读令牌
 * (`dossier.module.css` 的 .done / .todo / .now),所以随 `[data-civ]` 与深浅主题走。
 *
 * 为什么是组件而不是 public/ 下的 SVG:定稿 SVG 把「现在」画死在一个位置(地府第一殿、埃及天平 …),
 * 而脊要说的正是这个灵魂此刻在哪 —— 位置由 `spineNow()`(spineModel.ts)按数据算。
 * 窄屏(< 640)只留节点,不写站名;地府只标当前殿(样式里 `.label` 隐藏,`.keep` 留下)。
 */
export function DossierSpine({ civ, now, testId = "dossier-spine" }: { civ: SpineCiv | null; now: SpineNow | null; testId?: string }) {
  const { t } = useI18n();
  if (!civ) return <div className={s.spine} aria-hidden="true" data-testid={testId} />;
  const label = t(`caseDesk.dossier.spine.${civ}.aria`);
  return (
    <div className={s.spine} data-testid={testId} data-now={now ? JSON.stringify(now) : undefined}>
      <svg viewBox="0 0 940 44" preserveAspectRatio="xMinYMid meet" role="img" aria-label={label} className={s.spineSvg}>
        {civ === "cn" && <CnSpine now={now?.civ === "cn" ? now : null} />}
        {civ === "eu" && <EuSpine now={now?.civ === "eu" ? now : null} />}
        {civ === "eg" && <EgSpine now={now?.civ === "eg" ? now : null} />}
        {civ === "gr" && <GrSpine now={now?.civ === "gr" ? now : null} />}
      </svg>
    </div>
  );
}

type State = "done" | "now" | "todo";
const stateOf = (pos: number, at: number | null): State => (at === null ? "todo" : pos < at ? "done" : pos === at ? "now" : "todo");

/** 一段连线:已行实线,待行虚线。 */
function Seg({ d, done, w = 1.4 }: { d: string; done: boolean; w?: number }) {
  return <path d={d} fill="none" className={done ? s.done : s.todo} stroke="currentColor" strokeWidth={done ? 2 : w} strokeDasharray={done ? undefined : "4 5"} />;
}

const NUMERALS = ["一", "二", "三", "四", "五", "六", "七", "八", "九", "十"];
/** 英文与 egy 不出汉字(Design 第三十六批 第一节第 1 条):殿号写 1 … 10。 */
const ARABIC = ["1", "2", "3", "4", "5", "6", "7", "8", "9", "10"];

function CnSpine({ now }: { now: Extract<SpineNow, { civ: "cn" }> | null }) {
  const { t, locale } = useI18n();
  const numerals = locale === "zh-Hans" ? NUMERALS : ARABIC;
  // 进度:前九站 1–9,第 n 殿 9+n,地狱 = 所挂那殿之后,轮回最末。
  const at = !now ? null : now.at === "pre" ? now.n : now.at === "hall" ? 9 + now.n : now.at === "hell" ? 9 + now.n + 0.5 : 30;
  const hallX = (k: number) => 164 + (k - 1) * 79.1;
  const preX = (i: number) => 20 + (i - 1) * 16;
  return (
    <>
      <Seg d={`M20 16H${hallX(1)}`} done={at !== null && at > 1} />
      {Array.from({ length: 9 }, (_, i) => {
        const st = stateOf(i + 1, at);
        const x = preX(i + 1);
        return st === "now" ? (
          <NowMark key={i} x={x} y={16} shape="tick" />
        ) : (
          <path key={i} d={`M${x} 12V20`} stroke="currentColor" strokeWidth="1.4" className={st === "done" ? s.done : s.todo} />
        );
      })}
      <text x="80" y="38" fontSize="11" textAnchor="middle" className={s.label}>
        {t("caseDesk.dossier.spine.cn.pre")}
      </text>
      {NUMERALS.map((_, i) => i < 9 && <Seg key={`c${i}`} d={`M${hallX(i + 1) + 5} 16H${hallX(i + 2) - 5}`} done={at !== null && at > 10 + i} />)}
      {/* 地狱支线:挂在第二至第九殿下的点线。 */}
      <path d={`M${hallX(2)} 22V30H${hallX(9)}V22`} fill="none" stroke="currentColor" strokeWidth="1" strokeDasharray="1.5 3.5" className={s.todo} />
      {now?.at === "hell" ? (
        <NowMark x={520} y={29} shape="dot" />
      ) : (
        <circle cx="520" cy="29" r="3.2" className={s.hollow} stroke="currentColor" strokeWidth="1" strokeDasharray="1.5 2" />
      )}
      <text x="520" y="42" fontSize="10" textAnchor="middle" className={`${s.label} ${s.faint}`}>
        {t("caseDesk.dossier.spine.cn.hells")}
      </text>
      {numerals.map((numeral, i) => {
        const st = stateOf(10 + i, at);
        const x = hallX(i + 1);
        return (
          <g key={numeral}>
            {st === "now" ? (
              <NowMark x={x} y={16} shape="square" />
            ) : (
              <rect x={x - 4.5} y="11.5" width="9" height="9" rx="1" stroke="currentColor" strokeWidth="1.3" className={st === "done" ? s.solid : s.hollowTodo} />
            )}
            <text
              x={x}
              y={st === "now" ? 39 : 38}
              fontSize={st === "now" ? 12 : 11}
              textAnchor="middle"
              className={`${s.serif} ${st === "now" ? `${s.nowText} ${s.keep}` : s.label} ${i === 0 || i === 9 ? s.keep : ""}`}
            >
              {numeral}
            </text>
          </g>
        );
      })}
      <Seg d={`M${hallX(10) + 5} 16H910`} done={at === 30} />
      {at === 30 ? (
        <NowMark x={916} y={16} shape="diamond" />
      ) : (
        <path d="M916 10l6 6-6 6-6-6z" stroke="currentColor" strokeWidth="1.3" className={s.hollowTodo} />
      )}
      <text x="916" y="38" fontSize="11" textAnchor="middle" className={`${s.label} ${s.keep}`}>
        {t("caseDesk.dossier.spine.cn.rebirth")}
      </text>
    </>
  );
}

function EuSpine({ now }: { now: Extract<SpineNow, { civ: "eu" }> | null }) {
  const { t } = useI18n();
  const circle = now?.at === "circle" ? now.n : null;
  return (
    <>
      <Seg d="M8 22H112" done />
      <text x="120" y="42" fontSize="11" textAnchor="middle" className={s.label}>
        {t("caseDesk.dossier.spine.eu.minos")}
      </text>
      {now?.at === "gate" ? (
        <g data-testid="spine-now">
          <path d="M115 30V12q5-6 10 0v18" stroke="currentColor" strokeWidth="2.2" className={`${s.now} ${s.hollow}`} />
          <circle cx="120" cy="21" r="14" fill="none" stroke="currentColor" strokeOpacity=".45" className={`${s.now} ${s.breath}`} />
        </g>
      ) : (
        <path d="M115 30V12q5-6 10 0v18" stroke="currentColor" strokeWidth="1.8" className={`${s.done} ${s.hollow}`} />
      )}
      <path d="M138 2L930 16V28L138 42" fill="none" stroke="currentColor" strokeWidth="1" className={s.funnel} />
      {Array.from({ length: 9 }, (_, i) => {
        const x = 145.5 + i * 96.5;
        const y = 4 + i * 1.7;
        const h = 36 - i * 3.4;
        const st: State = circle === null ? "todo" : i + 1 < circle ? "done" : i + 1 === circle ? "now" : "todo";
        if (st === "now")
          return (
            <g key={i} data-testid="spine-now">
              <rect x={x} y={y} width="5" height={h} rx="1" fill="currentColor" className={s.now} />
              <rect x={x - 4} y={y - 2} width="13" height={h + 4} rx="3" fill="none" stroke="currentColor" strokeOpacity=".45" className={`${s.now} ${s.breath}`} />
            </g>
          );
        return (
          <rect
            key={i}
            x={x}
            y={y}
            width="5"
            height={h}
            rx="1"
            stroke="currentColor"
            strokeWidth="1.2"
            strokeDasharray={st === "done" ? undefined : "2.5 2.5"}
            fill={st === "done" ? "currentColor" : "none"}
            className={st === "done" ? s.done : s.todo}
          />
        );
      })}
    </>
  );
}

const EG_ORDER = { gate: 1, scale: 2, aaru: 3, annihilation: 3 } as const;

function EgSpine({ now }: { now: Extract<SpineNow, { civ: "eg" }> | null }) {
  const { t } = useI18n();
  const at = now ? EG_ORDER[now.at] : null;
  const node = (x: number, y: number, pos: number, key: string) =>
    stateOf(pos, at) === "now" ? <NowMark key={key} x={x} y={y} shape="dot" /> : <circle key={key} cx={x} cy={y} r="4" stroke="currentColor" strokeWidth="1.3" className={stateOf(pos, at) === "done" || pos === 0 ? s.solid : s.hollowTodo} />;
  const scaleCls = at === 2 ? s.now : at !== null && at > 2 ? s.done : s.todo;
  return (
    <>
      <Seg d="M12 22H178" done />
      <Seg d="M178 22H361" done={at !== null && at >= 2} />
      {node(12, 22, 0, "death")}
      <text x="12" y="40" fontSize="11" className={s.label}>
        {t("caseDesk.dossier.spine.eg.death")}
      </text>
      {node(178, 22, 1, "gate")}
      <text x="178" y="40" fontSize="11" textAnchor="middle" className={s.label}>
        {t("caseDesk.dossier.spine.eg.gate")}
      </text>
      {/* 天平:立在路中,左盘心,右盘羽。 */}
      <g className={scaleCls} stroke="currentColor" fill="none" data-testid={at === 2 ? "spine-now" : undefined}>
        <path d="M395 6V36M381 36H409" strokeWidth="1.8" />
        <path d="M367 10H423" strokeWidth="1.8" />
        <path d="M367 10l-7 13h14z" strokeWidth="1.2" />
        <path d="M358 23h18" strokeWidth="1.8" />
        <path d="M423 10l-7 13h14z" strokeWidth="1.2" />
        <path d="M414 23h18" strokeWidth="1.8" />
        <circle cx="395" cy="6" r="3" fill="currentColor" />
      </g>
      {at === 2 && <circle cx="395" cy="21" r="20" fill="none" stroke="currentColor" strokeOpacity=".35" className={`${s.now} ${s.breath}`} />}
      <text x="367" y="42" fontSize="10" textAnchor="middle" className={s.label}>
        {t("caseDesk.dossier.spine.eg.heart")}
      </text>
      <text x="423" y="42" fontSize="10" textAnchor="middle" className={s.label}>
        {t("caseDesk.dossier.spine.eg.feather")}
      </text>
      <Seg d="M431 16C485 16 505 6 555 6H850" done={now?.at === "aaru"} w={1.3} />
      <Seg d="M431 28C485 28 505 38 555 38H820" done={now?.at === "annihilation"} w={1.3} />
      {now?.at === "aaru" ? <NowMark x={850} y={6} shape="dot" /> : <circle cx="850" cy="6" r="4" stroke="currentColor" strokeWidth="1.3" className={s.hollowCiv} />}
      <text x="860" y="10" fontSize="11" className={s.label}>
        {t("caseDesk.dossier.spine.eg.aaru")}
      </text>
      <rect x="820" y="32" width="12" height="12" fill="none" stroke="currentColor" strokeDasharray="2 2" className={now?.at === "annihilation" ? s.now : s.todo} data-testid={now?.at === "annihilation" ? "spine-now" : undefined} />
      <text x="838" y="42" fontSize="11" className={`${s.label} ${s.faint}`}>
        {t("caseDesk.dossier.spine.eg.annihilation")}
      </text>
    </>
  );
}

const GR_BRANCH = { isles: 4, asphodel: 22, tartarus: 40 } as const;

function GrSpine({ now }: { now: Extract<SpineNow, { civ: "gr" }> | null }) {
  const { t } = useI18n();
  const at = !now ? null : now.at === "ferry" ? 1 : now.at === "fork" ? 2 : 3;
  return (
    <>
      <Seg d="M12 22H207" done />
      <Seg d="M207 22H414" done={at !== null && at >= 2} />
      <circle cx="12" cy="22" r="4" fill="currentColor" className={s.done} />
      <text x="12" y="40" fontSize="11" className={s.label}>
        {t("caseDesk.dossier.spine.gr.death")}
      </text>
      {at === 1 ? <NowMark x={207} y={22} shape="dot" /> : <circle cx="207" cy="22" r="4" fill="currentColor" className={s.done} />}
      <text x="207" y="40" fontSize="11" textAnchor="middle" className={s.label}>
        {t("caseDesk.dossier.spine.gr.ferry")}
      </text>
      {(Object.keys(GR_BRANCH) as (keyof typeof GR_BRANCH)[]).map((key) => {
        const y = GR_BRANCH[key];
        const here = now?.at === key;
        return (
          <g key={key}>
            <Seg d={`M414 22C494 22 504 ${y} 584 ${y}H830`} done={here} w={1.2} />
            {here ? <NowMark x={830} y={y} shape="dot" /> : <circle cx="830" cy={y} r="3" stroke="currentColor" strokeWidth="1.2" className={s.hollowTodo} />}
            <text x="842" y={y + 4} fontSize="11" className={s.label}>
              {t(`caseDesk.dossier.spine.gr.${key}`)}
            </text>
          </g>
        );
      })}
      {at === 2 ? <NowMark x={414} y={22} shape="dot" /> : <circle cx="414" cy="22" r="6" stroke="currentColor" strokeWidth="2.2" className={at === 3 ? s.solid : s.hollowTodo} />}
    </>
  );
}

/** 「现在」:metal 描边的节点 + 一圈呼吸。全图只有这一处 metal。 */
function NowMark({ x, y, shape }: { x: number; y: number; shape: "square" | "dot" | "tick" | "diamond" }) {
  return (
    <g className={s.now} data-testid="spine-now">
      {shape === "square" && (
        <>
          <rect x={x - 6.5} y={y - 6.5} width="13" height="13" rx="1.5" stroke="currentColor" strokeWidth="2.2" className={s.hollow} />
          <rect x={x - 11} y={y - 11} width="22" height="22" rx="3" fill="none" stroke="currentColor" strokeOpacity=".45" className={s.breath} />
        </>
      )}
      {shape === "dot" && (
        <>
          <circle cx={x} cy={y} r="5" stroke="currentColor" strokeWidth="2.2" className={s.hollow} />
          <circle cx={x} cy={y} r="10" fill="none" stroke="currentColor" strokeOpacity=".45" className={s.breath} />
        </>
      )}
      {shape === "tick" && (
        <>
          <path d={`M${x} 9V23`} stroke="currentColor" strokeWidth="2.4" />
          <circle cx={x} cy={y} r="9" fill="none" stroke="currentColor" strokeOpacity=".45" className={s.breath} />
        </>
      )}
      {shape === "diamond" && (
        <>
          <path d={`M${x} ${y - 7}l7 7-7 7-7-7z`} stroke="currentColor" strokeWidth="2.2" className={s.hollow} />
          <circle cx={x} cy={y} r="12" fill="none" stroke="currentColor" strokeOpacity=".45" className={s.breath} />
        </>
      )}
    </g>
  );
}
