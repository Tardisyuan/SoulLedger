# 功过总账四柱、界域与四种行程形状、律条语料阅读页 — 云端报告

分支 `feat/web-ledger-realms-corpus`,自 `main` `638929e` 起。
设计参考:`design/refs-2026-09` 的 `web-third/…B_-_功过总账_-_界域_-_律条语料.dc.html`、`web-ledger/spec.txt`。

> 「规则 16」不在 `web-ledger/spec.txt` 里(那份表只到 14),在
> `web-third/SoulLedger_规范_v1_-_账簿_×_卷宗.dc.html`:
> 「后端补齐 judgment.realm_id 与 soul.path[] 后,四种形状同时上线;在此之前四文明都画『一条线 · 示意』」。
> 任务说明里的「只有有记录的站画成已行」按字面实现(见下)。

截图在 `cloud-reports/web-ledger-realms-corpus/`(`*-desktop.png` 为 Playwright chromium 默认 1280×720 视口,`*-393.png` 为 mobile-chrome;数据是 E2E ApiMock 的夹具,不是真库)。

## 后端(新增两个只读接口)

| 接口 | 做什么 | 为什么需要 |
|---|---|---|
| `GET /api/v1/ledger/journal/?month=YYYY-MM[&page][&civilization][&category]` | 四柱(旧管 / 新收 / 开除 / 实在)、本期按类目的功 / 过合计、本期流水一页(20 条,新→旧,每行带 UTC `day`) | 原有接口没有跨灵魂的流水,也没有「某月之前」的累计 —— 四柱算不出来 |
| `GET /api/v1/realms/occupancy/` | `[{realm_id, count}]`:未离开(`left_at` 为空)的行程站按界域计数 | 树表的「在押」没有任何接口给 |

- 口径:四柱是 MERIT / DEMERIT 的**登记原值**(`weight`)之和,不是衰减后的 `karmic_balance`(后者按文明衰减、按世分段,混用会得到一张不平的账)。页面副题写明「按登记原值计,不计衰减」。JUDGMENT / DISPOSITION 证据行不计。月份边界与 `day` 都按 `settings.TIME_ZONE`(UTC)切,前端按 `day` 分组,所以日小计之和与本期一致。
- 划界:两者都走 `scope_to_tenant`(ADMIN 跨租户);排除已删灵魂;权限 `ledger.read` / `realms.read`。
- 参数错误(月份格式、页码、未知类目)→ 400,body 指明字段。
- 测试:`tests/test_ledger_journal.py`(17)+ `tests/test_realm_occupancy.py`(3)。**变异验证**:去掉 `scope_to_tenant` 与已删过滤后 3 条变红,还原后全绿。
- `openapi/schema.yml` 与 `generated/schema.ts` 已重新生成。无迁移。

## 逐页:做了 / 没做

### /ledger 功过总账 —— 做了
- 四柱 `旧管 + 新收 − 开除 = 实在`,可切月(‹ › 与原生月份框),实在下双线;下接公式行「· N 户 · 本期 N 条」。
- 流水按日分组:日头一行单线小计;页末「本页合计 · N 条」双线;393 下每条两行(灵魂 + 金额 / 条目 + 依据)。
- 整行可点:一条 `Link` 用 `::after` 盖住整行,指向 `/souls/{id}#soul-karma`(详情页「乙 · 功过」标题加了这个锚点)。依据缺失时是 `<MissingValue>`,不是空白。
- 图例账:复用 `LegendLedger`,每个类目的功、过各一行。
- 文明 / 类目筛选同时作用于四柱与流水(同一次查询),账始终是平的。加载骨架 / 空月(写明「旧管 = 实在」)/ 失败 + 重试 三屏。

**没做**:设计稿上的「灵魂姓名或 ID」检索框与「导出」按钮(接口里没有,要另加)。
**替换说明**:/ledger 原来是「功德统计」(状态分布、业力分桶、各界域人数、最近活动,来自 `statsOverview`)。按设计稿换成总账;那些读数在仪表盘上各有位置。欢迎页快捷入口的文字仍是 `ledger.title`「功德统计」,未改(改它会动 egy 修订表钉住的值)。

