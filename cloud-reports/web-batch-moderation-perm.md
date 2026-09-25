# 灵魂批量回收、朋友圈审核四区、权限矩阵与角色；自助重置限灵魂账号

分支 `feat/web-batch-moderation-perm`，起点 `main` @ `638929e`。设计参照 `origin/design/refs-2026-09`
（规范 v1、C 组 08、E 组 08b/08c/08d/11a/11b）。没有迁移。

环境说明：这台云端机器上 **没有 Node 20.19.5**，用的是 `/opt/node20` 的 **v20.20.2**（满足 `>=20.9.0`）。
依赖按 CLAUDE.md：`npx -y npm@11 ci` → `npm rebuild …` → `git checkout -- package-lock.json`。
后端 venv 是 Python 3.11 + `requirements.lock` + `requirements-dev.txt`；Redis 是 6399 上的一次性实例。

截图在 `cloud-reports/web-batch-moderation-perm/`（`chromium-*` 是 1280 宽，`mobile-chrome-*` 是 Pixel 5 / 393 宽），
取自构建产物 + `e2e/fixtures.ts` 的路由 mock。截图脚本是一次性的，没有提交。

---

## 1. /souls 批量条（规范 3.1「有接口」）

**做了**

- `DataTable` 加了可选的 `selection` 属性：行首一列原生复选框，包在一个填满单元格的 `<label>` 里，
  并抬到 `linkedRows` 的 `::after` 遮罩之上（`relative z-[1]`）。所以点这个单元格只会勾选，不会跟进行链接；
  它是普通 tab 停靠点，Space 切换。表头有「选择本页全部」（半选态 `indeterminate`）。
- 吸底批量条「已选 N · 移入回收站 · 取消选择 · Esc」（`src/components/souls/SoulBatchBar.tsx`）。
- 移入回收站先弹确认，文案是回收站措辞（沿用 `souls.detail.delete_confirm_message`）。
- **选择跟查询绑定**：存着它所属查询（页码、筛选、排序）的 key，key 一变就在同一次渲染里清空。
  测试一开始 **发现了一个真缺陷**：旧写法只是「key 不同就读成空」，翻回第 1 页，第 1 页的勾选又回来了。
  修成「key 不同就重置状态」，那条测试把它钉住了。
- 被拒（404 `not_found` / 409 `not_deletable`，经 `soulBatchRecycleErrorOf`）：弹层不关，
  列出被拒的灵魂 **名字**（名字在勾选时就记下了，因为被拒的恰恰可能已不在列表里），
  并写明原因。因为是全有或全无，**选择保持不变**。
- 没有 `soul.delete` 就没有这一列，也没有批量条。

**没做 / 注意**

- 画布批量条上的「移交… / 导出」没做，本轮没要求。
- 被拒时 `useBatchRecycleSouls` 自己的 onError 还会弹一条通用 toast「删除失败」，和弹层里具体的
  名单同时出现（见 `chromium-02-souls-refused.png`）。hook 没改，因为它的 toast 是共享的键。

## 2. /moderation 四区

页头 = 标题 + 文明范围（当前用户租户的 `display_name`，ADMIN 无租户时是「全部文明」；它只 **说明** 范围，
不给下拉框，因为后端按请求租户 `scope_to_tenant`，页面换不了）+ 分段切换 举报 / 敏感词 / 禁言 / 已处理，带计数。
旧的「待审内容」页签没了：规则命中的内容并进了举报队列（与 C-08 一致：「被举报或命中规则的才进这里」）。

### 举报（C-08 审阅版式）

**做了**

- 左列表、右详情；393 宽下详情排在列表下面。列表 = 未处理的举报 + PENDING 的帖子 / 评论（规则命中）。
  一条既被举报 **又** 被敏感词拦下的帖子只占一行：放行时同时驳回举报 **并** 通过内容，
  否则它会立刻以「规则命中」的身份回到队列。
