# 殿司收件箱:待回复 / 已回复 / 草稿 / 归档 / 未读与回复模板

分支 `feat/soul-inbox-folders`,自 `main` `05631b1` 起。环境:云端,Node **22.22.2**(没有 20.19.5),
npm 11 `ci` + `rebuild`,锁文件已还原;Python 3.11 `backend/.venv`;一次性 redis-server :6399。

## 1. 后端能看见什么(动手之前先查的)

| 问题 | 结论 | 依据 |
|---|---|---|
| 灵魂写给殿司的信经过后端吗? | **App 经过,但不是强制的。** App 的收件箱发送走 `POST /me/chat/conversations/{id}/messages/` → `services.send_inbox_message`。可灵魂在收件箱房间里是 **50 级**,别的 Matrix 客户端可以直接发,Synapse 模块不拦。 | `mobile/src/chatRules.ts` `sendsThroughBackend`;`services.open_officer_inbox` 的 power level;`config/synapse/soulledger_policy.py` 只拦建房 / 邀请 / 节流房间 |
| 绕过后端的那一封,后端看得见吗? | **看得见,但只在配了回调时,而且是尽力而为。** Synapse 模块的 `on_new_event` 对**每一条** `m.room.message` 回调 `/api/v1/chat/hooks/new-message/`(签名校验)。前提是配了 `push_url`,且回调在后台进程里跑:失败只记日志。 | `soulledger_policy.py` 第 3 条;`views.ChatPushHookView` |
| 殿司的回复经过后端吗? | **经过,而且只能经过。** 服务账号的凭据只在后端,`officer_reply` 是唯一的发送口。 | `services.officer_reply` |

**结论:「谁最后说话」可以诚实地知道,不用每次请求都去读 Synapse。** 做法是三处写、一处修:

1. 灵魂经后端发 → `send_inbox_message` 写 `last_from="soul"`、`last_soul_message_at`;
2. 官员回复 → `officer_reply` 写 `last_from="hall"`;
3. Synapse 回调(收件箱房间的任何一封)→ `record_inbox_event` **问 Synapse 最新的 10 个事件**,
   按时间线**最新一封**的发送者重写 `last_from`。不信回调里的 sender:回调可能晚到,
   晚到的一封灵魂来信不能盖掉它之后已经发出的殿司回复(`test_a_late_hook_does_not_overwrite_a_newer_reply`);
4. 修:官员打开线程(`officer_messages`)时手上已经有真实时间线,顺手按它对一遍
   (`test_opening_the_thread_repairs_a_missed_hook`)。

不存在「只有一边写」的字段:`last_from` 两边都写,绕过后端的那一路由回调与打开线程补上。
**剩下的盲区,说清楚:** 没配 `push_url` 时,一封绕过 App 直接写进 Matrix 的信,要等有官员
打开那个线程(或跑 `reconcile_inbox`)才会被看见。在那之前,那个会话会停在「已回复」、不显示未读。
时刻只往后推(`max`),而且混用了两只钟:我们的 `timezone.now()` 与 Synapse 的
`origin_server_ts`。两边在同一台机器上(`services.py` 的注释)。时钟偏差若大于两封信的间隔,
未读可能判错;`last_from` 不受影响,它只看顺序。

## 2. 做了什么

### 后端(`apps/chat`)
- `Conversation` 加 `last_from`(`soul` / `hall` / 空)与 `last_soul_message_at`,三个写点见上。
- 新模型 `InboxOfficerState`,按 (会话, 官员) 一行:`last_read_at`、`archived_at`、`draft`(≤ 4000,
  与回复同一上限)、`draft_saved_at`。租户经 `conversation__tenant`;所有入口都先经过
  `OfficerInboxViewSet.get_object()`,也就是 `scope_to_tenant`。**草稿不进 Synapse、不进审计**
  (`test_a_draft_never_leaves_our_database`)。
- 新模型 `InboxReplyTemplate`(租户级:标题 ≤ 80、正文 ≤ 4000)。占位符只收 `{{soul_name}}` / `{{hall_name}}`,
  别的 `{{…}}` 答 400。
- `apps/chat/inbox.py`:调用者自己的 `unread` / `archived` / `has_draft` 用子查询算;文件夹由 `folder_q` 切;
  计数由 `counts` 算,与列表同一个过滤。
- 文件夹:`all` = 未归档;`awaiting_reply` = 未归档、未关闭、最后一封是灵魂写的,**最早在上**(设计稿
  「最早在上」);`replied` = 未归档、最后一封是殿司写的;`drafts` = 未归档、我有草稿;`archived` = 我归档的。
  待回复与已回复不相交;两者之外的未归档会话只有两种:还没有一封信的,和已关闭而最后一封是灵魂写的
  (再也回不了,不算「待」)。
