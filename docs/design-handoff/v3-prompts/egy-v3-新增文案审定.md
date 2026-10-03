# 埃及语 v3 新增 / 改动文案 · 待审（2026-10-02）

请接在「egy 旧词审定 · 277.md」后面，新开一节「第三节 · v3 新增文案」。

- **范围**：`feat/v3-modern` 相对 `main`（`7e139aa4`）在 `packages/core/messages/egy.json` 里新增的 49 条和改动的 1 条，由脚本从 git 逐条比对得出，不是手抄。
- **约束**：这些全部只用已定稿的词根拼成；仓库里的词表守卫（`egyLexiconRules`）确认没有生词（`lexicon:false` 为 0）。所以要审的是**拼法与语义是否贴切**，不是有没有新造词。
- **还在做的分支**（App 调色板、身份带、控件尺寸）合入后如有新增，会再补一节。
- 第二节（`error.title` / `error.retry` / `permission.go_back`）Design 已审过，存档在 `egy-277-v3-addendum.md`；其中 `Khet` 是否足以表达「返回上一页」，仍需懂埃及语的人最后确认。

**审定方式**：每条在最后加一列「意见」：同意 / 改为 ×× / 存疑（说明）。

### `nav`（1 条）

| 键 | 中文 | English | egy | 旧 egy |
|---|---|---|---|---|
| `nav.collapse_locked` | 窗口宽度不足 1200 像素,导航固定收起 | Navigation stays collapsed below a 1200 px window width | Khetem Menu · 1200 | —（新增） |

### `souls.detail`（6 条）

| 键 | 中文 | English | egy | 旧 egy |
|---|---|---|---|---|
| `souls.detail.profile.birth_name` | 本名 | Birth name | Ren En Mesut | —（新增） |
| `souls.detail.profile.description` | 生平描述 | Life summary | Medu Ankh | —（新增） |
| `souls.detail.profile.eyebrow` | 灵魂 | Soul | Ba | —（新增） |
| `souls.detail.profile.ledger_tabs` | 卷宗 | Records | Sesh | —（新增） |
| `souls.detail.profile.tab_judgments` | 全部审判 | All judgments | Wedja Neb | —（新增） |
| `souls.detail.profile.tab_records` | 全部功过记录 | All merit and demerit records | Sesh Nefer Isfet Neb | —（新增） |

### `judgment.desk`（20 条）

| 键 | 中文 | English | egy | 旧 egy |
|---|---|---|---|---|
| `judgment.desk.back_to_check` | 返回检查 | Back to review | Iyi Er Sia | —（新增） |
| `judgment.desk.back_to_focus` | 返回聚焦 | Back to focus | Iyi Er Wedja | —（新增） |
| `judgment.desk.case_nav` | 案卷导航 | Case navigation | Wat Sesh En Sep | —（新增） |
| `judgment.desk.confirm_body` | 你选择了「{{verdict}}」。落判后写入审判记录,不可撤回。 | You chose “{{verdict}}”. Once ruled it goes on the record and cannot be withdrawn. | Setep Seth: {{verdict}}. Wedja Em Sesh, Nen Iyi. | —（新增） |
| `judgment.desk.confirm_title` | 确认落判 | Confirm the ruling | Sesen Wedja | —（新增） |
| `judgment.desk.current_ruling` | 当前这一判 | Current ruling | Wedja Em Tepy | —（新增） |
| `judgment.desk.done` | 完成 | Done | Kheper Seth | —（新增） |
| `judgment.desk.draft_conflict` | 草稿冲突待处理 | Draft conflict to resolve | Sesh Tepy Nen Sesen | —（新增） |
| `judgment.desk.draft_unsaved` | 有未保存的改动 | Unsaved changes | Medu Seth Nen Sau | —（新增） |
| `judgment.desk.full_case` | 展开全案 | Full case | Sesh En Sep Neb | —（新增） |
| `judgment.desk.irreversible` | 落判不可撤回 | A ruling cannot be withdrawn | Wedja Nen Iyi | —（新增） |
| `judgment.desk.materials` | 资料舱 | Case materials | Sesh En Sep | —（新增） |
| `judgment.desk.nav_draft` | 草稿与批注 | Draft and notes | Sesh Tepy Hena Medu Seth | —（新增） |
| `judgment.desk.recorded` | 判决已写入记录。 | The ruling is on the record. | Wedja Em Sesh Seth. | —（新增） |
| `judgment.desk.ruling_hint` | 按数字键 1–4 选择判决,检查完毕后进入盖印确认。 | Press 1–4 to choose a verdict, then go on to the seal. | Setep Wedja Em 1–4 · Em Khet Sesen Khetem | —（新增） |
| `judgment.desk.signing_court` | 签署殿司 | Signed by | Wesekhet Khetem | —（新增） |
| `judgment.desk.stamp` | 盖印并结案 | Seal and conclude | Khetem Wedja | —（新增） |
| `judgment.desk.tab_evidence` | 功过记录 | Merit and demerit | Sesh Nefer Isfet | —（新增） |
| `judgment.desk.tab_law` | 律条引用 | Cited articles | Djed Medu | —（新增） |
| `judgment.desk.to_confirm` | 进入盖印确认 | Go to the seal | Sesen Khetem | —（新增） |

