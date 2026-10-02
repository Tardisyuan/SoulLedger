# egy 第四节 · v3 后续新增文案 + 旧键改写（2026-10-02）

请接在「egy 旧词审定 · 277 · 第三节.md」之后，新开「第四节」。

- **第一部分**：第三节落地（`9f006ce3`）之后，`feat/v3-modern` 上新增或改动的 egy 文案，共 161 条新增、1 条改动，脚本逐条比对生成。全部只用已登记的词根（词表守卫 `lexicon:false` 为 0），要审的是拼法与语义。
- **第二部分**：第三节规则 R6 / R1 涉及的旧键，共 12 处，请给出写法。
- 特别请看：
  - 冥界名 `plaque.realm.*`：欧洲、希腊是用已有词拼的（Duat Europa、Duat Haunebut）。
  - 司名 `plaque.office.court.eu`「米诺斯之庭」：词表没有 Minos，暂用 Wesekhet Europa。
  - 审判方式「魔鬼审判」暂作 `Wedja Isfet`（词表无「魔鬼」）。
  - `breadcrumb.about`「关于」暂作 `Tepy Hena Sesen`——按 R6，Sesen 不该出现在这里，请重定。
- 还在做的分支（页面 v3、App、案号位置等）合入后若有新增，会再补一节。

**审定方式**：每条最后加一列「意见」：同意 / 改为 ×× / 存疑（说明）。

## 一、v3 后续新增 / 改动

### `breadcrumb`（1 条）

| 键 | 中文 | English | egy | 旧 egy |
|---|---|---|---|---|
| `breadcrumb.about` | 关于 | About | Tepy Hena Sesen | —（新增） |

### `common.value`（2 条）

| 键 | 中文 | English | egy | 旧 egy |
|---|---|---|---|---|
| `common.value.case_number_copied` | 案号已复制到剪贴板 | Case number copied to clipboard | Hesb Sep Senn Seth | —（新增） |
| `common.value.copy_case_number` | 复制案号 {{value}} | Copy case number {{value}} | Senn Hesb Sep {{value}} | —（新增） |

### `dashboard`（6 条）

| 键 | 中文 | English | egy | 旧 egy |
|---|---|---|---|---|
| `dashboard.avg_scope` | 全部已入簿灵魂 | All souls in the ledger | Ba Neb | —（新增） |
| `dashboard.bucket_width` | 每格 {{n}} | {{n}} per bar | Hesb {{n}} | —（新增） |
| `dashboard.occupancy` | 占容量 | Of capacity | Hesb Aq | —（新增） |
| `dashboard.tab_ledger` | 账本 | Ledger | Medjat | —（新增） |
| `dashboard.top_realms` | 界域前十 | Top 10 realms | Ahet Tepy | —（新增） |
| `dashboard.vs_last_month` | 较上月 | vs last month | Abed Pehwy | —（新增） |

### `dashboard.todo`（2 条）

| 键 | 中文 | English | egy | 旧 egy |
|---|---|---|---|---|
| `dashboard.todo.sync_ok` | 同步正常 | In sync | Nen Djer | —（新增） |
| `dashboard.todo.unbooked` | 未入簿 | Not entered | Nen Sesh | —（新增） |

### `judgment`（1 条）

| 键 | 中文 | English | egy | 旧 egy |
|---|---|---|---|---|
| `judgment.case_number` | 案号 | Case no. | Hesb Sep | —（新增） |

### `judgment.claim`（3 条）

| 键 | 中文 | English | egy | 旧 egy |
|---|---|---|---|---|
| `judgment.claim.col_cycle_kind` | 世次 / 种类 | Life / kind | Ankh / Iru | —（新增） |
| `judgment.claim.col_merit_demerit` | 功 / 过 | Merit / demerit | Nefer / Isfet | —（新增） |
| `judgment.claim.release` | 取消认领 | Release claim | Sehen Shesep | —（新增） |

### `judgment.corpus`（10 条）

