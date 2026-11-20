# v3 第十批 · 收尾 · 设计回复(2026-10-09)

> 存档自 Claude Design 项目 `bf5707ac…` `templates/soulledger-v3-pages/v3-batch10-wrapup-reply.md`(含 10-09「补充」节)。
> egy 表同目录 `A14-officer_app.egy.json`。画面在 Design 的 A14(14a–14k):`OfficerAppIcons`、`TrendPanel`、`OfficerApp detail="cosign"`。

## 一、画面

### 1. 官员 App 图标(14a)
- **iOS 1024**:纸色满幅 #EFEFEB,方形不带圆角(圆角由系统遮罩);墨标 #181A17,标高 52%(532 px),视觉中心上移 8 px。
- **Android adaptive**:前景 108 dp 透明底，标高 40 dp,整体落在 66 dp 安全圆内，同时作为 monochrome 层(Android 13 主题图标);背景纯色 #EFEFEB。
- **通知小图标** `ic_stat_officer`:24 dp,白色加透明，标高 18 dp;颜色由系统着色，不要导出成墨色。
- **启动屏**:#EFEFEB 是浅色 `--color-canvas`,#181A17 是浅色 `--color-ink`。启动屏固定用浅色，不跟随系统深色。
- 九笔路径用 `BrandMark` 的 SVG 直接导出，不要描图。

### 2. 个人资料里的两步验证：同意，用分节
- 不加子导航。「丁 · 两步验证」的行结构照 A12 面板：开启于、最近使用、恢复码、关闭;每行最小高 56,标签列宽 160。
- 个人资料满五节时再考虑子导航。

### 3. 重置对话框：同意，用 640 BaseModal
保留 `role="alertdialog"`、两个必填项、danger 色确认按钮。

### 4. 殿设置 › 安全：同意，放在底部
- 组前加 1px 分隔线和组标题「安全」(font-title 600 17)。
- 安全类设置到两组以上时再加页签。

### 5. 仪表盘趋势面板：正式稿(14b–14i)
**改为小多图**:每个状态或文明一格，纵轴各自独立(「在世」约占六成，同轴会压平其余线)。原实现(冷灰蓝梯度、线型、字形图例)换掉。

面板结构：
- 外框：surface-1,1px line,圆角 8,内边距 20。
- 头部：标题「趋势」font-title 600 20;下方 12 号小字「每日 00:00 快照 · 较区间起点」。
- 两组分段开关，每段高 44:区间(30 天 / 90 天 / 12 个月)、维度(状态 / 文明);选中项墨色实底。
- 格子网格：状态 6 格 `minmax(300px,1fr)`(1440 下 3 列);文明 4 格 `minmax(240px,1fr)`(1440 下 4 列);393 下都是 1 列。
- 每一格:
  - 顶边 1px ink;
  - 格名用字形加文字(○ 在世、■ 中国地府……);
  - 当前值 mono 20;
  - 变化写「↑ / ↓ / → 百分比」,不用 ▲▼(▲ 是埃及字形);
  - 线 2px `--color-chart-1`;
  - 左侧标区间最高与最低值，mono 11;
  - 底部标起止日期。
- 读屏：每格一个 `figure`,`aria-label` 读「名称，当前值，升 / 降 x%」。
- 文明色不进图表。
- 名字过长:(Design 10-09 修正)数值与变化另起一行放在格名下;仍放不下时截断加「…」。

状态：
- **空态**:面板照常，开关可用。正文「○ 还没有快照」,说明「每天 00:00 记一张……区间没满时只画已有的天数」,底部一条虚线基线。
- **区间未满**(部署后第 1–29 天):上方加 ◐ 提示「只有 N 天的快照……左边空着的部分不是零」;线只从有数据的那天画起。
- **加载**:格子骨架,`aria-busy`。
- **出错**:Notice「! 趋势没取到」加「重试」;上方统计数字不受影响。

### 6. 官员 App 的两处缺口
- **加签置灰(14j)**:按钮上方一行「◇ 加签暂未开通，现在只能查看候选人。」,13/20,`aria-describedby` 关联到按钮。按钮 surface-2 底、ink-subtle 字,`aria-disabled`。候选人照常可选。不提后端，不承诺时间。
- **写评议：隐藏，不置灰**(置灰像没权限)。审判页底部说明句改为「手机上可以认领和查看案子。宣判和盖印请在官员台完成。」,key `queue.scope_note`。

## 二、埃及语

失败写法一律「Nen + 动词」,本批没有用 Nen Kheper。

### A. 多角色
| key | egy |
|---|---|
| users.roles_dialog.primary_hint | Netjer Hery: Sab Hery Er Nen; Hena Hesb Was. |
| users.roles_dialog.extra_hint | Was = Was Netjer Hery Hena Was Netjer Ky Neb. Nen Redi En Netjer Neb: Em Netjer Pen Wa — Heri-Tep Per Ahet Hena Sab Wedja: Hesy Em Sab Wedja. Iri Sab Hery Wa: Netjer Hery Wa. |
| users.roles_dialog.extra_none | Nen Netjer Ky |
| users.roles_dialog.admin_locked | Netjer Em Tepy Shesep Seth Was Neb; Nen Redi Netjer Ky. |
| users.batch.skipped_note | Sab Hery Hena Djes-Ek: Nen Em Iri Neb. |

### B. 两步验证(审定)
| 中文 | egy |
|---|---|
| 验证器 App | Kat Medu Ahet |
| 手机 / 设备 | **Kat Aq**(Kat 单用是「组件」) |
| 二维码 | Tut Medu |
| 密钥 | **Medu Imen**(Medu Khetem 已是「印字」) |
| 扫描 | Maa,只在「Maa Tut Medu」里用 |
| 两步验证 | **Aq Sep Sen** |
| 恢复码 | Medu Ankh Wehem |
| 动态码(新增) | **Medu Ahet** |

### C. 官员 App
全部在 `A14-officer_app.egy.json`。一词两值的选定:
- 审判页签 Sepu Wedja;
- 通知 Sedjem Sab;
- 待我处理 Nen Iri-I Djer;
- 转生申请 Dbh Wehem Mesut;
- 批准 Hesy(不用 Sesen);
- 语言 Medew Seth;
- 用户名：登录表单 Ren Aq,资料 Ren。

Design 说明：有些 key 未见中文原文，按 key 名写成，请对照原文核对。

### D. 语言名
- English:**Medu Europa**
- Kemet / egy:**Medu Kemet**

殿设置语言下拉里的替代写法换成这两个。
