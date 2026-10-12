# Changelog

All notable changes to SoulLedger will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

> ### 关于版本号 / On version numbers
>
> `0.1.0` 之后没有再发过版本。判断依据：仓库只有一个 tag（`v0.1.0`，指向
> 2026-05-29 的提交，与本文件记的 `0.1.0 - 2026-05-08` 并不一致），
> `frontend/package.json` 至今仍是 `0.1.0`，后端没有任何版本声明。既然没有可靠的
> 版本信号，也从未发布过，下面就**按日期分段**，段标题写的是工作区间而不是版本号。
> 每段对应一轮主题明确的工作，并在有对应里程碑时标出（M8–M15，见
> [`docs/MILESTONES.md`](docs/MILESTONES.md)）。
>
> 条目按**主题聚合**，不是一条 commit 一行。`git log` 才是逐条的准确记录。
>
> *No release has been cut since `0.1.0`. Sections below are dated work periods,
> not versions — see the reasoning above.*

## [Unreleased]

2026-08-15 至 2026-08-28、尚未归入某一段的工作。按主题聚合，`git log` 才是逐条记录。

> 这一段最后一次随手更新是 2026-08-28。此后到 2026-10-09 的工作(灵魂端 App、官员端 App、书信、朋友圈、问一问、
> 受刑计划、设计系统 v1–v3 等)曾长期没有记录;2026-10-12 已按 `git log` 回头补写为下面 2026-08-30 至 2026-10-09 的七段
> (夹在 2026-10-10 一段与 2026-08-13 一段之间)。那七段是事后从提交整理的,不是当时记的,逐条仍以 `git log` 为准。

### Added
- **希腊成为第四个文明**（`GREEK` / 租户 `GR_HADES`）：actors、realms、disposition 路由、
  ledger 读数、i18n 标题与配色全线补齐。此前系统只有中国 / 欧洲 / 埃及三个文明
- **可引用的条文语料**，四个文明共 **172 条**：
  - `GONGGUOGE` 74（《太微仙君功過格》，中国）
  - `NEGATIVE_CONFESSION` 42（玛特四十二判官，埃及；DERIVED，不转录正文）
  - `INFERNO` 26 + `DEADLY_SIN` 7（欧洲）
  - `GORGIAS` 12 + `REPUBLIC_ER` 11（希腊）
  - `HELL_LAW` 0，并显式声明 ABSENT
- 希腊与欧洲各有**两套**语料而不是合并成一套：结构不同不可合并——欧洲是七层 vs 九圈，
  希腊是「盖印即终局」（《高尔吉亚》）vs「千年循环后重生」（《理想国》卷十）
- 判决卷宗页、语料浏览页，以及按本租户实际引用频次给条文排序
- 功過格读数：零積不抵整發，以及 fungibility class 与 granularity 规则的 API 通路
- 工作流模板级优先级；申诉流程在各文明都可发起，并带上真实节点
- 处置记录本刑期起算时间，并与灵魂在世时间交叉校验
- 设计系统：真实字体、Tailwind 八级字号阶梯、六个 UI 原语，以及带牙齿的门禁

### Changed
- 44 个页面迁到 `PageShell`
- 处置路由改按各自宇宙论判：中国按未抵消的過、欧洲按 culpa、希腊按柏拉图的岔路
- `Statute.source` 由 `CharField` 改为 `TextField`
- 语料读数改为报出成员与代码，不再拼英文句子
- Git hooks 安装脚本落地——此前那些检查只在有人记得手动跑时才跑

### Fixed
- **四租户考据审计**：12 处确证错误、两处转录缺口；两条自己数错的校勘注也一并改掉。
  被推翻的是那些替四个文明作保证的摘要句，四个租户的框架本身成立
- 功過格四处省略号补全，带回 11 个被吃掉的计分子句；不軌門据原刻版式拆为六条
  （過律 39 条至此完整）
- 迁移：四个 reverse 会删掉自己从未写入的行；两个 forward 长期不可运行；
  `perm/0017` 在已有事务内改用 SAVEPOINT，异常时只回滚自身
- `actors/0010` 退役 2026-05 迁移遗留的那批 Actor
- 7 个长期被当作「环境问题」的测试 ERROR，真凶是 `serialized_rollback`，不是环境
- 两个只有真跑 PostgreSQL 才会暴露的缺陷（SQLite 下不可见）
- 忘川（Lethe）移到炼狱山顶并补入 Eunoè；杜阿特的门属于亡者而非拉
- 设计系统：281 处组件字号归档、28 处写死字号、12 个不产生圆角的圆角类、
  最后七个 `min-h-screen`；门禁报错文案曾把人指去改错的文件
- a11y：35 组不达 AA 的 ink-on-surface 组合、抽屉与工作流列的键盘可达性、
  埃及徽标改掉多数系统画不出的象形字
- 图表：骨架屏没有高度导致每次加载跳版；三处颜色映射与图例对不上

### Removed
- 120 行无人引用的组件；孤立的 `CASE_TYPE_KEYS` 映射

### Tests
- 后端 **2,694 passed, 9 skipped, 0 failed**，覆盖率 **91.43%**（闸门 80）——2026-08-28 实跑，
  **无任何排除**。此前引用的 2,672 是排除了 `tests/test_websocket*.py` 的数字，而那个排除
  的理由（沙箱到 Redis 不可达）已于 2026-08-27 被实测证伪 —— 理由删了、排除没删
- 前端补上「整套跑了多少」的下限门禁；三个永远不会失败的守卫被改成会失败
- 钉住「正文列了价而 clauses 没有」——省略号能吃掉分值的原因

---

## [2026-10-10 – 2026-10-12] — 账号与登录:两步验证、免手输登录、登录交付单

