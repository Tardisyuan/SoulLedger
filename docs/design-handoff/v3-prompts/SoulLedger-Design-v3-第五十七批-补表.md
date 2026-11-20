# SoulLedger · 第五十七批 · 补表(2026-10-28)

回复 Design 第五十七批要的三样:203 条待补键的中英原文、城隍各级诸司预设、十三站说明;另附司名、站名、部洲的全表。

另:后续还会多出一批键(枉死申诉上时间线、灵魂 App 提申诉、告白「不实」拦通过、希腊百年可渡、土地公上级限县城隍),那几条做完再单独发一张小表。

## 一、203 条待补键(键 / 中文 / English)

| # | 键 | 中文 | English |
|---|---|---|---|
| 1 | `judgment.offences.ABDUCTION` | 拐骗少年男女 | Abducting young men and women |
| 2 | `judgment.offences.SEIZING_PROPERTY` | 欺占他人财物 | Seizing others' property |
| 3 | `judgment.offences.MAIMING` | 损坏人耳目手足 | Maiming another's eyes, ears, hands or feet |
| 4 | `judgment.offences.DEFYING_ELDERS` | 忤逆尊长 | Defying one's elders |
| 5 | `judgment.offences.INCITING_LITIGATION` | 教唆兴讼 | Inciting litigation |
| 6 | `judgment.offences.BETRAYING_TRUST` | 背恩失节 | Betraying a kindness or trust |
| 7 | `judgment.offences.WITHHOLDING_DUES` | 抗粮赖租 | Withholding grain dues and rent |
| 8 | `judgment.offences.TRADE_FRAUD` | 交易欺诈 | Fraud in trade |
| 9 | `judgment.offences.RESENTMENT` | 怨怼 | Resentment |
| 10 | `judgment.offences.INGRATITUDE` | 忘恩 | Ingratitude |
| 11 | `judgment.offences.ENVY` | 嫉妒 | Envy |
| 12 | `judgment.offences.MISERLINESS` | 悭吝 | Miserliness |
| 13 | `judgment.offences.CURSING_HEAVEN` | 怨天尤地 | Cursing heaven and earth |
| 14 | `judgment.offences.SACRILEGE` | 亵渎神佛 | Sacrilege against gods and buddhas |
| 15 | `judgment.offences.DISRESPECTING_SCRIPT` | 不敬字纸经书 | Disrespect for written paper and scripture |
| 16 | `judgment.offences.BONES_FOR_MEDICINE` | 取骸合药 | Taking bones for medicine |
| 17 | `judgment.offences.SEPARATING_KIN` | 离散骨肉 | Scattering kin |
| 18 | `judgment.offences.NEGLECTING_PARENTS` | 亲存不养 | Not keeping living parents |
| 19 | `judgment.offences.UNBURIED_PARENTS` | 亲殁不葬 | Not burying dead parents |
| 20 | `judgment.offences.MURDER` | 杀人 | Murder |
| 21 | `judgment.offences.ARSON` | 放火 | Arson |
| 22 | `judgment.offences.POISONING` | 制毒 | Making poison |
| 23 | `judgment.offences.FIVE_HEINOUS` | 五逆 | The five heinous crimes |
| 24 | `judgment.offence_field.label` | 罪目 | Offence |
| 25 | `judgment.offence_field.none` | 未填 | Not recorded |
| 26 | `judgment.offence_field.routes_to` | 判有罪时自动送{{court}} | If found guilty, sent to the {{court}} |
| 27 | `judgment.offence_field.fallback` | 未填罪目:判有罪时按严重度选殿 | No offence recorded: if found guilty, the court is chosen by severity |
| 28 | `judgment.wrongful_death_causes.ACCIDENT` | 意外身亡 | Accident |
| 29 | `judgment.wrongful_death_causes.VICTIM` | 刑事被害 | Victim of a crime |
| 30 | `judgment.wrongful_death_causes.SUICIDE` | 自杀 | Suicide |
| 31 | `judgment.wrongful_death_causes.WAR` | 战争死亡 | War |
| 32 | `judgment.wrongful_death_causes.OTHER` | 其他 | Other |
| 33 | `judgment.grievance_levels.NONE` | 无冤情 | No grievance |
| 34 | `judgment.grievance_levels.MINOR` | 轻 | Minor |
| 35 | `judgment.grievance_levels.MAJOR` | 重 | Major |
| 36 | `judgment.grievance_levels.SEVERE` | 极重 | Severe |
| 37 | `judgment.grievance_statuses.FILED` | 已申诉 · 待审 | Filed · awaiting review |
| 38 | `judgment.grievance_statuses.UPHELD` | 属实 · 已提前释放 | Upheld · released early |
| 39 | `judgment.grievance_statuses.REJECTED` | 不属实 | Not upheld |
| 40 | `judgment.wangsi.title` | 枉死城 | City of the Wrongfully Dead |
| 41 | `judgment.wangsi.cause` | 死因 | Cause of death |
| 42 | `judgment.wangsi.level` | 冤情等级 | Grievance |
| 43 | `judgment.wangsi.unset` | 未登记 | Not recorded |
| 44 | `judgment.wangsi.grievance` | 冤情申诉 | Grievance |
| 45 | `judgment.wangsi.plea` | 申诉内容 | The grievance |
| 46 | `judgment.wangsi.plea_hint` | 替亡魂记下申诉的冤情;城隍名下的官员或殿管理员审核。 | Recorded on the soul's behalf; the city god's officers or a hall administrator review it. |
| 47 | `judgment.wangsi.file` | 提出申诉 | File grievance |
| 48 | `judgment.wangsi.decision_note` | 审核意见 | Review note |
| 49 | `judgment.wangsi.uphold` | 属实 · 提前释放 | Upheld · release early |
| 50 | `judgment.wangsi.reject` | 不属实 | Not upheld |
| 51 | `judgment.wangsi.uphold_hint` | 冤情等级为「重」或「极重」时,属实即提前释放。 | With a major or severe grievance, upholding it releases the soul early. |
| 52 | `judgment.wangsi.decided_line` | {{date}} 审结 | Reviewed {{date}} |
| 53 | `judgment.wangsi.error.not_in_wangsi` | 这位亡魂已不在枉死城。 | This soul is no longer held in the City of the Wrongfully Dead. |
| 54 | `judgment.wangsi.error.grievance_open` | 这件案子已有申诉。 | This case already has a grievance. |
| 55 | `judgment.wangsi.error.no_grievance_filed` | 没有待审的申诉。 | No grievance is awaiting review. |
| 56 | `judgment.wangsi.error.grievance_not_major` | 冤情等级须为「重」或「极重」才能提前释放。 | Only a major or severe grievance releases the soul early. |
| 57 | `judgment.wangsi.error.not_city_god_officer` | 只有这位城隍名下的官员或殿管理员能审核。 | Only this city god's officers or a hall administrator can review it. |
| 58 | `judgment.wangsi.error.not_pending` | 这件案子已结案。 | This case is concluded. |
| 59 | `cityGods.rank` | 级别 | Rank |
| 60 | `cityGods.rank_none` | 未定级 | Unranked |
| 61 | `cityGods.ranks.PROVINCE` | 都省城隍 | Provincial city god |
| 62 | `cityGods.ranks.PREFECTURE` | 府城隍 | Prefectural city god |
| 63 | `cityGods.ranks.DEPARTMENT` | 州城隍 | Departmental city god |
| 64 | `cityGods.ranks.COUNTY` | 县城隍 | County city god |
| 65 | `cityGods.rank_titles.PROVINCE` | 威灵公 | Duke Weiling |
| 66 | `cityGods.rank_titles.PREFECTURE` | 绥靖侯 | Marquis Suijing |
| 67 | `cityGods.rank_titles.DEPARTMENT` | 显佑伯 | Earl Xianyou |
| 68 | `cityGods.rank_titles.COUNTY` | 显正伯 | Earl Xianzheng |
| 69 | `cityGods.bureaus_label` | 下属诸司 | Bureaus |
| 70 | `cityGods.bureaus_hint` | 按这位城隍实际设的司勾选。级别越高,诸司通常越齐全。 | Tick the bureaus this city god actually has. Higher ranks usually have more. |
| 71 | `cityGods.bureau_count` | {{count}} 司 | {{count}} bureaus |
| 72 | `cityGods.ministries.HEAD` | 总务 | General office |
| 73 | `cityGods.ministries.PERSONNEL` | 吏部 | Personnel |
| 74 | `cityGods.ministries.REVENUE` | 户部 | Revenue |
| 75 | `cityGods.ministries.RITES` | 礼部 | Rites |
| 76 | `cityGods.ministries.WAR` | 兵部 | War |
| 77 | `cityGods.ministries.JUSTICE` | 刑部 | Justice |
| 78 | `cityGods.ministries.WORKS` | 工部 | Works |
| 79 | `cityGods.bureau_names.YINYANG` | 阴阳司 | Bureau of Yin and Yang |
| 80 | `cityGods.bureau_names.GONGCAO` | 功曹司 | Bureau of Merit Records |
| 81 | `cityGods.bureau_names.DIANJI` | 典籍司 | Bureau of Registers |
| 82 | `cityGods.bureau_names.JIBU` | 记簿司 | Bureau of Deeds |
| 83 | `cityGods.bureau_names.DUGUAN` | 都官司 | Bureau of Constables |
| 84 | `cityGods.bureau_names.CAIBO` | 财帛司 | Bureau of Offerings |
| 85 | `cityGods.bureau_names.TUDI` | 土地司 | Bureau of Land |
| 86 | `cityGods.bureau_names.LIANGMO` | 粮秣司 | Bureau of Grain |
| 87 | `cityGods.bureau_names.KAOJIE` | 考劫司 | Bureau of Life Spans |
| 88 | `cityGods.bureau_names.JISI` | 祭祀司 | Bureau of Sacrifices |
| 89 | `cityGods.bureau_names.YIZHU` | 仪注司 | Bureau of Ceremonies |
| 90 | `cityGods.bureau_names.HUOFU` | 祸福司 | Bureau of Fortune |
| 91 | `cityGods.bureau_names.MINGYI` | 冥衣司 | Bureau of Grave Goods |
| 92 | `cityGods.bureau_names.BINGZHANG` | 兵杖司 | Bureau of Implements |
| 93 | `cityGods.bureau_names.XINGXUN` | 刑讯司 | Bureau of Interrogation |
| 94 | `cityGods.bureau_names.JUBU` | 拘捕司 | Bureau of Arrests |
| 95 | `cityGods.bureau_names.XUNCHA` | 巡察司 | Bureau of Patrols |
| 96 | `cityGods.bureau_names.XINGFA` | 刑罚司 | Bureau of Punishments |
| 97 | `cityGods.bureau_names.ANBU` | 案簿司 | Bureau of Case Files |
| 98 | `cityGods.bureau_names.QUANDIAN` | 权典司 | Bureau of Hard Cases |
| 99 | `cityGods.bureau_names.XUMING` | 续命司 | Bureau of Prolonged Life |
| 100 | `cityGods.bureau_names.YINGZAO` | 营造司 | Bureau of Building |
| 101 | `cityGods.bureau_names.QIAODAO` | 桥道司 | Bureau of Bridges and Roads |
| 102 | `cityGods.bureau_names.CIJI` | 祠祭司 | Bureau of Shrines |
| 103 | `cityGods.bureau_names.SHUYUN` | 输运司 | Bureau of Escort |
| 104 | `realms.names.EU_ANTINFERNO` | 地狱前庭 | The Vestibule of Hell |
| 105 | `realms.codes.EU_ANTINFERNO` | 地狱前庭 | 地狱前庭 |
| 106 | `souls.neutral_in_life.label` | 中立者 | Neutral in life |
| 107 | `souls.neutral_in_life.UNRECORDED` | 未记录 | Not recorded |
| 108 | `souls.neutral_in_life.YES` | 是 | Yes |
| 109 | `souls.neutral_in_life.NO` | 否 | No |
| 110 | `souls.neutral_in_life.help` | 生前既不为善也不为恶、不站任何一边（Inf. III）：判有罪而没有引用更深的圈时，入地狱前庭，不入九圈。 | Lived neither for good nor for evil, taking no side (Inf. III): when condemned with no deeper circle cited, the vestibule of hell, outside the nine circles. |
| 111 | `souls.ferry_passage.label` | 过河 | The crossing |
| 112 | `souls.ferry_passage.NONE` | 已葬，有渡资 | Buried, fare paid |
| 113 | `souls.ferry_passage.UNBURIED` | 未葬 | Unburied |
| 114 | `souls.ferry_passage.NO_FARE` | 无渡资 | No fare |
| 115 | `souls.ferry_passage.help` | 卡戎只渡已葬且付了渡资的亡魂。未葬或无渡资者滞留阿刻戎岸边，审判不能认领；补记为「已葬，有渡资」后即可受审。 | Charon ferries only the buried who can pay. The unburied and those without a fare wait on the bank of Acheron and their judgment can't be claimed; record “Buried, fare paid” and the case can be heard. |
| 116 | `souls.sin_gravity.label` | 大罪 / 小罪 | Mortal / venial |
| 117 | `souls.sin_gravity.NONE` | 未分 | Unclassified |
| 118 | `souls.sin_gravity.MORTAL` | 大罪 · 未悔 | Mortal · unrepented |
| 119 | `souls.sin_gravity.MORTAL_ABSOLVED` | 大罪 · 已告解 | Mortal · absolved |
| 120 | `souls.sin_gravity.VENIAL` | 小罪 | Venial |
| 121 | `souls.sin_gravity.help` | 未悔的大罪只能判不通过（下地狱）；小罪与已告解的大罪不能判下地狱，进炼狱涤罪。未分的不核对。 | An unrepented mortal sin can only be condemned (hell). Venial sins and absolved mortal sins can't be sent to hell; they are purged in purgatory. Unclassified deeds are not checked. |
| 122 | `judgment.claim.unferried` | 这桩审判不能认领：亡魂未葬或没有渡资，滞留在阿刻戎岸边。 | This judgment can't be claimed: the soul is unburied or has no fare, and waits on the bank of Acheron. |
| 123 | `sentence_plan.errors.mortal_sin_unrepented` | 已采信的证据里有未悔的大罪：只能判不通过。 | The admitted evidence holds an unrepented mortal sin: the verdict can only be Failed. |
| 124 | `sentence_plan.errors.no_mortal_sin` | 已采信的罪都是小罪或已告解的大罪：不能判下地狱，应判待定（炼狱）。 | Every admitted sin is venial or absolved: not hell. Give Pending (purgatory). |
| 125 | `appeals.error.mortal_sin_unrepented` | 已采信的证据里有未悔的大罪：只能改判不通过。 | The admitted evidence holds an unrepented mortal sin: the amended verdict can only be Failed. |
| 126 | `appeals.error.no_mortal_sin` | 已采信的罪都是小罪或已告解的大罪：不能改判下地狱。 | Every admitted sin is venial or absolved: the amended verdict can't be hell. |
| 127 | `judgment.confessions.title` | 四十二条否定告白 | The forty-two denials |
| 128 | `judgment.confessions.hint` | 亡者向四十二位判官逐一否认一项罪。逐条记下是否如实；结案后不能再改。 | The deceased denies one wrong before each of the forty-two assessors. Record whether each denial is true; it can't be changed once the case is concluded. |
| 129 | `judgment.confessions.tally` | 如实 {{truthful}} · 不实 {{untruthful}} · 未记 {{unheard}} | True {{truthful}} · False {{untruthful}} · Not recorded {{unheard}} |
| 130 | `judgment.confessions.truthful` | 如实 | True |
| 131 | `judgment.confessions.untruthful` | 不实 | False |
| 132 | `judgment.confessions.unheard` | 未记 | Not recorded |
| 133 | `judgment.confessions.note` | 备注 | Note |
| 134 | `judgment.confessions.note_placeholder` | 依据（可空） | Grounds (optional) |
| 135 | `judgment.confessions.row_label` | 第 {{n}} 位判官 {{assessor}} | Assessor {{n}}, {{assessor}} |
| 136 | `judgment.confessions.empty` | 本殿还没有四十二条告白的条文（种子未运行）。 | This hall has no articles for the forty-two denials yet (the seed has not run). |
| 137 | `judgment.confessions.errors.concluded` | 已结案，告白记录不能再改。 | The case is concluded; the confession record can't be changed. |
| 138 | `judgment.confessions.errors.not_weighed` | 这件案子不称心，没有否定告白。 | This case is not weighed and hears no denials. |
| 139 | `judgment.confessions.errors.unknown_clause` | 本殿没有这一位判官。 | This hall has no such assessor. |
| 140 | `judgment.confessions.errors.generic` | 没有记下，请重试。 | Not recorded; please try again. |
| 141 | `souls.events.DIYU_STATION_CHANGED` | 十三站换站 | Moved to another station |
| 142 | `souls.events.CAPTURE_WARRANT_ISSUED` | 发勾魂牒 | Capture warrant issued |
| 143 | `souls.events.SOUL_CAPTURED` | 鬼差拘到 | Captured by the escorts |
| 144 | `souls.events.CAPTURE_HANDED_OVER` | 勾魂交接 | Capture handed over |
| 145 | `souls.events.CAPTURE_WARRANT_CANCELLED` | 勾魂牒撤销 | Capture warrant cancelled |
| 146 | `souls.diyu_station.label` | 十三站 | Thirteen stations |
| 147 | `souls.diyu_station.NONE` | 不在路上 | Not on the road |
| 148 | `souls.diyu_station.TUDI_TEMPLE` | 土地庙 | Earth God's Temple |
| 149 | `souls.diyu_station.YELLOW_SPRINGS_ROAD` | 黄泉路 | Road of the Yellow Springs |
| 150 | `souls.diyu_station.WANGXIANG_TERRACE` | 望乡台 | Terrace for Viewing Home |
| 151 | `souls.diyu_station.EVIL_DOG_VILLAGE` | 恶狗村 | Village of Vicious Dogs |
| 152 | `souls.diyu_station.GOLDEN_ROOSTER_HILL` | 金鸡山 | Golden Rooster Hill |
| 153 | `souls.diyu_station.WILD_GHOST_VILLAGE` | 野鬼村 | Village of Wild Ghosts |
| 154 | `souls.diyu_station.MIHUN_HALL` | 迷魂殿 | Hall of Bewilderment |
| 155 | `souls.diyu_station.OFFERING_PAVILION` | 供养阁 | Pavilion of Offerings |
| 156 | `souls.diyu_station.GHOST_FORT` | 鬼界堡 | Fort of the Ghost Realm |
| 157 | `souls.diyu_station.FENGDU_CITY` | 酆都城 | City of Fengdu |
| 158 | `souls.diyu_station.EIGHTEEN_HELLS` | 十八层地狱 | Eighteen Hells |
| 159 | `souls.diyu_station.LOTUS_TERRACE` | 莲花台 | Lotus Terrace |
| 160 | `souls.diyu_station.HUANHUN_CLIFF` | 还魂崖 | Cliff of Returning Souls |
| 161 | `souls.diyu_station.ordinal` | 第 {{n}} / 13 站 | Station {{n}} / 13 |
| 162 | `souls.diyu_station.move_label` | 挪到 | Move to |
| 163 | `souls.diyu_station.move` | 挪站 | Move |
| 164 | `souls.diyu_station.moved` | 已挪到{{station}} | Moved to {{station}} |
| 165 | `souls.diyu_station.error.not_diyu` | 只有地府的亡魂走十三站。 | Only a soul of Diyu walks the thirteen stations. |
| 166 | `souls.diyu_station.error.alive` | 在世的灵魂不在路上。 | A living soul is not on the road. |
| 167 | `souls.birth_continent.label` | 出身部洲 | Continent of birth |
| 168 | `souls.birth_continent.NONE` | 不详 | Unknown |
| 169 | `souls.birth_continent.DONGSHENG` | 东胜神洲 | Pūrvavideha (East) |
| 170 | `souls.birth_continent.NANZHAN` | 南瞻部洲 | Jambudvīpa (South) |
| 171 | `souls.birth_continent.XINIU` | 西牛贺洲 | Aparagodānīya (West) |
| 172 | `souls.birth_continent.BEIJULU` | 北俱卢洲 | Uttarakuru (North) |
| 173 | `souls.birth_continent.help` | 这一世生在四大部洲的哪一洲。转世到人道时由转世那一笔改写成下一世的部洲。 | Which of the four continents this life was born in. A rebirth into the human path sets the next life's continent. |
| 174 | `souls.capture.title` | 勾魂 | Capture |
| 175 | `souls.capture.due_hint` | 阳寿已到，可以发勾魂牒。交接时登记死亡，案子交城隍初审。 | The fated date has come: a capture warrant can be issued. Handing over registers the death and sends the case to the City God. |
| 176 | `souls.capture.escort_label` | 鬼差 | Escort |
| 177 | `souls.capture.escort.SUGGESTED` | 按功过建议 | Suggested by karma |
| 178 | `souls.capture.escort.WUCHANG` | 黑白无常 | Black and White Impermanence |
| 179 | `souls.capture.escort.NIUTOU_MAMIAN` | 牛头马面 | Ox Head and Horse Face |
| 180 | `souls.capture.status.ISSUED` | 已发牒 | Issued |
| 181 | `souls.capture.status.CAPTURED` | 已拘到 | Captured |
| 182 | `souls.capture.status.HANDED_OVER` | 已交接 | Handed over |
| 183 | `souls.capture.status.CANCELLED` | 已撤销 | Cancelled |
| 184 | `souls.capture.city_god` | {{name}}发牒 | issued by {{name}} |
| 185 | `souls.capture.issue` | 发勾魂牒 | Issue capture warrant |
| 186 | `souls.capture.capture` | 拘到 | Captured |
| 187 | `souls.capture.hand_over` | 交接 | Hand over |
| 188 | `souls.capture.cancel` | 撤销 | Cancel |
| 189 | `souls.capture.cancel_reason` | 撤销理由 | Reason for cancelling |
| 190 | `souls.capture.cancel_confirm` | 撤销勾魂牒 | Cancel the warrant |
| 191 | `souls.capture.issued_toast` | 已为{{name}}发勾魂牒 | Capture warrant issued for {{name}} |
| 192 | `souls.capture.captured_toast` | {{name}}已拘到 | {{name}} captured |
| 193 | `souls.capture.handed_over_toast` | {{name}}已交接，死亡已登记 | {{name}} handed over; death registered |
| 194 | `souls.capture.cancelled_toast` | {{name}}的勾魂牒已撤销 | Capture warrant for {{name}} cancelled |
| 195 | `souls.capture.error.not_diyu` | 只有地府的灵魂由鬼差勾魂。 | Only a soul of Diyu is fetched by the ghost escorts. |
| 196 | `souls.capture.error.not_alive` | 这个灵魂已经不在世。 | This soul is no longer alive. |
| 197 | `souls.capture.error.lifespan_not_ended` | 阳寿未到，或没有登记阳寿。 | The fated date has not come, or is not recorded. |
| 198 | `souls.capture.error.warrant_open` | 这个灵魂已有一张未了结的勾魂牒。 | This soul already has an open capture warrant. |
| 199 | `souls.capture.error.wrong_status` | 勾魂牒此刻不能这样办，刷新后再试。 | The warrant can't do that now; refresh and try again. |
| 200 | `souls.capture.error.reason_required` | 撤销要写理由。 | Write a reason to cancel. |
| 201 | `soul_app.life.station` | 所在之站 | Where you are |
| 202 | `soul_app.life.station_at` | 第 {{n}} / 13 站 | Station {{n}} / 13 |
| 203 | `soul_app.life.continent` | 出身部洲 | Continent of birth |

