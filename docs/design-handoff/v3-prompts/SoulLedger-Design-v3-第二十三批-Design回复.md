# 第二十三批 · Design 回复(2026-10-11)

稿:`PasswordRulesBoard.dc.html`(A1–A5 灵魂 App,B 官员台)。单屏组件 `PasswordRulesApp.dc.html`(`state` = entry / typing / done / savefail / rejected),`PasswordRulesDesk.dc.html`。

## 一、5 件事

1. **列哪几条:同意你们的分法,另加一行说明。**
   - 新密码框下列 1、2、3 三条。
   - 第 4 条单独放在确认框下。
   - 5 和 6 合成一行说明,用 ◇,不打勾:「别用常见密码,也别用自己的名字或编号」。不加这一行的话,用户把三条都打了勾,点保存还是被拒,会觉得清单骗人。
   - 三条都写成「做到了什么」(不只是数字 / 和当前密码不同),打勾时读起来才通顺。
2. **什么时候出现:一进页面就列着。** 不等点进框才出现,理由有三:
   - 用户输入之前就能看到要求;
   - 清单不会突然冒出来、把下面的确认框和按钮顶下去;
   - 读屏用户按顺序就能读到。

   用户说的「突然显示」,我们理解为想要「边输边打勾」,这一点照做。
3. **三种状态:**

   | 状态 | 符号 | 文字 |
   |---|---|---|
   | 还没输 / 还没达标 | ○ | ink-muted,400 |
   | 已达标 | ✓ | ink,500 |
   | 没达标(已离开框或点了保存) | ! | danger,600;对应的框描红 |

   - 不用 ◐。它在规范里的意思是「进行中」,放在这里会和 ○ 混淆。
   - ✓ 不用绿色。规范里冷玫红只表示错误,没有「成功色」;能区分状态的是符号和字重。
   - **用户还在输的时候不标红,只会从 ○ 变成 ✓。** 输「1234」时第 2 条保持 ○,不变成 !。焦点离开这个框、或者点了保存时,没达标的才变成 !。
   - 已经标了 ! 的条目,再改到达标会直接变成 ✓,不用等离开框。
4. **「保存」:一直可以点,不置灰。**
   - 第 5、6 条本来就只能靠提交来检查。置灰的按钮也不会说明哪里不对,读屏用户会卡住。
   - 有没达标的条目时点保存(A4):不发请求;没达标的条目变成 !,对应的框描红;焦点移到第一个有问题的框;读屏念 `summary`(见文案)。
5. **框下那行「至少 8 位」:去掉。** 已经并入清单第 1 条。`new_password_min`(「新密码至少 8 位」)保留,给旧版客户端和服务器的报错用。

## 二、键盘弹出时(A2、A3)

- 清单跟在新密码框下面,不放到页面底部。
- 新密码框获得焦点时,页面滚动到让新密码框的标题停在内容区顶部 24 处。上面的「当前密码」框滚出屏幕。
- 按 393 × 852、键盘 336 高(含联想栏)计算:内容区可见 457。新密码框加清单 192,确认框加一致那一行 140,再加「保存」56。全部能放下,保存按钮也在键盘上方。
- 确认框获得焦点时,保持同样的滚动位置,不再往下滚,清单仍然看得见。
- 系统字号调大以后放不下时,先保证「当前获得焦点的框 + 它下面那一行」能看到。清单可以有一部分被挡住,因为离开框时的 ! 会被读屏念出来,也会在框上描红。

## 三、服务器以「太常见」拒绝(A5)

- ◇ 那一行换成报错,位置在新密码框正下方、清单上方:
  - **! 这个密码太容易被猜到**
  - 它在常见密码名单里,或和你的名字、编号太像。换一个再保存。
- 前三条和「两次一致」仍然显示 ✓。错的不是它们,打勾不撤回。
- 新密码框描红。两个框里的内容保留,焦点回到新密码框,并全选内容。
- 服务器如果能区分 5 和 6,请分别返回不同的错误码,我们再拆成两句。现在先用一句话同时说两种情况。
- 第 2 条现在由手机自己检查,所以这句也替换掉现有的「强度不足」。

## 四、6 处都用

- 确认 6 处全部使用。没有「当前密码」框的页面(忘记密码第 2 步、两处重置密码)不显示第 3 条,清单只有 2 条加 ◇ 那一行。
- **官员 App:** 版式和灵魂 App 完全相同,不另画。
- **官员台 Web(B):**
  - 页面够宽,清单放在新密码框**右侧**,和框顶部对齐;「两次一致」放在确认框右侧。表单不会因为清单变长。
  - 输入框高 40,清单字号 13,和 App 相同。
  - 状态规则和 App 相同。按 Tab 离开框就算「离开」,在任一框里按 Enter 等于点保存。
  - 窗口宽度小于 720 时,清单改回放在框下面。

## 五、文案

key 建议放在公共命名空间 `password_rules.*`,三端共用。

| key | 中文 | English | egy |
|---|---|---|---|
| password_rules.min_length | 至少 8 位 | At least 8 characters | Sesh 8 Er Hry |
| password_rules.not_digits | 不只是数字 | Not only numbers | Nen Em Hesb Djesef |
| password_rules.not_current | 和当前密码不同 | Different from your current password | Ky Er Sekhem-Ek |
| password_rules.match | 两次输入一致 | Both entries match | Sen Wa |
| password_rules.match_bad | 两次输入不一致 | Entries don't match | Sen Nen Wa |
| password_rules.note | 别用常见密码,也别用自己的名字或编号 | Avoid common passwords, your name or your soul number | Nen Sekhem Rekh-Tw, Nen Ren-Ek, Nen Ren Hesb |
| password_rules.common_title | 这个密码太容易被猜到 | This password is too easy to guess | Sekhem Mawy Rekh-Tw |
| password_rules.common_body | 它在常见密码名单里,或和你的名字、编号太像。换一个再保存。 | It's on a list of common passwords, or too close to your name or number. Choose another. | Rekh-Tw Pw, Mi Ren-Ek. Sesh Ky. |
| password_rules.state_ok(读屏) | 已满足 | met | Maat |
| password_rules.state_bad(读屏) | 未满足 | not met | Nen Maat |
| password_rules.summary(读屏,点保存时) | 新密码还有 {{n}} 条没满足:{{list}} | {{n}} requirements not met: {{list}} | Sekhem Mawy: {{n}} Nen Maat — {{list}} |

**读屏:**
- 清单通过 `aria-describedby` 关联到新密码框。获得焦点时,先念框名,再按顺序念每一条加状态,例如「新密码,编辑框。至少 8 位;不只是数字,已满足;和当前密码不同,已满足」。
- ○ 状态不加后缀,符号本身对读屏隐藏。
- 输入时不用 live region,不然每敲一下都会播报。只在离开框、点保存、服务器拒绝这三个时刻播报,用 `role="alert"`。
- `match_bad` 只在离开框或点保存后显示;用户还在输时,确认框下照常显示 ○ `match`。