### Added
- **两步验证(TOTP + 恢复码)**:官员(Web 与官员端 App)和灵魂(灵魂端 App)都可开启;开启前先输当前密码;
  重新生成恢复码要再验一次;官员可在灵魂详情里关闭某个灵魂的两步验证(`souls.mfa_reset`)。
  恢复码可存为文件。灵魂端令牌带会话版本,改密码后别处的登录立即失效
- **灵魂登录不再手输编号**:编号按 3-4-3 分组显示与输入(输到编号不用的字符当场提示);登录页可扫
  交付单上的二维码(`SL1:<编号>`,只带编号);手机记住最近一个账号;面容 / 指纹登录
  (服务端给这部手机发专用凭据,只存哈希;改密码、官员重置、转生会吊销并说明原因)
- **登录交付单**:官员台「初始密码交付」页可打印 A4 一页的交付单,上联 110 mm 交给灵魂、下面是存根。
  按四种文明各自排版(匾额带、外框、纹样、殿印),默认带文明色,另有「黑白打印」开关;上联印文明自己的
  文字加英文副行(彼岸、哈迪斯只印英文),存根跟官员台界面语言。单上不印密码,留手写框。打印写审计
- **设新密码时逐条列出要求**(Web 两处、两个 App 五处):至少 8 位、不只是数字、和当前密码不同、两次一致,
  达标打勾;没达标点保存不发请求。规则函数在 `packages/core`,最小长度有守卫盯着与后端一致
- 跨殿移交:发起方可在对方批准前取消;驳回 / 取消的理由单独成字段;四种通知按语言下发;
  官员端 App 的移交通知落到对应的屏
- 朋友圈:官员发帖与评论过敏感词表,作者会被告知结果(打码 / 送审 / 隐藏);作者可在 Web 编辑自己的帖子
- 书信可以发图(私有上传、签名取图、每图一条消息);官员在殿司收件箱与官员端 App 里能看到
- 官员端 App:应用内完成密码重置;通知与查询的 Siri / 桌面快捷方式;书信交接或新来信时推送给经办官员

### Changed
- 「旧密码」统一叫「当前密码」(标签与输错时的提示,Web 与两个 App)
- 灵魂端忘记密码第 2 步去掉强度条(它不知道服务器的常见密码名单,会与服务器的判断矛盾)
- 改密码或重置密码会删掉其他设备的推送登记,并关闭别处打开的实时连接
- 权限导入的「覆盖」模式默认关闭(`PERM_IMPORT_OVERWRITE_ENABLED`)
- 埃及文:「新」统一写 Mawy;Sekhem Tepy 只表示「初始密码」;第十七至二十七批 Design 定稿全部写入,
  待定清单清空

### Fixed
- 事件日志写失败时整笔业务回滚(`SoulEvent` 写不进去,业务写入随之回滚);转生同步、工作流事件、转生申请状态都挪进
  决定所在的事务;`REINCARNATION_COMPLETED` 接入 Web 客户端
- 评议区拿到非数组响应时不再把整个审判页打成 500
- 恢复码登录页输错时说的是恢复码,不再说「数字不对」
- 审计明细里的动作名引用了不存在的颜色令牌,整条样式被浏览器丢掉
- 只在设备上才现形的九处(iOS 编号框点不进、相机权限被另一个插件删掉、`↗` 被画成彩色表情、
  回信页发送键被键盘盖住、安卓编号框重影等),逐条见 `CLAUDE.md` 的 Build & Test

---

## [2026-10-08 – 2026-10-09] — 官员端 App、多角色与两步验证、功过结构化、分库守卫

> 本段与下面各段(2026-08-30 至 2026-10-09)是 2026-10-12 按 `git log` 回头补写的,不是当时随手记的。

### Added
- **官员端 App**:独立的 Expo 工作区 `mobile-officer/`(待办 / 审判 / 查询 / 通知 / 我的),后端提供免选殿登录与「待我处理」;
  审批详情列出节点接受的判决,可在当前审批节点加会签人、写审判评语(审判评语接口,按租户划界并写审计);
  官员端刷新令牌有效期单设(24 小时,Web 不变);图标按 A14 出;`ci.yml` 与 `run-gates.sh` / pre-push 守卫测试接入该工作区
- **官员两步验证**(TOTP、恢复码、设备令牌)的后端与前端:登录第二步、向导、个人中心
- **一个官员可持有多个角色**,权限取并集;硬规则按角色逐个生效后再取并集(殿主兼任判官不会被误伤);`/users` 有角色签、设置角色对话框与批量操作
- **官员邮件找回密码**(邮件链接 + 邮箱验证);官员端 App 的「忘记密码」打开 Web 的重置页
- **功过记录结构化**:律条引用带冻结快照,可改已入簿的一条(`PATCH /souls/<id>/records/<record_id>/`),改后重算 `merit_score` / `demerit_score`;
  灵魂详情的功过台账可新增与逐条修改,事件日期拆为年 / 月 / 日三框(年可为负);App 本世页显示每条功过的依据律条与人生阶段