## 二、城隍诸司全表(25 个)与各级预设

预设是**工程按文档提的方案**:docs/08 只说「级别越高诸司越齐全」,没给每级名单。县级取接引、记功过、拘魂、审案、押送这些办一件死亡案必经的司;往上逐级补齐;都城隍全设。用户可改。

| 部 | 键 | 中文 | English | 县 | 州 | 府 | 都 |
|---|---|---|---|---|---|---|---|
| 总务 | `cityGods.bureau_names.YINYANG` | 阴阳司 | Bureau of Yin and Yang | ✓ | ✓ | ✓ | ✓ |
| 吏部 | `cityGods.bureau_names.GONGCAO` | 功曹司 | Bureau of Merit Records | ✓ | ✓ | ✓ | ✓ |
| 吏部 | `cityGods.bureau_names.DIANJI` | 典籍司 | Bureau of Registers |  | ✓ | ✓ | ✓ |
| 吏部 | `cityGods.bureau_names.JIBU` | 记簿司 | Bureau of Deeds | ✓ | ✓ | ✓ | ✓ |
| 吏部 | `cityGods.bureau_names.DUGUAN` | 都官司 | Bureau of Constables |  | ✓ | ✓ | ✓ |
| 户部 | `cityGods.bureau_names.CAIBO` | 财帛司 | Bureau of Offerings |  | ✓ | ✓ | ✓ |
| 户部 | `cityGods.bureau_names.TUDI` | 土地司 | Bureau of Land | ✓ | ✓ | ✓ | ✓ |
| 户部 | `cityGods.bureau_names.LIANGMO` | 粮秣司 | Bureau of Grain |  |  | ✓ | ✓ |
| 户部 | `cityGods.bureau_names.KAOJIE` | 考劫司 | Bureau of Life Spans | ✓ | ✓ | ✓ | ✓ |
| 礼部 | `cityGods.bureau_names.JISI` | 祭祀司 | Bureau of Sacrifices | ✓ | ✓ | ✓ | ✓ |
| 礼部 | `cityGods.bureau_names.YIZHU` | 仪注司 | Bureau of Ceremonies |  | ✓ | ✓ | ✓ |
| 礼部 | `cityGods.bureau_names.HUOFU` | 祸福司 | Bureau of Fortune |  | ✓ | ✓ | ✓ |
| 礼部 | `cityGods.bureau_names.MINGYI` | 冥衣司 | Bureau of Grave Goods |  |  | ✓ | ✓ |
| 兵部 | `cityGods.bureau_names.BINGZHANG` | 兵杖司 | Bureau of Implements |  |  | ✓ | ✓ |
| 兵部 | `cityGods.bureau_names.XINGXUN` | 刑讯司 | Bureau of Interrogation | ✓ | ✓ | ✓ | ✓ |
| 兵部 | `cityGods.bureau_names.JUBU` | 拘捕司 | Bureau of Arrests | ✓ | ✓ | ✓ | ✓ |
| 兵部 | `cityGods.bureau_names.XUNCHA` | 巡察司 | Bureau of Patrols |  | ✓ | ✓ | ✓ |
| 刑部 | `cityGods.bureau_names.XINGFA` | 刑罚司 | Bureau of Punishments |  | ✓ | ✓ | ✓ |
| 刑部 | `cityGods.bureau_names.ANBU` | 案簿司 | Bureau of Case Files | ✓ | ✓ | ✓ | ✓ |
| 刑部 | `cityGods.bureau_names.QUANDIAN` | 权典司 | Bureau of Hard Cases |  |  | ✓ | ✓ |
| 刑部 | `cityGods.bureau_names.XUMING` | 续命司 | Bureau of Prolonged Life |  |  |  | ✓ |
| 工部 | `cityGods.bureau_names.YINGZAO` | 营造司 | Bureau of Building |  |  | ✓ | ✓ |
| 工部 | `cityGods.bureau_names.QIAODAO` | 桥道司 | Bureau of Bridges and Roads |  | ✓ | ✓ | ✓ |
| 工部 | `cityGods.bureau_names.CIJI` | 祠祭司 | Bureau of Shrines |  |  |  | ✓ |
| 工部 | `cityGods.bureau_names.SHUYUN` | 输运司 | Bureau of Escort | ✓ | ✓ | ✓ | ✓ |

