# 第二十五批 · Design 回复(2026-10-12)

稿:`DeliverySlipBoard.dc.html`
- A · 双语骨架
- B1–B4 · 彩色(默认)
- C1 · 黑白打印

组件 `DeliverySlipCiv.dc.html` 的参数:
- `civ`:决定印哪种文字;
- `desk`:官员台界面语言,决定存根用哪种;
- `mono`:黑白打印。

第二十四批第二稿留在 `DeliverySlipCivV2.dc.html`。

## 一、交付单印两种文字

### 1. 欧洲、希腊:同意只印英文,另在匾额上加两三个固定的古文字词

整套文案不做拉丁文、希腊文。但匾额带的**眉题**换成固定的装饰文字。这是文明特色最显眼、成本最低的地方,而且只是名字,不需要翻译维护。

| 文明 | 左眉题(文明名) | 右眉题(原「灵魂簿 · 登录交付单」) |
|---|---|---|
| 天堂 / 地狱 | 接口给的英文文明名,如 INFERNO(照旧) | **LIBER ANIMARVM**(拉丁文「灵魂之书」,按铭文习惯用 V 代 U) |
| 哈迪斯 | **ΑΙΔΗΣ · HADES** | **ΒΙΒΛΟΣ ΨΥΧΩΝ**(希腊文「灵魂之书」) |

- 这两个右眉题就是「灵魂簿」本身的意思,只在这两种文明的交付单上出现,和语言无关。
- 希腊字母由现有的 Noto Sans SC / Noto Serif SC 覆盖,不需要新字体。
- 大字(殿名、Sign-in slip)仍按英文印。

### 2. 双语排法:主文字照原样,英文小一号跟在每一项下面

- **上联加高到 110 mm(794 × 416)**,这是 DL 信封的上限。剪线移到 416。
- **主文字**(中文 / 埃及文)的大小、位置都和第二稿一样。**英文**是 10px 的副行,紧跟在每一项下面。
- 选这个方案,不选「标签双语、正文按需」的原因:灵魂先看到的是自己的文字,英文是备份。所以英文**每一项都有,但始终更小一号**,不和主文字抢位置。
- 英文副行**只印要点**,所以有几条用新的短句(见第 6 点)。
- 「有效至」从句子改成表格里的一行(标签 | 时间)。这样时间只印一次,两种文字共用。
- 「只发给本人」移回正文区,放在「必须改密码」下面。二维码那一栏要留给双语的扫码说明。
- **只印英文的文明**(天堂 / 地狱、哈迪斯):没有副行,版式和第二稿一样,只是上联也是 110 mm。四种文明的骨架保持一致。

**存根:跟官员台的界面语言,只印一种。** 存根是给殿里档案用的,读的人是官员。剪线上的说明「✂ 沿此线剪下…」也是写给官员的,同样跟官员台语言。

### 3. 不翻译的数据,和时间格式

- 灵魂名、编号、官员名、时间都**只印一次**。
- 时间两种文字下统一印成 **`2026-10-15 00:40`**:等宽字体、24 小时制,不带秒。中文的「年月日」写法换了一种语言就看不懂,这个写法谁都看得懂。
- 72 小时写在时间后面:
  - 双语:`(72 小时 · 72 h)`;
  - 只印英文:`(72 hours)`;
  - 埃及文:`(Unut 72 · 72 h)`。

### 4. 匾额带

| 位置 | 印什么 |
|---|---|
| 左眉题 | 本文字文明名 · 英文文明名(两者相同就只印一个,如 DUAT) |
| 左大字 | **本文字**殿名 |
| 右眉题 | SOUL LEDGER · SIGN-IN SLIP(英文就放这里) |
| 右大字 | **本文字**单据名 |

- 英文殿名不印在上联(交付单本来就不印英文殿名)。存根标题右侧的殿名按官员台语言印。
- 匾额文字区两侧各让 12:同意。我把四种文明都改成了 72–722,骨架保持一致。

### 5. 字距

- **照旧,不因为双语调整:** 中文单据名 0.3em;英文、埃及文 0.06em;眉题 0.2em。
- 大字和眉题本来就分成两行,不存在两种文字在同一行里并排的情况。
- 唯一并排的是正文副行和交付官员那一行:英文 10px,不加字距。

### 6. 新的短 key

放在 `soul_accounts.credentials.slip.*` 下,现有的整句保留。

| key | zh | en | egy |
|---|---|---|---|
| system | 灵魂簿 | Soul Ledger | Medjat Ba |
| doc_title | 登录交付单 | Sign-in slip | Djama Redi |
| eyebrow_en(固定) | — | SOUL LEDGER · SIGN-IN SLIP | — |
| password_label | 初始密码 | Initial password | Sekhem Tepy |
| password_hint | 官员当面写上,或只口头告诉 | Written or told in person by the officer | Sab Sesh, Mi Djed |
| valid_label | 有效至 | Valid until | Wenen Er |
| valid_hours | 72 小时 | 72 hours | Unut 72 |
| must_change_head | ■ 首次登录必须改密码。 | ■ You must change the password at first sign-in. | ■ Aq Tepy: Smen Sekhem Mawy. |
| must_change_tail | 改完以后,这里写的初始密码就作废了。 | After that, the one written here no longer works. | Er Khet: Sekhem Tepy Hedj. |
| must_change_short(英文副行) | — | ■ Change the password at first sign-in. | — |
| qr_where | 灵魂簿 App 登录页 | Soul Ledger app · sign-in page | Medjat Ba: Aq |
| qr_action | 点「扫码」扫这里 | Tap Scan, then scan this | «Maa Tut Medu» |
| officer_label | 交付官员 | Issued by | Sab |
| printed_label | 打印于 | Printed | Sesh Djama Em |

- 埃及文全部取自第二十批的整句,只是在原来的断句处拆开,没有新造词。
- `must_change_head` 和 `must_change_tail` 放在同一行时,中间不加空格;埃及文、英文中间加一个空格。
- 英文副行用的标签是 en 列的大写形式。

## 二、颜色默认开:请保留「黑白打印」开关

- 原因:黑白激光机会把文明色的匾额印成**灰色网点**,白字压在网点上边缘发毛。殿名是这张纸上第二重要的字,发毛就不像正式凭据了。
- 勾上后,匾额、框、殿印改成纯黑(C1),白字清楚。
- 开关放在「打印交付单」旁边,默认不勾,记在这台电脑上。

| key | zh | en | egy |
|---|---|---|---|
| credentials.print_mono | 黑白打印 | Print in black and white | Sesh Kem |
| credentials.print_mono_hint | 打印机只能印黑白时勾上。匾额会印成纯黑,字更清楚。 | Tick this for a black-and-white printer. The band prints solid black, so the lettering stays sharp. | Sesh Kem: Djama Kem, Medu Seped. |

- egy 里的 Kem(黑)、Seped(清楚)是**新词**,请按词表核对。

## 三、忘记密码第 2 步:去掉强度条

- **去掉,和另外 5 处一致。**
- 强度条是手机自己估算的"好不好猜",服务器的判断(两万条名单、名字和编号)它不知道。所以会出现"强度条显示强,点保存却被服务器以太常见拒绝"的情况,两个东西互相矛盾。
- 清单逐条说清了能检查的项,◇ 那一行说明了服务器另外查什么,强度条没有补充任何新信息。
- 被服务器拒绝时的报错照第二十三批 A5 的做法。

## 四、稿上的占位

- 埃及殿名 Wesekhet Sen-Nu、各殿官员名都是示例。
- 埃及殿印里的象形字在我的截图里仍显示得不对,请以真机打印为准。
