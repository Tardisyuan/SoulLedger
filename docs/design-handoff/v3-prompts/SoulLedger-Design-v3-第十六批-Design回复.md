# 第十六批 · Design 回复(2026-10-10)

## 一、8 处

1. **改密码**:照现在。定了「其他设备退出」再来找我补一句。
2. **「文件来自{{hall}}」**:确认去掉。摘要第一行就写「文件名 · 当前殿名」。
3. **「将更新」**:合并模式下**去掉这一行**,表格只留「将新增」「将跳过」。一行恒为 0 的数字会让人以为出了问题。key 先留着，以后做「覆盖」时再显示。第 3 步结果表也一样处理。
4. **「将跳过(已存在，或被规则挡下)」**:确认，照你们的写法。
5. **上一步：要加**。放在第 2 步，用次级按钮，排在「确认导入」左边。点了回到第 1 步，已选的文件名还显示着，可以直接换。第 3 步不加，因为导入已经发生了。新增 1 个 key:`permissions.config.back`,中文「上一步」,English「Back」,egy 见下。
6. **待办五组**:确认。顺序：审批节点 → 移交 → 缩短冷却申请 → 转生申请 → 待回书信。上一批我把一个队列当成了两个，是我弄错了。
7. **打印**:确认只有两页，受刑计划卡随灵魂档案一起打印。打印时给这张卡加 `break-inside: avoid`,一站不要被拆到两页。页码只在 Chrome / Edge 显示，可以接受，不另想办法补。
8. **三处自定**:都同意。
   - 「展开其余 N 条」放在上方，对。时间从上往下排，展开的内容本来就该出现在那里。
   - 「全部 N 场 ›」:等列表页能按灵魂筛选后再做。在这之前不要用空链接占位。
   - 导出：导出当前内容，对。文件名写成「页面名-殿名-YYYYMMDD-HHmm」。

## 二、egy

### 改词 4 条
这里没有官员台「移交」的 egy 词表。**官员台如果已经有写法，四条都照官员台换**,两边必须是同一个词。如果官员台还没有写法，就用下面这几条：

| key | egy |
|---|---|
| officer_app.todo.groups.reassignments | **Swedj Ba** |
| officer_app.kinds.reassignment | **Swedj Ba** |
| officer_app.confirm.approve_body.reassignment | **Hesy: Swedj Ba Pen Smen.** |
| officer_app.todo.empty_body | **Wat Hesy, Swedj Ba Hena Dbh Renpi: Sedjem Sab.** |

- **新词根 Swedj**:意思是「交付、移交」,请登记。不再用 Dbh Hab Ky,它读出来是「请求派给别人」,说的是改派。
- 不用 Hab-Ba。它已经是「调拨」(受刑计划)的意思，两个概念不能共用一个词。

### 新词根(请登记)
- Djama = 文件
- Ini = 带进来(导入)
- Redi Per = 送出去(导出)
- Nemet = 步
- Sni = 跳过
- Mawy = 新(更新)
- Hedj = 删除
- Neb = 全部
- Smi = 报告
- Pesh = 页
- Hesb = 编号
- Bu = 处

沿用已有的词：配置 = Smen(同 Smen Hemsu),规则 = Hap,版本 = Hemet-Sesh,选 = Setep,新增 = Redi … Hena,前面 = Hat。

### permissions.config(27 + 1)
| key | egy |
|---|---|
| export | Redi Per Smen |
| exporting | Redi Per Djer… |
| export_error | Nen Per Djama. Wehem Iri Er Khet. |
| import | Ini Smen… |
| import_title | Ini Smen · {step}/3 |
| choose_file | Setep Djama |
| file_hint | Setep Djama JSON Em Redi Per Smen; Aa Er {max}. |
| merge_note | Redi Hena Wa: Ket Em Djama, Nen Em Hemsu — Redi Hena. Ket Wenen Seth: Nen Ir Mawy, Nen Hedj. |
| errors.not_json | Djama Pen Nen JSON Maat. |
| errors.too_large | Djama Aa Wer; Aa Er {max}. |
| errors.bad_structure | Djama Nen Maat: Er JSON Em Redi Per Smen, Hena Wa Em permissions, roles, role_permissions, field_permissions, data_scopes. |
| errors.empty | Nen Ket Er Ini Em Djama. |
| confirm | Ini |
| importing | Ini Djer… |
| import_error | Nen Ini Smen: {reason} |
| reason_unknown | Hemsu Nen Djed Khet. |
| more | Ky Ket |
| next | Nemet Ky |
| back | Er Hat |
| checking | Ip Djer… |
| done | Khetem |
| will.add | Er Redi Hena |
| will.update | Er Ir Mawy |
| will.skip | Er Sni (Wenen Seth, Mi Khesef Em Hap) |
| did.add | Redi Hena Seth |
| did.update | Ir Mawy Seth |
| did.skip | Sni Seth (Wenen Seth, Mi Khesef Em Hap) |
| download_skipped | Redi Per Ket Sni |

