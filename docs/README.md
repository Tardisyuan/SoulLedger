# SoulLedger — 文档索引 / Documentation Index

这个目录混了三类东西，混得有点不寻常，所以先说清楚它是怎么分的：

This folder holds three different kinds of material, and the mix is unusual
enough to be worth explaining up front:

1. **神话领域研究（中文）** — 死后世界体系的一手整理，按三个研究小节归档（中国／欧洲／
   埃及），而代码从中长出了**四个**文明——希腊后来从「欧洲」里拆了出去，见下面那一节。
   这不是背景资料，是领域模型的来源。 *Chinese-language research, filed in three sections
   (Chinese / European / Egyptian); the code grew **four** civilizations out of it — Greek
   was later split out of "European." Not background colour: this is where the domain
   model came from.*
2. **工程文档** — 架构、规约、API、里程碑，以及一批带日期的评审与审计报告。
   *Engineering docs plus a set of dated review/audit reports.*
3. **`design-handoff/`** — 交付给外部设计师的设计简报包。
   *A design brief package delivered to an external designer.*

主 README 在上一层：[`../README.md`](../README.md) ／ [`../README.en.md`](../README.en.md)。

---

## 1. 神话领域研究 / Domain research

三套体系各自独立编号，所以本目录里有三个 `01_`、三个 `02_`。按体系读，不要按数字读。
*Each cosmology is numbered independently, so this folder contains three `01_`
files and three `02_` files. Read by system, not by number.*

这些文件在仓库根目录下曾有一份按体系分目录的、逐字节相同的镜像（`地府结构研究/`、
`欧洲天堂地狱/`、`埃及冥界/`）。**2026-08-15 已去重**：那 19 份副本删除，三个目录只
留一份指向本目录的 README。两份手工维护的副本会在第一次更正时分叉，这正是
`docs/lore-verification/verify-egyptian.md` §1.5 提出的问题。
*Those files used to be mirrored byte-for-byte at the repo root, grouped into
per-cosmology directories. **De-duplicated on 2026-08-15**: the 19 copies were
deleted and each directory now holds only a pointer README. Two hand-maintained
copies fork on the first correction — the problem raised in
`docs/lore-verification/verify-egyptian.md` §1.5.*

> **本节所列的神话研究文档在 2026-08-15 做过一次史实校订**，依据是
> [`lore-verification/`](lore-verification/) 的八份核实报告。校订前这批文档零引用，
> 且在若干处**比 seeder 更不可靠**（`docs/09` 把望乡台与孟婆的次序搞反，seeder 是对的）。
> 校订后各文均在正文内标注一手依据与存疑范围；仍标为「存疑」「未取得一手」的地方，
> 请勿当作定论使用，更不要据以 seed 数据。
> *These research documents were fact-checked on 2026-08-15 against the eight
> reports in [`lore-verification/`](lore-verification/). They previously carried
> zero citations and were in places less reliable than the seeder. Passages still
> marked 存疑 / 未取得一手 are open questions, not settled facts — do not seed from
> them.*

### 中国地府 / Chinese Diyu

| 文件 | 内容 |
|---|---|
| [01_地府整体架构.md](01_地府整体架构.md) | 整体结构、神祇层级 |
| [02_地府人物详解.md](02_地府人物详解.md) | 十殿阎王及其属官 |
| [03_人物关系图.md](03_人物关系图.md) | 人物关系 |
| [04_地狱体系详解.md](04_地狱体系详解.md) | 十八层地狱 |
| [05_系统建模建议.md](05_系统建模建议.md) | **研究 → 数据模型的桥**，实体抽象建议 |
| [06_地府十三站详解.md](06_地府十三站详解.md) | 亡魂路径的十三站 |
| [07_六道轮回详解.md](07_六道轮回详解.md) | 六道 |
| [08_城隍体系详解.md](08_城隍体系详解.md) | 城隍的行政层级 |
| [09_忘川河水系与奈何桥.md](09_忘川河水系与奈何桥.md) | 忘川、奈何桥、孟婆 |
| [10_枉死城详解.md](10_枉死城详解.md) | 枉死城 |
| [11_地府审判制度与冥律.md](11_地府审判制度与冥律.md) | 审判制度与冥律 |