| 键 | 中文 | English | egy | 旧 egy |
|---|---|---|---|---|
| `judgment.corpus.cited_by_unit` | 次被判词引用 | times cited in judgments | Djed Seth | —（新增） |
| `judgment.corpus.effective_from` | 自 {{date}} 起施行 | In force since {{date}} | Em Wenen · {{date}} | —（新增） |
| `judgment.corpus.hit_next` | 下一处 | Next hit | Em Khet | —（新增） |
| `judgment.corpus.hit_prev` | 上一处 | Previous hit | Em Tepy | —（新增） |
| `judgment.corpus.hits_summary` | 子串匹配 · {{c}} 部中 {{n}} 处 | Substring match · {{n}} hits in {{c}} corpora | Gem {{n}} · Sesh {{c}} | —（新增） |
| `judgment.corpus.next_article` | 下一条 | Next | Em Khet | —（新增） |
| `judgment.corpus.prev_article` | 上一条 | Previous | Em Tepy | —（新增） |
| `judgment.corpus.revision` | 第 {{n}} 版 | Revision {{n}} | Hemet-Sesh {{n}} | —（新增） |
| `judgment.corpus.search_paste` | 粘贴引文直达，或输入字词搜索 | Paste a citation to jump, or type words to search | Hehy Hep; Er Djed: Wat-Ha | —（新增） |
| `judgment.corpus.search_paste_short` | 粘贴引文或搜索 | Paste a citation or search | Hehy Hep | —（新增） |

### `judgment.detail`（2 条）

| 键 | 中文 | English | egy | 旧 egy |
|---|---|---|---|---|
| `judgment.detail.current_realm` | 所在界域 | Realm | Ta | —（新增） |
| `judgment.detail.method` | 审判方式 | Method | Iru En Wedja | —（新增） |

### `judgment.methods`（3 条）

| 键 | 中文 | English | egy | 旧 egy |
|---|---|---|---|---|
| `judgment.methods.DIABOLICAL_TRIAL` | 魔鬼审判 | Diabolical trial | Wedja Isfet | —（新增） |
| `judgment.methods.HEART_WEIGHING` | 称心审判 | Heart weighing | Dens Ib | —（新增） |
| `judgment.methods.STANDARD` | 标准审判 | Standard trial | Wedja Tepy | —（新增） |

### `ledger.book`（3 条）

| 键 | 中文 | English | egy | 旧 egy |
|---|---|---|---|---|
| `ledger.book.clause` | 条款 | Clause | Hep | —（新增） |
| `ledger.book.milestone` | 重要节点 | Milestone | Khet Dens | —（新增） |
| `ledger.book.occurrences` | 发生 {{n}} 次 | Occurred {{n}}× | Sep {{n}} | —（新增） |

### `plaque`（17 条）

| 键 | 中文 | English | egy | 旧 egy |
|---|---|---|---|---|
| `plaque.comments` | 评论 {{n}} | {{n}} comments | Wesheb {{n}} | —（新增） |
| `plaque.corpus` | 律条语料 | Statute corpus | Hep Sesh | —（新增） |
| `plaque.corpus_meta` | {{works}} 部 · {{n}} 条 | {{works}} rulebooks · {{n}} articles | Sesh {{works}} · Hep {{n}} | —（新增） |
| `plaque.desk` | 审判台 | Judgment desk | Wedja | —（新增） |
| `plaque.held` | 在押 {{n}} | Held {{n}} | Em Sekhet {{n}} | —（新增） |
| `plaque.permissions` | 权限 | Permissions | Was | —（新增） |
| `plaque.permissions_meta` | {{roles}} 角色 · {{perms}} 项权限 | {{roles}} roles · {{perms}} permissions | Netjeru {{roles}} · Was {{perms}} | —（新增） |
| `plaque.post` | 帖子 | Post | Sesh | —（新增） |
| `plaque.posts` | 发帖 {{n}} | {{n}} posts | Sesh {{n}} | —（新增） |
| `plaque.queue` | 审判队列 | Judgment queue | Sepu Wedja | —（新增） |
| `plaque.realms` | 界域 · {{root}} | Realm · {{root}} | Ta · {{root}} | —（新增） |
| `plaque.social` | 朋友圈 | Circle | Shemsu | —（新增） |
| `plaque.social_meta` | 关注 {{following}} · 粉丝 {{followers}} | Following {{following}} · Followers {{followers}} | Nehes {{following}} · Nehesu {{followers}} | —（新增） |
| `plaque.soul` | 灵魂详情 | Soul | Ba | —（新增） |
| `plaque.step` | 第 {{k}} / {{n}} 步 | Step {{k}} / {{n}} | Wedja {{k}} / {{n}} | —（新增） |
| `plaque.workflow_editor` | 审批流编辑器 | Workflow editor | Khemen Wat Wedja | —（新增） |
| `plaque.workflow_instance` | 审批实例 | Workflow instance | Wat Wedja Em Iri | —（新增） |