- **灵魂 CSV 批量导入**:预览不写库、提交全有或全无;`/souls` 有导入对话框
- **缩短冷却申请**:冷却期内的灵魂可申请缩短(可写希望还剩几天),官员在 `/rebirth-applications` 新页签处理;App 有五态面板;转生冷却上限 365 天;关着的殿拒收调拨
- **仪表盘「趋势」面板**:灵魂普查日快照与趋势接口,按状态 / 文明 / 界域取维度,随后改为小倍数图(A14)
- **审计日志**:CSV 导出(与列表同一组筛选)、按殿筛选(全局管理员用下拉,殿内管理员只读本殿);殿设置 / 印字 / 助手开关的编辑逐字段入审计、每次编辑只留一行
- **灵魂端通知记录**接口与 App 页面(无设备的灵魂也留一条 `NO_DEVICE` 记录);官员邮件通知通道与 `/profile` 的开关;死亡同步的 Webhook 管理接口与页签
- **App 深链与快捷方式**:两个 App 都支持深链(未登录时先挂起);安卓桌面快捷方式与 iOS App Intents;Siri 念缓存的数字,「问一问」带着问题打开
- **分库(tenant sharding)守卫**:`G1` 逐条钉住租户外键并写明理由、`G2` 登记所有测试之外的未过滤管理器用法、`G5` 钉住全局唯一键及其保证、`G6` 全局管理员的聚合等于各殿之和;
  `G3` / `G7` 是可选的第二个数据库(`tenant_shadow`)路径与 `reconcile_tenant_shadow`,计划文档同步标注已完成的几项

### Changed
- 迁移里的 `RunPython` 一律读写被迁移的那个库(`org`..`workflow`、`actors`..`menus` 两批已改),并加守卫防止回退;影子路由会跑数据迁移
- 调拨与联审通知、受刑计划通知改为提交后再发(`on_commit`)
- 埃及文 Design 第 10 至 13 批定稿陆续导入

### Fixed
- 死亡同步的幂等键改为每个殿内唯一,不再全局唯一;律条编号在灵魂自己的殿里解析
- 审计的资源、统计、时间线、`by_trace` 与列表使用同一条殿规则
- 安卓桌面快捷方式总打开默认页;iOS 27 上两个 App 都能启动(场景生命周期);`↗` 在 iOS 上不再画成彩色表情
- 官员端 App 的转生标题、会签候选人与灵魂搜索不再显示原始枚举码;两个同号的 `authentication 0019` 迁移补了合并迁移
- 官员端门禁点名了不存在的工作区,已改正;同日合并后的门禁红(CSV 导入、趋势、小倍数图)已清

---

## [2026-10-01 – 2026-10-04] — 设计系统 v3、问一问流式回答、全局搜索

### Added
- **设计系统 v3**:令牌换成 v3 的中性色与文明色,另有形状与展示字;外框换成 v3 导航(中性侧栏、顶部身份带),
  描边印取代 v2 实底印,身份带取代 v2 的匾;控件尺寸(按钮 / 输入 / 表格)、层级令牌、动效令牌(四档时长、三条缓动)、反馈层(toast、停靠)、403 / 404 / 500 卡片一并换成 v3;
  标题层级写成一张被守卫的表,圆角与阴影两道守卫放开为两档
- **v3 页面改版**:审判队列、审判台(落判键竖排、资料舱、草稿栏)、灵魂详情、仪表盘、权限矩阵、朋友圈、界域拓扑路线图、律条语料阅读器、审批流编辑器与实例详情、管理与系统页、登录页 / 欢迎页 / 落地页;
  案号可复制并印在审判台、队列与流程信息卡上;审判新增案号与律条版本(三步迁移)
- **灵魂端 App 全局换 v3 调色板**:本世页换 v3 版式(身份带随滚动收起),新 App 图标(S 与 L 组成的天平)与启动页,冷启动九笔写出金标;下拉刷新两端同一实现;离线条
- **全局搜索**:顶栏入口与 `⌘K` 命令面板
- **问一问流式回答**:三个提问端点走 SSE 流式输出(`packages/core` 有类型化的 SSE 读取器),可切到备用供应商,分平台密钥,用量按主 / 备用拆分;
  App 与官员端都改为边写边显示;检索按提问页面稳定重排 top-k
- **致谢页**加开源软件、文献出处(含「参照」条目)、模型与服务
- 功过总账按月日记账、余额月快照与「较上月」,`karma` 记录带条款与发生次数,功过条款链到语料原条
- 外部接入密钥与登录日志页;殿的设置与更正结案

### Changed
- 设计守卫改按 v3 的允许值;撤掉 v2 分节标题 `SectionTitle` 与分节纹;`DataTable` 的 compact 密度删除
- 动效:行展开 / 收起、整节折叠、弹窗、印落下、草稿「已保存」一闪、审判台 `F` 展开全案的转场都按 v3 重做
- 欢迎页的 `onboarded` 改为跟着账号存进偏好
- 门禁:读别区文件的测试清单按 git 跟踪的顶层条目推导;一个区域改动也会跑读它文件的别区测试
- 埃及文第 3、4 节审定落地

### Fixed
- 断线横条不再挡住工具条按钮(只留「重试」可点)
- 点击区:下划线标签与用户菜单项加到 44;每处截断都带 `title`;`□` / `■` 补进状态字形字体
- 393 px 下灵魂列表名字不再一字一行,仪表盘已终结行加载时不再跳版

---

## [2026-09-29 – 2026-09-30] — 问一问(灵魂端 / 管理页 / 官员端)、设计系统 v2「朱印」、门禁工具

### Added
- **问一问(`soul_assist`)**:灵魂端 LLM 助手(App 里的入口与抽屉,历史页写明 30 天规则)、官员端入口与面板(`/api/v1/assist/`)、
  管理员的「助手管理」页(配置、供应商预设与模型列表、连通测试、试问、用量,仅 ADMIN);系统自建专用的试问灵魂与官员;
  用量达 80% 告警、到顶自动重开;帮助语料(含与代码对照的漂移测试);向量检索(`pgvector`)及降级回退
- **设计系统 v2「朱印」**:Web 令牌(纸墨色板、状态色、文明皮)、匾 / 印 / 分节纹组件、立柱取代侧栏、页头换成匾,
  App 同步引入 v2 令牌与动效库(Reanimated);撤掉用户自选强调色;图表改冷灰蓝梯度加图案;设计守卫改按 v2 允许值——v2 次日起被 v3 取代,见上一段
