# SoulLedger · Design v3 · 第七十一批 · 第七十批的收尾(2026-11-02)

不用画新东西。回 `egy-fill-2026-11-02-71.json`,回复 `v3-batch71-reply.md`,都发布到这个目录。

## 一、egy:退回的 8 条
第七十批这 8 条用了 `egyLexiconRules.test.ts` 不收的词,你说「已加进词表」,但仓库的 `egyVocabulary.json` / 旧账清单里没有。二选一:改用已登记的词;或者确认是专名,在回复里列出要登记的词,我登记进专名表。
「厄尔」是对的,用你的。测试说明三引擎是 Chromium、Firefox、Mobile Chrome(不是 WebKit),我们改了中英。

| 键 | 中文 | English | 第七十批的 egy |
|---|---|---|---|
| `demo.build.github` | 在 GitHub 上看源码 | Read the source on GitHub | Maa Medu Em GitHub |
| `demo.build.lede` | 一个 Django 后端，四个前端。四种冥界的规则只写一遍，放在 packages/core，四端共用。 | One Django backend, four front ends. The rules of the four underworlds are written once, in packages/core, and shared by all four. | Django Wa, Medjat 4. Djedu Duat 4: Sesh Sep Wa Em packages/core · Medjat Neb. |
| `demo.build.tests_caption` | {{date}} 实测 · 三种浏览器引擎:Chromium / Firefox / Mobile Chrome | Measured {{date}} · three browser engines: Chromium, Firefox, Mobile Chrome | Hesb {{date}} · 3: Chromium, Firefox, WebKit |
| `demo.civ.cn.realm` | Diyu | Diyu | Diyu |
| `demo.civ.eu.line` | 圣彼得守在天门，炼狱逐层涤罪，但丁的九层地狱按罪下沉。 | St Peter at the gate, Purgatory cleansing terrace by terrace, Dante's nine circles sinking by sin. | Petrus Em Sebkhet Pet; Ta Hesmen; Duat 9 En Dante: Isfet Wer, Duat Khery. |
| `demo.civ.eu.realm` | Paradiso · Inferno | Paradiso · Inferno | Paradiso · Inferno |
| `demo.tour.cn.3.body` | 城隍先看功过；枉死的，送进枉死城等候。 | The City God reviews merit and demerit first; the wrongfully dead wait in their own city. | Chenghuang Maa Nefer Hena Isfet Tepy; Mut Nen Maat: Em Smen Em Nut Mut Nen Maat. |
| `demo.tour.eu.2.body` | 圣彼得在门前看生前功过：天堂、炼狱，还是地狱。 | At the gate St Peter weighs the life: Heaven, Purgatory, or Hell. | Petrus Em Sebkhet Pet: Pet, Ta Hesmen, Er Duat. |

## 二、egy:新增 16 条
导览的「看这里:X」目标名,和一条权限名。

| 键 | 中文 | English |
|---|---|---|
| `demo.tour.target.capture` | 灵魂详情 · 勾魂卡 | Soul · summons card |
| `demo.tour.target.city_god` | 城隍初审 | First review |
| `demo.tour.target.confessions` | 审判台 · 四十二条 | Judgment desk · the forty-two |
| `demo.tour.target.death` | 死亡登记 | Death registration |
| `demo.tour.target.desk` | 审判台 | Judgment desk |
| `demo.tour.target.desk_offence` | 审判台 · 罪目 | Judgment desk · offence |
| `demo.tour.target.desk_place` | 审判台 · 去处 | Judgment desk · destination |
| `demo.tour.target.disposition` | 处置 | Disposition |
| `demo.tour.target.ferry` | 灵魂详情 · 渡河 | Soul · the crossing |
| `demo.tour.target.realm_map` | 界域 · 地图 | Realms · map |
| `demo.tour.target.rebirth` | 轮回 | Rebirth |
| `demo.tour.target.rebirth_soup` | 轮回 · 孟婆汤 | Rebirth · Meng Po's soup |
| `demo.tour.target.scale` | 称心之厅 · 天平 | Hall of Two Truths · the scale |
| `demo.tour.target.soul_plan` | 灵魂详情 · 受刑计划 | Soul · sentence plan |
| `demo.tour.target.timeline` | 灵魂详情 · 时间线 | Soul · timeline |
| `permission.names.audit.read` | 查看审计日志 | View the audit log |

## 三、T-6 / T-7 里没有精确对应的高亮(请看要不要改稿,不改我们就按现状)
- 地府第 1 步「死亡登记」:高亮灵魂详情的状态,死亡登记页没有主角这条。其余三个文明第 1 步相同。
- 地府第 3 步「城隍初审」:主角已结案,高亮 `/city-god-cases` 整张表。
- 地府第 4 步、欧洲第 3 步「罪目」:高亮裁决区 / 判决结果,没有单独的罪目块。
- 欧洲第 2 步、埃及第 4 步「审判台 · 去处」:整个裁决区。
- 埃及第 3 步「称心之厅 · 天平」:用称重记录那一行,没有单独的天平图块。
- 希腊第 2 步「渡河」:高亮身份卡,主角没有渡河记录。第 3 步是审判台裁决区,三判官分流其实在 `/workflow`,建议换过去。
- 希腊第 4 步「处置」:主角已转世,不在处置默认列表,高亮整段。

## 四、落印过渡
我们做的是简化版(扩色、落印、淡出,≤700ms,可跳过),没做「其余三张淡到 40%」和「色块收成身份带」。要不要补,你看截图定。
