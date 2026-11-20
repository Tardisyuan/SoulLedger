# A9 · 官员台登录页与欢迎页(Design 2026-10-03,v3-batch5-login-welcome-reply.md)

取自 Design 项目「SoulLedger v3」:`templates/soulledger-v3-pages/` 的 `Login` / `LoginMobile` / `Welcome` / `WelcomeMobile` / `BrandMark`。下面照抄 Design 的答复;末尾「我们的答复」是代码这边对它三个待确认问题的决定。

## 一、品牌标

| 位置 | 放什么 |
|---|---|
| 登录页左上(1440)/ 顶栏(393) | 天平标 32(393 为 24),右边是「灵魂簿」(Noto Serif SC 600,20 / 17) |
| 侧栏品牌位 | 天平标 24 加「灵魂簿」17/600,高 56。**改 GlobalNav**:去掉 28 号印和「SoulLedger / 灵魂簿」两行字;收起时只留标 |
| 393 顶栏、首次设置顶栏 | 天平标 24 |
| 冷启动、App 图标、favicon | 照 A7 |
| **文明印** | 只放在身份带(64 / 52 / 30),以及落判 72、签署 52。导航里不再出现 |
| 欢迎页右上 | **不放标**。顶栏右侧依次是搜索(240×36)、通知 44、头像 32,和 A8 一致 |

- 颜色：浅色底用墨色 `oklch(var(--color-ink))`;深色底用 `--brand-mark` #ECAA3D;`--brand-ground` 底加金标只在图标和冷启动里用。金色不当界面色用，标以外不出现。
- 标的画法:A7 外形路径整体填色(evenodd;`mobile/src/brandMark.ts` 的 SHAPE 三段，viewBox `200 216 624 591`)。笔画只在冷启动动画里用。
- `BrandMark` 组件：`size`、`tone = ink | gold | white`。

## 二、登录页 `/login`

**版式(1440×900)**:两栏,`minmax(0,1fr)` 加 560。左栏 `--color-canvas`,右栏 `--color-surface-1`,中间用 1px `--color-line` 分开。两栏共用三条横线：顶行 44(上边距 40)、内容起始线 y=216(律条眉题和「登录」对齐)、底行。墨色宽带去掉。

| 块 | 组件 / 令牌 / 尺寸 |
|---|---|
| 品牌行 | BrandMark 32;「灵魂簿」font-title 20/28 600;「SoulLedger · 官员台」13 ink-muted |
| 语言 + 明暗 | 原生 select 44 高、圆角 4、`--color-line-strong` 边框;`ThemeToggle` 44 |
| 今日律条 | 眉题 11/16 加 0.1em 字距,ink-subtle。正文 font-serif 500(引文);出处用 24px 细线引出,13 ink-muted,条号用 mono 12 |
| 四文明短引 | 底行四等分，顶边 1px `--color-ink`,竖分隔用 `--color-line`。每格三行：字形加文明名 12 muted;短引 serif 15/24;编号 mono 12。字形 ■●▲◆ 用墨色，**不用文明色** |
| 表单 | 宽 400(右栏左右各留 80)。「登录」font-title 28/36 600;`TextField` md(48)×2;密码框里的「显示」是 `Button` ghost sm 44,叠在输入框右侧;「保持登录 30 天」是原生 checkbox 18,点击区 44;「忘记密码」是 44 高的链接;`Button` primary lg 56,占满宽度，带 ↵ |
| 主按钮颜色 | 登录前没有租户,provider 不传 `civ`,primary 走中性皮肤(墨色)。这页不出现文明色 |
| 底行(右) | 「第一次来？看欢迎页」链接 12;版本号 mono 12 |

**律条长度**(按字数分三档，律条都来自语料库):
- 60 字以内:36/56,最多 22em 一行
- 61–160 字:28/46
- 160 字以上:20/36,行长 34em,最多显示 10 行(360px),底部 72px 渐隐到 canvas。出处行后面放「展开全文」(`Button` ghost sm)。展开后左栏内部滚动，底行固定不动。登录前也能展开。

**393**:律条**放到表单下方**,不折叠成入口。首屏只放顶栏 56 和表单;律条在 852 线以下，默认显示 4 行(20/34,136px),后面接「展开 ↓」,再往下是四文明短引的列表(行高 56)。表单放在 surface-1 上，律条区换 canvas 底并加顶线，两块分开。

