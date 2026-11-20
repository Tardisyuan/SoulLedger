# SoulLedger · egy 待补(2026-10-27 第六批)

第五批 3 条已写进语言包。你提的批量停用拆分照办了：一个都没停用 `users.batch.open_work`(中文已改回「一个都没有停用：{{n}} 位…」,你给的 egy 正好对上);停了一部分用新键 `users.batch.open_work_partial`;没停的人逐行列在提示下面(`users.batch.held_row`),每行一个「移交 N 件并停用」入口(复用 `officerHandover.submit_and_deactivate_n`),这组行的无障碍名称是 `users.batch.held_region`。

两个新事件类型：
- `souls.events.OFFICER_HANDOVER`:官员停用 / 交接时，灵魂的案子、申诉或书信换了经办官员。你建议的 `Redi Seth` 合适。
- `souls.events.DUAT_PASSAGE_CHANGED`:**不只是解除暂缓**。灵魂死后改「入殿前情形」三种情况共用这一个事件：葬仪改回如常(解除暂缓、进殿)、改成无名者 / 葬仪不当(退回杜阿特入口、永久暂缓)、两者互改。所以 `Em Smen Khetem Seth` 只对得上第一种，请给一个涵盖三种的写法(中文标签是「杜阿特行程改记」)。

另请复核一条已有的:`reincarnation.forms.OTHER` 中文从「未分类」改成了「六道之外」(希腊转世不走六道，存的就是这一项),现在的 egy 是 `Ky Seth`,意思还对得上吗？对不上请一并给新写法。

其余是欧洲新加的「受洗」「否认灵魂不朽」两项(未受洗且无重罪的入灵薄狱;否认不朽的入第六圈异端)和希腊转世的「六道之外」。
要求同前：只用词表里已有的词;确实没有的给新词根建议加暂代。占位符原样保留。

回复：在设计系统发布 `egy-fill-2026-10-27-6.json`(只有 `{"键": "egy 文本"}`),并把键加进词表。

| 键 | 中文 | English |
|---|---|---|
| `souls.events.OFFICER_HANDOVER` | 经办官员交接 | Case handed to another officer |
| `souls.events.DUAT_PASSAGE_CHANGED` | 杜阿特行程改记 | Duat passage changed |
| `users.batch.open_work_partial` | 已停用 {{done}} 位。{{n}} 位手上还有在途的事，没有停用：请逐个停用，停用时移交。 | {{done}} deactivated. {{n}} still hold open work and stay active: deactivate them one at a time and hand it over. |
| `users.batch.held_row` | {{name}} · 在途 {{n}} 件 | {{name}} · {{n}} open |
| `users.batch.held_region` | 没有停用的官员 | Officers not deactivated |
| `souls.baptism.label` | 受洗 | Baptism |
| `souls.baptism.UNRECORDED` | 未记录 | Not recorded |
| `souls.baptism.BAPTISED` | 已受洗 | Baptised |
| `souls.baptism.UNBAPTISED` | 未受洗 | Unbaptised |
| `souls.baptism.BEFORE_CHRIST` | 生于基督之前 | Born before Christ |
| `souls.baptism.help` | 未受洗或生于基督之前、又没有更重的罪：判入第一圈 Limbo（不是刑罚）。有更重的罪，按那条罪发落。已受洗的灵魂不会落到 Limbo。 | Unbaptised or born before Christ, with no heavier sin: the first circle, Limbo (not a punishment). A heavier sin decides instead. A baptised soul never lands in Limbo. |
| `souls.denied_immortality.label` | 否认灵魂不灭 | Denied the soul's immortality |
| `souls.denied_immortality.UNRECORDED` | 未记录 | Not recorded |
| `souls.denied_immortality.YES` | 是 | Yes |
| `souls.denied_immortality.NO` | 否 | No |
| `souls.denied_immortality.help` | 生前主张灵魂随肉体而死（伊壁鸠鲁派，Inf. X）：判有罪时入第六圈（异端），除非引用的罪更深。不是渎神，渎神在第七圈。 | Held in life that the soul dies with the body (the Epicureans, Inf. X): when condemned, the sixth circle (heresy), unless a cited sin lies deeper. Not blasphemy, which is the seventh circle. |