- **租户的印字** `seal_glyphs`(按文明校验,仅 ADMIN 可改)
- **关于 / 致谢页**(Web 用户菜单与 App 设置)
- 系统邮件改为纯文本 + HTML 两部分,按收件人语言(`zh-Hans` / `en` / `egy`)发送
- **门禁工具**:`scripts/gate-lock.sh`(同一时刻只跑一个吃 CPU 的重门禁,跨 worktree 共用);pre-push 的后端 pytest 在装了 `pytest-xdist` 时用 4 进程并打印进度;
  `scripts/run-gates.sh` 成为门禁逻辑唯一出处,feature 分支推送时只跑受影响的 jest,并报门禁时间与 jest 时间(不含等锁)

### Changed
- Web 页面 CSP 改为每请求 nonce + `strict-dynamic`;`middleware.ts` 改名为 Next 16 的 `proxy.ts`;React Query 默认 `staleTime` 30 秒、实时查询显式设 0
- 灵魂端朋友圈各列表改用 `FlatList`,书信会话时间线用倒置 `FlatList`
- 总账改为整月一次请求(`all=1`);仪表盘去向柱按界域类型画图案
- 删除用户改为输入用户名确认;删除确认按能否撤回收口
- 埃及文:助手管理、官员助手面板、系统邮件、关于页等多节 Design 定稿落地

### Fixed
- 助手:冷的嵌入模型不再让每个问题都回退;先查提问者自己的数据再解释规则;`DeepSeek` 默认思考模式在兼容层关掉
- 通道层 socket 读超时长于 `channels_redis` 的阻塞弹出
- 测试会话:禁止在事务测试之后跑普通 db 测试,否则拒绝运行;依赖补丁(`brace-expansion`、`fast-uri`)

---

## [2026-09-24 – 2026-09-28] — 规范 v1「账簿 × 卷宗」、审判台与审批流引擎、朋友圈与审核、受刑计划进 App

### Added
- **Web 规范 v1「账簿 × 卷宗」**:色板、徽章、壳、字号七档、方角焦点环、弹层、账页式列表(用户 / 租户 / 回收站 / 菜单 / 执事 / 权限 / 审计等)、右侧 480 px 抽屉、筛选签;
  概览、灵魂详情、发起移交、审判台三栏、登录 / 欢迎等页都按它改版(此后被 v2、v3 取代)
- **审判台与队列**:认领、释放、改派、暂缓与批量;证据采信、判词草稿自动保存、先例排序;结案可选目的地与刑期,结案时冻结采信后余额并给引用条文拍快照;
  `J` / `K` 上下一件;别人认领的案子只有认领人能结案(ADMIN、殿主不受限);改派弹层为可搜索的判官名单
- **审批流引擎**:会签、通知、结束节点与声明式条件分支;节点超时与驳回到(回退封顶);审批人预览;模板版本(草稿 / 发布,在途流程钉住版本);编辑器按规范重做
- **朋友圈审核后台**(`/moderation`)的后端与改版:敏感词可改、必须选类别、可从其他文明复制整张词表,举报处置新增「警告作者」,禁言区筛选,官员删帖进回收站;帖子可带图(上传、存储、审核,经 nginx `X-Accel-Redirect` 发出)
- **灵魂端 App**:朋友圈(信息流、发帖、详情、他人主页、关注列表、搜索、本机压缩图片);书信发件箱存本机并按账号隔离;「忘记密码」邮箱验证码两步重设;
  「我的受刑」(本世页分区、站列表、转生页拒绝);欢迎过场与「文明气质」(页头细带、空状态插画、信纸角饰);问一问入口与抽屉(09-28,后端 `soul_assist` 同日起)
- **灵魂端受刑计划接口** `/me/sentence-plan/` 与受刑推送;欢迎过场已播记录 `/me/welcomed/`
- **权限**:矩阵部分保存与冲突检测、角色「说明」、复制角色连同字段权限与行级范围、殿主(`MODERATOR`)不得持有审批与用户管理、管理员始终拥有全部权限、回收站恢复与彻底删除仅限 ADMIN、`sync_permissions` 命令
- **处置与界域**:处置期满状态与每日检查,执行即开始服刑;「死亡即行程第一站」与 `backfill_soul_entry_path`;界域容量可改;杜阿特拓扑改为「称心二岔」
- 功过总账四柱与流水;语料页「相关条目」与「被引用」清单
- 认证:登录失败回报剩余次数、保持登录 30 天、官员忘记密码通知殿主;书信发送后端 `txn_id` 去重

### Changed
- 审判队列落判即提交,去掉客户端撤回窗口;快捷键统一为 Design 定的六个键
- 调拨加草稿状态与目标界域,发起调度理由至少 20 字
- 邮箱自助重置密码只对灵魂账号生效,重设成功后作废该账号全部 refresh token
- 埃及文第 9 至 14 节旧词审定落地(按义项替换,封闭词汇门禁同步)

### Fixed
- 测试会话结束前关掉 `database_sync_to_async` 线程的数据库连接(此前 DROP 失败却被降成 warning,真 PostgreSQL 上会留下残留测试库)
- 所有动作都记下审计操作人(单删、归档、批量删此前缺);审计用户在 `finalize_response` 里清掉
- 邮箱重置结束初始密码的生命周期;联系邮箱同步为本世账号的登录邮箱
- App 书信没配置聊天服务时不再每 5 秒重试;忘记密码页的验证码格子、旧错误残留等小问题

---

## [2026-09-17 – 2026-09-20] — 灵魂账号与灵魂端 App、暂居、定时任务、书信、受刑计划、React 19