### 欧洲天堂地狱 / European afterlives

| 文件 | 内容 |
|---|---|
| [01_欧洲天堂地狱整体架构.md](01_欧洲天堂地狱整体架构.md) | 整体结构 |
| [02_天使九级 hierarchy.md](02_天使九级%20hierarchy.md) | 九级天使 |
| [03_七宗罪与地狱惩罚.md](03_七宗罪与地狱惩罚.md) | 七宗罪与但丁的圈层 |
| [04_希腊冥界详解.md](04_希腊冥界详解.md) | 哈迪斯、塔尔塔罗斯、极乐岛 |
| [05_北欧死后世界.md](05_北欧死后世界.md) | 瓦尔哈拉、海姆冥界、福尔克范格 |

**希腊已经不在这一组里了。** 这一节的分档是研究阶段的分法；代码此后把希腊拆成了第四个
文明——`Civilization.GREEK`，租户 `GR_HADES`，语料是柏拉图的两个神话（《高尔吉亚》12 条 +
《理想国》厄尔 11 条）。所以 `04_希腊冥界详解.md` 虽然仍归档在这一节，它喂的是 `GREEK`
而不是 `EUROPEAN`。`EUROPEAN` 现在是基督教与北欧两支合一个租户，仍是产品上的取舍。
*Greek is no longer in this group.* The filing here is the research-phase split; the
code has since made Greek the fourth civilization — `Civilization.GREEK`, tenant
`GR_HADES`, its corpus Plato's two myths (Gorgias 12 + Republic/Er 11). So
`04_希腊冥界详解.md` still lives in this section but feeds `GREEK`, not `EUROPEAN`.
`EUROPEAN` now groups the Christian and Norse material, and that is still a product
compromise rather than a claim that they are one system.

### 埃及冥界 / Egyptian Duat

| 文件 | 内容 |
|---|---|
| [01_埃及冥界整体架构.md](01_埃及冥界整体架构.md) | 整体结构 |
| [02_奥西里斯审判详解.md](02_奥西里斯审判详解.md) | 心脏称量、玛特羽毛、42 判官 |
| [03_杜阿特十二门详解.md](03_杜阿特十二门详解.md) | 杜阿特十二门 |

### 研究是怎么进代码的 / Where the research lands in code

这一段是这批文档存在的理由。
*This is why the research folder exists at all.*

- [`backend/apps/ledger/readings.py`](../backend/apps/ledger/readings.py) — 四套宇宙论
  给出四种**结构不同**的读数：中国是可抵消的累积账户，埃及是不可抵消的阈值检验，
  欧洲是罪责与补赎两个互不相关的量（其中补赎明确标为不可得），希腊给的是一段程序而不是
  一个量——柏拉图两个神话本身就不一致（盖印即终局 vs 千年循环后重生），所以 23 条条文里
  21 条的极性是 `PROCEDURE`。模块内的注释直接引用了上面这些研究的结论。
- [`backend/apps/ledger/services.py`](../backend/apps/ledger/services.py) — 按文明的
  衰减率；欧洲为 0。
- [`backend/apps/souls/models.py`](../backend/apps/souls/models.py) — `TENANT_CIVILIZATION`，
  租户与宇宙论唯一的映射点。

---

## 2. 工程文档 / Engineering docs

