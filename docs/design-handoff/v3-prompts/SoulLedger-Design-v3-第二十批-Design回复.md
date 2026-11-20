# 第二十批 · Design 回复(2026-10-11)

稿：`SoulLoginBoard.dc.html`(23 屏 + 官员台 2 张)。单屏组件:
- `SoulLoginApp.dc.html`:`screen` / `state` / `device`(face / finger)/ `civ` / `theme`
- `CredentialDesk.dc.html`:官员台「初始密码交付」页
- `DeliverySlip.dc.html`:交付单，A4 原尺寸(794×1123 = 210×297 mm)

## 一、6 个问题

**1. 二维码：选 (a),只放编号。**
- 内容：`SL1:QU33Q9FW5F`。`SL1:` 是格式前缀(带版本号),后面是 10 位编号，不带分隔符。全是大写和冒号，能用 QR 的字母数字模式，码小、好扫。纠错级别 M。
- 不用网址：还没有自己的域名(和通行密钥同一个原因)。别的扫码软件扫到，只会显示这串字，不会出事。
- App 只认 `^SL1:[23456789ABCDEFGHJKMNPQRSTUVWXYZ]{10}$`,其余都算「不是我们的码」(B3)。
- **密码不印在单上**。单上留一格「初始密码 · 官员当面写上，或只口头告诉」。写不写由官员当场决定，这样现在口头交付的做法不用改。写上以后，这张单在 72 小时内、本人改密码之前就等于钥匙，所以单底印一行「只发给本人，不要拍照转发」。

**2. 分组：3-4-3。** 例：`QU3 3Q9F W5F`。
- 每组不超过 4 位，念一组、记一组、输一组，不用回头看。5-5 一组太长，念到一半要换气。
- 3-4-3 两头对称，对照纸面找位置时，更容易看出自己输到哪了。
- 屏幕上组与组之间用间距隔开，不放字符(UI 里是 `gap`,纯文本场合用一个空格)。复制出去的是不带分隔的 10 位。
- 所有地方都用这一种：显示、输入框、交付单、存根、页脚、设置页底部、第十八批「手机和恢复码都没有了」那页。**第十八、十九批稿上的 `S-0042-1187` 是旧写法，作废**,改成分组写法。
- 读屏：逐个字符念，组之间停顿。`aria-label="灵魂编号 Q U 3，3 Q 9 F，W 5 F"`:字符之间用空格，组之间用逗号。字母按英文字母名念。

**3. 记住编号后的登录页：照你们的设想(C1)。只记最近一个。**
- 编号那一栏换成一行只读卡片：上面是灵魂名(17/600),下面是分组编号(mono,muted),右边是「换一个账号」(文字按钮，点按区 44)。下面只有密码框，焦点直接在密码框里。
- 点「换一个账号」先弹一个确认(C5),因为它同时会关掉面容登录。确认后回到 A1。
- 不记多个：
  - 每个灵魂只有一个账号，同一部手机上能切换多个账号的情况很少;
  - 记多个，就要在登录页上列出别人的名字和编号，共用手机时等于互相公开;
  - 要换人，扫一下交付单就行。

**4. 面容 / 指纹**
- **在哪开**:两处都有。
  - **首次登录成功后问一次**(D1):在必须改密码那一步完成之后，进首页时弹底部弹层。选「以后再说」就不再问，以后只能在设置里开。手机没有录入面容或指纹的，不问。
  - **设置 › 账号安全**:排在第三行，在「修改密码」「两步验证」之后(D2)。前两行管的是整个账号，在哪台手机上登录都算数;这一行只管这部手机，所以单独排在后面，副标题写「只在这部手机上」。用开关，不带 ›。
  - 在设置里开启要先输当前密码(D3),理由同第十九批开启两步验证要先输密码。关闭不用输密码，直接关。
- **登录页**:从冷启动打开 App、并且已开面容登录时，自动弹系统验证(C3)。页面上同时有「用面容登录」主按钮和「输入密码」链接(C2)。
  - 用户点了取消：停在 C2,不再自动弹。
  - 系统判定失败(系统自己的重试次数用完):出现密码框，上面一行写「面容没认出，请输入密码」,下面有「再用面容试一次」(C4)。
  - App 从后台切回来时不自动弹。
