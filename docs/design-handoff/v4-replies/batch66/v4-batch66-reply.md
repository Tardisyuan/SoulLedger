# v4 · 第六十六批 · 回复：4 个 egy 词 + 三处动效

**交付文件：**

| 文件 | 内容 |
|---|---|
| `v4-batch66-egy.json` | 4 个键 |
| `_egy_lexicon.tsv` | 7714 行，追加 4 行，没有改旧行 |
| `v4-batch66-reply.md` | 本回复 |

## 一、4 个键的 egy

**没有新词根。**

| 键 | egy | 说明 |
|---|---|---|
| `death_sync.api_keys.allowed_sources` | Tepy Wenen | 「可用的来源」。Tepy（来源）同 `dispatch.source_label`，Wenen（可以）同 `status.ACTIVE` 的用法 |
| `death_sync.api_keys.allowed_sources_hint` | Tepy Wenen Er X-Source-System, Mi: HOSPITAL, POLICE. Nen Sesh: Kher-N Hemsu Djes-Ef Wa. | 「留空则只能用它自己的系统类型」写成「不写：只有它自己的系统类型」。Kher-N Hemsu 同字段名 `system_type_label`。「用逗号分隔」没有单独写：例子里已经是逗号 |
| `death_sync.webhooks.url_invalid` | Wat: Tepy Em http:// Mi https:// | 网址字段本身叫 Wat（`death_sync.webhooks.url`）；「或」用 Mi |
| `map.pause_motion` | Smen Shem | 「停住流动」。Smen 是暂停（同 `auth.error_locked_title`），Shem 是走 |

**原样保留：**`X-Source-System`、`HOSPITAL`、`POLICE`、`http://`、`https://` 不翻，照你说的保留。词表检查如果把它们当成生词，请把这几个加进放行名单（同 `judgment.execute`、`webhook` 这类已有的原文）。

## 二、三处动效时长

1. **落印后选中下一件：改。**行的离场动画（划线 80 → 滑出 160 → 收起 160）照旧播，选中立刻移到下一件，不再等 400ms。离场的那一行只是在退场，已经不是「当前件」。撤回条和 5 秒倒计时照旧，撤回时选中回到那一件。
2. **换件时卷宗的 240 淡入上移：改。**来自键盘（J / K、方向键）的切换不播，直接换内容；上一段还没播完又换件时，也不播，直接换。鼠标点选照旧播 240。这样按住 J 扫卷时内容不跳，偶尔点一下换件时仍有「换了一件」的感觉。
3. **概览数字从 0 滚 900ms：改。**每次会话第一次进概览才滚（数字、环、KPI 条一起）；之后再进直接显示终值。会话里数字有变化时，不从 0 重滚，用现有的「行变更」高亮标出变了的那格（墨 10%，停 1.6 秒、淡 0.4 秒）。减少动态效果时照旧一律不滚。

三条都不改令牌的值：落印、行离场、卷宗淡入、数字滚动的时长都还是原来的，改的只是什么时候播、什么时候不用等它播完。

**检查：**

- 占位符：这 4 个键没有占位符。
- egy 都是词表里已有的词（原样保留的原文除外）。
- 4 个键都在官员一侧，没有 -Ek / -I。
