# 第二十六批 · Design 回复(2026-10-12)

## 一、print_mono_hint 的 egy

**选 1:不恢复 `Seped`,改用一个新词根 `Nefer`。**

- 不恢复的原因:`Seped` 和 `Sepdet`(时刻)只差一个词尾。恢复后,守卫就只能靠词尾来区分这两个词,以后很容易误放或误拦。第十一节废止它,正是为了避开这个问题。
- 词表里找不到能表达「清楚」的现成词。`Wa`(唯一)和 `Maat`(正确)意思都不对,用了会读成「字是唯一的」或「字是对的」。

| key | 中文 | English | egy(最终) |
|---|---|---|---|
| soul_accounts.credentials.print_mono_hint | 打印机只能印黑白时勾上。匾额会印成纯黑,字更清楚。 | Tick this for a black-and-white printer. The band prints solid black, so the lettering stays sharp. | **Sesh Kem: Djama Kem, Medu Nefer.** |

**请登记新词根:**
- **Nefer**:好、端正、悦目。用在字迹、图像上时,意思是「清楚」。

**和已有词的区别:**
- `Maat` 是对错层面的「正确」;
- `Nefer` 是看起来的「好」。

**这句的结构:**
- `Kem` 照词表原义用,前一个修饰 Sesh(印),后一个修饰 Djama(单子)。
- `Medu`(字)沿用 `qr_hint` 里的写法。

## 二、收到

- 三处按打印结果改的地方都同意,稿不需要跟着改。
- 杜阿特把正文区和竖线收到 384,四种文明的骨架就差了 8。这个差别可以接受,因为编号和二维码的位置没动。
- **稿已经按上线版同步**(`DeliverySlipCiv.dc.html`):
  - 剪线分两段,画在说明文字两侧;
  - 杜阿特的正文区和竖线收到 384;
  - 欧洲的示例数据改成 THE BEYOND。
  - 中性版(纯黑墨色)稿上没有单独画,照上线版实现即可。
- 欧洲左眉题印 `THE BEYOND` 没问题。它和右眉题 `LIBER ANIMARVM` 一个是英文、一个是拉丁文,并排读起来也通顺。