- **文案按设备写**:iOS 带面容的写「面容」,Android 和带指纹的设备写「指纹」,同一套 key 只换一个词。D5 是指纹的例子。
- **系统弹窗上的理由**(iOS `NSFaceIDUsageDescription`):`用来登录灵魂簿，不用输密码。`
- **开了两步验证：照你们的倾向，还要输 6 位数字**,除非这部手机在 30 天免询问期内。面容只代替密码，两步验证照常要求。这样不管用哪种方式登录，规则都一样，第十八批的规则不用改。
- **D1 上写明风险**:「手机里录入的面容 / 指纹都能用来登录，和家人共用这部手机就别开」。安卓上可以录多个人的指纹，系统分不出是谁的指纹。

**5. 什么时候忘：确认你们的设想，补两条。**

| 情况 | 编号 | 面容登录 | 登录页 |
|---|---|---|---|
| 退出登录 | 留着 | 留着 | C1 / C2,没有提示 |
| 换一个账号 | 忘掉 | 关闭 | A1 |
| 在这部手机上改了密码 | 留着 | **留着**(改完自动重新绑定) | 没有提示 |
| 在别处改了密码(Web、找回密码) | 留着 | 失效 | E1 |
| 本殿官员重置了密码 | 留着 | 失效 | E2 |
| 转生，换了新一世的账号 | 留着(编号不变) | 失效;30 天免询问也一起作废 | E3 |
| 手机上的面容 / 指纹有变动(系统让密钥失效) | 留着 | 失效 | E4 |

- **补一**:在这部手机上改密码时，本人刚输过旧密码，没必要让面容登录失效。
- **补二**:手机里新录了一张脸或一个指纹，系统会让我们存的密钥作废(iOS `biometryCurrentSet`,Android `setInvalidatedByBiometricEnrollment(true)`)。这时一定要提示，不然灵魂会以为 App 坏了。
- **实现**:不存密码。开启时由服务端发一个这部手机专用的凭据，存在钥匙串 / Keystore 里，要验证面容才能取出来。服务端吊销凭据时返回原因，取值为 `password_changed` / `password_reset_by_officer` / `account_reincarnated`,登录页按原因选 E1–E3。E4 是手机本地判断的。
- 失效时提示用中性样式(◇,line-strong 描边),不用 danger,因为不是出错了。灵魂名先显示上次登录时的名字，登录成功后更新。

**6. 扫码页**
- 取景(B1):全屏相机，248 的方框，下面说明「把交付单上的二维码放进框里」。扫到就返回登录页，编号自动填好，焦点到密码框，编号下方一行「✓ 已从二维码填入」(A4)。扫到的同时手机震一下。
- **手电筒：要**(B2)。殿里光线往往不够。用开关，开了以后按钮变成实心。
- **无效码**(B3):顶部出 danger 提示条，相机不停，继续扫。等扫到有效的码，或 4 秒内没有再扫到无效码，提示条自动消失。
- **权限被拒**(B4):不进相机，换成说明页，有「去系统设置打开 ↗」和「手动输入编号」两个按钮。第一次请求权限时的理由文案:`用来扫交付单上的二维码。`
- **相册：不做。** 交付单是纸，就在手边。从相册选图要多申请一个权限，而且这个功能鼓励的正是「把交付单拍下来传给别人」,我们不想鼓励。

## 二、输入规则(D · 好念好输)

- 输入时自动大写，自动跳过空格、`-`、全角空格和全角 `－`,字符之间自动按 3-4-3 分组。
- 输了字符集以外的字符：**不放进框里**,当场提示，描边变 danger(A3)。提示写出具体是哪个字符，再下一行说明编号不用哪五个字符。下一个有效字符输进来，提示就消失。
- 输了 0 / O / 1 / I / L 以外的符号：提示「! 编号只有字母和数字」。
- 粘贴：先去掉分隔符，再转大写。只要有一个无效字符，整段都不粘，提示同上。
- 输满 10 位后，焦点自动跳到密码框，与「输满 6 位自动提交」的做法一致。不满 10 位时「登录」不可点。
- 输入框属性:`autocapitalize="characters"`、`autocorrect="off"`、`spellcheck="false"`、`autocomplete="username"`。密码框用 `current-password`,这样系统的密码管理也能帮忙填。
- 扫码入口放在编号框里面的右端，和框连成一体(左边一条分隔线)，图标加文字「扫码」，点按区 48。第一次来的灵魂手里正拿着交付单，看框的时候就能看到入口。

