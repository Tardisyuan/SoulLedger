/**
 * The soul app's stack params and the life tab's landing params, in a leaf: every screen and
 * `push.ts` read them, and while they lived in `screens/applications.tsx` the life and sentence
 * screens imported applications (cq-apps 2026-10-30 #1).
 */
import type { SentenceLanding } from "./sentenceKinds";
import type { JudgmentAppealParams } from "./screens/appeals";
import type { WangsiGrievanceParams } from "./screens/wangsi";

/**
 * Where on the life page a push landed (第四十批 S-e): a judgment's row, a disposition's row in 去向, or the
 * 「暂居 · 原属」 block. Washed for two seconds; the param is forgotten when the page is left.
 * `delivered`(第六十二批):「已超度」那一行(或并进了超度日期的枉死城那一行)—— 滚到那里,不洗底色。
 */
export type LifeFocus = { judgment?: string; disposition?: string; residence?: boolean; delivered?: boolean };

/** The life tab's params: a sentence push that landed on its section (受刑 1d), or a row to wash (S-e). */
export type LifeParams = { sentenceLanding?: SentenceLanding; lifeFocus?: LifeFocus };

export type AppStackParams = {
  /**
   * `screen` picks the tab (a push landing on the life tab). The circle's
   * `pendingId`: the post just sent went to review — the feed says so over it.
   */
  Tabs: { screen: "Life" | "Applications" | "Letters" | "Circle"; params?: { pendingId?: string; landed?: boolean } & LifeParams } | undefined;
  /** 受刑 1c. `landing`: opened from a tapped sentence push — the stations it names are marked 「新」 once. */
  Sentence: { landing?: SentenceLanding } | undefined;
  NewApplication: undefined;
  /** 审判申诉的表单(第五十二批 A-2),从本世 › 审判那件卡片的「申诉 ›」进。 */
  // One definition, in the screen: two copies drifted twice in one day (stations, then civilization).
  JudgmentAppeal: JudgmentAppealParams;
  /** 枉死城的冤情申诉表单(地府),从本世 › 审判那件枉死案子卡片的「申诉 ›」进。 */
  WangsiGrievance: WangsiGrievanceParams;
  /** `landed`: opened from a tapped notification — the result block is highlighted once. */
  ApplicationDetail: { id: string; landed?: boolean };
  Settings: undefined;
  /** 设置页主动进入的改密屏。名字与强制改密的根屏 ChangePassword 不同:改密成功后会话变为已登录,同名屏会留在栈里。 */
  AccountPassword: undefined;
  /** 关于 / 致谢(补足 C16),从设置页进。 */
  About: undefined;
  /** 两步验证:关着是开启向导,开着是管理页。从设置页「账号安全」进。 */
  Mfa: undefined;
  /** 登录设备与记录 (第二十八批 S1),从设置页「账号安全」进。 */
  SignIns: undefined;
  /** 导出我的资料 (第二十八批 S3),从设置页「我的资料」进;完成的推送也落在这里。 */
  DataExport: undefined;
  /** 帮助 (S5)。`only: "login"`:登录页「登录遇到问题」的版本 —— 只有登录与账号那一组,没有「写给本殿」,未登录也能进。 */
  Help: { only?: "login" } | undefined;
  /** 写给本殿 (S5),从帮助页进:一封带类别的书信。 */
  Feedback: undefined;
  NotificationPrimer: undefined;
  /** 通知记录:推送过的都在,从设置页进。 */
  NotificationHistory: undefined;
  /** `landed`: opened from a tapped notification — the newest letter from the other side is highlighted once. */
  Conversation: { id: string; landed?: boolean };
  FindSoul: undefined;
  ComposePost: undefined;
  /** `comment`: opened from a comment / reply (push or 互动消息) — that comment is scrolled to and washed once. */
  CirclePost: { id: string; comment?: string };
  /** 互动消息 (第四十批 S-a): from the 「互动」 entry on the circle's bar. */
  CircleInbox: undefined;
  SoulProfile: { userId: number };
  /** 设置 › 账号安全 › 联系邮箱 (第四十批 S-b): add or change it. */
  ContactEmail: undefined;
  MyCircle: undefined;
  CircleFollows: { relation: "following" | "followers" };
  CircleSearch: undefined;
  /** `preview`: the post / comment text, or the soul's name — shown so the reporter sees what they report. */
  CircleReport: { target: "POST" | "COMMENT" | "USER"; id: string; preview: string };
};
