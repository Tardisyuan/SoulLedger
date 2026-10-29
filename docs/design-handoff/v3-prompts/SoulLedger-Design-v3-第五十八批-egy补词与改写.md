# SoulLedger · Design v3 · 第五十八批 · egy 补词与改写(2026-10-29)

## 对第五十七批 c 的答复
- 184 条 egy 已全部填进语言包;英文五处(City God 大写、Mark captured、Bureau of Wealth / Calamities / Arms)都已照改。
- **四个新词根都采用你的建议**:药 `Pekhret`、火 `Sedjet`、毒 `Metu`、战争 `Mesha`。请把用到暂代写法的那几条(取骸合药、放火、制毒、战争死亡)换成新词根后重新发布,我们拿到再替换。
- 土地公仍用 `Netjer Ta`(`Tudi` 未定)。地上乐园改用词表里的 `Paradiso Terrestre`:同意。

## 一、新增待补 egy(46 条)
这批来自用户 10-29 拍板后的流程改造:原审一律走审批流程、执行即开始服刑并可「期满释放」、按殿默认刑期、地府无罪直接候转世、四文明「重审」统一为重开一案、转世按灵魂申请的六道(官员改道须写原因)、枉死城「超度」与阳寿到期后的「属实(只记结论)」、没有城隍不许开案。

| # | 键 | 中文 | English |
|---|---|---|---|
| 1 | `souls.diyu_station.TUDI_TEMPLE` | 土地庙 | Earth God's Temple |
| 2 | `souls.diyu_station.YELLOW_SPRINGS_ROAD` | 黄泉路 | Road of the Yellow Springs |
| 3 | `souls.diyu_station.WANGXIANG_TERRACE` | 望乡台 | Terrace for Viewing Home |
| 4 | `souls.diyu_station.EVIL_DOG_VILLAGE` | 恶狗村 | Village of Vicious Dogs |
| 5 | `souls.diyu_station.GOLDEN_ROOSTER_HILL` | 金鸡山 | Golden Rooster Hill |
| 6 | `souls.diyu_station.WILD_GHOST_VILLAGE` | 野鬼村 | Village of Wild Ghosts |
| 7 | `souls.diyu_station.MIHUN_HALL` | 迷魂殿 | Hall of Bewilderment |
| 8 | `souls.diyu_station.OFFERING_PAVILION` | 供养阁 | Pavilion of Offerings |
| 9 | `souls.diyu_station.GHOST_FORT` | 鬼界堡 | Fort of the Ghost Realm |
| 10 | `souls.diyu_station.FENGDU_CITY` | 酆都城 | City of Fengdu |
| 11 | `souls.diyu_station.EIGHTEEN_HELLS` | 十八层地狱 | Eighteen Hells |
| 12 | `souls.diyu_station.LOTUS_TERRACE` | 莲花台 | Lotus Terrace |
| 13 | `souls.diyu_station.HUANHUN_CLIFF` | 还魂崖 | Cliff of Returning Souls |
| 14 | `judgment.grievance_statuses.UPHELD_LATE` | 属实 · 期满出城 | Upheld · after release |
| 15 | `judgment.grievance_statuses.DELIVERED` | 属实 · 已超度 | Upheld · delivered |
| 16 | `souls.events.WANGSI_GRIEVANCE_DELIVERED` | 申诉属实 · 超度至莲花台 | Grievance upheld · delivered at the Lotus Terrace |
| 17 | `judgment.wangsi.deliver` | 属实 · 超度 | Upheld · deliver |
| 18 | `judgment.wangsi.deliver_title` | 超度{{name}}？ | Deliver {{name}}? |
| 19 | `judgment.wangsi.deliver_body` | 属实并超度：{{name}}离开枉死城，到莲花台，免审结案。 | Upheld and delivered: {{name}} leaves the City of Wrongful Death for the Lotus Terrace, and the case is concluded without a hearing. |
| 20 | `judgment.wangsi.delivered_line` | 枉死 · {{date}} 已超度 | Untimely · delivered on {{date}} |
| 21 | `judgment.wangsi.uphold_late` | 属实（只记结论） | Upheld (finding only) |
| 22 | `judgment.wangsi.late_hint` | 阳寿已到或案子已结，亡魂已出城：审核只记结论，不再释放或超度。 | The fated day has passed or the case is concluded, so the soul has already left the city: the review only records a finding. |
| 23 | `judgment.wangsi.error.deliver_needs_upheld` | 只有属实的申诉才能超度。 | Only an upheld grievance can deliver the soul. |
| 24 | `soul_app.wangsi.status.UPHELD_LATE` | 申诉属实 · 阳寿已到时已出城 | Grievance upheld · you had already left on the fated day |
| 25 | `soul_app.wangsi.status.DELIVERED` | 申诉属实 · 已超度，往莲花台 | Grievance upheld · delivered to the Lotus Terrace |
| 26 | `judgment.placement.errors.passed_has_no_destination` | 地府判无罪不发落：结案（审批流程走完）后直接候转世，清空发落再结案。 | Acquitted in Diyu, the soul is not placed: once the case is concluded (and its approval flow completes) it awaits rebirth. Clear the placement and conclude. |
| 27 | `disposition.serving_until` | 服刑中 · 至 {{date}} | Serving · until {{date}} |
| 28 | `disposition.release` | 期满释放 | Release at term end |
| 29 | `disposition.release_confirm` | 确认期满释放？ | Release at term end? |
| 30 | `disposition.release_warning` | 记下期满，灵魂离开这一站：受刑计划还有下一站就去下一站，没有就候转世（或终局）。不可撤销。 | Records the term as served and the soul leaves this stop: to the next stop of its sentence plan, or, if none is left, to await rebirth (or its final rest). This can't be undone. |
| 31 | `disposition.release_success` | 已期满释放 | Released at term end |
| 32 | `disposition.release_error.term_not_ended` | 期满日还没到，不能释放。 | The term has not ended yet; it cannot be released. |
| 33 | `disposition.release_error.not_serving` | 这份处置不在服刑中。 | This disposition is not being served. |
| 34 | `reincarnation.error.term_not_served` | {{name}}刑期未满（至 {{date}}），期满释放后才能转世。 | {{name}}'s term is not served out (until {{date}}); release it at term end before the rebirth. |
| 35 | `reincarnation.error.rebirth_form_reason_required` | {{name}}的转生申请所愿是{{form}}；改选别的道要写原因。 | {{name}}'s approved application asks for {{form}}; give a reason to choose another path. |
| 36 | `reincarnation.desired_form` | 灵魂所愿：{{form}} | The soul asks for: {{form}} |
| 37 | `reincarnation.form_reason` | 改道原因 | Reason for another path |
| 38 | `reincarnation.form_reason_hint` | 与灵魂所愿不同：写明原因，记入转世记录。 | This differs from what the soul asked for: give the reason; it is kept with the rebirth. |
| 39 | `judgment.wangsi.deliver_sends_on` | 案子还在城隍初审，超度时一并解送。 | The case is still with the City God for first review; delivering sends it on in the same step. |
| 40 | `judgment.placement.term_default` | 默认 {{n}} 年 · 可改 | Default {{n}} years · can be changed |
| 41 | `disposition.term_default` | 默认 {{n}} 年 · 可改 | Default {{n}} years · can be changed |
| 42 | `judgment.error.no_city_god` | 本殿没有可收案的城隍，先在城隍管理里设一位兜底城隍。 | No City God of this hall can take the case: set a default City God under City Gods first. |
| 43 | `judgment.detail.workflow_forced_original` | 原审必走审批流程：流程走完才能执行处置；流程被驳回就重开一案。 | An original judgment always runs its approval workflow: the disposition is executed once it finishes; a refused workflow reopens the case. |
| 44 | `disposition.flow_waiting.approval_in_progress` | 审批流程还没走完：走完之后才能执行。 | The approval workflow is still running: execution waits for it to finish. |
| 45 | `disposition.flow_waiting.approval_rejected` | 审批流程被驳回：这件案子要重开或申诉，不能直接执行。 | A station refused the approval workflow: reopen or appeal the case; it cannot be executed. |
| 46 | `death_sync.error.NO_CITY_GOD` | 本殿没有可收案的城隍 | No City God of this hall can take the case |