## 三、官员台

- **入口(F1)**:放在每一行的动作里，排在「查看密码」(或「重试发送」)之后、「标记已交付」之前。都是文字按钮。
  - 待交付(`PENDING`)、已查看待交付(`REVEALED`):「打印交付单」。发送失败的行也给打印，官员可以不等重试，当面交。
  - 已线下交付(`DELIVERED`):只剩「补打交付单」(muted)。单上没印密码，补打没有风险。
  - 已过期、已作废(`VOID`):不给打印，因为单上的有效期已经不对了。只留现有的「去重置」。
  - 打印不改状态。「标记已交付」仍要先「查看密码」(`deliver_not_revealed` 不变)。
- 点了直接调起浏览器打印，不另做预览页。
  - 打印写进审计日志，动作是 `credentials.print_slip`,不要求填理由。
  - 写日志的请求失败时不打印，用现有的 toast 显示 `print_failed`。
- **交付单(F2)**:A4 竖版一页。
  - 上面三分之一(210×99 mm,和 DL 信封一样大，也正好是 A4 折三折的一折)交给灵魂;下面是存根，本殿留存，有签收线。两部分之间是剪切线。不想剪的话，折三折也能用。
  - 上联：殿名、殿印、灵魂名、分组编号(mono 30)、手写密码格、有效期、「首次登录必须改密码」、二维码(42 mm)及用法、交付官员与打印时间。
  - 打印规范照第十五批：黑白，页眉左边殿名、右边殿印，页脚左边灵魂编号、右边「第 1 页 / 共 1 页」;强调用 ■ 和粗体，不用颜色。用 `@page { size: A4 portrait; margin: 0 }`,版心自带 10 mm 边距。

## 四、状态

- 请求中、网络失败：沿用第十八批 C2 / D1 那一套。输入框变灰，按钮显示「登录中…」并且不可点;失败时上方出 danger 提示条，写明「输入的内容还在」(A5)。
- 官员台：沿用现有的 toast。

## 五、文案

新 key 放在 `soul_app.login.*`、`soul_app.scan.*`、`soul_app.bio.*`、`soul_accounts.credentials.slip.*` 下。`{{bio}}` 按设备取 `bio.face` 或 `bio.finger`。

**用词**
- **灵魂编号 = Ren Hesb Ba**,同 `soul_app.login.soul_code`。
- **初始密码 = Sekhem Tepy**,同 `soul_accounts.credentials.title`。
- **当前密码**:`bio.enable_body` 只写 Sekhem-Ek,不写第十九批 `password_hint` 的 Sekhem-Ek Tepy,否则会读成「你的初始密码」。见第六节。
- **二维码 = Tut Medu**(印着码的图);**扫码 = Maa Tut Medu**。
- **面容 / 指纹登录 = Aq Em Djes-Ek**(用你自己登录)。egy 不区分面容和指纹，`bio.face` 和 `bio.finger` 都是 Djes-Ek。
- **记住 = Rekh**;**换一个账号 = Aq Em Ba Ky**。
- **交付单 = Djama Redi**;**存根 = Djama Smen**;**打印 = Sesh Djama**。
- **新词根：一个,Ra(光)**,只用在手电筒上。手电筒按钮下面有文字，读屏也要念，绕不开这个词，请登记。

