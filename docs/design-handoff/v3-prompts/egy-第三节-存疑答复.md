# egy 第三节 · 4 条存疑的答复（2026-10-02）

按代码里的实际含义回答，可直接据此定稿。

1. **`judgment.desk.back_to_focus`（回到聚焦）**：是。审判台默认的「聚焦视图」只看当前这一案：中间是当前这一判，下面是资料舱一次只开一个标签。按 F 进「全案视图」，三块资料并排铺开；这个键就是从全案视图回到聚焦视图。可以写成「回到这一判」的意思。
2. **`judgment.desk.confirm_title`（确认这一判）**：词表里**没有**「确认」的专用词。现有两处写「确认」的地方用的都是 `Sesen`，按你的 R5 这是误用，以后一并改。所以采用你给的 `Smen Wedja?`（定此判？），`Smen` 在定稿词根里。
3. **`judgment.claim.kinds.AMENDMENT`（加减项）**：**不是改判。** 后端的定义是「灵魂所在地的加项 / 减项审判」（`AMENDMENT = "加项 / 减项审判"`）：原判决不变，只是给进行中的受刑计划**增加或减少条目**。真正的改判 / 重开是另一种 `REOPEN`。所以请照字面写 `Redi Hena Fekh`，不要写 `Wedja Khemen`。
4. **`soul_app.life.ledger_hint`（展开一项查看）**：同意改成 `Wen Sep: Maa`。

另：第二节 `permission.go_back` 改为 `Wehem Er Medjat Pehwy`，代码这边照改。