### Added
- **灵魂账号**(`apps.soul_accounts`):账号链、初始密码三道保护、`/api/v1/me` 与转生申请(含 `current_step` / `can_appeal` / `cooldown_until`,驳回理由单列、申诉保留首次驳回的理由);
  任何登记死亡都开号;灵魂编号、联系方式,审判与处置按世(`cycle`)盖章;官员台新增「待交付初始密码」与「转生申请」页和灵魂详情里的账号区块
- **灵魂端 App**(`mobile/`,Expo SDK 57,作为第三个 workspace):按 Claude Design 设计稿重做界面;`packages/core` 增灵魂端 API 客户端、`soul_app` 文案(三份语言包同键)
- **暂居**:`Soul.home_tenant`;调拨执行改为暂居,暂居地处置执行完毕自动回归原属;灵魂仍有未结案审判时拦下回归并通知两边官员;原属殿对暂居灵魂只读可见(租户隔离的集中例外);可手动结束暂居
- **灵魂端推送**:设备令牌、偏好、事件→推送、Expo;锁屏区分批准 / 驳回,只推结果
- **定时任务**(`apps.scheduler`):注册表、`ScheduledJob` / `TaskRun`、REST API 与 `scheduler.read/manage`、`/scheduler` 页(含 cron 预览、运行历史页签),状态变更走 WebSocket;幂等登记命令 `setup_scheduled_tasks` 取代两个旧命令;失败与丢失的执行记录保留一年
- **书信**(灵魂 ↔ 官员,Matrix / Synapse):Synapse 策略模块与真 Synapse 集成测试、compose 服务与 nginx 反代(对外关掉联邦接口)、会话按一世记账、会话关闭后在 Synapse 上禁言留下的一方、新信推送(锁屏写明谁来信,不带正文);
  官员台殿司收件箱 `/soul-inbox`;`packages/core` 手写最小 Matrix 客户端;任意两个灵魂可私聊,按灵魂编号精确查找
- **朋友圈**(灵魂端)与审核后台:`/api/v1/me/social/`,可见性、审核、举报、禁言;官员 `/moderation` 页
- **受刑计划**(`sentence_plan`):只读 API、存量回填 `backfill_sentence_plans`、推进 `advance` 接到全部调用点、联审重排各站、加减项请求与原审判官决定、重开审判、撤销即赦免;Web 的计划面板与「受刑请求」收件箱
- 联审入席可选被邀文明的神祇,顾问席放开到判官以外的在任神祇
- 备份补上聊天数据(Synapse 库 dump 与数据卷);`synapse-migrate-sqlite-to-pg.sh`

### Changed
- **Web 后台与 `packages/core` 升到 React 19.2.3**,与 mobile 对齐;`useDrawerA11y` 按 React 19 的 `useRef` 签名返回 `RefObject<T | null>`
- 埃及文:修订表落地,第五至七节与「一词一义」「笔误 / 一词多写」「审核域」等多节定稿;Sekhem 只表密码成为门禁
- 菜单可见性跟权限码走;转生申请只允许 `REINCARNATING`;依赖安装改用 npm 11(文档记载)

### Fixed
- 菜单可见性判断排除已软删除的菜单(侧栏曾列出回收站里的菜单);`config/__init__.py` 导入 Celery app,`shared_task` 绑到我们的 app
- App:Android 键盘盖住输入条、iOS 实机上现形的书信缺陷、系统字号变化时重排而不是裁切、推送点击只落地一次

---

## [2026-09-12 – 2026-09-16] — 全量审查的修复、安全与部署收口

### Fixed
- **全量审查条目**(提交里以 `BP` / `FL` / `IS` / `FT` / `BD` 编号):
  - 前端:处置 / 死亡同步等列表只取第一页、同一端点开了两条 socket 致每条实时事件双 toast、菜单筛选前端发 `menu` 而后端读 `menu_id`、通知未读徽章读后端真实未读数、数十个 `t()` / `tf()` key 三份语言包都缺
  - 权限与租户:跨租户开庭与转移守卫是死代码、判决可 `PATCH` 伪造终审、三个工作流 viewset 与 `DispatchRecord` 补行级范围、权限导入校验 body 且整个导入进一个事务、角色改名后矩阵出现假 diff
  - 认证与实时:token 刷新后没有触发 WS 重连、登出不清 `sessionStorage` 的 access token、邮箱唯一性下沉到数据库、密码重置验证码真正发邮件
  - 数据:账本按「世」记账(轮回继承不再被重算抹掉)、日期校验只看本世、执行与转世触发在处置行锁内、`complete_node` / `escalate` 在事务内锁住工作流行
- **安全**:没有 `ENCRYPTION_KEY` 就明文落库(且异常被吞)、`DEBUG` 下不再把 `backend/` 当静态目录交出、限流按客户端 IP 取键与 CSV 公式注入防护、webhook 投递不再跟随重定向、WebSocket 改首帧鉴权(token 不再进 URL)、`/ws/` 访问日志不带 token 并校验 `Origin`、`/health/` 与 `/health/detailed/` 分别处理
- **部署**:基础 compose 不发布端口也不挂宿主源码(dev 走 override)、后端 / 前端各只留一份 Dockerfile 从仓库根构建、开发栈 Postgres 与 Redis 只发布到回环、生产加 `certbot` 续期、备份同时打包 `media` 卷且失败可见、恢复失败时非零退出并整体回滚、过期 JWT 行每天清理、生产日志真 JSON 编码
- 依赖:锁定依赖升级到修复版本,`pip-audit` 对 `requirements.lock` 无已知漏洞
- 门禁:pre-push 的后端门禁永远用一次性 Redis,不再写进共享库;pre-push 在 worktree 里能推、对仓库根文件不再是瞎的;`jest` 的 `rootDir` 提到仓库根,core 覆盖率不再被静默丢弃