- 未读 = 灵魂有一封我读过之后才来的信。殿司的回复(包括同僚的)不算来信。回复即读过、并清掉回复人的草稿。
- 分页:沿用全站 `PageNumberPagination`(每页 20),没有另造。
- 管理命令 `reconcile_inbox`:**上线 0005 之后跑一次**。存量会话的 `last_from` 是空的,迁移答不出谁最后说话,
  这条命令按 Synapse 补上。

### 迁移
`chat/0005_inbox_officer_state_and_templates`:纯结构迁移,不回填数据。
- `Conversation.last_from`:`CharField(4)`,默认 `""`
- `Conversation.last_soul_message_at`:`DateTimeField`,可空
- `InboxReplyTemplate`:UUID 主键,`tenant` 外键(CASCADE),`created_by` 外键(SET_NULL)
- `InboxOfficerState`:UUID 主键,唯一约束 `chat_one_inbox_state_per_officer`,即 (conversation, user)

`makemigrations --check --dry-run` 在提交之后跑,exit 0。

### 端点
| 方法 | 路径 | 权限 |
|---|---|---|
| GET | `/api/v1/chat/inbox/?folder=&status=open\|closed&hall=&page=` | `soul_inbox.read` |
| GET | `/api/v1/chat/inbox/folders/` | `soul_inbox.read` |
| GET | `/api/v1/chat/inbox/{id}/`、`{id}/messages/` | `soul_inbox.read`(原有) |
| POST | `/api/v1/chat/inbox/{id}/read/` | `soul_inbox.read` |
| POST | `/api/v1/chat/inbox/{id}/archive/`、`{id}/unarchive/` | `soul_inbox.read` |
| GET / PUT / DELETE | `/api/v1/chat/inbox/{id}/draft/`(关闭的会话:PUT 答 409 `closed`) | `soul_inbox.read` + `soul_inbox.reply` |
| POST | `/api/v1/chat/inbox/{id}/reply/`(原有;现在还会清草稿、标已读) | `soul_inbox.reply` |
| GET / POST | `/api/v1/chat/inbox-templates/` | `soul_inbox.reply` |
| GET / PUT / PATCH / DELETE | `/api/v1/chat/inbox-templates/{id}/` | `soul_inbox.reply` |

**模板用哪个权限:** 查过 `apps/perm/models.py`,`soul_inbox` 下只有 `read` / `reply` 两个码,
没有更合适的现成码。所以选了 `soul_inbox.reply`,**读模板也要它**:模板只在回复框里用。
要把「维护模板」和「写回复」分开,需要新增 `soul_inbox.template`(一条数据迁移加授予)。这件事没做,见待定问题。

### core(`packages/core`)
- `openapi/schema.yml` 与 `src/api/generated/schema.ts` 照仓库做法重新生成:`manage.py spectacular --file …`,再 `npm run schema:generate`。
- `api/soul-inbox.ts`:`soulInboxApi` 加 `folders` / `markRead` / `archive` / `unarchive` / `draft` / `saveDraft` / `clearDraft`,
  新增 `inboxTemplatesApi`、`renderTemplate`、`TEMPLATE_PLACEHOLDERS`。
- `hooks/useSoulInbox.ts`:`useInboxFolders` / `useInboxMarkRead` / `useInboxArchive` / `useInboxDraft` / `useInboxSaveDraft` /
  `useInboxTemplates` / `useInboxTemplateMutations`。

### 前端(`/soul-inbox`)
- 文件夹栏照 C · 09:全部来信 / 待回复 / 已回复 / 草稿 / 归档,往来中 / 已关闭,按殿。每项的计数来自 `folders/`,
  删掉了原来「第一页不全就不写计数」那套。
- 未读:6 px 强调色**方块**(设计稿写的是「方块,不用圆点」)+ 名字加粗 + 读屏文字「未读」。线程加载成功后标已读。
- 草稿:进线程时从服务端恢复;失焦立即存,停止输入 1 秒后再存一次;内容与服务端那份相同就不存。
  **恢复完成之前一个字都不存**,否则空的回复框会先把服务端的草稿清掉。已关闭的会话既不取草稿也不存。
  另有「存草稿」按钮。
- 回复框加模板选择器:插到光标处,在客户端替换占位符;`{{hall_name}}` 取界面语言的殿名。
  另有模板管理对话框(`TemplateManager.tsx`)。线程头加「归档 / 移回收件」。
