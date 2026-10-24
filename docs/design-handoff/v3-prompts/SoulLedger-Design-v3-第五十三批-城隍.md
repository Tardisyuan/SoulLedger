# 第五十三批 · 城隍初审(2026-10-24)

## 背景

此前地府的死亡一登记就直接进十殿的审判队列。城隍在系统里只出现在审批模板的一个节点名(「城隍初审」)上,
没有人、没有地界、没有队列。用户定了(只在地府):

- **城隍是登记与拘拿的前站。** 一殿可以有**多位城隍**,各管几处**出身地**(地名,例如「浙江」「杭州」「临安」)。
- 一条死亡登记(官员手登、或外部系统经死亡同步登记)开出审判时,先交给**出身地对应的城隍**做**初审**,
  城隍**解送**之后,案子才进十殿的队列,照常认领、结案。
- 官员可以**分到某位城隍名下**(分工);初审只由名下官员办,殿管理员 / 殿主也能办。
- 后端已上线(见末尾接口);本批要界面。

### 规则(界面要能说清楚的部分)

- **按出身地分**:灵魂档案上的「出身地」(自由文本,如「浙江省杭州市临安县」)里出现了哪位城隍的地名,就归哪位。
  命中好几位时,取**写在最后**的那个(地址从大到小写,最后命中的就是最小一级:县城隍先于府、省城隍)。
  同一殿里一个地名只能属于一位城隍(保存时校验)。
- **兜底城隍**:每殿可以设一位(可不设)。出身地没命中任何一位(包括出身地空着)时交给它。
  **本殿没有兜底时,没命中的案子不经城隍,直接进十殿**(与过去一样)。本殿一位城隍都没设,就和过去完全一样。
- 欧洲、埃及、希腊不经城隍;官员在审判台手开的审判也不经城隍。
- 初审三个动作:
  - **解送**(批语可空):进十殿队列。
  - **退回补正**(批语必填):缺资料(出身地、生辰、死因……),案子留在城隍处,通知本殿管理员;补好之后同一位城隍**解送**。
  - **改交**(只有殿管理员):出身地写错、分错了城隍时改交另一位,状态回到「待初审」。
- 在城隍处(待初审 / 退回补正)的案子:**十殿的队列里看不到**,认领 / 改派 / 暂缓 / 结案都被拒(409 `at_city_god`)。
- **横死(枉死城)不受影响**:解送之后,应死日未到的照样认领不了(`held_until_fated_date`)。

## 要的

### 一、Web(官员)

1. **城隍管理**(殿管理员 / 殿主;其他人只读):本殿城隍列表 —— 名字、管的地名(标签)、是否兜底、名下官员、
   在城隍处的案子数。新建 / 编辑 / 删除:
   - 地名标签输入(回车加一个,重复的自动去掉);地名已被别的城隍占用时的报错要点名是哪位城隍、哪个地名。
   - 「设为本殿兜底城隍」开关;已有兜底时的报错。
   - 名下官员多选(候选 = 本殿能办案的官员,与改派弹层同一份名单规则)。
   - 删除:名下还有没解送的案子时不能删(409 `city_god_has_open_cases`),提示先解送或改交。
   - 一个说明块:「出身地命中多个时取最后写的那个;都不命中交兜底;没有兜底直接进十殿」。
   - 入口放在哪(殿设置 / 组织 / 审判旁),你定。非地府的殿不显示这个入口。
2. **初审队列**:默认「待初审 + 退回补正」;可切「已解送」。可按城隍筛;「只看我的城隍」开关。
   每行:案号、灵魂、出身地(高亮命中的那个地名,若你觉得有必要)、城隍、状态、登记时间、横死标记(有 `held_until` 时)。
   我不能办的行(`can_act=false`)动作置灰并说明「你不在这位城隍名下」。
3. **初审页 / 侧栏**:灵魂的基本资料(姓名、出身地、生卒、阳寿 / 横死)、登记来源;三个动作:
   - 解送:批语(选填,最多 2000 字)+ 确认。
   - 退回补正:批语必填(最多 2000 字),说明「会通知本殿管理员」。
   - 改交(仅管理员):选本殿另一位城隍。
   - 已退回的显示退回批语,动作只剩「解送」(和管理员的「改交」)。
4. **审判台 / 审判队列**:审判详情多了 `city_god`、`city_god_name`、`city_god_status`、`city_god_note`、`sent_on_at`。
   - 已解送的案子在案卷里显示一行「{{城隍}} 初审 · {{时间}} 解送」(+ 批语)。
   - 若官员从别处(例如灵魂详情)打开了一件还在城隍处的审判,认领 / 结案按钮置灰并说明「城隍初审中」。
5. **时间线**:灵魂事件新增三种 —— 城隍收案 / 城隍解送十殿 / 城隍退回补正(归在「生命周期」组,紧跟审判开始)。
   收案事件可能出现两次(改交时),payload 里有 `transferred_from`。
6. **通知**:两种站内通知 —— 「城隍收案待初审」(给这位城隍名下的官员)、「城隍退回补正」(给本殿管理员 / 殿主)。

### 二、官员 App

初审要不要上手机(进「待我处理」成为新的一组、能在手机上解送 / 退回),**还没定**;请给出你的建议和手机版画面,
我们据此决定是否补接口(「待我处理」目前没有这一组)。

### 三、灵魂 App