### `plaque.office`（7 条）

| 键 | 中文 | English | egy | 旧 egy |
|---|---|---|---|---|
| `plaque.office.court.cn` | 第十殿 | Tenth Court | Zhuanlun Wesekhet | —（新增） |
| `plaque.office.court.eg` | 双真理厅 | Hall of Two Truths | Weret Maaty | —（新增） |
| `plaque.office.court.eu` | 米诺斯之庭 | Court of Minos | Wesekhet Europa | —（新增） |
| `plaque.office.court.gr` | 三判官之庭 | Court of the Three Judges | Wesekhet Wedja 3 | —（新增） |
| `plaque.office.records` | 典籍司 | Office of Records | Per Medjat | —（新增） |
| `plaque.office.rules` | 规制司 | Office of Rules | Wesekhet Hep | —（新增） |
| `plaque.office.trials` | 刑名司 | Office of Trials | Wesekhet Wedja | —（新增） |

### `plaque.realm`（4 条）

| 键 | 中文 | English | egy | 旧 egy |
|---|---|---|---|---|
| `plaque.realm.cn` | 酆都 | Fengdu | Duat Sherer | —（新增） |
| `plaque.realm.eg` | 杜阿特 | Duat | Duat | —（新增） |
| `plaque.realm.eu` | 彼岸 | The Beyond | Duat Europa | —（新增） |
| `plaque.realm.gr` | 哈迪斯 | Hades | Duat Haunebut | —（新增） |

### `realms`（2 条）

| 键 | 中文 | English | egy | 旧 egy |
|---|---|---|---|---|
| `realms.manage_hint` | realms.manage · 容量可就地编辑 | realms.manage · capacity can be edited in place | Hesb Aq Khemen Dy | —（新增） |
| `realms.switch_hint` | 切换只换查看的文明，匾与印仍是你所属的文明 | Switching changes only the civilization you view; the plaque and seal stay yours | Maa Wa · Sepat Nen Khemen | —（新增） |

### `realms.map`（18 条）