- 翻页用站内的 `Pagination`;< 1024 px 仍是列表头下拉,计数也在下拉里。
- 页头注释改写,不再写「刻意不画」这些文件夹。

## 3. 转交:没有做

先查了会话在当前模型里能不能在殿司之间移动:**不能。**
- `Conversation.tenant` 是**收件人**,不是「灵魂现在在哪」。模型注释明确写着:灵魂回归原文明之后它**不会改变**,
  否则 X 殿司的官员会丢掉正在回的那串信,Y 殿司会突然看见它。
- 灵魂只能给**当前所在**的殿司写信(`refusal` → `not_current_hall`)。它在别的殿司各有一个房间,
  由唯一约束 `chat_one_open_inbox_per_soul_and_hall` 管着。房间名里写着殿名。

所以「把线程交给另一个殿司」需要:
1. 决定语义:改收件人(`tenant` 换掉)、还是建一个新房间并附上旧线程的引用;
2. 处理唯一约束:目标殿司可能已经有这个灵魂的收件箱;
3. 审计与通知:两边官员都要看到这次移交;
4. 灵魂一侧:App 按 `tenant` 判断「当前殿司 / 已离开的殿司」(`hall_sealed`),换收件人会让灵魂那边的房间状态跟着变。

「标给同僚」(按官员指派)不需要移动会话,只要给 `InboxOfficerState` 加一个指派字段,或另建一个表。
但任务把它列在「转交」之下,所以一并没做,等拍板。

## 4. 门禁(都是在更新之后的树上跑的,读的是退出码)

| 门禁 | 命令 | exit | 结果 |
|---|---|---|---|
| 后端全量 | `SECRET_KEY=… DEBUG=true DATABASE_URL=sqlite:///:memory: REDIS_URL=redis://127.0.0.1:6399/0 … .venv/bin/python -m pytest --tb=short -q` | 0 | 4951 passed / 26 skipped(44 分 41 秒;覆盖率 94.01%,门槛 80%) |
| 新增后端测试 | `pytest tests/test_chat_inbox_folders.py` | 0 | 18 passed |
| 原有聊天测试 | `pytest tests/test_chat_*.py tests/test_soul_push*.py`(改动之后) | 0 | 140 passed / 3 skipped |
| ruff | `.venv/bin/ruff check .` | 0 | — |
| makemigrations | `manage.py makemigrations --check --dry-run`(迁移提交之后) | 0 | — |
| schema 门禁 | `pytest tests/test_schema_has_no_warnings.py tests/test_committed_schema_matches_the_backend.py tests/test_tenant_scoping_contract.py tests/test_every_writable_audit_viewset_sets_the_user.py tests/test_every_codename_family_is_claimed.py` | 0 | 94 passed / 2 skipped |
| core typecheck | `npm run --workspace packages/core typecheck` | 0 | — |
| core lint | `npm run --workspace packages/core lint` | 0 | — |
| core test | `npm run --workspace packages/core test` | 0 | 15 files / 145 tests |
| 前端 tsc | `cd frontend && npx tsc --noEmit` | 0 | — |
| 前端 lint | `npm run lint`(`--max-warnings 0`) | 0 | — |
| 前端 jest | `npm run test:coverage` | 0 | 186 suites / 3035 tests;全局覆盖率 80.78 / 73.72 / 71.72 / 81.7 |
| egy | `npx jest egyLexiconRules` | 0 | 21 passed;登记表**没有新增词形**(只是次数变了) |
| build | `npm run build` | 0 | — |
| E2E chromium | `npx playwright test --project=chromium` | 0 | 153 passed / 1 skipped |
| E2E mobile-chrome | `npx playwright test --project=mobile-chrome` | 0 | 149 passed / 5 skipped |
| E2E firefox | — | **没跑** | 这个环境里没有装 Firefox(`/opt/pw-browsers` 只有 chromium) |

E2E 的前提,照实说:装好的 `@playwright/test` 1.63 要的 chromium 修订号是 1243,而 `/opt/pw-browsers`
里是 1194。所以 chromium 和 mobile-chrome 两个 project 用一个**没提交的临时配置**跑:它把
`launchOptions.executablePath` 指到 `/opt/pw-browsers/chromium`,其余沿用 `playwright.config.ts`。

第一次跑 `test:coverage` 是红的,而且红得对:`truncatedValuesAreRecoverable` 抓到模板管理里一处截断
没带 `title`。补上 `title` 之后才是上表的绿。mobile-chrome 第一次也红过一条,是我新写的 e2e 在 393 px 下
去找被隐藏的文件夹栏;改成在那个宽度读下拉里的计数。

