# 第十七批 · Design 回复(2026-10-10)

## 一、更正

**1. 「轮回完成」= Wehem Mesut Khetem Seth。** `officer_app.egy.json` 已经改回来了。
- 你们引的那段话出自第十一批的回复。第十四批的回复里我写的是 Kheper Seth,和第十一批正好相反。是我自己前后矛盾。
- 第十六批我按第十四批的写法改了 json,改错了。
- 现在定为 Khetem Seth,第十四批那条作废。理由有两条:
  - 它和 Tepy Seth / Khetem Seth 这一对写法一致;
  - `stage_next_life_hint` 里已经用过这一串。
- 和灵魂状态 SETTLED 撞车的问题，靠前缀 Wehem Mesut 区分。

**2. 「移交」= Hab-Ba:确认。** 调拨本来就是一条移交，用同一个词是对的。我上一批担心两个概念撞车，这个担心不成立。Swedj 不登记。

## 二、15 条：换词 5 个，登记 2 个

- **Bu → 换词**:保留在废止名单里。「首页」= Pesh Tepy(第一页)。
- **Wer → 换词**:保留在废止名单里，整句改写。
- **Ir → Iri**。是我写错了，不另开词。
- **Ket → Khet**。Khet 已经有「东西 / 事由」的意思(Khet Khesef),「条目」也用它。
- **Hap → Smen**。被规则挡下 = 被配置挡下，不另开词。
- **Ip → Maa**(查看)。
- **Kheri → Khery**。已登记，有「在下」的意思(Medu Imen Khery)。
- **登记**:Mawy、Sni。

| key | egy |
|---|---|
| soul_app.errors.go_home | Er Pesh Tepy |
| permissions.config.errors.too_large | Djama Nen Smen: Aa Er {max}. |
| soul_app.update_required.title | Iri Mawy |
| soul_app.update_required.body | Hemet-Sesh Pen Nen Iri Djer. Iri Mawy: Sesh-Ek Hena Medjat-Ek Wenen Djer. |
| soul_app.update_required.button | Iri Mawy |
| permissions.config.will.update | Er Iri Mawy |
| permissions.config.did.update | Iri Mawy Seth |
| permissions.config.will.skip | Er Sni (Wenen Seth, Mi Khesef Em Smen) |
| permissions.config.did.skip | Sni Seth (Wenen Seth, Mi Khesef Em Smen) |
| permissions.config.checking | Maa Djer… |
| permissions.config.more | Khet Ky |
| permissions.config.merge_note | Tepy: Redi Hena. Khet Em Djama, Nen Em Hemsu — Redi Hena; Khet Wenen Seth — Nen Iri Mawy, Nen Hedj. Hedj Hena Ini: Setep Em Nemet Ky. |
| permissions.config.download_skipped | Redi Per Khet Sni |
| permissions.config.errors.empty | Nen Khet Er Ini Em Djama. |
| officer_app.update_required.body | Hemet-Sesh {{version}} Khery Hemet-Sesh Wesekhet {{min}}. |

- 「覆盖」= **Hedj Hena Ini**(删掉再导入)。这是用已有的词拼出来的，不开新词。
- 「默认」= Tepy(第一项)。Em Djes-Ef 是「自动」的意思，不能用在这里。

## 三、新增 28 条(+1)

### 书信
| key | egy |
|---|---|
| officer_app.todo.groups.letters | Sesh Er Wesheb |
| officer_app.kinds.letter | Sesh |
| officer_app.letter.irreversible | Er Khet Hab: Nen Sehen. |
| officer_app.letter.unavailable | Sesh Nen Wen Djer |
| officer_app.letter.failed | Nen Per Wesheb. Sesh-Ek Wenen Djer: Wehem Iri. |

- `failed` 同已有的 `Nen Per Wesheb`。
- 「书信」= Sesh,同灵魂端 `update_required.body` 里的 Sesh-Ek。

### 灵魂筛选
| key | egy |
|---|---|
| souls.detail.case_all | Wedja Neb {{n}} › |
| judgment.soul_filter | Ba |
| judgment.soul_filter_clear | Sehen Setep Ba |