- 详情正文用衬线；全文通过新加的 `socialModerationApi.item`（`GET /social-moderation/{posts|comments}/{id}/`，
  这个 retrieve 早就存在）取到，因为举报只带截断的摘录。
- 反应用文字，不用表情：「评 N」。
- A 放行 / H 隐藏；J / K 上下移动。**正在输入时忽略快捷键**（textarea / input / select / contenteditable），
  有弹层打开时也忽略。
- 隐藏必须写理由：空着按 H 会在 `role="alert"` 里提示，并且什么都不发送。
- 删除（先确认）和禁言（1–365 天）是第二排按钮，因为队列原本就能做这两件事。

**没做（附原因）**

- **W 警告作者**：API 没有「警告」这种处理结果（`SocialReportResolutionEnum` = HIDE / DELETE / MUTE / DISMISS）。
  所以「警告必须写理由」这条规则无处可落。
- **念 / 转 计数**：官员侧的序列化器只暴露 `comment_count`（`Post.reaction_count` 存在，但没有序列化）。
  只画了「评」。
- **方形媒体格**：帖子没有媒体模型，没有可画的东西。
- **圆形头像**：用了方形首字块。`eslint` 设计守卫只允许在白名单文件里用 `rounded-full`，
  把这个页面加进白名单需要有人拍板。

### 敏感词（E-08b）

**做了**：新增是内联一行（词 · 类别 · 命中后），回车即加；表格列：词 / 类别 / 命中后徽章
（送审警示、隐藏危险、替换 *** 中性）/ 30 天命中 / 添加人 / 添加于。**行尾没有删除按钮**；删除只能
勾选 → 批量条「删除所选」→ 确认 → `batch-delete`。选择随翻页清空。

**没做**：行点开的编辑抽屉和「改动作…」—— 词表 **没有 update 接口**
（`SensitiveWordViewSet` 只有 list / create / destroy / batch-delete），这两个控件会做不到它们说的事。
「从其他文明复制」也没有接口。

### 禁言（E-08c）

**做了**：期限条 TermBar = 剩余时间 / 全程（`created_at` → `until`），`role="meter"`；剩余不到 10% 变警示色。
按用户决定上限 365 天，**没有画永久禁言样式**。「解除禁言」按规则 15 例外保留为行尾按钮，先确认
（「即时生效，灵魂端会收到通知；不能撤销，但可以重新禁言」）。已解除 / 已到期的行显示徽章，没有按钮。

**没做**：搜索、状态筛选、「+ 禁言…」—— 列表接口不支持筛选；新建禁言需要一个灵魂选择器
（`user_id`），本轮范围里没有。

### 已处理（E-08d）

**做了**：整行打开只读详情（480 px 抽屉，J / K 切换）。HIDDEN 行：抽屉里取全文，给「恢复可见」
（既有的 `restore` 动作）。DELETED 行：显示「■ 在回收站」并链接 `/recycle-bin`，
**不提供第二条恢复路径**，也不去取全文（删除后那个端点返回 404）。有 类型 / 处理 两个筛选签。

**没做**：「近 30 天」时间范围 —— 接口没有日期筛选。

## 3. /permissions（E-11a / 11b）

页头分段：矩阵 / 角色 / 权限项（权限定义的增删改原本就在这一页，保留成第三区，不删已有功能）。

### 矩阵

**做了** —— 改用逐格保存接口 `POST /perm/role-permissions/changes/` 和 `impact/`，取代按角色整体 PUT：

- 权限格：墨色实心 = 有，空框 = 无；未保存的格子加 2 px 强调色环，并标 ＋ / −；
  保存失败 **!**（危险色）；引起冲突 **◇**（警示色）。每种非默认状态都有字形，
  状态文字进 `aria-describedby`（和 `title`），不单靠颜色。
- 保存结果逐格处理：`saved` / `unchanged` 立即写进缓存；`refused` / `failed` 的格子 **保持未保存**，
  并带上原因（`admin_only_permission`：「与规则『回收站的恢复与彻底删除仅限 ADMIN』冲突，已退回」；
  `version_conflict` 会重新加载那个角色）。