### 变异证明(每条都是:改坏 → 跑对应测试 → 红 → 还原)
| 变异 | 守它的测试 | 变异后 |
|---|---|---|
| `annotate_for` 子查询去掉 `user=user` | `test_read_archive_and_draft_are_per_officer`(官员之间隔离) | 红 |
| `folder_q("replied")` 去掉 `live &` | `test_the_folders_partition_the_inbox` | **第一次是绿的**:测试里归档的会话没有一个是殿司最后回的。补了一个之后是红 |
| `folder_q("awaiting_reply")` 去掉 `closed_at__isnull=True` | 同上 | 红 |
| `notify_new_message` 不调 `record_inbox_event` | `test_a_letter_written_straight_into_matrix_is_seen_through_the_hook` | 红 |
| `reconcile_inbox` 取 `timeline[-1]`(最旧一封) | `test_a_late_hook_does_not_overwrite_a_newer_reply` | 红 |
| `draft` 去掉 `closed_at` 判断 | `test_a_closed_conversation_takes_no_draft` | 红 |
| `draft` 的权限只要 `soul_inbox.read` | `test_inbox_state_permissions` | 红 |
| `get_queryset` 去掉 `scope_to_tenant` | `test_state_and_counts_are_tenant_scoped` | 红 |
| 前端:不调 `markRead` / 不恢复草稿 / 失焦不存 / 未读行不按条件加粗 | `SoulInboxPage.test.tsx` 对应四条 | 各自红 |

## 5. egy 里没能准确表达的文案

所有 egy 文案只用了已有词形(词根、小词、冻结的登记表),登记表 diff 里**没有新词**。
下面几条表达的不是原意,是用已有的词拼出来的近义,请评审:

| 键 | zh-Hans | egy | 问题 |
|---|---|---|---|
| `soul_inbox.folder.archived` | 归档 | `Per Sesh` | 词表里没有「归档」,用的是「书信之屋」;回收站已经是 `Per Wehem` |
| `soul_inbox.archive` / `archived_done` | 归档 / 已归档 | `Nehem Er Per Sesh (Seth)` | 同上,字面是「移入书信之屋」 |
| `soul_inbox.unarchive` / `unarchived_done` | 移回收件 / 已移回收件 | `Nehem Er Wetu (Seth)` | 词表里没有「收件箱」,用的是「移回全部」 |
| `soul_inbox.oldest_first` | 最早在上 | `Wep Tepy` | 按「更早的」`Wep` 与「首」`Tepy` 拼的 |
| `soul_inbox.template.placeholders` | 发送前替换为灵魂名与殿名: | `Ren Ba Hena Ren Wesekhet Er Tepy Hab:` | 「替换」没有词,只说出了「灵魂名与殿名,在发送之前」 |

## 6. 待定问题
1. **转交**:没做,理由与需要的东西见第 3 节。要不要做、按哪种语义做,请拍板。
2. **模板的权限**:现在用 `soul_inbox.reply`。要不要单开一个 `soul_inbox.template`?
3. **上线步骤**:迁移之后跑一次 `manage.py reconcile_inbox`。不跑的话,存量会话在官员打开或来新信之前,
   既不在「待回复」也不在「已回复」。这一步要不要写进 `docs/DEPLOYMENT.md`?
4. **没配 `push_url` 的环境**:绕过 App 直接写进 Matrix 的信,要到打开线程才被看见。要不要把收件箱房间里
   灵魂的直接发言在 Synapse 模块里也挡掉(与节流房间同一个机制),让后端成为唯一入口?
5. **归档之后又来信**:目前不会自动取消归档,新信只在「归档」里显示为未读。要不要来信即取消归档?
6. **`{{hall_name}}` 用哪种语言**:现在取官员界面语言的殿名;灵魂的语言后端不知道。
7. **`frontend/app/soul-inbox/page.tsx` 约 625 行代码**(不计注释),超过 `CLAUDE.md` 的 500 行。
   模板管理已经拆成 `TemplateManager.tsx`。剩下最自然的缝是 `Composer`(带 `/` 援引的回复框),
   但按 `CLAUDE.md`,拆分要有缺陷来支撑,不能只凭行数,所以这次没拆,留给评审决定。
8. `test_chat_*` 用的 `FakeMatrix` 时间戳从 `1000+n` 改成了墙钟毫秒:收件箱拿它与 `timezone.now()` 比较。
   原有 140 条聊天测试在改动之后仍然全绿。