| 键 | 中文 | English | egy | 旧 egy |
|---|---|---|---|---|
| `realms.map.fork.FAIL` | ✕ 不过 · 心重于羽 | ✕ Fail · the heart heavier than the feather | ✕ Mut Sen | —（新增） |
| `realms.map.fork.LEFT` | ← 左 · 向下 | ← Left · downward | ← Tartaros | —（新增） |
| `realms.map.fork.PASS` | ✓ 过 · 心轻于羽 | ✓ Pass · the heart lighter than the feather | ✓ Ib Maa | —（新增） |
| `realms.map.fork.RIGHT` | 右 · 向上 → | Right · upward → | Ta Nefer → | —（新增） |
| `realms.map.legend_count` | 数字 = 在押 | number = held | Hesb = Em Sekhet | —（新增） |
| `realms.map.legend_empty` | □ 空 | □ empty | □ Nen | —（新增） |
| `realms.map.legend_held` | ■ 有灵魂 | ■ souls held | ■ Em Sekhet | —（新增） |
| `realms.map.read_only` | 只读示意 | Read-only sketch | Maa Wa · Tut | —（新增） |
| `realms.map.region.INFERNO` | 地狱 · {{n}} 圈，越下越窄 | Inferno · {{n}} circles, narrowing downward | Duat · {{n}} | —（新增） |
| `realms.map.region.PARADISO` | 天堂 · {{n}} 重 | Paradiso · {{n}} spheres | Pet · {{n}} | —（新增） |
| `realms.map.region.PURGATORIO` | 炼狱 · {{n}} 层，越上越窄 | Purgatorio · {{n}} terraces, narrowing upward | Ta Hesmen · {{n}} | —（新增） |
| `realms.map.shape_fork` | 主干后分左右 | A trunk, then left / right | Wat 3 | —（新增） |
| `realms.map.shape_fork_two` | 主干后分过 / 不过 | A trunk, then pass / fail | Wat 2 Em Fai Ib | —（新增） |
| `realms.map.shape_funnel` | 漏斗，按层排 | A funnel, by level | Hesep Neb | —（新增） |
| `realms.map.shape_line` | 一条直线 | A single line | Wat Wa | —（新增） |
| `realms.map.shape_schematic` | 一条线 | A line | Wat Wa | —（新增） |
| `realms.map.terminal` | ≡ 吞噬即终结 | ≡ Devoured: the end | ≡ Mut Sen | —（新增） |
| `realms.map.title` | 路线图 | Route map | Tut Wat | —（新增） |

### `realms.switch`（4 条）

| 键 | 中文 | English | egy | 旧 egy |
|---|---|---|---|---|
| `realms.switch.CHINESE` | 地府 | Diyu | Duat Sherer | —（新增） |
| `realms.switch.EGYPTIAN` | 埃及 | Egypt | Duat Kemet | —（新增） |
| `realms.switch.EUROPEAN` | 欧洲 | Europe | Duat Europa | —（新增） |
| `realms.switch.GREEK` | 希腊 | Greece | Duat Haunebut | —（新增） |

### `realms.table`（4 条）

| 键 | 中文 | English | egy | 旧 egy |
|---|---|---|---|---|
| `realms.table.eternal_yes` | 永恒 | eternal | Djet | Iu |
| `realms.table.keys` | Enter 保存 · Esc 取消 | Enter saves · Esc cancels | Sau · Sehen | —（新增） |
| `realms.table.near` | 将满 | nearly full | Aq | —（新增） |
| `realms.table.near_warning` | 将满：在押 {{held}}，改为 {{cap}} 后占用 {{pct}}%。 | Nearly full: {{held}} held; at {{cap}} it is {{pct}}% occupied. | Aq · Em Sekhet {{held}} / {{cap}} · {{pct}}% | —（新增） |

### `realms.tree`（7 条）

| 键 | 中文 | English | egy | 旧 egy |
|---|---|---|---|---|
| `realms.tree.count` | {{n}} 处 | {{n}} realms | Ta {{n}} | —（新增） |
| `realms.tree.count_editable` | {{n}} 处 · 点容量数字可改 | {{n}} realms · click a capacity to change it | Ta {{n}} · Khemen Hesb Aq | —（新增） |
| `realms.tree.legend_eternal` | ≡ 永恒 = 不出狱、不轮回 | ≡ eternal = no release, no rebirth | ≡ Djet | —（新增） |
| `realms.tree.legend_full` | ■ 满 = 在押 ≥ 容量 | ■ full = held ≥ capacity | ■ Nen Aq = Em Sekhet ≥ Hesb Aq | —（新增） |
| `realms.tree.legend_near` | ◐ 将满 = ≥ 90% | ◐ nearly full = ≥ 90% | ◐ Aq = ≥ 90% | —（新增） |
| `realms.tree.sheet_hint` | 窄屏下点一行，从底部抽屉改容量 | Tap a row to change its capacity | Khemen Hesb Aq | —（新增） |
| `realms.tree.title` | 界域树 | Realm tree | Ta Neb | —（新增） |