| key | 中文 | en | egy |
|---|---|---|---|
| login.title | 灵魂登录 | 复用 | 复用 |
| login.subtitle | 使用随初始密码一起发给你的灵魂编号登录 | 复用 | 复用(只在 A 组显示,C、E 组不显示) |
| login.soul_code | 灵魂编号 | 复用 | 复用 Ren Hesb Ba |
| login.soul_id_hint | 10 位字母数字 · 交付单上有，也可以扫码 | 10 letters and digits · on your slip, or scan it | Ren Hesb Ba: Medu 10 · Em Djama Redi, Mi Maa Tut Medu |
| login.scan | 扫码 | Scan | Maa Tut Medu |
| login.scanned | ✓ 已从二维码填入 | ✓ Filled in from the code | ✓ Sesh Em Tut Medu Seth |
| login.bad_char | ! 编号里没有「{{c}}」 | ! Soul numbers don't use "{{c}}" | ! Ren Hesb Ba Nen Wen «{{c}}» |
| login.bad_char_body | 编号不用 0、O、1、I、L 这五个，请对照交付单再看一下。 | Numbers never use 0, O, 1, I or L. Check your slip again. | Ren Hesb Ba Nen Wen 0 O 1 I L. Maa Djama Redi Wehem. |
| login.bad_symbol | ! 编号只有字母和数字 | ! Only letters and digits | ! Ren Hesb Ba: Medu Wa |
| login.bad_paste | ! 粘贴的内容里有编号不用的字符 | ! The pasted text has characters a number never uses | ! Medu Senn Nen Maat Er Ren Hesb Ba |
| login.id_aria | 灵魂编号 {{spelled}} | Soul number {{spelled}} | Ren Hesb Ba {{spelled}} |
| login.password / show / submit / forgot | 复用 | 复用 | 复用 |
| login.sending | 登录中… | Signing in… | Aq Djer… |
| login.network | 复用 `soul_app.mfa.login.network` | 复用 | 复用 |
| login.network_body | 检查网络后再点「登录」。输入的内容还在。 | Check your connection and tap Sign in. What you typed is still here. | Medu-Ek Wenen Djer. Wehem Aq. |
| login.switch | 换一个账号 | Use another account | Aq Em Ba Ky |
| login.switch_title | 换一个账号？ | Use another account? | Aq Em Ba Ky? |
| login.switch_body | 这部手机会忘掉编号 {{id}},{{bio}}登录一起关闭。下次要重新输入或扫码。 | This phone will forget {{id}} and turn off {{bio}} sign-in. Next time, type or scan the number again. | Medjat Pen Nen Rekh Ren Hesb Ba {{id}} Djer; Aq Em Djes-Ek: Khetem. Er Khet: Sesh Ren Hesb Ba, Mi Maa Tut Medu. |
| login.switch_ok | 换一个账号 | Use another account | Aq Em Ba Ky |
| login.cancel | 取消 | 复用 | 复用 `disable.cancel` |
| login.use_password | 输入密码 | Enter password | Sesh Sekhem |
| login.lapsed.pw_changed | 密码已在别处修改 | Your password was changed elsewhere | Sekhem Mawy Em Ky Seth |
| login.lapsed.pw_changed_body | 请输入新密码。登录后可以在设置里重新开启{{bio}}登录。 | Enter the new password. You can turn {{bio}} sign-in back on in Settings. | Sesh Sekhem Mawy. Er Khet: Wen Aq Em Djes-Ek Mawy. |
| login.lapsed.reset | 本殿官员已重置你的密码 | An officer of your hall reset your password | Sab Wesekhet: Sekhem-Ek Mawy Seth |
| login.lapsed.reset_body | 请用官员给你的初始密码登录，登录后要设新密码。 | Sign in with the initial password the officer gave you, then set a new one. | Aq Em Sekhem Tepy Sab. Er Khet: Smen Sekhem Mawy. |
| login.lapsed.reborn | 你已转生，这是新一世的账号 | You have been reborn — this is a new life's account | Ba-Ek Ankh Mawy: Aq Mawy |
| login.lapsed.reborn_body | 编号不变。请用这一世的初始密码登录。 | Your number stays the same. Sign in with this life's initial password. | Ren Hesb Ba Wenen. Aq Em Sekhem Tepy Ankh Pen. |
| login.lapsed.bio_changed | {{bio}}登录已关闭 | {{bio}} sign-in is off | Aq Em Djes-Ek: Khetem Seth |
| login.lapsed.bio_changed_body | 这部手机上的{{bio}}有变动，为了安全先关闭。输入密码后可以重新开启。 | The {{bio}} on this phone changed, so we turned it off. Enter your password to turn it back on. | Djes Em Medjat Pen Mawy: Khetem. Sesh Sekhem, Wen Mawy. |
| scan.title | 扫交付单上的码 | Scan your slip | Maa Tut Medu Em Djama Redi |
| scan.close | 关闭扫码 | Close scanner | Khetem Maa Tut Medu |
| scan.hint | 把交付单上的二维码放进框里 | Fit the code on your slip inside the frame | Redi Tut Medu Em Hery |
| scan.hint_sub | 扫到就自动填好编号，密码仍然自己输。 | The number fills in by itself. You still type the password. | Ren Hesb Ba: Sesh Em Djes-Ef. Sekhem: Sesh-Ek. |
| scan.torch | 手电筒 | Flashlight | Ra |
| scan.torch_on | 手电筒 · 开 | Flashlight · on | Ra · Wen |
| scan.manual | 手动输入编号 | Type the number instead | Sesh Ren Hesb Ba |
| scan.invalid | ! 这不是灵魂簿交付单上的码 | ! This isn't a Soul Ledger slip code | ! Nen Tut Medu Djama Redi Medjat Ba |
| scan.invalid_body | 请扫交付单右侧那个。也可以关掉这里，手动输入编号。 | Scan the one on the right of your slip, or close this and type the number. | Maa Tut Medu Em Djama Redi. Mi Sesh Ren Hesb Ba. |
| scan.denied_title | 没有相机权限 | No camera access | Nen Was Maa Tut |
| scan.denied_body | 扫码要用相机。可以去系统设置里给灵魂簿打开相机，也可以直接手动输入编号。 | Scanning needs the camera. Turn it on in system settings, or type the number. | Maa Tut Medu: Was Er Medjat. Wen Em Djeret Medjat, Mi Sesh Ren Hesb Ba. |
| scan.open_settings | 去系统设置打开 ↗ | Open system settings ↗ | Wen Djeret Medjat ↗ |
| scan.privacy | 相机只用来读二维码，不拍照、不存图。 | The camera only reads the code. Nothing is photographed or saved. | Maa Tut Medu Wa. Nen Smen Tut. |
| scan.permission_reason(系统) | 用来扫交付单上的二维码。 | Used to scan the code on your slip. | Maa Tut Medu Em Djama Redi. |
| bio.face | 面容 | Face | Djes-Ek |
| bio.finger | 指纹 | Fingerprint | Djes-Ek |
| bio.row | {{bio}}登录 | Sign in with {{bio}} | Aq Em Djes-Ek |
| bio.row_sub | 只在这部手机上 | This phone only | Em Medjat Pen Wa |
| bio.row_unavailable | 这部手机没有录入面容或指纹 | No face or fingerprint set up on this phone | Nen Djes Em Medjat Pen |
| bio.on / off | 开 / 关 | On / Off | Wen / Khetem |
| bio.button | 用{{bio}}登录 | Sign in with {{bio}} | Aq Em Djes-Ek |
| bio.ask_title | 下次用{{bio}}登录？ | Use {{bio}} next time? | Aq Em Djes-Ek Er Khet? |
| bio.ask_body | 只在这部手机上，打开灵魂簿时不用再输密码。手机里录入的{{bio}}都能用来登录，和家人共用这部手机就别开。 | This phone only — no password when you open Soul Ledger. Any {{bio}} saved on the phone can sign in, so skip this on a shared phone. | Em Medjat Pen Wa: Nen Sesh Sekhem. Djes Neb Em Medjat: Aq. Medjat En Per: Nen Wen. |
| bio.ask_note | 以后可以在「设置 › 账号安全」里关掉。 | You can turn it off later in Settings › Account security. | Khetem Er Khet Em «Smen › Senb Ren Aq». |
| bio.ask_later | 以后再说 | Not now | Er Khet |
| bio.ask_ok | 开启 | Turn on | Wen |
| bio.enable_title | 开启{{bio}}登录 | Turn on {{bio}} sign-in | Wen Aq Em Djes-Ek |
| bio.enable_body | 先输入当前密码，再验证{{bio}}。 | Enter your current password, then confirm your {{bio}}. | Sesh Sekhem-Ek; Maa Djes-Ek. |
| bio.enable_next | 下一步 | Next | 复用 `intro.next` 的 Nemet Ky |
| bio.failed | {{bio}}没认出，请输入密码。 | {{bio}} not recognised. Enter your password. | Nen Rekh Djes-Ek. Sesh Sekhem. |
| bio.retry | 再用{{bio}}试一次 | Try {{bio}} again | Wehem Aq Em Djes-Ek |
| bio.system_reason(系统) | 用来登录灵魂簿，不用输密码。 | Sign in to Soul Ledger without a password. | Aq Em Medjat Ba, Nen Sekhem. |
| credentials.print_slip | 打印交付单 | Print slip | Sesh Djama Redi |
| credentials.reprint_slip | 补打交付单 | Reprint slip | Wehem Sesh Djama Redi |
| credentials.print_failed | 没有连上，交付单没有打印 | Not connected — slip not printed | Nen Em Senb: Nen Sesh Djama Redi |
| credentials.slip.title | 灵魂簿 · 登录交付单 | Soul Ledger · Sign-in slip | Medjat Ba · Djama Redi |
| credentials.slip.soul | 灵魂 | Soul | Ba |
| credentials.slip.soul_id | 灵魂编号 | Soul number | Ren Hesb Ba |
| credentials.slip.password_box | 初始密码 · 官员当面写上，或只口头告诉 | Initial password · written or told in person by the officer | Sekhem Tepy · Sab Sesh, Mi Djed |
| credentials.slip.valid_until | 有效至 {{time}}(72 小时) | Valid until {{time}} (72 hours) | Wenen Er {{time}} (Unut 72) |
| credentials.slip.must_change | ■ 首次登录必须改密码。改完以后，这里写的初始密码就作废了。 | ■ You must change the password at first sign-in. After that, the one written here no longer works. | ■ Aq Tepy: Smen Sekhem Mawy. Er Khet: Sekhem Tepy Hedj. |
| credentials.slip.qr_hint | 灵魂簿 App 登录页，点「扫码」扫这里 | In the Soul Ledger app, tap Scan on the sign-in page | Medjat Ba: Aq › «Maa Tut Medu» |
| credentials.slip.officer | 交付官员 {{name}} | Issued by {{name}} | Sab {{name}} |
| credentials.slip.printed_at | 打印于 {{time}} | Printed {{time}} | Sesh Djama Em {{time}} |
| credentials.slip.personal | 只发给本人，不要拍照转发。 | For you only. Don't photograph or forward it. | Er Ba-Ek Wa. Nen Smen Tut, Nen Hab. |
| credentials.slip.cut | ✂ 沿此线剪下 · 上面交给灵魂，下面本殿留存 | ✂ Cut here · top to the soul, bottom kept by the hall | ✂ Djama Hery: Er Ba. Djama Khery: Em Wesekhet. |
| credentials.slip.stub | 存根 · 本殿留存 | Stub · kept by the hall | Djama Smen · Em Wesekhet |
| credentials.slip.stub_until | 初始密码有效至 | Initial password valid until | Sekhem Tepy Wenen Er |
| credentials.slip.stub_printed | 打印 | Printed | Sesh Djama |
| credentials.slip.sign_soul | 灵魂签收 · 日期 | Soul's signature · date | Sesh Ren Ba · Hru |
| credentials.slip.sign_officer | 交付官员签名 | Officer's signature | Sesh Ren Sab |
| credentials.slip.after_sign | 签收后请在官员台点「标记已交付」。 | After signing, tap Mark delivered on the desk. | Er Khet: «Sesh Djeret» Em Medjat Sab. |

