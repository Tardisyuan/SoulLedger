# SoulLedger · 规范 v3 · 给 Design 的 egy 待审词(第三批，2026-10-08)

这一轮新增了四块功能：仪表盘趋势、审计导出、界域说明、功过记录的录入与编辑。新增的 egy 文案都由词表里已有的词组成，词表守卫已通过;但组合是我们自己拼的，请审一遍。另有一条是对第二批答复的回复，见第零节。

规则照旧：
- 只用词表里的词，每个词首字母大写;
- 不用撇号，不用全大写;
- `{{…}}` 原样保留。

## 零、第二批 decide_failed:没照答复写，需要你确认

- 答复给的是 `Wedja Nen Kheper: {{reason}}`,但它违反词表第七节：「失败一律写成 Nen + 动词;Nen Kheper 只许在白名单三键里出现」,守卫报红。
- 我们改成 `Nen Iri Wedja: {{reason}}`(未能做出决定)。这样也避开了与待决定状态 `Nen Wedja Djer` 同开头的问题。
- 是否可以?

## 一、仪表盘趋势(这一块也没有设计稿，见第五节)

| key | 中文 | English | 现用 egy | 备注 |
|---|---|---|---|---|
| dashboard.trends.title | 趋势 | Trends | Khemen Hru | 词表里没有「趋势」 |
| dashboard.trends.range_label | 范围 | Range | Pehwy | |
| dashboard.trends.range_30d | 近 30 天 | Last 30 days | Pehwy Hru 30 | |
| dashboard.trends.range_90d | 近 90 天 | Last 90 days | Pehwy Hru 90 | |
| dashboard.trends.range_12m | 近 12 个月 | Last 12 months | Pehwy Abed 12 | |
| dashboard.trends.by_state | 按状态 | By state | Em Kheperu | |
| dashboard.trends.by_civilization | 按文明 | By civilization | Em Taui | |
| dashboard.trends.error | 趋势加载失败 | Couldn't load the trends | Nen Ini Khemen Hru | |
| dashboard.trends.not_enough | 快照还不足两天；每天夜里记一次，线随后出现。 | Fewer than two days of snapshots… | Nen Hru 2 Djer. Sesh Hru Neb. | 词表里没有「快照」 |
| scheduler.jobs.ledger_snapshot_census_for_tenant | 记灵魂普查日快照 | Snapshot the daily soul census | Sesh Redu Ba Hru Neb | 词表里没有「普查」 |

## 二、审计导出与界域说明

| key | 中文 | English | 现用 egy |
|---|---|---|---|
| audit.export | 导出 | Export | Bek Seth |
| audit.export_failed | 导出失败 | Export failed | Nen Wehem Medew |
| realms.facts.show | 说明 | Details | Medu |
| realms.facts.hide | 收起 | Hide | Imen |
| realms.facts.cycle_limit | 轮回上限 | Rebirth limit | Sep Wehem Mesut Er Pehwy |
| realms.facts.judgment_required | 入界须经审判 | Judgment required before entry | Wedja: Em Tepy |
| realms.facts.judgment_not_required | 入界无需审判 | No judgment needed to enter | Nen Wedja |

请特别看两处：
- `audit.export_failed` 写成「Nen Wehem Medew」,但「导出」写的是「Bek Seth」,两者不对应。
- `realms.facts.judgment_not_required`「Nen Wedja」和待决定、未能决定的开头相近。

## 三、功过记录的录入与编辑

| key | 中文 | English | 现用 egy |
|---|---|---|---|
| ledger.book.form.add_button | 新增一条 | Add an entry | Redi Sep |
| ledger.book.form.add_title | 新增功过记录 | Add a record | Redi Sesh Nefer Hena Isfet |
| ledger.book.form.edit_title | 修改功过记录 | Edit a record | Khemen Sesh Nefer Hena Isfet |
| ledger.book.form.type | 类型 | Type | Iru |
| ledger.book.form.occurrence_count | 发生次数 | Occurrences | Kheper Sep |
| ledger.book.form.life_stage | 人生阶段 | Life stage | Ankh |
| ledger.book.form.statute | 引用律条 | Cited statute | Djed Hep |
| ledger.book.form.statute_none | 不引用 | None | Nen Djed |
| ledger.book.form.clause_none | 不指定条款 | No clause | Nen Djedu |
| ledger.book.form.evidence_source | 证据来源 | Evidence source | Medu Maat |
| ledger.book.form.evidence_note | 来源说明 | Source note | Medu Seth |
| ledger.book.form.count_needs_clause | 填写次数时须同时选择条款 | Choose a clause when giving a count | Setep Djedu Hena Sep Kheper |
| ledger.book.form.clause_needs_count | 选了条款须同时填写次数 | Give a count when a clause is chosen | Sesh Sep Kheper Hena Djedu |
| ledger.book.form.weight_range | 权重须是 1 到 100 的整数 | Weight must be a whole number from 1 to 100 | Aha: 1 Er 100 |
| ledger.book.form.snapshot | 已存入的律条快照 | Stored statute snapshot | Sau Hep |
| ledger.book.form.date_year / month / day | 年 / 月 / 日 | Year / Month / Day | Renpet / Abed / Hru |
| ledger.book.form.err.date_order | 年、月、日须从大到小依次填写 | Fill the year first, then the month, then the day | Sesh Renpet Tepy Abed Hru |
| ledger.book.form.err.date_invalid | 日期不合法，请检查年、月、日(没有 0 年) | Not a valid date… | Nen Maat Hru: Setep Renpet Abed Hru |
| ledger.book.form.err.statute_civ | 该律条不属于这个灵魂的文明 | This statute belongs to another civilization | Hep Pen Nen Em Taui Ba |
| ledger.book.form.err.pair | 次数与条款须同时填写，或同时留空 | Give a count and a clause together, or neither | Sep Kheper Hena Djedu Wa |
| ledger.book.form.err.count_min | 次数须是不小于 1 的整数 | Count must be a whole number, 1 or more | Sep Kheper: 1 Er Neb |
| ledger.book.form.err.unknown_enum | 取值不在可选范围内 | Not one of the allowed values | Nen Setep |
| soul_app.life.basis | 依据 | Basis | Djedu |

请特别看四处：
- 「人生阶段」只写了 Ankh,词表里没有「阶段」。
- 「证据来源」写成 Medu Maat,词表里没有「来源」。
- `err.count_min` 里的「Er Neb」只是近似，不确定能否表达「以上」。
- `err.date_order` 的 egy 没有表达出「依次」。

## 四、第二批仍然悬着的
- 「阶段」「来源」两个词根，见第三节。

## 五、仪表盘趋势面板：请出设计
- 这块没有设计稿。现在是总览页上一张面板：
  - 折线图;
  - 范围切换(30 天 / 90 天 / 12 个月);
  - 维度切换(按状态 / 按文明);
  - 不用文明色，靠线型和墨色字形图例区分;
  - 图例显示每条线的最新值。
- 请给出：
  - 放在哪里、多大(总览页还是账本页，或单独一个页签);
  - 线条样式;
  - 要不要再加一条「按界域」的线(数据已经存了);
  - 图例要不要改为显示这段时间的变化量;
  - 空态(快照不足两天)的写法。
- 尺寸：1440、393 两档，浅色和深色。

请在回复里给出每条的最终 egy 和理由;第五节请附画面。