### `scheduler.jobs`（1 条）

| 键 | 中文 | English | egy | 旧 egy |
|---|---|---|---|---|
| `scheduler.jobs.ledger_snapshot_balance_for_tenant` | 记余额月快照 | Snapshot monthly balances | Sesh Hesb Abed | —（新增） |

### `social`（2 条）

| 键 | 中文 | English | egy | 旧 egy |
|---|---|---|---|---|
| `social.back_to_feed` | 返回动态 | Back to feed | Wehem Er Medew Sesh | —（新增） |
| `social.compose` | 发帖 | New post | Iri Sesh | —（新增） |

### `social.lamp`（3 条）

| 键 | 中文 | English | egy | 旧 egy |
|---|---|---|---|---|
| `social.lamp.light` | 点长明灯 | Light the lamp | Wen Khabes | —（新增） |
| `social.lamp.lit` | 长明灯已点 | Lamp lit | Khabes Wen Seth | —（新增） |
| `social.lamp.lit_short` | 已点 | Lit | Wen Seth | —（新增） |

### `social.legend`（2 条）

| 键 | 中文 | English | egy | 旧 egy |
|---|---|---|---|---|
| `social.legend.lamp` | 长明灯最重：单独一格，不与其他四种并排计数 | The eternal lamp weighs most: it stands apart and is not counted beside the other four | Khabes Djet: Aat Wa, Nen Sepu Er Sehed Ky | —（新增） |
| `social.legend.light` | {{list}} 是轻表态，只计总数 | {{list}} are light reactions; only the total is counted | {{list}}: Sepu Neb Wa | —（新增） |

### `social.media`（8 条）

| 键 | 中文 | English | egy | 旧 egy |
|---|---|---|---|---|
| `social.media.add` | 配图 | Add images | Ini Tut | —（新增） |
| `social.media.expired` | 链接已过期 | Link expired | Tut Nen Wenen | —（新增） |
| `social.media.max` | 最多 {{max}} 张 | Up to {{max}} | Tut Er Pehwy {{max}} | —（新增） |
| `social.media.next` | 下一张 | Next image | Tut Ky | —（新增） |
| `social.media.prev` | 上一张 | Previous image | Tut Khet | —（新增） |
| `social.media.refetch` | 重新获取 | Fetch again | Wehem Ini Tut | —（新增） |
| `social.media.refetch_short` | 重取 | Refetch | Wehem Ini | —（新增） |
| `social.media.viewer_hint` | ← → 切换 · Esc 关闭 | ← → to switch · Esc to close | ← → Khemen · Khetem | —（新增） |

### `workflow.detail`（6 条）

| 键 | 中文 | English | egy | 旧 egy |
|---|---|---|---|---|
| `workflow.detail.last_step` | 最近一步 | Latest step | Wedja Pehwy | —（新增） |
| `workflow.detail.not_reached` | 未走 | Not reached | Nen Shem | —（新增） |
| `workflow.detail.row_legend` | 行首竖条 = 待我处理 · 底色 = 当前节点 | Bar = waiting on me · tint = current node | Shesep-I · Nen Iri Djer — Sekhet Tepy | —（新增） |
| `workflow.detail.status` | 状态 | Status | Kheperu | —（新增） |
| `workflow.detail.template` | 模板 | Template | Pet-Sesh | —（新增） |
| `workflow.detail.waiting_on_me` | 待我处理 | Waiting on me | Shesep-I · Nen Iri Djer | —（新增） |

### `workflow.editor`（44 条）