> ℹ️ **本目录下的 Markdown 现在全部进版本库。** 2026-08-14 之前，`.gitignore` 的
> `/docs/*` 把这里大部分文件排除在外，它们只存在于维护者的工作副本里。这造成过实际
> 损害：`MILESTONE_M15.md` 记录了「menu/perm 端点全局共享、不分租户」是**有意设计**，
> 但仓库里的人看不到，于是那个「缺失」的租户过滤被当成 bug 补了回去，导致
> `GET /menus/buttons/` 对每个非 ADMIN 角色都 500（已由 `c2ca5ac` 修复）。
> 现在 `.gitignore` 只继续排除散落在本目录的截图与其他二进制文件。
>
> *All Markdown in this folder is now tracked. Until 2026-08-14 `/docs/*` excluded
> most of it, so conclusions recorded here were invisible to anyone reading the
> repo — which is how a deliberate design decision got "fixed" back into a 500.
> `.gitignore` now only excludes loose screenshots and other binaries here.*

**长期有效 / Living:**

| 文件 | 状态 | 内容 |
|---|---|---|
| [MILESTONES.md](MILESTONES.md) | 已入库 | 里程碑历史与计划。落后于代码，以 `git log` 为准 |
| [coverage-roadmap.md](coverage-roadmap.md) | 已入库 | 测试覆盖率工作计划 |
| [claude-reference.md](claude-reference.md) | 已入库 | 本仓库的 Claude Code 参考（由 `../CLAUDE.md` 按需加载） |
| [ARCHITECTURE.md](ARCHITECTURE.md) | 已入库 | 架构概览 |
| [CONVENTIONS.md](CONVENTIONS.md) | 已入库 | 前后端编码规约 |
| [API.md](API.md) | 已入库 | API 手写索引。**权威来源是运行中的 `/api/docs/`（drf-spectacular）** |
| [TECHNICAL_DOCS.md](TECHNICAL_DOCS.md) | 已入库 | 权限系统与项目结构说明 |

**带日期的报告 / Dated reports** — 这些是某一天的快照，写下之后不再更新。当历史读，
不要当现状读。*Snapshots of one day's state, never updated afterwards. Read them as
history, not as a description of the code today.*

已入库 / *in repo*：
[PRODUCTION_READINESS_REPORT.md](PRODUCTION_READINESS_REPORT.md)、
[RC_READINESS_REPORT_FINAL.md](RC_READINESS_REPORT_FINAL.md)、
[M12_READY_REPORT.md](M12_READY_REPORT.md)、
[ENGINEERING_EXCELLENCE_REPORT.md](ENGINEERING_EXCELLENCE_REPORT.md)、
[SECURITY_CLOSURE_REPORT.md](SECURITY_CLOSURE_REPORT.md)、
[tenant-contextvar-investigation.md](tenant-contextvar-investigation.md)、
[tenant-manager-safety-validation.md](tenant-manager-safety-validation.md)、
[task-292-security-validation.md](task-292-security-validation.md)、
[task-292-implementation-report.md](task-292-implementation-report.md)

同样已入库（2026-08-14 起）/ *also in repo, since 2026-08-14*：
[BACKEND_CODE_REVIEW_20260529.md](BACKEND_CODE_REVIEW_20260529.md)、
[FRONTEND_CODE_REVIEW_20260528.md](FRONTEND_CODE_REVIEW_20260528.md)、
[code-review-backend.md](code-review-backend.md)、
[code-review-frontend.md](code-review-frontend.md)、
[post-coverage-audit-report.md](post-coverage-audit-report.md)、
[MILESTONE_M7.md](MILESTONE_M7.md)、[MILESTONE_M8.md](MILESTONE_M8.md)、
[MILESTONE_M15.md](MILESTONE_M15.md)、
[M7_用户组织架构重构.md](M7_用户组织架构重构.md)、
[v2-plan-analysis.md](v2-plan-analysis.md)、
[snowy-analysis.md](snowy-analysis.md)（菜单/权限设计的参考来源）、
[DEBATE_RESULTS.md](DEBATE_RESULTS.md)、[REVIEW_RESULTS.md](REVIEW_RESULTS.md)、
[LESSONS_LEARNED.md](LESSONS_LEARNED.md)