### Added
- 自建角色可持有、改名并级联、删进回收站;灵魂详情显示第几世(`cycle` / `life_index` / 继承功过暴露到 API);联审详情页「激活联审」
- 社交头像改为只能上传到本站(`User.avatar`),删除外链头像
- 本地后端门禁改用项目专属 `backend/.venv`(Python 3.11 + `requirements.lock`)

### Removed
- 无入口的 webhook 投递管线与 `WebhookDeliveryLog` 表;无调度者的 `recalculate_soul_ledger_task`;全链路没人读的 `X-Tenant-ID` 头;若干仅测试可达的死代码

---

## [2026-08-30 – 2026-09-11] — 审计收口、前端交互审计、Tailwind 4、`packages/core`、OpenAPI 类型

### Security
- **2026-08-29 审计条目的修复**:降权在已建立的 WebSocket 连接上不生效、停用用户也断得掉 WebSocket;`X-Forwarded-For` 不再被无条件相信(一个头能删审计记录);
  webhook 用真密钥签名、只发订阅事件、不往内网打;`POST /perm/init/` 不再静默撤销授权;密码哈希不再进审计日志;六位验证码不可无限猜;三条创建路径不再写 `tenant=NULL`
- 租户边界:目标租户终于能审批调拨、跨租户判决的当事方不能被 `PATCH` 改写、工作流不能交给别的租户;九个页面路由直接输 URL 能打开的越权修掉;ADMIN-only 子菜单与按钮不再漏给所有角色
- M10 权限缓存跨进程窗口实测后默认改为不缓存;软删除的行不再占唯一键

### Fixed
- 数据正确性:无锁读-改-写丢分数(分数决定灵魂去哪一殿)、两个法官不能同时判同一节点(真 PostgreSQL 上实证)、`escalate` 现在真的推进流程、处置记录不再说「已执行」而灵魂未被处置、终局宇宙观的灵魂不能被手动走回轮回
- 全新 PostgreSQL 空库现在能迁起来(四个迁移);恢复被合并掉的 Pluto,与 Hades 区分
- 前端:多个页面把「请求失败」画成「这里没有东西」;六处失效键打空致实时推送到不了屏幕;希腊灵魂创建不了;第 21 条以后的调拨记录看不见;`prefers-reduced-motion` 被整个应用忽略;Sentry 客户端与服务端此前从未运行,已修
- **交互审计**(2026-09-05):关标签页时判决两头落空、同案能被裁两次、两个标签页争用同一个扣住的判决;手搓弹层补 `dialog` 语义(其一是永久硬删除);折叠侧栏主导航没有可访问名称;纯键盘无法编辑工作流节点;多处截断没有看全的办法
- 其余 LOW / MEDIUM 级条目分批清掉(提交里点名了守卫查错主体的几处)

### Added
- **审批流按结果分流**,画布上画出来的分支不再被丢弃;有分支的图不再渲染成单列;自动布局重排用 GSAP Flip;扣住的判决跨 suspend 持久化
- **`packages/core`**(npm workspaces 的第二个包):2026-09-02 建骨架并带一条会失败的「无 DOM」边界;随后搬进 API 契约与两个 WebSocket 客户端、领域常量与校验、三份语言包、六个 hook;
  平台能力走端口(session / persistent / secure 存储、`onUnauthorized`、`onSessionSuspend` / `onSessionResume`、`notify`),`ToastContext` 的模块单例被 `notify` 端口取代;web 实现在 `frontend/lib/platform/web.ts`
- **OpenAPI schema 成为前端类型来源**:从 schema 生成 API 类型并钉住「生成物 = 这个后端」;补齐 27 个无法内省的 view,门禁改成「一个都不许有」;committed schema 不再编码生成它的数据库引擎
- 动效 token 层;文明标识分出 ink 层(徽章文明名达 AA);四个文明各有自己的底色阶梯(后将颜色 token 从 HSL 迁到 OKLCH,32 张截图逐像素不变)

### Changed
- **`@headlessui` → Base UI 1.7**(确认框改用 `alert-dialog`);**Tailwind 3.4 → 4.3.3**,配置搬进 `@theme`(迁移曾把 450 处语义颜色类打成空操作,随后修好)
- 语言包懒加载;七个模态框迁回 `Button` 与 `Field`;标题层级、`z-index`、区块节奏、面板内边距四组收敛
- 拆最大的两个生产文件,数据与逻辑分开

### Removed
- `RealtimeEventPublisher`(自称 deprecated、零生产调用)

---

## [2026-08-13 – 2026-08-14] — 神话建模收口与质量门

### Added
- 十殿：每一殿获得独立的 realm，不再共用一个（`realms`）
- 玛特的四十二判官入座，埃及审判的判官阵容补全（`actors`）
- 分诊队列（triage queue，设计简报 §4.2）——待审判灵魂的排队与分派入口
- 六道轮回补全，并对 `rebirth_form` 做校验
- 枚举、标识符与缺失值的**统一显示约定**（设计简报 §4.6），配 `IDENTIFIER_POLICY`
  与审计行的登记豁免
- 神话种子改为幂等的 management command；三个文明的席位可重复执行而不重复写入

### Changed
- 种子入口收敛：退役 `populate_chinese_actors`，删除第二份重复的种子数据，
  埃及 bootstrap 不再硬编码
- 十殿归位，希腊阵容补入，北欧线退出（此前 `05_北欧死后世界.md` 只是研究稿）
- 租户 scoping 收敛到**单一 helper**，各处不再各写各的
- CI 两条 workflow 改为手动 dispatch，E2E 并行化

### Fixed
- **`GET /menus/buttons/` 对每个非 ADMIN 角色都 500**——过滤条件引用了 Menu 上
  并不存在的 tenant 字段，必然抛 `FieldError`（五个角色中四个受影响）
