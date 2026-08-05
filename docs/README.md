# SoulLedger — 文档索引 / Documentation Index

这个目录混了三类东西，混得有点不寻常，所以先说清楚它是怎么分的：

This folder holds three different kinds of material, and the mix is unusual
enough to be worth explaining up front:

1. **神话领域研究（中文）** — 三套死后世界体系的一手整理。这不是背景资料，是领域模型
   的来源。 *Chinese-language research on three afterlife systems. Not background
   colour — this is where the domain model came from.*
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

这些文件在仓库根目录下还有一份按体系分目录的镜像：`地府结构研究/`、`欧洲天堂地狱/`、
`埃及冥界/`。内容相同。
*The same files are mirrored at the repo root, grouped into per-cosmology
directories. The contents are identical.*

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

系统里的 `EUROPEAN` 是把基督教、希腊、北欧三支归为一个租户的结果——这是产品上的取舍，
不是这些体系本身相容。
*`EUROPEAN` in the code groups the Christian, Greek and Norse material into one
tenant. That is a product compromise, not a claim that they are one system.*

### 埃及冥界 / Egyptian Duat

| 文件 | 内容 |
|---|---|
| [01_埃及冥界整体架构.md](01_埃及冥界整体架构.md) | 整体结构 |
| [02_奥西里斯审判详解.md](02_奥西里斯审判详解.md) | 心脏称量、玛特羽毛、42 判官 |
| [03_杜阿特十二门详解.md](03_杜阿特十二门详解.md) | 杜阿特十二门 |

### 研究是怎么进代码的 / Where the research lands in code

这一段是这批文档存在的理由。
*This is why the research folder exists at all.*

- [`backend/apps/ledger/readings.py`](../backend/apps/ledger/readings.py) — 三套宇宙论
  给出三种**结构不同**的读数：中国是可抵消的累积账户，埃及是不可抵消的阈值检验，
  欧洲是罪责与补赎两个互不相关的量（其中补赎明确标为不可得）。模块内的注释直接引用了
  上面这些研究的结论。
- [`backend/apps/ledger/services.py`](../backend/apps/ledger/services.py) — 按文明的
  衰减率；欧洲为 0。
- [`backend/apps/souls/models.py`](../backend/apps/souls/models.py) — `TENANT_CIVILIZATION`，
  租户与宇宙论唯一的映射点。

---

## 2. 工程文档 / Engineering docs

> ⚠️ **本目录大部分内容没有进版本库。** `.gitignore` 里 `/docs/*` 忽略了整个目录，
> 只保留了神话研究、`design-handoff/` 和下面标为「已入库」的少数文件。其余文件只存在
> 于维护者的工作副本里，在 GitHub 上看不到。下表用「仅本地」标出，并且**不加链接**——
> 加了在 GitHub 上就是死链。
>
> *Most of this folder is not in version control. `.gitignore` excludes `/docs/*`,
> keeping only the mythology research, `design-handoff/`, and the few files marked
> "in repo" below. The rest exist only in the maintainer's working copy and are
> invisible on GitHub, so they are listed here without links.*

**长期有效 / Living:**

| 文件 | 状态 | 内容 |
|---|---|---|
| [MILESTONES.md](MILESTONES.md) | 已入库 | 里程碑历史与计划。落后于代码，以 `git log` 为准 |
| [coverage-roadmap.md](coverage-roadmap.md) | 已入库 | 测试覆盖率工作计划 |
| [claude-reference.md](claude-reference.md) | 已入库 | 本仓库的 Claude Code 参考（由 `../CLAUDE.md` 按需加载） |
| `ARCHITECTURE.md` | 仅本地 | 架构概览 |
| `CONVENTIONS.md` | 仅本地 | 前后端编码规约 |
| `API.md` | 仅本地 | API 手写索引。**权威来源是运行中的 `/api/docs/`（drf-spectacular）** |
| `TECHNICAL_DOCS.md` | 仅本地 | 权限系统与项目结构说明 |

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

仅本地 / *local only*：`BACKEND_CODE_REVIEW_20260529.md`、
`FRONTEND_CODE_REVIEW_20260528.md`、`code-review-backend.md`、
`code-review-frontend.md`、`post-coverage-audit-report.md`、`MILESTONE_M7.md`、
`MILESTONE_M8.md`、`MILESTONE_M15.md`、`M7_用户组织架构重构.md`、`ROADMAP_V2.md`、
`v2-plan-analysis.md`、`snowy-analysis.md`（菜单/权限设计的参考来源）、
`DEBATE_RESULTS.md`、`REVIEW_RESULTS.md`、`LESSONS_LEARNED.md`

`archive/` 下是更早的记录，`backend/docs/` 下是后端自己的文档（权限矩阵与审计报告）。
两者都被 ignore 规则排除在版本库之外，只存在于工作副本里。

---

## 3. 设计交付包 / Design handoff

[`design-handoff/`](design-handoff/) 是 2026 年 8 月发给外部设计师的完整简报包：

- [`BRIEF.md`](design-handoff/BRIEF.md) — 产品说明、灵魂生命周期、逐屏讲解
- [`ADDENDUM.md`](design-handoff/ADDENDUM.md) — 打包**之后**发生的变化。最重要的一条是
  三种文明现在在数据层就不同了（见 `readings.py`），因此需要三种不同的呈现，而不是一个
  带 variant 的组件。**必须与 BRIEF 一起读。**
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