- 「语言」「忘记密码」沿用现有的 `soul_app.login.*`。
- en 的「Soul Ledger」沿用 `about`。

## 六、补登与一处冲突

**第十八批补登**

| key | egy |
|---|---|
| soul_app.mfa.lost.no_email | **Nen Khetem Aq Sep Sen Em Wat Sesh.** |

**冲突:Sekhem Tepy 有两个意思。** 在 `credentials.*` 里它指「初始密码」,第十七批 `profile.password_old_wrong`(Sekhem Tepy Nen Maat)里指「旧密码」,第十九批 `password_hint` 和 `mfa.setup.password_hint`(Sesh Sekhem-Ek Tepy)里指「当前密码」。改密码那一屏两种意思会同时出现。

**已定:Sekhem Tepy 只留给「初始密码」。** 要改的有四条(第四条是你们查出来的):

| key | 现 | 改 |
|---|---|---|
| profile.password_old_wrong | Sekhem Tepy Nen Maat | **Sekhem-Ek Nen Maat** |
| soul_app.mfa.intro.password_hint | Sesh Sekhem-Ek Tepy: Maa Ba-Ek. | **Sesh Sekhem-Ek: Maa Ba-Ek.** |
| mfa.setup.password_hint | Sesh Sekhem-Ek Tepy: Maa Ba-Ek. | **Sesh Sekhem-Ek: Maa Ba-Ek.** |
| soul_app.errors.password_unchanged | Sekhem Renpi Nen Wa Hena Sekhem Tepy | **Sekhem Renpi Nen Wa Hena Sekhem-Ek** |