- `LETHE` 的存储值写错，realm 与枚举重新绑定（`disposition`）
- nanoid DoS 依赖告警修补，并让审计门禁真正生效
- 共享 data-grid 的徽章底色 tint 上限压到 10%，附契约测试（a11y 对比度）
- 页头与工作流列在 393px 视口下不再溢出
- `LedgerStatsOverview` 数组的可选链补完
- 强调色背景上的按钮链接 hover 时不再变透明

### Removed
- 已死的 disposition execute schema
- 一条过期的 E2E 竞态注释

### Tests
- 前端覆盖率 33% → 51%，门槛同步上调（棘轮）
- E2E 套件重建，使其**能够真正失败**（此前部分断言恒真）
- 四个形同虚设的质量门被改成会实际触发
- 六道与分诊队列的 i18n key 补齐三个语言包

---

## [2026-08-01 – 2026-08-08] — 设计交付期：设计系统、权限强制执行、M15 租户加固

### Added
- **共享 data-grid 组件库**抽取，页面表格统一收敛（此前为手写 table）
- **软删除与回收站**：级联 id 软删除、以归档替代删除、全局回收站页面
  （Stage 4 §4.7），菜单上先落地 delete/restore 模式
- 灵魂详情的**生命周期脊线**——原先分离的审判/处置/轮回三个盒子合并为一条主线
- SETTLED 状态的 ADMIN 专属**受审计更正**通道
- 文明专属"读数"渲染与文明表面色调（每套宇宙论用自己的读法，而非一个带 variant 的组件）
- 死亡后事件告警的 acknowledge / unacknowledge 端点，并记录操作人与时间
- 权限**矩阵**取代按角色逐个挑选的编辑器，替换操作加保护；菜单编辑器的五道可见性门
  变得可读
- 角色带上用户数与乐观锁版本号
- 侧边栏归入六个目录并加面包屑
- 语义调色板重新调校，新增 `accent-ink` 分叉

### Changed
- 权限体系分阶段**开始强制执行 codename**：先 ledger 与 souls，再 judgment /
  disposition / workflow，再 dispatch / reincarnation，最后退役 menus 里硬编码的
  ADMIN 判断；跨租户审判移交 JUDGE
- `karma` 更名为 `ledger`，相关 codename 一并迁移
- MODERATOR 成为领域主管角色，配受审计的应急通道
- API client 全量加类型——过程中查出 12 个运行时 bug
- 最后五张手写表迁移到 DataTable；souls / users / audit 表同步迁移
- `admin/stats` 折叠为 dashboard 的一个 karma tab

### Fixed
- **M15 多租户加固**：四个 CRITICAL Celery 任务做租户隔离；JWT 中与用户不再匹配的
  `tenant_code` 直接拒绝；服务层四处（A1/A2/A4/A5）与 API 层四处（C1/C4/C9/C10）
  租户 scoping 缺口关闭，随后又补上两处遗漏
- 权限层：授权真的授权、撤销真的撤销；按 codename（而非按角色）解析权限清单；
  窄 codename 被宽 action 绕过的三个洞；org 应用的跨租户洞；ADMIT 的 escalate
  授权补回（迁移 0015 本意如此）
- death-sync：有效 API key 终于能到达视图（C11）；`create_time`/`created_at`
  错配导致的 `WebhookViewSet` 故障；用 `DjangoJSONEncoder` 让校验过的日期能存下来
- 前端崩溃与错配一批：跨租户审判列表、组织树不嵌套、死亡同步注册路由与分页、
  用户编辑表单的姓名与租户字段不生效、轮换后的 refresh token 丢失（登出时加入黑名单）
- 工作流：节点审批 404、模板渲染、列表节点数、空模板遮蔽十殿、软删除行泄漏进列表
- dispatch：绕开 approve/reject/execute 的 PATCH 路由关闭；软删除记录泄漏
- 权限缓存不再对已死的 Redis 连接每次 cache miss 都重试
- 浅色模式下五个低于 AA 的状态色调暗；Toast 内联 CSS 的图标徽章 tint 同样压到 10%
- 灵魂：早于公元 1 年的日期可记录；记录级日期 ERROR 在列表页也标出；
  总分不再由四舍五入后的分项相加得出
- karma：衰减锚定到灵魂的死亡时间而非"今天"；结转只在端点计算处算一次
- i18n：`egy` 语言包改回埃及语；日期与状态枚举走当前 locale 渲染

### Removed
- 已死的社交原型代码与重复实现
- 无人渲染的图表组件
- 临时种子账号

---

## [2026-07-30 – 2026-07-31] — 前端稳定化与 i18n / a11y 补齐

### Added
- 95 个缺失的 i18n key，并加上回落到默认 locale 的机制

### Fixed
- `/dispatch`、`/cross-judgments`、`/welcome` 三个页面崩溃
- 分页响应未解包就当数组使用（含菜单按钮与侧边栏）
- 加载态表格行未包在 `tbody` 内
- 状态色与判决色改走语义 token
- 键盘焦点环恢复，纯图标控件补上可访问名称
- 默认 queryset 排除软删除记录（`core`）
- `org` 中无效的 tenant 字段引用

---

## [2026-06-06 – 2026-06-09] — M13 社交与 M14 覆盖率、租户修复

### Added
- **M13 社交功能**：`Post`、`Comment`、`Reaction`、`Follow`、`UserProfile`
  与可见性枚举，含权限、服务层与 API
- WebSocket 基建：鉴权、权限、路由与 ASGI 装配
- EventBus + HandlerRegistry + 通知 consumer + 实时推送
- 前端 WebSocket provider、SocialEventBus、响应式布局与 WS 客户端
- death-sync、dispatch 详情、disposition、tenants 页面与图表
- 英文 README 与语言切换