**状态**(提示框高度固定在表单标题下方;边框 1px、圆角 4、canvas 底;提示框不写账号密码哪个错，字段本身不标红):
- 加载中:`Button loading`,宽度不变，文案换成「登录中」;两个输入框 disabled。
- 账号或密码不对:`--color-danger` 只用在「! 账号或密码不对」这一行，下面一行 muted 写剩余次数。密码清空，账号保留，焦点回到密码框。
- 锁定：边框用 `--color-warning`,标题「◐ 账号已锁定」用墨色，下面写解锁时间(mono)。密码框和登录按钮 disabled。
- 网络错:「! 连不上服务器」,右边放 `Button` secondary sm「重试」。已填内容保留。

(后端已有:401 带 `remaining_attempts`;锁定是 `code: login_locked` 加 `retry_after` 秒。见 `backend/apps/authentication/serializers.py:199-212`。)

## 三、欢迎页 `/welcome`

**结构(1440)**:`GlobalNav`(品牌位按上面改)→ 顶栏 52 → 身份带 `Plaque` 156 → 内容区(padding 24,gap 24)。

| 块 | 组件 / 令牌 / 尺寸 |
|---|---|
| 问候 | **并入身份带**:题字「晚上好，崔判官」font-title 40;上一行是文明加殿名;右侧 meta 写日期。原来的问候区和「欢迎页」字样都去掉 |
| 统计 | 一块面板(surface-1、1px line、圆角 8),四格之间用竖线分开，不再做四张卡。表头 44:眉题「本殿灵魂」加「截至 20:14」(mono)。每格：字形加名称 13;数字用 font-title 28/36 600 tabular;下面「去 xx →」12 muted。整格可点，跳到筛好的列表。字形：总数不加、◇ 审判中、○ 存活、▣ 已处置。图标去掉 |
| 接着做 | 400 宽面板，标题 20/600,右侧写「按『判官』角色」。**一个** `Button` primary lg 56(全页唯一的主按钮),文案带待办数;下面三行 56 高的入口(名称 13/500 + 说明 12 + 快捷键帽 + →);底行是「? 所有快捷键」和「重看首次设置」 |
| 按角色 | 判官：主按钮「进入审判台」;操作员：同上;管理员：主按钮「看统计概览」,三行改为 用户 / 权限 / 审计。入口来自当前用户的菜单，没有权限就不出现 |
| 最近活动 | `minmax(0,1fr)` 面板，标题 20/600 加来源说明，右上「查看全部活动 →」44。行高 56,四列：时间(mono 12)/ 字形加动作 500 / 对象加编号(mono 12)/ 备注 12 muted。最多 6 条 |
| 文明、角色、版本 | 三张信息卡去掉。文明在身份带上一行;角色在侧栏用户块和「接着做」右上;版本放页脚一行(12 muted)。首次设置左栏底部也会再写一次 |

**首次进入**:单独占一屏，不和常规内容同时出现。身份带保留;下面是一块 960 宽的面板(圆角 8),左边 280 是步骤栏，右边是当前这一步。
- 步骤栏：眉题「首次设置 · 2 / 4」(mono 11)。四行各 56 高，标记 24 见方:✓ 是墨底反白;当前步是 2px 墨色框，文字 600;未到的步是 1px line-strong 框，文字 muted。
- 内容区：面板标题 20/600 加一句说明。底栏 80 高：左边「跳过，直接进入」(ghost md 48),右边「上一步」(secondary md)和「继续」(primary md)。
- 第 2 步默认视图：两个单选卡，圆角 4,选中时 2px 墨色框，卡里画示意。第 3 步:`SelectField` 选语言，三个 48 高的主题单选。第 4 步：键帽表，沿用现有那 7 条。
- 做完或跳过，写入 `onboarded`,进入常规页。之后从「接着做」底部的「重看首次设置」回来。
- 393:全屏显示，没有底栏。顶栏放标、步数和「跳过」,下面一条 4 段的 2px 进度条;标题 font-title 28;底部是「上一步」secondary lg 和「继续」primary lg,各 56。

**数据状态**:
- 空：数字照样写 0,不隐藏格子(和 `DomainNumber` 一致)。活动区用 `EmptyState`(标题加原因，不放动作)。主按钮改成「进入审判台 · 队列已清空」。
- 加载中：各格和各行按实际形状画骨架(surface-3 / surface-2 色块，同 `Skeleton`),`aria-busy`。「接着做」不等接口，直接显示。
- 出错：统计和活动**各自**报错、各自重试。`--color-danger` 只用在「! 加载失败」这几个字;说明用 muted;右侧放 `Button` secondary sm「重试」。入口照常可用。

**393**:顶栏 56(标 + 搜索 44 + 头像)→ `Plaque` mobile 120 → 统计 2×2 分格面板(数字 font-title 20/28)→ 主按钮 lg 全宽 → 三行入口 56 → 最近活动 4 条(两行，行高 56+)→ 页脚 → 底栏 56。

## 四、约束核对