本批不改。时间线上的三种事件若灵魂端会显示,用 `souls.events.*` 同一套文案(不显示经办官员、不显示批语)。

## 文案

请给 zh-Hans / en / egy(egy 只用词表里已有的词,没有的写进待补)。

**已经在语言包里(后端要求,先放了占位译文,请审定或替换;egy 在 `egyPendingKeys.json` 待补):**

| 键 | zh-Hans 占位 |
|---|---|
| `souls.events.CITY_GOD_RECEIVED` | 城隍收案 |
| `souls.events.CITY_GOD_SENT_ON` | 城隍解送十殿 |
| `souls.events.CITY_GOD_RETURNED` | 城隍退回补正 |
| `official_notify.city_god_case_received.title` / `.body` | 城隍收案待初审 / 灵魂「{{soul}}」的案子已交到{{city_god}},等待初审。 |
| `official_notify.city_god_case_returned.title` / `.body` | 城隍退回补正 / {{city_god}}退回了灵魂「{{soul}}」的案子,需补正资料。经办:{{by}}。批语:{{reason}} |

**本批新增(请给三种语言):**

| 键 | 用途 |
|---|---|
| `cityGods.title` / `cityGods.empty` / `cityGods.explain` | 城隍管理标题 / 空态 / 分案规则说明 |
| `cityGods.name` / `cityGods.regions` / `cityGods.regions_hint` | 名字 / 管的地名 / 输入提示 |
| `cityGods.is_default` / `cityGods.default_badge` / `cityGods.default_hint` | 兜底开关 / 标记 / 「没命中的交给它;不设则直接进十殿」 |
| `cityGods.officers` / `cityGods.officers_hint` | 名下官员 / 候选说明 |
| `cityGods.open_cases` | 「{{count}} 件在初审」 |
| `cityGods.create` / `cityGods.edit` / `cityGods.delete` / `cityGods.delete_confirm` / `cityGods.saved_toast` / `cityGods.deleted_toast` | 增改删 |
| `cityGods.error.region_taken` / `default_taken` / `name_taken` / `invalid_officer` / `city_god_has_open_cases` / `city_gods_diyu_only` | 保存 / 删除被拒 |
| `cityGodCases.title` / `cityGodCases.empty` / `cityGodCases.only_mine` / `cityGodCases.filter_city_god` | 初审队列 |
| `cityGodCases.status.PENDING` / `RETURNED` / `SENT_ON` | 三态:待初审 / 退回补正 / 已解送 |
| `cityGodCases.origin_location` / `cityGodCases.untimely_badge` | 出身地 / 横死标记 |
| `cityGodCases.send_on` / `cityGodCases.send_on_note` / `cityGodCases.sent_on_toast` | 解送 |
| `cityGodCases.return` / `cityGodCases.return_note` / `cityGodCases.return_note_required` / `cityGodCases.return_hint` / `cityGodCases.returned_toast` | 退回补正(「会通知本殿管理员」) |
| `cityGodCases.transfer` / `cityGodCases.transfer_pick` / `cityGodCases.transferred_toast` | 改交 |
| `cityGodCases.cannot_act` | 「你不在这位城隍名下」 |
| `cityGodCases.sent_on_line` | 案卷里的「{{city_god}} 初审 · {{date}} 解送」 |
| `cityGodCases.error.not_at_city_god` / `not_city_god_officer` / `invalid_city_god` / `not_pending` | 动作被拒 |
| `judgment.error.at_city_god` | 审判台:「城隍初审中,解送后才能认领 / 结案」 |

## 接口(已上线)

城隍(本殿;看 `judgment.read`,增改删 `judgment.assign`;只有地府能建):
- `GET /api/v1/judgment/city-gods/` → `[{id, tenant, name, regions[], is_default, officers: [{id, name}], open_case_count, …}]`
- `POST /api/v1/judgment/city-gods/` `{name, regions?, is_default?, officer_ids?}` → 201;非地府 400 `city_gods_diyu_only`
- `PATCH /api/v1/judgment/city-gods/{id}/`(`officer_ids` 是全量替换)
- `DELETE /api/v1/judgment/city-gods/{id}/` → 204;有未解送的案子 409 `city_god_has_open_cases`
- 校验错误是 DRF 的字段错误:`regions` / `is_default` / `name` / `officer_ids`(各自的 `code`:`region_taken` / `default_taken` / `name_taken` / `invalid_officer`)

初审(本殿;看 `judgment.read`,解送 / 退回 `judgment.execute` 且是名下官员或殿管理员,改交 `judgment.assign`):
- `GET /api/v1/judgment/city-god-cases/?status=PENDING|RETURNED|SENT_ON&city_god=<id>&mine=true`
  (不带 status = 待初审 + 退回补正)→ `[{id, case_number, soul, soul_name, origin_location, city_god, city_god_name,
  city_god_status, city_god_note, sent_on_at, sent_on_by_name, untimely, held_until, created_at, can_act}]`
- `POST …/{id}/send_on/` `{note?}`
- `POST …/{id}/return/` `{note}`
- `POST …/{id}/transfer/` `{city_god}`
- 拒绝:403 `not_city_god_officer`,409 `not_at_city_god` / `not_pending`,400 `invalid_city_god`
- 审判的认领 / 改派 / 暂缓 / 结案:409 `at_city_god`(带 `city_god`、`city_god_status`)