### Changed
- pytest 配置上移到项目根，支持根级执行
- 前端清理：移除未使用的组件、hooks、contexts，页面组件简化

### Fixed
- 租户隔离：`TenantCreateMixin` 修复与视图层隔离；移除基于 contextvar 的
  queryset 过滤（该路径被调查证伪，见 `docs/tenant-contextvar-investigation.md`）
- postcss XSS 依赖漏洞（npm overrides）
- 缺失的迁移补生成（events、menus、reincarnation、workflow）
- CI：pytest-asyncio 与 `asyncio_mode=auto`；测试发现；E2E 选择器
- 组织级联测试中的软删除断言

### Tests
- dispatch、karma、souls、workflow 的覆盖率测试
- WebSocket、实时总线与工作流事件测试

---

## [2026-05-30 – 2026-06-04] — M8–M12：RC 收口、搜索、死亡同步、WebSocket 架构

### Added
- **M10 搜索与过滤**：基础层，并接入 Actors/Realms、Karma、Workflow/Dispatch
- **M11 死亡同步 API**：基础层、死亡登记 API 与服务、带 HMAC 签名与重试的
  Webhook 系统（Celery）、可靠性层（限流、健康指标）
- **M9 工程质量**：依赖清理与 hook 测试
- 页面级 `error.tsx` 错误边界

### Changed
- DDD 重构分四层推进（Tier 1–4），含 `SoulViewSet` 逻辑抽取与领域 hooks
- `middleware.ts` 移到项目根以适配 Next.js 16
- `@sentry/nextjs` 升到 v10 以适配 Next.js 16

### Fixed
- RC 收口：5 项关键阻塞项，以及反向验证查出的 Critical / High / Medium 问题
- 数据库审计：索引、`CASCADE`→`PROTECT`、`select_related`、N+1
- `source_payload` 加密、原子限流、批量清理、重试内存
- M11 审计：确定性幂等、事务、admin 权限、SSRF
- 软删除一致性（`SoulRecord`、`LoginLog`、`UserNotification`）
- 未认证用户重定向到 `/login` 而非 `/welcome`
- 所有 mutation 补上 `onError`

### Tests
- pytest-cov 配置，覆盖率门槛与分支覆盖
- 审计测试成组补齐（User、Menu、Workflow、Tenant、Notification）
- 并发测试、性能回归测试、E2E 导航与工作流测试
- 组件测试（Modal、Skeleton、RequireButton、PageError、ErrorBoundary）

---

## [2026-05-09 – 2026-05-29] — 安全收口与工程基建

*本段即本文件此前的 `Unreleased` 内容，原样保留，只补上了工作区间。
它对应 `v0.1.0` tag（2026-05-29）之前的一轮工作。*

### Added
- GitHub Actions CI/CD pipeline (backend + frontend + migration check)
- Pre-commit hooks (ruff, prettier, eslint, trailing-whitespace)
- API documentation via DRF Spectacular (Swagger UI at `/api/docs/`)
- Frontend test framework: Jest + React Testing Library (126 tests)
- Semantic color tokens for theme-aware status/karma/verdict colors
- i18n: ~100 new translation keys across en.json and zh-Hans.json
- Data scope architecture design (Snowy analysis) documented for M7

### Fixed
- **CRITICAL**: Toast.tsx XSS vulnerability (innerHTML → textContent)
- **CRITICAL**: admin/stats page missing role guard
- **CRITICAL**: welcome page missing auth check
- **CRITICAL**: UserModal type assertion bypass (as any → proper typing)
- **CRITICAL**: SettingsDrawer CSS injection (hex color validation)
- **HIGH**: NotificationViewSet tenant isolation bypass
- **HIGH**: Password reset code length validation (6-digit enforced)
- **HIGH**: ALLOWED_HOSTS=['*'] → environment-based configuration
- **HIGH**: Registration rate limiting (5/hour via DRF throttle)
- **HIGH**: Empty tenant soul creation prevention
- **HIGH**: Cross-civilization workflow validation
- **HIGH**: SoulEvent `created_at` migration issue (stale column removed)
- Auth token reading: now checks both cookie and sessionStorage
- Events API 500 error (field name mismatch `created_at` → `create_time`)
- 15+ hardcoded Tailwind colors replaced with CSS variables
- 5 files with missing `hsl()` wrapper on CSS variables
- Toast SSR crash protection (document guard)
- localStorage try/catch in SettingsDrawer and AppLayout
- Variable shadowing in dashboard and workflow pages
- Dead component `progress-bar.tsx` removed
- 27+ hardcoded Chinese/English strings replaced with i18n keys

### Changed
- WorkflowEditor: 40+ hardcoded strings → i18n keys
- SoulEditModal: 15+ hardcoded strings → i18n keys
- All CIVILIZATION_LABELS/ROLE_LABELS/NODE_TYPE_LABELS → i18n
- KarmaChart colors: hardcoded hex → CSS variables
- Jest config: testEnvironment `node` → `jsdom`

## [0.1.0] - 2026-05-08

### Added
- Initial release
- Soul lifecycle management (ALIVE → JUDGING → DISPOSED → REINCARNATING)
- Multi-civilization support (Chinese Diyu, European Heaven-Hell, Egyptian Duat)
- Karma system with time-decay formula
- Judgment system with verdicts (PASSED/FAILED/PURGATORY/RETRY)
- Disposition and reincarnation workflows
- Cross-civilization soul dispatch
- Multi-stage approval workflow with ReactFlow visualization
- Role-based access control (RBAC) with menu permissions
- Tenant isolation (3 civilizations)
- Audit logging
- i18n support (zh-Hans, en, egy)
- Dark/light theme with CSS variables