- 文明色只出现在：身份带、印、primary 按钮。
- 状态都用字形加文字表示:! ◐ ✓ ↺ ＋ → ✎ ◇ ○ ▣。
- 衬线 600(font-title)用在：身份带题字、「登录」、首次设置 393 标题、统计数字、「灵魂簿」字标。律条和短引用 font-serif 500,它们是引文。
- 控件高度：按钮 44 / 48 / 56;输入框 48;列表行 56;点按区不小于 44。圆角：控件和单选卡 4,面板 8。

## 五、新增文案(egy 按词表处理)

| key | 中文 | English |
|---|---|---|
| login.subtitle | 用本殿发给你的账号登录。 | Sign in with the account your court issued. |
| login.account | 账号 | Account |
| login.statute.eyebrow | 今日律条 | Today's statute |
| login.statute.rotates | 每次进入换一条 | A new one each visit |
| login.statute.expand | 展开全文 | Show full text |
| login.statute.chars | 全文 · {n} 字 | Full text · {n} characters |
| login.welcomeLink | 第一次来？看欢迎页 | First time? See the welcome page |
| login.error.credentials | 账号或密码不对 | Account or password is incorrect |
| login.error.attemptsLeft | 还可以再试 {n} 次，之后账号锁定 {m} 分钟。 | {n} more tries before the account locks for {m} minutes. |
| login.error.locked | 账号已锁定 | Account locked |
| login.error.lockedBody | 连续输错 {n} 次。{time} 后可再试，或请本殿管理员解锁。 | {n} failed attempts. Try again after {time}, or ask your court admin to unlock it. |
| login.error.network | 连不上服务器 | Can't reach the server |
| login.error.networkBody | 填好的内容还在。检查网络后重试。 | What you typed is kept. Check your connection and retry. |
| login.submitting | 登录中 | Signing in |
| welcome.greeting.{morning,afternoon,evening} | 早上好 / 下午好 / 晚上好，{name} | Good morning / afternoon / evening, {name} |
| welcome.stats.eyebrow | 本殿灵魂 | Souls in this court |
| welcome.stats.asOf | 截至 {time} | As of {time} |
| welcome.stats.goJudging | 去审判台 → | Go to judgment → |
| welcome.stats.filter | 按状态筛选 → | Filter by state → |
| welcome.stats.roster | 查看名册 → | View roster → |
| welcome.next.title | 接着做 | Pick up where you left off |
| welcome.next.byRole | 按「{role}」角色 | For the {role} role |
| welcome.next.judgment | 进入审判台 · {n} 待审 | Open judgment · {n} pending |
| welcome.next.judgmentEmpty | 进入审判台 · 队列已清空 | Open judgment · queue clear |
| welcome.next.createSoulHint | 手动登记一名亡者 | Register a deceased person by hand |
| welcome.next.workflowHint | 我发起的 · 待我签的 | Started by me · awaiting my signature |
| welcome.next.meritHint | 按殿、按月的功过余额 | Merit balance by court and month |
| welcome.next.allShortcuts | 所有快捷键 | All shortcuts |
| welcome.next.redoOnboarding | 重看首次设置 | Redo first-time setup |
| welcome.activity.source | 审计日志 · 我的最近 {n} 条 | Audit log · my last {n} |
| welcome.activity.emptyReason | 你在这里落判、登记、调派，都会按时间记在这一栏。 | Rulings, registrations and transfers you make appear here in order. |
| welcome.error.stats | 统计接口没有响应，下面的入口照常可用。 | Stats didn't load. The shortcuts below still work. |
| welcome.error.activity | 审计日志暂时读不到。 | The audit log can't be read right now. |
| onboarding.progress | 首次设置 · {i} / {n} | First-time setup · {i} / {n} |
| onboarding.canChange | 四项都能之后再改。 | You can change all four later. |
| onboarding.wrongIdentity | 身份不对请联系本殿管理员。 | Wrong identity? Contact your court admin. |
| onboarding.view.title | 登录后先看到什么？ | What should you see after signing in? |
| onboarding.back | 上一步 | Back |
| onboarding.skip | 跳过 | Skip |
| onboarding.theme.system | 跟随系统 | Match system |

保留原词，不新增:「继续」「跳过，直接进入」「操作员」「管理员」「忘记密码」「在此设备上保持登录 30 天」「暂无最近活动」「查看全部活动」「加载失败」「重试」。key 名以仓库现有命名空间为准，上表只是 Design 的建议。

## 我们的答复(2026-10-03)

- GlobalNav 品牌位：代码这边改(去掉印，换 BrandMark),改完重新 `/design-sync`。
- 四文明短引：沿用登录页现有的四句(本来就摘自语料库原文),固定不变。
- 「展开全文」:只展开当前这一条，登录前也可以。