### 覆盖
| key | egy |
|---|---|
| permissions.config.will.remove | Er Hedj |
| permissions.config.did.remove | Hedj Seth |
| permissions.config.mode.label | Setep Ini |
| permissions.config.mode.merge | Redi Hena (Tepy) |
| permissions.config.mode.overwrite | Hedj Hena Ini |
| permissions.config.overwrite.warning | Hedj Hena Ini: Hedj Khet {n} Nen Em Djama. Nen Sehen Er Khet. |
| permissions.config.overwrite.warning_own | Hedj Hena Ini: Hedj Khet {n} Nen Em Djama, Hena Khet-Ek. Nen Sehen Er Khet. |
| permissions.config.overwrite.all_halls | Smen Nen Em Wesekhet Wa: Hedj Hena Ini Er Wesekhet Neb, Nen {hall} Wa. |
| permissions.config.overwrite.blocked_own | Khet Nen Em Djama: Hena Khet-Ek. Nen Hedj Hena Ini. Redi Hena Em Djama, Mi Setep Redi Hena. |
| permissions.config.overwrite.action | Hedj Hena Ini |
| **permissions.config.overwrite.confirm_hint**(新) | 中文「输入「覆盖」以确认」/ English「Type "Overwrite" to confirm」/ egy **Sesh «Hedj Hena Ini»: Hesy** |

- `mode.overwrite` 和 `action` 写成同一串可以。中文这两处也只差「导入」两个字。
- `confirm_hint` 的说明见第四节第 2 条。

### 密码
| key | egy |
|---|---|
| profile.password_changed_others_out | Sekhem Mawy Seth. Medjat Ky: Per Aq Seth. |
| profile.password_reason_common | Sekhem Pen Wenen Em Neb. Setep Ky. |
| profile.password_reason_numeric | Sekhem: Nen Hesb Neb. |
| profile.password_reason_similar | Sekhem Mi Ren Aq. Setep Ky. |
| profile.password_reason_invalid | Sekhem Nen Smen. Setep Ky. |
| profile.password_old_wrong | Sekhem Tepy Nen Maat |

- 用词沿用已有写法：密码 = Sekhem(同 `bad_credentials`),设备 = Medjat(同 `logout_title`),退出 = Per Aq。
- `old_wrong` 同 `Medu Ahet Nen Maat` 的句式。

### 书信发图
| key | egy |
|---|---|
| soul_app.chat.image.failed | Nen Per |
| soul_app.chat.image.errors.too_many_pending | Tut Hab Djer. Setep Er Khet. |
| soul_app.chat.image.errors.images_unavailable | Er Wesheb-Ef: Sesh Medu Wa. |
| soul_app.chat.image.button | Tut |

- 「图片」我用 **Tut**。如果朋友圈已经有图片的 egy 词，就照朋友圈改，四条都换。如果朋友圈没有，请登记 Tut。

## 四、知悉的四件

1. **改密码**:照现在。
2. **覆盖的确认词**:同意你们的判断，用殿名来确认不对。
   - 改成输入「覆盖」这个词(按当前语言显示)。提示文案用上面新增的 `confirm_hint`。
   - `all_halls` 那句放在确认输入框的正上方，紧挨着。
   - 「包括你自己的」只在确实包含时才显示，照现在。
3. **书信发图**:
   - **入口**:确认用「图」字键，44×44。读屏标签用 `soul_app.chat.image.button`。以后图标集里有了图片图标再换。
   - **大图查看器**:不统一，两端各按平台的习惯来。
     - Web 保留「关闭」按钮和 Esc 键，因为键盘和鼠标需要能看到的出口。
     - 灵魂 App 照现在点一下关闭，但补上「2 / 4」计数(只在不止一张时显示)。计数位置在顶部居中，13px,白字。
   - **推送和通知预览**:照现在，不加「[图片]」。锁屏上本来就不该透露书信内容。
4. **页码**:确认用 `print.page_label`。`page_pre / page_mid / page_post` 三个键作废，可以删掉。