- `confirm` 只写 **Ini**,不写 Redi Sab Hena 那种「Redi …」。`officer_app.cosign.confirm` 已经用了 Redi Sab Hena,只写 Ini 不会撞上。
- `export_error` 和 `import_error` 都用「Nen + 动词」,符合 §7。`export_error` 用 Nen Per Djama,与 `Nen Per Wesheb` 同句式。
- `done` 用 Khetem,不用 Kheper Seth。Kheper Seth 是状态，这里是一个按钮动作。

### 两个 App · 更新、出错
| key | egy |
|---|---|
| soul_app.update_required.title | Ir Mawy |
| soul_app.update_required.body | Hemet-Sesh Pen Nen Iri Djer. Ir Mawy: Sesh-Ek Hena Medjat-Ek Wenen Djer. |
| soul_app.update_required.button | Ir Mawy |
| soul_app.update_required.version | Hemet-Sesh {{version}} |
| officer_app.update_required.body | Hemet-Sesh {{version}} Kheri Er Hemet-Sesh Wesekhet {{min}}. |
| soul_app.errors.reported | Smi Em Djes-Ef Seth. |
| soul_app.errors.go_home | Er Bu Tepy |

- 标题和按钮都写 Ir Mawy,中文这两处本来也只差一个「去」字。
- `version` 同 `me.version`。
- 「首页」写成 **Bu Tepy**(第一处)。不用 Per Tepy,它已经是「原属地」的意思。

### 评议
| key | egy |
|---|---|
| officer_app.comment.show_rest | Wen {{n}} Ky |
| officer_app.comment.after_close | Er Khet Wedja Khetem |

- 「结案」写 Wedja Khetem,同 JUDGMENT_CONCLUDED。

### 通知
| key | egy |
|---|---|
| notifications.select_all | Setep Neb |
| notifications.select_row | Setep Sedjem: {{title}} |
| notifications.batch_region | Iri Neb Er Sedjem |
| notifications.batch_selected | Setep {{n}} |
| notifications.batch_limit | Aa Er {{n}} Em Sep Wa |
| notifications.batch_clear | Sehen Setep |
| notifications.batch_deleted | Hedj {{count}} Seth |
| notifications.batch_delete_error | Nen Hedj |
| notifications.batch_delete_title | Hedj Sedjem {{n}} Setep? |
| notifications.batch_delete_message | Hedj: Nen Gem-Ek Em Sedjem-Ek. Sedjem Ky Nen Hedj. |

- `batch_clear` 用 Sehen(取消),同受刑计划。
- `batch_delete_error` 同 §7 句式。

### 导出、打印、数据、案号
| key | egy |
|---|---|
| common.export | Redi Per |
| common.export_failed | Nen Per Djama |
| print.button | Sesh Er Djama |
| print.case_no | Hesb Wedja |
| print.soul_no | Hesb Ba |
| print.page_pre | `Pesh ` |
| print.page_mid | ` / ` |
| print.page_post | (空串) |
| dashboard.data_as_of | Hesb Er {{time}} |
| souls.detail.case_open | Nen Khetem Djer |
| souls.detail.case_closed | Wedja Khetem |

- 页码拼出来是「Pesh 2 / 5」。`page_post` 是空串，不是缺 key。
- `case_open` 的写法同「Nen Shesep Djer」(待认领),「Nen … Djer」表示还没到，不是失败句。
- `case_closed` 不写 Khetem Seth。Khetem Seth 是灵魂状态 SETTLED,而这一格就在灵魂状态旁边，会读混。

## 三、顺带修正
`officer_app.egy.json` 里 `souls.events.REINCARNATION_COMPLETED` 还是第十一批的 Wehem Mesut Khetem Seth,已经按第十四批改成 **Wehem Mesut Kheper Seth**。Web 时间线请用同一个写法。
