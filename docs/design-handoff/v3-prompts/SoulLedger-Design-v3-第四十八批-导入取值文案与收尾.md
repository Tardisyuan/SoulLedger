# 第四十八批 · 导入取值提示文案与收尾(2026-10-20)

第四十七批的回复都已用上：画布图例 `workflow.editor.legend.unconnected_exit` 三语照用；`jump_target_required` 的 egy 照你确认的写法。另外两件已经定了、已经做了：

## 一、导入与补录的「出身地域」取值已统一(要一条文案)

用户定了：灵魂导入现在和出身地域补录认同一套写法，都是 `EUROPE` / `Europe` / `欧洲`、`ASIA` / `Asia` / `亚洲`、`UNKNOWN` / `不详` / 留空，大小写不限。

所以导入那条行错误的文案要改：

| 键 | 现在的 zh-Hans | 现在的 en |
|---|---|---|
| `souls.import.row_codes.invalid_origin_region` | 只能是 EUROPE、ASIA 或留空 | Must be EUROPE, ASIA or blank |

请给新的 zh / en / egy，说法和补录的 `souls.region_backfill.values_hint`(出身地域填 {{europe}} / {{asia}}；留空 = {{unknown}})一致。这条是行错误，没有占位符可用；如果你觉得应该带占位符，请直接写出，我们照着改代码。

## 二、`archived/` 已删除

确认过：设计系统里没有任何页面、预览、脚本或样式加载 `archived/`(55 个组件预览只在注释里写着「formerly _preview/X.js」，代码是内嵌的)。旧文件的原件在本地镜像里还有一份。

删完以后有一份说明文档过时了：`assets/notes/COMPONENTS.md` 的表格指向 `project/components/<分组>/<组件>/<组件>.jsx`、`.prompt.md`、`.html` 这些旧路径，迁移后就已经不存在了。请把它改成指向 `components/<组件>/README.md`、`<组件>.d.ts`、`preview.html`，或者删掉这份(`MIGRATION-REPORT.md` 是迁移当天的记录，留着不改)。

## 三、README 的「## Tokens」那一节

那句「They are declared inside `components/bundle.css` (this DS ships one compiled stylesheet rather than separate token files)」也请改掉，和你已经改好的那两句同一个说法：页面上的 token 在 `tokens.json` / `tokens.css`，`components/bundle.css` 里保留原始颜色三元数。

## 四、和稿不同的一处，已经改成与图例一致

图例写的是「从端点拖到节点即连上」，现在每个短桩的空心端点都能直接拖：从哪个端点拖，接的就是哪条出口。从卡片底部的通过端口拖，仍然按 欧洲 → 亚洲 → 不详 的顺序依次接。

## 要的回复
1. 第一节那一条的 zh / en / egy。
2. 第二、三节改完说一声。
