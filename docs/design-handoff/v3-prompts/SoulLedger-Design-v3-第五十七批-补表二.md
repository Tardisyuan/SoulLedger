# SoulLedger · 第五十七批 · 补表二(2026-10-29)

接上一份补表。按第五十七批稿实现、以及用户拍板后的几处改动,又多出 **97 条**待补 egy 的键(下表)。

另:上一份 203 条里有 15 条已经不用了,不必给词:`EIGHTEEN_HELLS`, `EVIL_DOG_VILLAGE`, `FENGDU_CITY`, `GHOST_FORT`, `GOLDEN_ROOSTER_HILL`, `HUANHUN_CLIFF`, `LOTUS_TERRACE`, `MIHUN_HALL`, `OFFERING_PAVILION`, `TUDI_TEMPLE`, `WANGXIANG_TERRACE`, `WILD_GHOST_VILLAGE`, `YELLOW_SPRINGS_ROAD`, `judgment.confessions.empty`, `souls.diyu_station.move`。

几点说明:
- 十三站每站一句说明的键是 `souls.diyu_station_desc.<站>`(不是 `souls.diyu_station.desc.*`,那个命名空间是枚举,不能嵌套)。中文取上一份补表第三节,英文按你第八节的原则拟的,请一并复核。
- 土地公用了你建议的 `earthGods.*` 前缀;另有 `captureDue.*`(待发勾魂牒页)。
- 用户拍板后新增的:枉死城申诉上灵魂 App 与时间线(`soul_app.wangsi.*`、`souls.events.WANGSI_GRIEVANCE_*`)、埃及告白「不实」拦通过(`*.untruthful_confession`)、希腊未葬满百年可渡(`souls.ferry_passage.century_passed`)、土地公只挂县城隍(`cityGods.error.*`)。
- 城隍封号已按明制改了(都 承天鉴国司民升福明灵王 / 府 威灵公 / 州 灵佑侯 / 县 显佑伯),`cityGods.rank_titles.*` 的值变了,原来那四条请按新值给词。

