import type { BuiltinUserRole } from "@soulledger/core/api";
import type { Locale } from "@soulledger/core/config/locale";
import type { OfficerAssistScreen } from "@soulledger/core/api/officer-assist";

/**
 * Suggested questions, role × page — canvas 「灵魂簿 官员端 · 问一问」 1a, with the
 * corrections sent to Design: 「调度」 is dispatch (escort / transfer), the
 * scheduler is ADMIN-only, GUARDIAN has no hall inbox, MODERATOR can escalate
 * workflows and approve / execute dispatches but not approve / advance
 * workflows or manage users, JUDGE can approve / advance but not escalate.
 *
 * In code, not in the message bundles, for the soul App's reason: a suggestion
 * is sent verbatim as the question, so it is in the language the server
 * answers in — zh-Hans for a zh UI, English otherwise (egy included). A
 * bundle would invite an egy translation nobody can ask in.
 *
 * Pages a role has no row for (GUARDIAN's inbox, anyone but ADMIN on the
 * scheduler, every other route) take that role's 「其他页」 pair. A custom role
 * takes VIEWER's: page-purpose questions only, nothing that presumes a queue.
 */
type Page = "judgment" | "workflow" | "dispatch" | "scheduler" | "soul-inbox" | "sentence-requests" | "other";
type Pair = readonly [string, string];
type Table = Record<BuiltinUserRole, Partial<Record<Page, Pair>> & { other: Pair }>;

const VIEWER_ZH: Pair = ["这一页是做什么的？", "这些状态是什么意思？"];
const VIEWER_EN: Pair = ["What is this page for?", "What do these states mean?"];

const ZH: Table = {
  ADMIN: {
    judgment: ["各殿待审一共多少件？", "哪个殿积压最多？"],
    workflow: ["卡住最久的流程停在哪一步？", "越级推进会留下什么记录？"],
    dispatch: ["各殿待批准的调拨有几件？", "回归原属会立即生效吗？"],
    scheduler: ["哪些任务连续失败？", "重建调度会改掉手动改过的设置吗？"],
    "soul-inbox": ["各殿待回复的信有几封？", "等了多久算积压？"],
    "sentence-requests": ["全部待处理的受刑请求有几件？", "改站由谁批准？"],
    other: ["这一页是做什么的？", "这里的改动会写入审计吗？"],
  },
  MODERATOR: {
    judgment: ["本殿待审有多少件？", "我能把案子改派给谁？"],
    workflow: ["为什么我点不了审批？", "卡住的流程我能越级推进吗？"],
    dispatch: ["待我批准的调拨有几件？", "批准和执行有什么区别？"],
    "soul-inbox": ["本殿有几封待回复？", "回复会署谁的名？"],
    "sentence-requests": ["本殿待处理的请求有几件？", "为什么我不能批准？"],
    other: ["为什么我不能管理用户？", "这一页我能做什么？"],
  },
  JUDGE: {
    judgment: ["我的队列有多少？", "为什么我不能结案？"],
    workflow: ["待我审批的有几件？", "这个流程下一步是什么？"],
    dispatch: ["这份调拨走到哪一步了？", "调拨后案子归哪一殿？"],
    "soul-inbox": ["有几封待我回复？", "回复里能引用律条吗？"],
    "sentence-requests": ["待我处理的有几件？", "改站需要谁批准？"],
    other: ["这一页是做什么的？", "我在这里能做什么？"],
  },
  GUARDIAN: {
    judgment: ["结案后多久交给押解？", "这些裁决状态是什么意思？"],
    workflow: ["押解要等哪一步批完？", "这个流程下一步是什么？"],
    dispatch: ["今天待执行的调拨有几件？", "放弃的移交草稿去哪了？"],
    "sentence-requests": ["待我押解的有几件？", "目的地已满怎么办？"],
    other: ["这一页是做什么的？", "我在这里能做什么？"],
  },
  VIEWER: { other: VIEWER_ZH },
};

const EN: Table = {
  ADMIN: {
    judgment: ["How many cases are awaiting judgment across all halls?", "Which hall has the largest backlog?"],
    workflow: ["Where is the longest-stuck workflow waiting?", "What record does escalating a workflow leave?"],
    dispatch: ["How many dispatches are awaiting approval across the halls?", "Does a return to the home hall take effect at once?"],
    scheduler: ["Which tasks have failed several times in a row?", "Will rebuilding the schedules overwrite settings changed by hand?"],
    "soul-inbox": ["How many letters await a reply across the halls?", "How long a wait counts as a backlog?"],
    "sentence-requests": ["How many sentence requests are pending in all?", "Who approves a change of station?"],
    other: ["What is this page for?", "Are changes made here written to the audit log?"],
  },
  MODERATOR: {
    judgment: ["How many cases await judgment in this hall?", "Who can I reassign a case to?"],
    workflow: ["Why can't I approve?", "Can I escalate a stuck workflow?"],
    dispatch: ["How many dispatches are waiting for my approval?", "What is the difference between approving and executing?"],
    "soul-inbox": ["How many letters in this hall await a reply?", "Whose name does a reply go out under?"],
    "sentence-requests": ["How many requests are pending in this hall?", "Why can't I approve?"],
    other: ["Why can't I manage users?", "What can I do on this page?"],
  },
  JUDGE: {
    judgment: ["How many are in my queue?", "Why can't I close the case?"],
    workflow: ["How many are waiting for my approval?", "What is the next step in this workflow?"],
    dispatch: ["What step has this dispatch reached?", "Which hall does the case belong to after the dispatch?"],
    "soul-inbox": ["How many letters are waiting for my reply?", "Can a reply cite the statutes?"],
    "sentence-requests": ["How many are waiting for me?", "Who has to approve a change of station?"],
    other: ["What is this page for?", "What can I do here?"],
  },
  GUARDIAN: {
    judgment: ["How long after a case closes is it handed over for escort?", "What do these verdict states mean?"],
    workflow: ["Which step must be approved before an escort?", "What is the next step in this workflow?"],
    dispatch: ["How many dispatches are due to be executed today?", "Where do discarded dispatch drafts go?"],
    "sentence-requests": ["How many are waiting for me to escort?", "What if the destination is full?"],
    other: ["What is this page for?", "What can I do here?"],
  },
  VIEWER: { other: VIEWER_EN },
};

const PAGES: readonly Page[] = ["judgment", "workflow", "dispatch", "scheduler", "soul-inbox", "sentence-requests"];

export function officerAssistSuggestions(role: string, screen: OfficerAssistScreen, locale: Locale): readonly string[] {
  const table = locale === "zh-Hans" ? ZH : EN;
  const row = table[(role in table ? role : "VIEWER") as BuiltinUserRole];
  const page = (PAGES as readonly string[]).includes(screen) ? (screen as Page) : "other";
  return row[page] ?? row.other;
}