| 键 | 中文 | English | egy | 旧 egy |
|---|---|---|---|---|
| `workflow.editor.condition.and` | 且 | and | Hena | —（新增） |
| `workflow.editor.exit_add` | 加一条条件出口 | Add a conditional exit | Redi Wat Setep | —（新增） |
| `workflow.editor.exit_down` | 下移出口 | Move exit down | Wat Em Khet | —（新增） |
| `workflow.editor.exit_label` | 连线标签 | Edge label | Ren Wat | —（新增） |
| `workflow.editor.exit_target` | 目标 | Target | Setep Seth | —（新增） |
| `workflow.editor.exit_up` | 上移出口 | Move exit up | Wat Em Tepy | —（新增） |
| `workflow.editor.exits_fixed` | 条件只挂在「通过」出口上；「否决」出口另走固定路线。 | Conditions sit on pass exits only; the fail exit keeps its fixed route. | Setep Em Wat Menkh · Wat Khesef Nen Setep | —（新增） |
| `workflow.editor.exits_hint` | 按顺序匹配，首个命中即走；都不中走默认 | Tried in order; the first match is taken, otherwise the default | Hesb · Gem Wa; Nen Gem → Tepy | —（新增） |
| `workflow.editor.exits_none` | 这个节点没有「通过」出口。 | This node has no pass exit. | Nen Wat Menkh | —（新增） |
| `workflow.editor.exits_title` | {{node}} 的出口 | Exits of {{node}} | Wat · {{node}} | —（新增） |
| `workflow.editor.field.approver` | 审批人 | Approver | Netjer Em Wedja | —（新增） |
| `workflow.editor.field.court` | 殿号 | Court | Wesekhet | —（新增） |
| `workflow.editor.field.kind` | 类型 | Kind | Iru | —（新增） |
| `workflow.editor.field.name` | 名称 | Name | Ren | —（新增） |
| `workflow.editor.field.reject_to` | 驳回到 | Reject to | Khesef Er | —（新增） |
| `workflow.editor.field.role` | 角色 | Role | Netjer | —（新增） |
| `workflow.editor.field.signers` | 会签人 | Signers | Netjer Sesen | —（新增） |
| `workflow.editor.field.stage` | 阶段 | Stage | Iru Sekhet | —（新增） |
| `workflow.editor.field.threshold` | 门槛 | Threshold | Sesen Er Hry | —（新增） |
| `workflow.editor.flow_count` | 流程 · {{n}} 节点 | Flow · {{n}} nodes | Wat · Sekhet {{n}} | —（新增） |
| `workflow.editor.glyph_legend` | 左列字形是角色（▷ 入口 · □ 步骤 · ◇ 分支 · ■ 终点），名称前是节点类型 | The left glyph is the role (▷ entry · □ step · ◇ branch · ■ end); the one before the name is the node kind | ▷ Tepy · □ Wedja · ◇ Setep · ■ Pehwy | —（新增） |
| `workflow.editor.issues_blocking` | {{n}} 处问题挡住发布 | {{n}} issues block publishing | Nen Sesh · Maat {{n}} | —（新增） |
| `workflow.editor.issues_checks` | 共 {{total}} 种检查 · {{passed}} 种通过 | {{total}} checks · {{passed}} pass | Maat {{total}} · Menkh {{passed}} | —（新增） |
| `workflow.editor.issues_hint` | 点一条，画布定位到出问题的节点 | Pick one to select its node on the canvas | Setep Wa → Sekhet | —（新增） |
| `workflow.editor.preview_count` | {{nodes}} 节点 · {{edges}} 连线 | {{nodes}} nodes · {{edges}} edges | Sekhet {{nodes}} · Wat {{edges}} | —（新增） |
| `workflow.editor.role_legend.branch` | 分支 · 有条件出口 | Branch · conditional exit | Setep · Wat Setep | —（新增） |
| `workflow.editor.role_legend.end` | 终点 · 无出线 | End · no edge out | Pehwy · Nen Wat | —（新增） |
| `workflow.editor.role_legend.entry` | 入口 · 无入线 | Entry · no edge in | Tepy · Nen Wat | —（新增） |
| `workflow.editor.role_legend.step` | 步骤 | Step | Wedja | —（新增） |
| `workflow.editor.roles_note` | 角色不可拖，只能由连线得出 | Roles cannot be dragged; the edges decide them | Iaut Em Wat · Nen Nehem | —（新增） |
| `workflow.editor.roles_title` | 角色 · 由连线推导 | Roles · read off the edges | Iaut · Em Wat | —（新增） |
| `workflow.editor.signer_add_role` | 按角色添加会签人 | Add a signer by role | Redi Netjer Sesen · Netjer | —（新增） |
| `workflow.editor.signer_placeholder` | 输入姓名后回车 | Type a name, Enter | Ren Netjer Sesen | —（新增） |
| `workflow.editor.signer_remove_named` | 移除 {{name}} | Remove {{name}} | Fekh {{name}} | —（新增） |
| `workflow.editor.tab.exits` | 出口 | Exits | Wat | —（新增） |
| `workflow.editor.tab.issues` | 问题 | Issues | Maat | —（新增） |
| `workflow.editor.tab.node` | 节点 | Node | Sekhet | —（新增） |
| `workflow.editor.tab.version` | 版本 | Version | Hemet-Sesh | —（新增） |
| `workflow.editor.threshold_of` | / {{n}} 人 | of {{n}} | / {{n}} Remetj | —（新增） |
| `workflow.editor.threshold_rule` | {{n}} 人中任 {{k}} 人通过即放行 | Any {{k}} of {{n}} pass it | {{k}} / {{n}} Remetj Sesen: Menkh | —（新增） |
| `workflow.editor.zoom.fit` | 适配画布 | Fit to canvas | Maa Neb | —（新增） |
| `workflow.editor.zoom.in` | 放大 | Zoom in | Maa Aa | —（新增） |
| `workflow.editor.zoom.out` | 缩小 | Zoom out | Maa Nedjes | —（新增） |
| `workflow.editor.zoom.reset` | 缩放到 100% | Zoom to 100% | Maa 100% | —（新增） |