合计:县 10 司、州 18 司、府 23 司、都 25 司。

各级名称与封号(用户 2026-10-28 定改按明代史实,代码与 docs/08 正在同步改):都城隍 · 承天鉴国司民升福明灵王;府城隍 · 威灵公;州城隍 · 灵佑侯;县城隍 · 显佑伯。

## 三、十三站全表(站序取 docs/06 §一 总览表,用户 2026-10-28 定)

「说明」是灵魂 App 用的一句话,中文取自 docs/06 的「主要功能」,工程润色;英文还没写,请 Design 一并给中英 egy 三语(新键建议 `souls.diyu_station.desc.<键>`)。

| 站 | 键 | 中文名 | English | 说明(中文) |
|---|---|---|---|---|
| 1 | `TUDI_TEMPLE` | 土地庙 | Earth God's Temple | 亡魂先到土地庙报到，由土地公通报城隍、接引上路。 |
| 2 | `YELLOW_SPRINGS_ROAD` | 黄泉路 | Road of the Yellow Springs | 通往阴间的必经之路。 |
| 3 | `WANGXIANG_TERRACE` | 望乡台 | Terrace for Viewing Home | 回望人间、最后一眼看家乡的地方。 |
| 4 | `EVIL_DOG_VILLAGE` | 恶狗村 | Village of Vicious Dogs | 生前作恶者在此受恶狗拦咬。 |
| 5 | `GOLDEN_ROOSTER_HILL` | 金鸡山 | Golden Rooster Hill | 生前造业者在此受考验。 |
| 6 | `WILD_GHOST_VILLAGE` | 野鬼村 | Village of Wild Ghosts | 孤魂野鬼聚集之处。 |
| 7 | `MIHUN_HALL` | 迷魂殿 | Hall of Bewilderment | 饮迷魂水，清醒头脑。 |
| 8 | `OFFERING_PAVILION` | 供养阁 | Pavilion of Offerings | 领取阳间亲人烧来的纸钱供养。 |
| 9 | `GHOST_FORT` | 鬼界堡 | Fort of the Ghost Realm | 无处可去的孤魂暂时栖身。 |
| 10 | `FENGDU_CITY` | 酆都城 | City of Fengdu | 进入酆都城，正式归地府管辖，候十殿审判。 |
| 11 | `EIGHTEEN_HELLS` | 十八层地狱 | Eighteen Hells | 判有罪者在此受刑。 |
| 12 | `LOTUS_TERRACE` | 莲花台 | Lotus Terrace | 受度化，超拔出离苦海。 |
| 13 | `HUANHUN_CLIFF` | 还魂崖 | Cliff of Returning Souls | 饮孟婆汤后，投胎前的最后一关。 |

## 四、四大部洲全表

| 键 | 中文 | English |
|---|---|---|
| `DONGSHENG` | 东胜神洲 | Pūrvavideha (East) |
| `NANZHAN` | 南瞻部洲 | Jambudvīpa (South) |
| `XINIU` | 西牛贺洲 | Aparagodānīya (West) |
| `BEIJULU` | 北俱卢洲 | Uttarakuru (North) |