| # | 键 | 中文 | English |
|---|---|---|---|
| 1 | `sentence_plan.errors.untruthful_confession` | 有否定告白记为「不实」：不能判通过。可判天平摇摆，另开一次称量。 | A denial in the negative confession was recorded as untrue: the verdict can't be Passed. Let the scale waver to weigh again. |
| 2 | `appeals.error.untruthful_confession` | 原审有否定告白记为「不实」：不能改判通过。 | A denial in the original case's negative confession was recorded as untrue: the amended verdict can't be Passed. |
| 3 | `souls.ferry_passage.century_passed` | 岸边已满百年，可渡 | A hundred years on the bank: may cross |
| 4 | `souls.events.WANGSI_GRIEVANCE_FILED` | 枉死城申诉 | Grievance filed in the City of the Wrongfully Dead |
| 5 | `souls.events.WANGSI_GRIEVANCE_UPHELD` | 申诉属实 · 提前释放 | Grievance upheld · released early |
| 6 | `souls.events.WANGSI_GRIEVANCE_REJECTED` | 申诉不属实 | Grievance not upheld |
| 7 | `cityGods.error.city_god_has_tudi_gods` | {{city_god}}名下有土地公，而土地公的上级只能是县城隍；先把土地公改交别的城隍再改级别 | {{city_god}} has Earth Gods under it, and an Earth God reports only to a county City God; move them to another City God first |
| 8 | `cityGods.error.tudi_city_god_not_county` | 土地公的上级只能是县城隍 | An Earth God reports only to a county City God |
| 9 | `soul_app.wangsi.file` | 申诉 | File a grievance |
| 10 | `soul_app.wangsi.file_title` | 枉死城申诉 | Grievance to the City God |
| 11 | `soul_app.wangsi.held` | 押在枉死城 · 阳寿到 {{date}} 才受审 | Held in the City of the Wrongfully Dead · judged from {{date}} |
| 12 | `soul_app.wangsi.released` | 已出枉死城 | Out of the City of the Wrongfully Dead |
| 13 | `soul_app.wangsi.status.FILED` | 已申诉 · 待城隍核实 | Grievance filed · awaiting the City God |
| 14 | `soul_app.wangsi.status.UPHELD` | 申诉属实 · 已提前释放 | Grievance upheld · released early |
| 15 | `soul_app.wangsi.status.REJECTED` | 申诉不属实 · 照旧押到阳寿那一天 | Grievance not upheld · held until the fated day |
| 16 | `soul_app.wangsi.note_label` | 城隍批语 | The City God's note |
| 17 | `soul_app.wangsi.plea_label` | 冤情 | Your grievance |
| 18 | `soul_app.wangsi.plea_required` | 写下你的冤情 | Write down your grievance |
| 19 | `soul_app.wangsi.file_body` | 城隍会调查核实。冤情重大且属实的，提前出枉死城受审；不属实就照旧押到阳寿那一天，之后可以再提。 | The City God will look into it. A grave grievance that proves true releases you early to be judged; if it is not upheld you stay until your fated day, and may file again. |
| 20 | `soul_app.wangsi.submit` | 提交申诉 | Submit grievance |
| 21 | `soul_app.wangsi.submitted_toast` | 申诉已提交 | Grievance filed |
| 22 | `soul_app.wangsi.errors.not_found` | 找不到这件案子 | This case could not be found |
| 23 | `soul_app.wangsi.errors.not_pending` | 这件案子已经不在审了 | This case is no longer pending |
| 24 | `soul_app.wangsi.errors.not_in_wangsi` | 你已不在枉死城，不用申诉 | You are no longer held in the City of the Wrongfully Dead |
| 25 | `soul_app.wangsi.errors.grievance_open` | 这件案子已经申诉过，等城隍核实 | A grievance on this case is already awaiting the City God |
| 26 | `judgment.offence_field.placeholder` | 未填 · 按严重度选殿 | Not recorded · court by severity |
| 27 | `judgment.offence_field.no_match` | 没有这个罪目 | No such offence |
| 28 | `cityGods.rank_short.PROVINCE` | 都 | Province |
| 29 | `cityGods.rank_short.PREFECTURE` | 府 | Prefecture |
| 30 | `cityGods.rank_short.DEPARTMENT` | 州 | Department |
| 31 | `cityGods.rank_short.COUNTY` | 县 | County |
| 32 | `judgment.offence_field.kings.2` | 楚江王 | Chujiang |
| 33 | `judgment.offence_field.hells.2` | 活大地狱 | Reviving Hell |
| 34 | `judgment.offence_field.kings.3` | 宋帝王 | Songdi |
| 35 | `judgment.offence_field.hells.3` | 黑绳大地狱 | Black Rope Hell |
| 36 | `judgment.offence_field.kings.4` | 五官王 | Wuguan |
| 37 | `judgment.offence_field.hells.4` | 合大地狱 | Crushing Hell |
| 38 | `judgment.offence_field.kings.5` | 阎罗王 | Yanluo |
| 39 | `judgment.offence_field.hells.5` | 叫唤大地狱 | Wailing Hell |
| 40 | `judgment.offence_field.kings.6` | 卞城王 | Biancheng |
| 41 | `judgment.offence_field.hells.6` | 大叫唤大地狱 | Great Wailing Hell |
| 42 | `judgment.offence_field.kings.7` | 泰山王 | Taishan |
| 43 | `judgment.offence_field.hells.7` | 热恼大地狱 | Scorching Hell |
| 44 | `judgment.offence_field.kings.8` | 都市王 | Dushi |
| 45 | `judgment.offence_field.hells.8` | 大热恼大地狱 | Great Scorching Hell |
| 46 | `judgment.offence_field.kings.9` | 平等王 | Pingdeng |
| 47 | `judgment.offence_field.hells.9` | 阿鼻大地狱 | Avici Hell |
| 48 | `souls.diyu_station.move_confirm` | 挪站 | Move |
| 49 | `souls.diyu_station.here_mark` | 现在 | now |
| 50 | `souls.diyu_station_desc.TUDI_TEMPLE` | 亡魂先到土地庙报到，由土地公通报城隍、接引上路。 | The soul reports first at the Earth God's temple; the Earth God tells the City God and sends it on its way. |
| 51 | `souls.diyu_station_desc.YELLOW_SPRINGS_ROAD` | 通往阴间的必经之路。 | The road every soul must take to the underworld. |
| 52 | `souls.diyu_station_desc.WANGXIANG_TERRACE` | 回望人间、最后一眼看家乡的地方。 | Where the soul looks back on the world of the living and sees home one last time. |
| 53 | `souls.diyu_station_desc.EVIL_DOG_VILLAGE` | 生前作恶者在此受恶狗拦咬。 | Here dogs bar the way and bite those who did evil in life. |
| 54 | `souls.diyu_station_desc.GOLDEN_ROOSTER_HILL` | 生前造业者在此受考验。 | Here those who made bad karma in life are tested. |
| 55 | `souls.diyu_station_desc.WILD_GHOST_VILLAGE` | 孤魂野鬼聚集之处。 | Where lonely and wandering ghosts gather. |
| 56 | `souls.diyu_station_desc.MIHUN_HALL` | 饮迷魂水，清醒头脑。 | The soul drinks the water of bewilderment, and its mind is cleared. |
| 57 | `souls.diyu_station_desc.OFFERING_PAVILION` | 领取阳间亲人烧来的纸钱供养。 | Where the soul receives the paper money its family burns for it above. |
| 58 | `souls.diyu_station_desc.GHOST_FORT` | 无处可去的孤魂暂时栖身。 | A shelter for lonely souls with nowhere else to go. |
| 59 | `souls.diyu_station_desc.FENGDU_CITY` | 进入酆都城，正式归地府管辖，候十殿审判。 | The soul enters the City of Fengdu, comes under the underworld's rule, and awaits the Ten Courts. |
| 60 | `souls.diyu_station_desc.EIGHTEEN_HELLS` | 判有罪者在此受刑。 | Where those found guilty are punished. |
| 61 | `souls.diyu_station_desc.LOTUS_TERRACE` | 受度化，超拔出离苦海。 | Where the soul is delivered and lifted out of the sea of suffering. |
| 62 | `souls.diyu_station_desc.HUANHUN_CLIFF` | 饮孟婆汤后，投胎前的最后一关。 | The last pass before rebirth, after drinking Mengpo's soup. |
| 63 | `reincarnation.next_continent_unset` | 不指定 | Not specified |
| 64 | `souls.capture.due_on` | 阳寿已到 · {{date}} | Fated date reached · {{date}} |
| 65 | `souls.capture.cancel_open` | 撤销… | Cancel… |
| 66 | `souls.capture.hand_over_city_god` | 交接城隍 | Hand over to the City God |
| 67 | `souls.capture.handed_line` | {{date}} 交{{city_god}} | Handed to {{city_god}} on {{date}} |
| 68 | `souls.capture.cancelled_line` | 已撤销 · {{reason}} | Cancelled · {{reason}} |
| 69 | `captureDue.title` | 待发勾魂牒 | Awaiting a capture warrant |
| 70 | `captureDue.scope` | 阳寿已到 · 全殿 | Fated date reached · whole hall |
| 71 | `captureDue.soul` | 灵魂 | Soul |
| 72 | `captureDue.origin` | 籍贯 | Origin |
| 73 | `captureDue.fated` | 阳寿 | Fated date |
| 74 | `captureDue.escort` | 建议鬼差 | Suggested escort |
| 75 | `captureDue.issue` | 发牒 | Issue |
| 76 | `captureDue.empty` | 没有阳寿已到、待发勾魂牒的灵魂 | No soul has reached its fated date without a warrant |
| 77 | `earthGods.officers` | 名下官员 | Officers |
| 78 | `earthGods.no_officers` | 没有名下官员 | No officers |
| 79 | `earthGods.officers_hint` | 名下官员与殿管理员能以这位土地公的名义登记死亡。 | This Earth God's officers, and hall administrators, can record a death in its name. |
| 80 | `earthGods.edit` | 编辑 | Edit |
| 81 | `earthGods.delete` | 删除 | Delete |
| 82 | `earthGods.delete_confirm` | 删除{{name}}？他登记过的死亡照旧留着。 | Delete {{name}}? The deaths it recorded stay. |
| 83 | `earthGods.saved_toast` | 土地公已保存 | Earth God saved |
| 84 | `earthGods.deleted_toast` | 土地公已删除 | Earth God deleted |
| 85 | `earthGods.empty` | 还没有土地公 | No Earth Gods yet |
| 86 | `earthGods.row_actions` | {{name}} 的操作 | Actions for {{name}} |
| 87 | `earthGods.soul` | 灵魂 | Soul |
| 88 | `earthGods.death_date` | 死亡日期 | Date of death |
| 89 | `earthGods.death_location` | 死于何处 | Place of death |
| 90 | `earthGods.registered_toast` | 已登记{{name}}的死亡 | Death of {{name}} recorded |
| 91 | `earthGods.register_failed` | 没有登记成功：{{reason}} | Not recorded: {{reason}} |
| 92 | `earthGods.error.name_taken` | 本殿已有同名的土地公 | This hall already has an Earth God by that name |
| 93 | `earthGods.error.invalid_city_god` | 上级城隍须是本殿的城隍 | The City God above must be one of this hall's |
| 94 | `earthGods.error.invalid_officer` | 有官员不能办这类案子 | Some officers can't take these cases |
| 95 | `earthGods.error.not_tudi_officer` | 只有这位土地公的名下官员或殿管理员能登记 | Only this Earth God's officers, or a hall administrator, can record it |
| 96 | `earthGods.error.tudi_gods_diyu_only` | 只有地府的殿能设土地公 | Only halls of the Chinese Diyu can have Earth Gods |
| 97 | `earthGods.register_submit` | 登记死亡 | Record the death |