## 二、意思变了、需要重写 egy 的已有键
下面这几条的中英文已经改了意思,现有 egy 还是旧意思,请按新中英文重写:

| 键 | 中文(新) | English(新) | 现有 egy(旧意思) |
|---|---|---|---|
| `sentence_plan.errors.retry_not_a_destination` | 「重审」（及欧洲以外的「待审」）不是去处：请给出终局裁决，或另开一件审判。 | A RETRY (or, outside Europe, a pending verdict) is not a destination: give a final verdict, or open a new judgment. | Duat Europa: «Wehem Wedja» Nen Ta. Djed Wedja Pehwy, Er Iri Wedja Mawy. |
| `appeals.error.retry_not_a_destination` | 「重审」（及欧洲以外的「待审」）不是去处：请改判为终局裁决，或另开一件审判。 | A RETRY (or, outside Europe, a pending verdict) is not a destination: amend to a final verdict, or open a new judgment. | Duat Europa: «Wehem Wedja» Nen Ta. Khemen Er Wedja Pehwy, Er Iri Wedja Mawy. |
| `soul_app.errors.sentence_in_progress` | 受刑计划尚未完成（刑期未满也算），完成后才能申请转生 | Your sentence plan is not finished (a term not yet served counts). You can apply once it is complete | Wetep-Ek Nen Neb Seth. Dbh Wehem Mesut Em Khet Wetep |
| `cityGods.empty` | 本殿还没有设城隍。没有城隍收案时，死亡登记会被拒绝：先设一位兜底城隍。 | No City Gods in this hall yet. Without one, a registered death is refused: set a default City God first. | Nen Chenghuang Em Wesekhet Pen. Mut Sesh: Iyi Emu Er Wesekhet 1 Er 10. |
| `cityGods.explain` | 出身地写了好几处地名时，交给写在最后的那个；一个都没写中，交兜底城隍；没有兜底，不能开案。 | If the place of origin names several places, the last one named decides. If none matches, the default City God takes it; with no default, no case can be opened. | Nut Ren Neb: Ren Pehwy Setep. Nen Gem: Chenghuang Smen Tepy. Nen Smen Tepy: Iyi Emu Er Wesekhet 1 Er 10. |

## 三、说明
- 超度:申诉属实时可选「提前释放」或「超度」;超度直接到莲花台、免审结案,案子若还在城隍处会一并解送。
- 「期满释放」:执行处置后进入「受刑中 · 至 日期」,到期后官员点「期满释放」才进入候转世。
- 默认刑期:地府二至九殿 10–80 年(工程设定)、欧洲炼狱每处 100 年(工程设定)、希腊塔尔塔罗斯与至福岛 1000 年(《理想国》)。界面写「默认 N 年 · 可改」。
