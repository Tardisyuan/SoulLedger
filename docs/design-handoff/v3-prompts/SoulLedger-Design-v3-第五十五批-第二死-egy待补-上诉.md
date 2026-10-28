# SoulLedger · Design v3 · 第五十五批

这批有三件事:「第二死」的视觉、23 个 egy 待补词、以及「上诉」入口(第五十二批没有覆盖到)。

现状都已经在代码里(main `4c06f810`)。要你做的是定稿：画稿、给词，或者确认现在的做法可以。

---

## 一、埃及「第二死」的视觉(新的界域类型 ANNIHILATION)

**背景**:用户 2026-10-28 决定，埃及的「第二死」(被阿米特吞噬)不再算地狱(HELL),改成新的界域类型 `ANNIHILATION`。依据是文档:第二死是结果，不是一个地方。界域类型因此从 4 种变成 5 种:BLISS / PURGATORY / HELL / NONE / ANNIHILATION。

**现在的临时做法(工程这边自己定的，需要你定稿)**:

1. **界域页的类型徽章**(`frontend/app/realms/page.tsx`)
   - 图标：划掉的圆圈(lucide `CircleOff`)。
   - 颜色：判决失败色 `--color-verdict-failed`,底色透明度 0.1,边框 0.3,文字用纯色。
   - 文案：中文「不存在」,英文「Ceased to exist」,egy 待补(见第二节)。
2. **仪表盘按界域类型的图表**(`frontend/lib/chart-colors.ts`、`RealmBars.tsx`)
   - 新加了第五种图案 `void`:1px 虚线框、空心。原来的四种是 solid / half / hatch / outline,A5 稿里没有第五种。
   - 颜色借用 `--color-chart-1`。
   - 图例里多了一项。
3. **排序**:按类型排序时，第二死现在排在埃及各界域的最前面。原来跟在 BLISS 后面。

**请你定**:
- 徽章的颜色和图标：用判决失败色是否合适？或者给一个专门表示「湮灭」的语义色。
- 第五种图案：用 `void` 虚线框，还是另画一种。守卫测试要求五种类型对五种互不相同的图案。
- 排序位置：是否要排到最后。
- 灵魂详情、时间线上「被吞噬」的展示，要不要跟着调整。现在这些地方按界域代码判断，没有变化。

---

## 二、egy 待补词(23 个)

这些键在 zh-Hans 和 en 里都有，egy 里没有。清单在 `frontend/src/__tests__/support/egyPendingKeys.json`,你给词后我们填进 `packages/core/messages/egy.json`,再把这些键从清单里删掉。

| 键 | 中文 | English |
|---|---|---|
| souls.events.OFFICER_HANDOVER | 经办官员交接 | Case handed to another officer |
| souls.events.DUAT_PASSAGE_CHANGED | 杜阿特行程改记 | Duat passage changed |
| users.batch.open_work_partial | 已停用 {{done}} 位。{{n}} 位手上还有在途的事，没有停用：请逐个停用，停用时移交。 | {{done}} deactivated. {{n}} still hold open work and stay active: deactivate them one at a time and hand it over. |
| users.batch.held_row | {{name}} · 在途 {{n}} 件 | {{name}} · {{n}} open |
| users.batch.held_region | 没有停用的官员 | Officers not deactivated |
| souls.baptism.label | 受洗 | Baptism |
| souls.baptism.UNRECORDED | 未记录 | Not recorded |
| souls.baptism.BAPTISED | 已受洗 | Baptised |
| souls.baptism.UNBAPTISED | 未受洗 | Unbaptised |
| souls.baptism.BEFORE_CHRIST | 生于基督之前 | Born before Christ |
| souls.baptism.help | 未受洗或生于基督之前、又没有更重的罪：判入第一圈 Limbo(不是刑罚)。有更重的罪，按那条罪发落。已受洗的灵魂不会落到 Limbo。 | Unbaptised or born before Christ, with no heavier sin: the first circle, Limbo (not a punishment). A heavier sin decides instead. A baptised soul never lands in Limbo. |
| souls.denied_immortality.label | 否认灵魂不灭 | Denied the soul's immortality |
| souls.denied_immortality.UNRECORDED | 未记录 | Not recorded |
| souls.denied_immortality.YES | 是 | Yes |
| souls.denied_immortality.NO | 否 | No |
| souls.denied_immortality.help | 生前主张灵魂随肉体而死(伊壁鸠鲁派，Inf. X):判有罪时入第六圈(异端)，除非引用的罪更深。不是渎神，渎神在第七圈。 | Held in life that the soul dies with the body (the Epicureans, Inf. X): when condemned, the sixth circle (heresy), unless a cited sin lies deeper. Not blasphemy, which is the seventh circle. |
| soul_app.errors.desired_form_required | 请先选一个希望转生的形态 | Choose the form you hope to be reborn as first |
| soul_app.errors.rebirth_form_not_applicable | 你的文明转世不分六道，不用选形态 | Your civilization has no six paths; there is no form to choose |
| judgment.placement.errors.retry_has_no_destination | 「重审」不发落：这件案子会另开一案再审，清空发落再结案。 | A RETRY sends the soul nowhere: the case is heard again. Clear the placement and conclude. |
| sentence_plan.errors.retry_with_open_cross | 这件案子挂着未结的联审，先结联审再判「重审」。 | A cross-realm judgment is open on this case; conclude it before hearing the case again. |
| sentence_plan.errors.retry_not_a_destination | 欧洲的「重审」不是去处：请给出终局裁决，或另开一件审判。 | A European RETRY is not a destination: give a final verdict, or open a new judgment. |
| appeals.error.retry_not_a_destination | 欧洲的「重审」不是去处：请改判为终局裁决，或另开一件审判。 | A European RETRY is not a destination: amend to a final verdict, or open a new judgment. |
| realms.types.ANNIHILATION | 不存在 | Ceased to exist |

说明:
- 受洗、否认灵魂不灭这 11 个键是欧洲文明的字段，埃及文明的界面不会出现。如果你认为 egy 不需要单独给词，告诉我们一声，我们会改成用英文兜底。
- 暂代词还没定的五个词根继续沿用第五批的说法：孟婆汤、饮、邀请、PDF、相册。

---

## 三、「上诉」入口(第五十二批没有覆盖)

第五十二批只交代了**审判申诉**。2026-10-27 起，代码里多了**上诉**:申诉被驳回后，灵魂可以把案子交给本文明的申诉流程，逐站复核(`can_escalate`)。实现在:
- 灵魂 App:`mobile/src/screens/appeals.tsx`
- 官员 Web:`frontend/app/judgment/appeals/`

现在两端是按第五十二批的组件拼出来的，没有专门的稿子。请补：上诉的入口和状态，包括当前到了哪一站、每一站的结论，以及它和申诉在视觉上怎么区分。

---

## 附：第五十四批的一处更正

第五十四批写「官员 App 只读附件」。现在官员 App 已经能拍照上传附件(`mobile-officer/src/screens/caseUpload.tsx`),以后的稿子按「可上传」画。