**`MILESTONE_M15.md` 值得单独一提**：它列出三条被确认为**有意为之**的设计，其中
「menu/perm 端点全局共享、不分租户」这一条正是本目录曾经不入库所付出的代价。

[`archive/`](archive/) 下是已废弃或更早的记录，目前包括
[`ROADMAP_V2.md`](archive/ROADMAP_V2.md)（V2 灵魂客户端 + 转生抢购规划，
2026-08-14 标记 superseded——其前提与本项目「无用户、从未部署」的定位冲突；
其中已交付的死亡同步 API 与 WebSocket 通知见文首说明）与 `memory/` 下的早期记录。

`backend/docs/` 下是后端自己的文档（权限矩阵与审计报告），仍被全局 ignore 规则
排除在版本库之外，只存在于工作副本里。

---

## 3. 设计交付包 / Design handoff

[`design-handoff/`](design-handoff/) 是 2026 年 8 月发给外部设计师的完整简报包：

- [`BRIEF.md`](design-handoff/BRIEF.md) — 产品说明、灵魂生命周期、逐屏讲解
- [`ADDENDUM.md`](design-handoff/ADDENDUM.md) — 打包**之后**发生的变化。最重要的一条是
  四种文明现在在数据层就不同了（见 `readings.py`），因此需要四种不同的呈现，而不是一个
  带 variant 的组件——ADDENDUM §1 写的是三种，§5 补了第四种（希腊）及其第四种读数形状。
  **必须与 BRIEF 一起读。**
- [`screens/`](design-handoff/screens/) — 29 张实际界面全页截图
- [`tokens.md`](design-handoff/tokens.md) / [`tokens.html`](design-handoff/tokens.html) — 设计 token 清单
- [`tables/`](design-handoff/tables/) — 三语（zh-Hans / en / egy）表格样本与字符串导出

> 这个包已经交付并被外部引用，请视为冻结内容——不要重排、重命名或改写其中的文件。
> *This package has been delivered and is referenced externally. Treat it as
> frozen: do not reorganise, rename, or rewrite anything inside it.*

---

## 跨文明概念对照 / Cross-cosmology concept map

这张表是三套研究收敛出来的抽象，也是数据模型的直接依据。
*This table is the abstraction the three research sets converge on, and it maps
directly onto the data model.*

| 跨文明概念 | 中国 | 欧洲 | 埃及 |
|-----------|------|------|------|
| 灵魂存储 | 生死簿 | 生命册（Book of Life） | 心脏记录 |
| 记忆消除 | 孟婆汤 | 忘川河（Lethe） | 芦苇原 |
| 审判核心 | 十殿阎王 | 上帝／末日审判 | 奥西里斯 + 42 判官 |
| 终极惩罚 | 十八层地狱／阿鼻地狱 | 地狱九圈 | 阿米特吞噬 |
| 最终归宿 | 六道轮回 | 天堂／地狱／炼狱 | 芦苇原 |
| 引渡使者 | 黑白无常 | 赫尔墨斯（Hermes） | 阿努比斯 |
| 善恶量具 | 功德积分（善行 − 恶行） | 原罪状态 + 审判 | 心脏重量 vs 玛特羽毛 |

最后一行是整个项目的关键分歧点。三种量具不是同一个数的三种叫法：中国那一套可以相抵，
埃及那一套不能，欧洲那一套根本不是账户。代码不再试图把它们统一成一个「善恶积分通兑」
机制——早期的设计想过，实现时发现那样做会把埃及的灵魂按它自己的传统里没有的机制放行。
处理方式见 [`backend/apps/ledger/readings.py`](../backend/apps/ledger/readings.py)。

*The last row is the project's pivot. These are not three names for one number:
the Chinese instrument nets off, the Egyptian one cannot, and the European one is
not an account at all. An early design proposed a single convertible good/evil
score; implementing it showed that netting passes an Egyptian soul on a mechanic
its tradition does not have. `readings.py` is the resolution.*