- 部分失败横幅「部分保存失败 · 已存 N 项，失败 M 项」，逐格列原因；「定位」把焦点送到失败的格子
  （393 宽下会先切到那个角色）。
- impact 检查：未保存的改动一变（防抖 300 ms）就把 **全部** 改动发过去，因为别的角色上的新增
  可能正好补上一个撤销。冲突横幅写明是哪个角色的哪一格，会让哪条审批流的第几步无人可批；
  引起冲突的格子标 ◇。结果按它所针对的那组改动做 key，所以过期的答案不会画在更新的改动上。
- 「只看差异」、筛选框、吸底未保存条（「未保存 N 项 ＋a · −b」、放弃、保存 ⌘S / Ctrl+S）。
- 393 宽：先选角色（下拉），再逐行开关（`role="switch"`，≥ 44 px）。两种版式都在 DOM 里、
  按断点显隐，写的是同一份状态。
- 原有的三级确认保留（带移除的保存要确认；清空一个角色要手打角色名）。
  「此接口为整体替换」那行提示删掉了，因为现在已经不对了。
- 删掉了 `useMatrixSave`、`ConflictBanner`、`PartialSaveBanner`、`MatrixToolbar`、`RolesGrid`
  以及 `matrixPartialSave.test.tsx`，由 `useMatrixCells` + `PermissionsMatrixCells.test.tsx` 取代。
  `PermissionsPage.roleRename.test.tsx`（改名不应凭空生出一个「全部移除」的 diff）保留，
  只换了断言的对象，改成看新的未保存条。

### 角色表

**做了**：整行打开 480 px 抽屉（393 宽下全宽），J / K 切换。字段：显示名称（可改）、代码
（**只读文本**，注明「创建后不可改；审批流按代码引用」）、成员 / 权限 / 被引用的审批流条数，
外加「在矩阵里编辑 →」。⋯ 菜单里：复制为新角色（新代码 + 名称）、移入回收站…（危险色；
内置角色不可用）。删除被拒时显示原因；因审批流引用被拒时列出每个模板及其步骤。

**没做**：画布上的「说明」字段 —— `Role` 没有描述字段；「成员 9 · 查看」没做成链接。

## 4. 后端：邮箱自助重置密码只对灵魂账号生效

- `reset_password_request` 按 `email + role=SOUL` 查找（`SELF_RESET_ROLE = UserRole.SOUL`，
  与代码库里其他地方识别灵魂账号的方式相同 —— `SoulAccount.user` 的持有者都是 `role="SOUL"`）。
  官员邮箱和未知邮箱走完全相同的语句，返回相同的响应体。
- `set_new_password` 同样限制：就算官员邮箱有一个验证码（本规则上线前签发的，或别处写进去的），
  也改不了官员的密码。
- 新增 `tests/test_password_self_reset_is_for_souls_only.py`（9 条）：
  - 官员邮箱不存验证码、不发邮件（ADMIN / MODERATOR / GUARDIAN / VIEWER / JUDGE）；
  - 灵魂邮箱照常拿到验证码并能完成重置；
  - 灵魂 / 官员 / 未知三者的状态码和响应体 **逐字节相同**，同时断言确实只有灵魂拿到了验证码；
  - 预先塞进去的验证码改不了官员密码。
- 既有的重置测试把测试账号的 `role` 从 VIEWER 改成 SOUL（它们测的是灵魂的重置路径）。
- **变异验证**：去掉 request 里的 role 过滤 → 新测试 6 条红；去掉 set_new_password 里的 → 1 条红；
  恢复后 41 条全绿。

## 5. i18n / egy