### `judgment.claim`（16 条）

| 键 | 中文 | English | egy | 旧 egy |
|---|---|---|---|---|
| `judgment.claim.col_deferred` | 延后 | Deferred | Sedjer | —（新增） |
| `judgment.claim.col_draft` | 草拟判决 | Draft verdict | Sesh Tepy | —（新增） |
| `judgment.claim.col_kind` | 种类 | Kind | Iru | —（新增） |
| `judgment.claim.deferred_session` | 本次会话 | This sitting | Aq Pen | —（新增） |
| `judgment.claim.done_release` | 已取消认领 | Claim released | Sehen Shesep Seth | —（新增） |
| `judgment.claim.done_restore` | 已将本次会话延后的 {{n}} 件全部放回 | Put {{n}} deferred cases back | Ankh Wehem Seth: Sep {{n}} | —（新增） |
| `judgment.claim.done_session_defer` | 已延后至本次会话末 | Deferred to the end of this sitting | Sedjer Em Hru Pen | —（新增） |
| `judgment.claim.draft_none` | 未拟 | Not drafted | Nen Sesh Tepy | —（新增） |
| `judgment.claim.filter_all` | 全部案卷 | All cases | Sep Neb | —（新增） |
| `judgment.claim.filter_mine` | 我认领的 | Claimed by me | Shesep-I | —（新增） |
| `judgment.claim.key_restore` | 全部放回 | Put all back | Ankh Wehem Neb | —（新增） |
| `judgment.claim.kinds.AMENDMENT` | 加减项 | Amendment | Khemen Sekhet | —（新增） |
| `judgment.claim.kinds.ORIGINAL` | 初审 | Original | Wedja Tepy | —（新增） |
| `judgment.claim.kinds.REOPEN` | 重开 | Reopened | Wedja Wehem | —（新增） |
| `judgment.claim.restore_body` | 本次会话延后的 {{n}} 件回到各自的组里，按原来的次序排。 | The {{n}} cases deferred this sitting return to their groups, in their original order. | {{n}} Sedjer Em Aq Pen: Ankh Wehem Er Sepu | —（新增） |
| `judgment.claim.restore_title` | 全部放回？ | Put all back? | Ankh Wehem Neb? | —（新增） |

### `permission`（1 条）

| 键 | 中文 | English | egy | 旧 egy |
|---|---|---|---|---|
| `permission.go_back` | 返回上一页 | Go back | Khet | —（新增） |

### `soul_app.life`（5 条）

| 键 | 中文 | English | egy | 旧 egy |
|---|---|---|---|---|
| `soul_app.life.balance` | 本世余额 | Balance, this life | Sepy Ankh Pen | —（新增） |
| `soul_app.life.here` | 你现在在哪 | Where you are now | Dy Emu | —（新增） |
| `soul_app.life.ledger` | 本世账目 | This life's ledger | Sesh Ankh Pen | —（新增） |
| `soul_app.life.ledger_hint` | 展开一项查看 | Open an item to read it | Wen Er Maa | —（新增） |
| `soul_app.life.stage` | 本世阶段 {{at}} / {{total}} | Stage {{at}} / {{total}} | Wat {{at}} / {{total}} | —（新增） |

### `error`（1 条）

| 键 | 中文 | English | egy | 旧 egy |
|---|---|---|---|---|
| `error.retry` | 重新载入 | Reload | Wehem Ini | Wehem Iri |