## 二、旧键按第三节规则要改的（R6 / R1）

| 键 | 中文 | English | 现 egy | 规则 |
|---|---|---|---|---|
| `common.confirm_delete` | 确认删除 | Confirm Delete | Sesen Wehem Seth | R6:Sesen 不作「确认」 |
| `common.confirm` | 确认 | Confirm | Sesen | R6:Sesen 不作「确认」 |
| `permissions.confirm_delete_action` | 确认删除 | Confirm Delete | Sesen Seth | R6:Sesen 不作「确认」 |
| `permissions.confirm_delete_role` | 确认删除此角色？ | Delete this role? | Sesen Wehem Netjer? | R6:Sesen 不作「确认」 |
| `permissions.matrix.confirm_submit` | 确认保存 | Confirm save | Sesen Sau | R6:Sesen 不作「确认」 |
| `workflow.verdicts.confirmed` | 确认 | Confirmed | Sesen Seth | R6:Sesen 不作「确认」 |
| `dispatch.confirm_execute` | 确认执行这次调度? | Execute this dispatch? | Sesen Iri Hab-Ba Seth? | R6:Sesen 不作「确认」 |
| `dispatch.confirm_approve` | 确认批准这次跨租户调度? | Approve this cross-tenant dispatch? | Sesen Hab-Ba Taui Ky? | R6:Sesen 不作「确认」 |
| `users.delete_confirm` | 确认删除该用户? | Delete this user? | Sesen Wehem Netjer? | R6:Sesen 不作「确认」 |
| `disposition.confirm_execute` | 确认执行该处置? | Execute this disposition? | Sesen Iri Wetep? | R6:Sesen 不作「确认」 |
| `assist_admin.errors.invalid_confirm_token` | 确认已过期或已用过，请重新开跑。 | The confirmation expired or was used; run again. | Sesen Khetem: Wehem Iri. | R6:Sesen 不作「确认」 |
| `social.back` | 返回 | Back | Khet | R1:返回＝Wehem Er … |