三份语言包各新增 104 个键；zh 里 `social_moderation.tabs.reports` 从「举报队列」改成「举报」。
egy **只用既有词形**：`egyLexiconRules` 的封闭词汇测试在重新生成词表之前就是绿的；
`egyVocabulary.json` 按测试里写好的命令（`EGY_VOCAB_WRITE=1`）重新生成，
**只有计数变了**，没有新词，也没有 lexicon 标记变化（逐项核对过）。
一处技术词放行：`social_moderation.review.shortcuts` 里的按键名 J / K / A / H，照已有的 `souls.preview.hint` 先例处理。
没有找不到词表达的字符串。

## 6. 门禁（最后一次提交之后在当前树上跑，读的是退出码）

| 门禁 | 命令 | 退出码 | 结果 |
|---|---|---|---|
| tsc | `cd frontend && npx tsc --noEmit` | 0 | — |
| lint | `cd frontend && npm run lint` | 0 | 0 warning |
| jest + 覆盖率 | `cd frontend && npm run test:coverage` | 0 | 183 个套件 / **2991 passed**；阈值守住（全部文件 80.06 / 72.54 / 70.74 / 80.97） |
| build | `cd frontend && npm run build` | 0 | — |
| e2e chromium | `npx playwright test --project=chromium` | 0 | **146 passed / 1 skipped** |
| e2e mobile-chrome | `npx playwright test --project=mobile-chrome` | 0 | **142 passed / 5 skipped** |
| e2e firefox | — | — | **没跑**：这台机器没装 Firefox |
| core typecheck | `npm run --workspace packages/core typecheck` | 0 | — |
| core lint | `npm run --workspace packages/core lint` | 0 | — |
| core test | `npm run --workspace packages/core test` | 0 | 13 个文件 / **122 passed**。同一条命令在 pytest 与 Playwright 同时占满 CPU 时红过一次：`nodeGlobals.test.ts` 编译整个 TS program，超过了 5 s 的默认超时。机器空下来之后重跑，全绿。用例本身没改，所以这是负载下的超时，不是这个分支带来的回归 |
| 后端 pytest | `.venv/bin/python -m pytest --tb=short -q`（SQLite 内存库 + 一次性 Redis） | 0 | **4818 passed / 25 skipped**，覆盖率 93.95%。第一次全量跑出 1 条失败：`test_user_management.py::test_set_new_password_success` 拿 ADMIN 走邮箱重置，钉住的正是本分支要去掉的行为。已改成灵魂账号（`8bbe908`），然后全量重跑 |
| ruff | `cd backend && .venv/bin/ruff check .` | 0 | All checks passed |
| makemigrations | `manage.py makemigrations --check --dry-run` | 0 | No changes detected |

Playwright 说明：这台机器上 Playwright 1.63 需要的 chromium 1243 没装，只有 `/opt/pw-browsers/chromium`（1194）。
e2e 用一个 **没提交** 的覆盖配置跑：原 config + `launchOptions.executablePath`，去掉了 firefox。
被跳过的：chromium 1 条 = 393 宽的「先选角色」测试（只在手机上跑）；mobile-chrome 5 条 = 桌面网格的矩阵测试
（在 393 宽下 `test.skip(isMobile)`，手机版式有自己的测试）。这 6 条跳过都是本分支新加的。

新测试做过变异验证（拿掉被测的那条规则，看测试变红，再恢复）：
- 审核：理由必填 / 输入时忽略快捷键 / 同一条合并后「放行」同时通过内容 / DELETED 不给恢复 / 解除禁言要确认 —— 5/5 变红。
  「输入时忽略」一开始 **没有** 变红：断言是同步做的，早于 mutation 真正发出。补了一次 flush 之后变红。
- 批量回收：选择不绑定查询 / 复选框不抬层 / 列 id 而不是名字 / 被拒时清空选择 / 没有权限门禁 —— 5/5 变红。
- 矩阵：丢掉失败标记 / 过期的冲突 / 不带 expected_versions / 代码可编辑 / 手机无视角色选择 / − 只靠颜色 —— 6/6 变红
  （最后一条一开始存活，补了字形断言之后变红）。