### /realms 界域 —— 做了
- ■●▲◆ 文明切换(`aria-pressed`,文明靠形状标记与名字区分,不用颜色)。
- 左:`RouteTopology mode="map"`,有在押的站填墨,站旁写在押数;不在形状上的界域写「N 个界域在此图上没有位置,见树表」。
- 右:TreeRow 树表(按 `parent_realm` 缩进、防环)——名称 / 编号 / 类型(`kind` 殿门层道,否则 realm_type 徽章)/ 在押 / 容量 / 永恒。满额(在押 ≥ 容量)用 `--color-warning` **并**写「已满」;容量为 null 是「未记录」。在押接口失败时写 `<MissingValue>`,不写 0。
- 杜阿特:种子里 `hour` 每一行都是 null(`REALM_TOPOLOGY` 注释:十二时是拉的夜行,不是亡者的路),所以画「一线 · 示意」。
- 没有界域的文明写「此文明尚未配置界域」。

**没做:编辑。** `RealmViewSet` 是 `ReadOnlyModelViewSet`,没有一条写入路由;按「只经由已有的界域接口编辑」,页面不提供编辑控件,并在表下写明原因。「+ 新增界域」「从模板导入」同理。
页面标题沿用已有键(「地域」/ 面包屑「领域管理」),没有改成设计稿的「界域」。

### 四种形状(共用组件 `src/components/realms/RouteTopology.tsx` + 纯布局 `src/lib/routeTopology.ts`)
| 文明 | 形状 | 用的字段 | 今天的种子能画吗 |
|---|---|---|---|
| 地府 | 一线 | `order`(殿号 1–10) | 能 —— 十殿 |
| 神曲 | 漏斗 | `region` + `level`;地狱篇下行渐窄,炼狱篇山顶在上(倒漏斗) | 能 —— 九圈、七台阶 + 地上乐园 |
| 杜阿特 | 十二时之河 | `hour`,`is_judgment_hall` 加粗 | **不能**:`hour` 全为 null → 示意线 |
| 冥府 | 三岔 | `fork`;无 fork 的为主干 | 能 —— 左塔尔塔罗斯 / 右至福岛;中路没有任何行(后端刻意不设),所以只画两路 |

- 同一套图例 `━ 已行 ┅ 待行 ▪ 现在 □ 站`,线型之外每站另有 sr-only 状态字。
- **规则 16**:站的状态只从 `soul.path` 来 —— `left_at` 有值 = 已行,为空 = 现在,其余一律待行,**包括序号在「现在」之前但 path 里没有记录的殿**;两端都有记录的段才画实线。不在形状上的已行站(如 待审所)画成 ↳ 分支。
- 形状字段缺失 → 一条线并标「示意」:界域页画该文明全部界域;详情页画这个灵魂 path 本身。
- 详情页行程条(`SoulLedgerProgress`)改为 realms 列表 + `GET /souls/{id}/path/`,两份数据各自加载 / 报错。

### /corpus 律条语料 —— 做了
- 三栏:目录(每部一组,当前一部展开,功過格按門分小标题)/ 阅读栏 `max-w-[72ch]` / 右栏;393 下目录收成一个 `<select>`。
- 衬线只给原文与今译(测试钉住阅读栏恰好两段 `.font-serif`);节号等宽;编者注、出处、元数据无衬线。
- **原文取哪一列**:库里只有《功過格》按原语转录(`text_zh` 即道藏原文),所以原文 = `text_zh`、今译 = 英译;其余五部的原语没入库、`text_*` 都是译文,原文写「未记录 · 只转录了译文,未存原语原文」,今译 = `display_text`。不拿译文冒充原文。
- 检索:标题 / 正文 / code 命中,`<mark>` 底色 + 2 px 强调下线,不改字重;无命中给「清除检索」。
- 编号直达:与某条的节号或 code 逐字相等(忽略空白、「·」、大小写)即打开 —— `IX · XXVI`、`§ 27 / 42`、`614b`、`救濟門 · 六` 都测了。
- 全部条目通过已有的 `GET /judgment/statutes/` 逐页取(新 hook `useAllStatutes`)。

