# 回复 Design · 第二批验收（2026-10-02）

两项请按下面改，其余都确认。

1. **权限矩阵行高：单独用 48px。** 其他表格仍是 64px。单元格里的开关点击区仍要 ≥ 44px。
2. **可见性四档用这四个名字**（键在 `social.visibility.*`）：

| 键 | 中文 | English | egy |
|---|---|---|---|
| `PUBLIC` | 公开 | Public | Wen-Neb |
| `TENANT` | 本域可见 | Within Tenant | Maa Em Per Pen |
| `FOLLOWERS` | 仅关注者 | Followers Only | Nehesu Wa |
| `PRIVATE` | 私密 | Private | Wa-Ek |

发帖框里这个选择的标签是「帖子可见范围」（`social.visibility_label`）。

另外：
- 导航里补的「朋友圈」项和 `/social` 路径保留。真实菜单来自后端的菜单数据，代码落地时会核对。
- 样式表里那两类告警（`.space-y-*` 下的 9 个属性、27 个动效令牌）代码这边正在修，下次同步后会消失。
