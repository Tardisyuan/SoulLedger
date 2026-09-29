# 官员端助手 —— 阶段 3 计划

> **状态:§6 Q1–Q3 已由用户拍板(2026-09-29),均取推荐项;Q4 等 Design 出稿。** 基于 `feat/soul-assist-app`。灵魂端助手的设计与决策记录见
> `docs/ARCHITECTURE-soul-assist.md`;本文只写官员端与它**不同**的地方。代码出处标文件:行;
> 没有实跑过的推断标「未核实」。

## 1. 复用什么

| 部件 | 灵魂端 | 官员端 |
|---|---|---|
| 供应商接口与两个适配器 | `apps/soul_assist/providers.py` | 原样复用 |
| 工具循环、超时、并发名额、Sentry 清理、审计写法 | `apps/soul_assist/service.py` | 抽出与身份无关的部分复用 |
| 帮助语料加载 | `corpus.py`,条目头有 `audience: soul / officer` | 原样复用,`audience: officer` 的条目另写 |
| 认证 | `SoulJWTAuthentication`(`soul_accounts/authentication.py:61-80`) | `OfficerJWTAuthentication`(同文件 `:43-58`),**独立接口**(决策 A2 的延伸:只共享服务层) |

## 2. 与灵魂端不同的三处

**2.1 数据范围由权限码与租户决定,不再是「本人」。** 官员问的是「我的队列里有什么、这个流程怎么走」。
每个工具声明它要的权限码,**两道检查**:
- 组请求时只把当前用户有权的工具放进 `tools`(模型看不见它不能用的工具);
- 工具执行时再 `check_permission(request.user, codename)`(`apps/perm/checker.py:27`),
  查询一律经 `scope_to_tenant(qs, request)`(`apps/core/tenant.py:53-113`,无租户即 `qs.none()`)。
  ADMIN 不受租户限制(同上),这一点要在答案里说明「这是全殿数据」。

**2.2 v1 工具只给计数,不给灵魂个人数据。** 官员能看的灵魂数据远多于灵魂自己,而这些会发给第三方模型。
v1 候选(都已有现成的只读接口):

| 工具 | 来源 | 权限码 |
|---|---|---|
| `judgment_queue_counts` | `JudgmentViewSet.queue_counts`(`apps/judgment/views.py:1020-1038`) | `judgment.read` |
| `my_pending_approvals` | 工作流列表按「待我审批」过滤,只返回数量与类型 | `workflow.read` |
| `inbox_counts` | `inbox.counts()`(`apps/chat/inbox.py:91`) | `soul_inbox` |

不返回灵魂姓名、编号、陈述、判词。要「看某个案子」就引导去对应页面。

**2.3 帮助语料是操作手册,不是灵魂说明。** 官员端 36 个页面(`frontend/app/**/page.tsx`)、
五种角色(`authentication/models.py:52-66`)、权限码约 45 个(`perm/migrations/0017` 起)。
仓库里**没有**任何面向官员的帮助内容(调研结论),语料要从零写。按角色拆条目,
`screens` 取前端路由段(`judgment`、`workflow`、`dispatch`……)。
MODERATOR 不持有 `workflow.approve` / `workflow.advance` / `user.manage`
(`perm/checker.py:23-25`)—— 这种「为什么我点不了」是高频问题,答案要来自 `check_permission`,
不来自语料措辞(与灵魂端 MUST-3 同一条)。

## 3. 数据与接口

- 会话表:把 `AssistConversation.account` 旁加一个可空的 `user` 外键,官员会话 `account` 为空、`user` 为官员。
  **不另建一套表**:留存、清理、软删、审计全部共用;查询从 `request.user` 出发。(未核实:迁移对现有灵魂会话无影响,需在 PG 上跑一遍。)
- 接口:`POST /api/v1/assist/`、`GET /api/v1/assist/conversations/`、`DELETE .../<id>/`,
  官员令牌;`CodenamePermission` 不要求额外权限码(能登录即能问),工具自己把关。
- 开关:沿用 `ASSISTANT_ENABLED` + `Tenant.settings["assistant_enabled"]`,官员读 `request.tenant`;
  是否要**分开**灵魂端与官员端的每殿开关,见 §6 Q3。
- 节流:`assist_officer` 另设,默认同灵魂端 30/hour(官员一天问得更多,见 §6 Q3)。
- **已落地(3a/3b)时的定法**:令牌不带殿的 ADMIN 只看全局开关(没有殿开关可读);带殿的 ADMIN
  与别人一样读那个殿的开关。节流另一个 scope(`assist_officer`)只为分开计数键,速率读的是
  `DEFAULT_THROTTLE_RATES["assist"]` 同一个设置。`inbox_counts` 的码名是 `soul_inbox.read`
  (`soul_inbox` 不是码名;收件箱 `folders` 接口要的就是它)。另加无码名的 `my_permissions`。

## 4. Web 界面

入口放在 `frontend/src/components/layout/AppLayout.tsx` 的页头。桌面端不是抽屉而是右侧面板更合适,
**需要 Design 出稿**(§6 Q4 附提示词)。在那之前不写前端。

## 5. 阶段

| 步 | 内容 | 门禁 |
|---|---|---|
| 3a | 服务层抽出与身份无关的部分;会话表加 `user`;官员接口 + 三个计数工具 + 两道权限检查 | 后端全量 SQLite + 真 PG;工具在无权限时不出现在 `tools` 里、强行调用返回拒绝(变异验证);非 ADMIN 跨租户读不到 |
| 3b | 官员帮助语料初稿(按角色),防漂移测试(每个前端路由段至少一条、每个工具的权限码在 `perm` 里存在) | 同上 |
| 3c | Web 界面(等 Design 稿) | 前端 tsc / lint / test:coverage / E2E 三个 project |
| 3d | 行为评测(真实 key) | 数字写进本文 |

估时:3a 约 2 天,3b 约 2 天(语料从零写),3c 约 2–3 天(视设计稿)。

## 6. 决定(2026-09-29 用户拍板:Q1 取 B、Q2 取推荐、Q3 取 A;Q4 待 Design)

- **Q1 v1 要不要工具?** A. 只有帮助语料,不读任何数据(最简单,零隐私面);B. 三个计数工具(推荐:
  「我的队列」是官员最常问的,计数不含个人数据)。
- **Q2 帮助语料谁写?** 同灵魂端:我按页面与代码起草,你审口径(推荐);或先只写审判与审批两块。
- **Q3 开关与限额是否与灵魂端分开?** A. 共用一个每殿开关与 30/hour(推荐先共用,看用量再拆);B. 分开设。
- **Q4 Web 界面请 Design 出稿**(提示词随最终汇报给出)。