**缺口(未伪造)**:
- 被引用:只有件数(`citation_count`,0 与 null 区分);「哪些判决引用了它」没有接口(`JudgmentFilter` 不能按律条筛),页面写明只有件数、没有清单。
- 版本:律条没有版本模型(更正走 `seed_mythology --update` 就地改写),版本栏写明缺口,不造 v1/v2。
- 「插入审判台」按钮、「相关条目」未做(没有关系数据)。

## i18n
三份语言包各新增 75 个键(`ledger.journal.*`、`realms.topology.*`、`realms.table.*`、`realms.kind.*`、`judgment.corpus.*` 若干)。egy 只用已有词形:`EGY_VOCAB_WRITE=1` 重生成后 `egyVocabulary.json` 只有 49 个词的次数变化,**没有新词形**;`egyLexiconRules` 21/21 通过。

## 顺带修掉 / 为此更新的契约测试
- **393 下详情页溢出(本轮引入并修复)**:行程条的 sr-only 状态字是 `position:absolute`,横向滚动框没有 `relative`,于是它们逃出滚动框,把文档撑到 705px —— 表现为 `soul-accounts.spec` 在 mobile-chrome 上弹窗按钮点不中。滚动框加 `relative` 修复;并把 `/souls/:id` 加进 `no-route-overflows-the-document.spec.ts`。**变异验证**:去掉 `relative` 重建后这条红(「文档 705px 宽,视口 393px」),还原后绿。
- `paginatedPagesCanBePaged`:检测器认不出 `{ month, page, …rest }`(page 不在首位)这种写法,是真盲区,已补并加了断言;/corpus 不再请求页码,从「按形状」清单里换成 /ledger。
- `PageShell`:h2 眉题补 `uppercase`;/corpus 声明 `density="document"`;realms 卡片网格的 `<h3>` 随卡片删除,H3 豁免条目删除、`app/` 下限 3→2(写明原因)。
- `domainDisplayContract`:`ENUM_FIELDS` 加 `record_type` / `region` / `fork`;RouteTopology 登记为字符串上下文(两个命名空间回退);撤掉 `IDENTIFIER_POLICY_EXCEPTIONS` 里已不再渲染标识符的旧 ledger 条目;去掉一处手写「—」。
- `truncatedValuesAreRecoverable`:新增截断都带 `title`。
- `suiteShape`:登记 `RealmsPage.test.tsx`、`routeTopology.test.ts`。
- E2E ApiMock:补 `/ledger/journal/`、`/realms/occupancy/`、`/souls/:id/path/`、`/judgment/statutes/`(此前 statutes 落在 `/judgment/:id/` 上,拿到的是一份判决对象),realms 夹具带上拓扑列。

## 门禁(都在最终树上重跑)

| 门禁 | 命令 | 退出码 | 数字 |
|---|---|---|---|
| tsc | `cd frontend && npx tsc --noEmit` | 0 | — |
| lint | `cd frontend && npm run lint` | 0 | 0 warning |
| jest + 覆盖率 | `cd frontend && npm run test:coverage` | 0 | 184 suites / 2995 tests passed;All files 80.04 / 71.57 / 70.4 / 80.96 |
| build | `cd frontend && npm run build` | 0 | — |
| playwright chromium | `npx playwright test --project=chromium` | 0 | 141 passed |
| playwright mobile-chrome | `npx playwright test --project=mobile-chrome` | 0 | 141 passed |
| playwright firefox | — | **未跑** | 云端镜像没有 firefox 浏览器 |
| core typecheck / lint / test | `npm run --workspace packages/core …` | 0 / 0 / 0 | vitest 13 files / 122 tests |
| pytest(SQLite + 一次性 Redis) | 见 CLAUDE.md | 0 | 4830 passed / 25 skipped(46 分钟;覆盖率 93.96%)|
| ruff | `cd backend && .venv/bin/ruff check .` | 0 | — |
| makemigrations --check | | 0 | No changes detected |
| schema 门禁 | `test_committed_schema_matches_the_backend.py`(在 pytest 里)+ core `generatedSchemaIsCurrent` | 见上 | — |

环境说明:仓库钉的 Playwright 1.63 需要 chromium 1243,镜像预装的是 1194;E2E 通过临时 `PLAYWRIGHT_BROWSERS_PATH` 目录(符号链接指向预装的 1194)运行,仓库里没有改动。真 PostgreSQL 路径未跑(云端无 115)。