- `soul_app.forgot_password.no_email_step_2` 不动。那里的 Sekhem Tepy 指官员给的一次性密码，正是「初始密码」的意思。
- `password_unchanged` 里的「新」用的是 Renpi,第十七批以后的新词条用的是 Mawy。这一条只改 Sekhem Tepy,Renpi 不动。两个词要不要统一，另开一条讨论。

改密码页上「旧密码」和「新密码」并列时，旧的写 Sekhem-Ek,新的写 Sekhem Mawy(或现有的 Sekhem Renpi)。

**Ra**:知悉，已登记。

---

## 附:转来时的摘要与我们这边的记录


全文在 Design 项目的 `v3-batch20-reply.md`,画稿 `SoulLoginBoard.dc.html`(灵魂 App 23 屏 + 官员台页 + A4 交付单)。实施前先把全文取回放到本目录。

## 六问的答复

1. 二维码:**只放编号**,内容 `SL1:QU33Q9FW5F`。交付单不印密码,留一个空框,官员可当面手写,也可照旧口头说。
2. 分组:**3-4-3**,如 `QU3 3Q9F W5F`。第十八、十九批画稿里的 `S-0042-1187` 旧格式作废。
3. 记住后的登录页:照我们的设想;只记最近一个编号。「换一个账号」先确认(它同时关掉面容登录)。
4. 面容 / 指纹:首次登录成功后问一次;设置 › 账号安全第三行有开关,在设置里打开要输当前密码。冷启动时系统验证自动弹出。开了两步验证的仍要输 6 位数字。
5. 何时忘掉:照我们的设想,另加两条 —— 在本机改密码**保留**面容登录;手机里新增了面容或指纹时面容登录关闭,登录页说明原因。
6. 扫码页:有手电筒;不支持从相册选图。

## 需要知道的

- 面容登录的询问里提醒:与家人共用的手机不要开(安卓可存多人指纹,分不出是谁)。
- 新 egy 词根 **Ra**(光),用于手电筒,需登记。
- Design 暂用 `Ren Ta` 表示「灵魂编号」、`⟨初始密码⟩` 占位,等我们给现有词条核对 —— 见同目录《第二十批-给Design的现有词条》。

## 第二轮(同日)

- Design 已把三处换成现有词:Ren Hesb Ba / Sekhem Tepy / Wat Sesh;Ra 记为已登记。
- 第十八批缺口补上:`soul_app.mfa.lost.no_email` = Nen Khetem Aq Sep Sen Em Wat Sesh(与语言包现值一致)。
- **待定一处(§6)**:Sekhem Tepy 在别处还被用作「旧密码 / 当前密码」。Design 提议 Sekhem Tepy 只留给「初始密码」,那几条改用 Sekhem-Ek,下一批给出。
- 画稿改动:官员台页改用现有状态与动作(查看密码 / 重试发送 / 去重置)和副标题;新增「发送失败」行,也可打印交付单;已过期与已作废的行不能打印;打印不改变行的状态。首次登录页显示现有副标题,记住编号后的那页不显示。
