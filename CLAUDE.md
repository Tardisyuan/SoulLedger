# SoulLedger — Claude Code Configuration

## Rules

- Do what has been asked; nothing more, nothing less
- NEVER create files unless absolutely necessary — prefer editing existing files
- NEVER create documentation files unless explicitly requested
- NEVER save working files or tests to root — use `/src`, `/tests`, `/docs`, `/config`, `/scripts`
- ALWAYS read a file before editing it
- NEVER commit secrets, credentials, or .env files
- Keep files under 500 lines **of code** (comments excluded). Treat the count as a
  prompt to ask whether the file does two things — never as a mandate to move lines.
  *Measured 2026-09-04:* of the eight largest frontend files (490–605 lines), **none
  has 500 lines of code**; the largest is 440 and `app/corpus/page.tsx` is 179 comment
  lines against 319 of code. Counting comments creates pressure to delete the
  institutional memory this repo is built on. Nothing enforces this rule — there is no
  `max-lines` in any eslint config and no test counts lines — so it is applied by eye,
  which is what the rest of this file exists to warn about.
  The canonical *right answer* is already in the tree: `backend/apps/actors/mythology/
  realms.py:16-29` records a split considered at 826 lines and **refused**, because
  "a mechanical split turns twenty true sentences into twenty possibly-false ones,
  silently." Compare `d80ac68`, which split sixteen files for the line count and left
  behind a `Breadcrumb` re-export shim (removed 2026-10-23), four stale `AppLayout.tsx:418`
  references (fixed in `29e82df`), and a "42 tests" record that now equals no file and
  no sum. `domainDisplayContract.test.tsx` was back over the ceiling nine days later.
  A split needs a defect to justify it, not a number.
- Validate input at system boundaries

## Agent Comms

Named agents coordinate via `SendMessage`, not polling or shared state.

- ALWAYS name agents — `name: "role"` makes them addressable
- ALWAYS include comms instructions in prompts — who to message, what to send
- Spawn ALL agents in ONE message with `run_in_background: true`
- After spawning: STOP, tell user what's running, wait for results
- NEVER poll status — agents message back or complete automatically

**子代理的 worktree 不保证在分支尖端 —— 每个 prompt 都要让它先确认。**
2026-09-07 一轮里五个代理,**四个的 worktree 停在 `main`(`35e28a5`)**,不含
当时分支上已有的十几个提交。三个自己发现并 reset 了,两个没有,而这两次都造成了
实际后果:

- `audit-rest` 自报「139 suites / 2530 全绿」—— 真的绿,但绿在一棵没有本轮任何
  工作的树上。**那个绿不作数**,重跑才是 2574。
- 同一个代理报告「`--z-toast` 被引用却从未声明」。那个缺陷**在 `c3039a6` 里
  已经修好**,而 `c3039a6` 在 `35e28a5` 之后。它写下那条时缺陷已不存在,而那句话
  被转告了用户、并写进了 `2aa8494` 的提交信息 —— **一条关于已修缺陷的活体报告
  进了 git 历史。**
- `a11y-guard` 在陈旧树上量覆盖率,据此把 `jest.config.js` 的阈值棘轮到
  59/51/50/60。真实的树上是 60.58/52.89/51.12/61.23,**守得住是运气不是验证**:
  若新增代码的覆盖率低些,门禁会红,而红的原因指向「覆盖率不够」,不指向
  「阈值是在别的树上定的」。

所以每个 prompt 里都要写:**动手前先 `git log --oneline -1` 确认在分支尖端,
不在就 `git reset --hard <branch>` 或 `git merge <branch>`;所有门禁数字必须在
更新后的树上重跑。** 主会话侧的对策是一样的一条命令:
`git -C <worktree> merge-base --is-ancestor <tip> HEAD`。

**`SendMessage` 在子代理的工具集里不存在。** 同一轮五个代理**全部**在报告开头
说了这件事。上面那条「ALWAYS include comms instructions — who to message」因此
是一条无法执行的指令:让它们「完成后 SendMessage 给 main」只会换来一句道歉加一份
写在最终回复里的报告 —— 那份回复本来就会回到主会话。**要报告就直说「把报告写在
最终回复里」。**

**子代理只跑它自己挑的测试,守卫测试常常不在其中 —— 合并后主会话必须跑一次全量。**
2026-10-09/10 两天里同一个形状出现三次,每次子代理的定向测试都是绿的:

- 迁移改成「读写被迁移的库」那条分支:定向测试全过,合并后全量 **18 条红** ——
  三个测试文件仍然把 `None` 当 `schema_editor` 传进去,它没搜到。
- 把 `REINCARNATION_COMPLETED` 补进事件类型枚举:定向 2284 条全过,真 PostgreSQL 全量 **7 条红** ——
  前端的事件清单镜像、标签表、时间线处理器、三份语言包各有一道守卫(`tests/test_frontend_event_types_track_the_backend.py`),
  还有一处新加的 `_base_manager` 没登记(`tests/tenancy_unscoped_sites.py`)。
  子代理还报告说「前端不存在要求全覆盖的模式」—— 那道守卫恰恰就是。
- 接着 pre-push 的 jest 又红一条:`domainNamespaceContract.test.ts` 不认 `egyPendingKeys.json`。

所以:**子代理报的「N passed」只说明它跑的那部分;改了枚举、迁移、文案、路由、未加租户过滤的查询时,
先在合并后的树上跑 `scripts/run-gates.sh --full`,碰事务的再跑一次真 PostgreSQL,然后才推送。**
给子代理的 prompt 里可以直接点名这些守卫文件,省一轮返工。

**主会话可以用 `SendMessage` 把后续决定发回同一个子代理**(它带着上下文继续,不用重新读代码)。
事件日志那一轮连续三次这样做。子代理自己没有这个工具,这一点不变。

## Build & Test

**前端命令需要 node >= 20.9.0**(两份 package.json 都声明了),而这台机器的默认
PATH 上是 **v18.20.8**。仓库根的 `.nvmrc` 钉了 20.19.5,`nvm use` 即可。
不切版本的话有两道门禁**根本起不来**,而且失败信息不指向版本:
`next build` 直说需要 >=20.9.0,但 `packages/core` 的 vitest 报的是
`SyntaxError: 'node:util' does not provide an export named 'styleText'`。
2026-09-04 实测:v18.20.8 下这两条红,v20.19.5 与 v22.22.1 下都绿。

**装依赖用 npm 11:`npx -y npm@11 ci`,不要用 nvm 自带的 npm 10。** 锁文件由 npm 11 生成(带 `libc` 字段)。
2026-09-17 实测:npm 10.8.2 的 `npm ci` 报「added 1529 packages」、退出码 0,但根 `node_modules` 里**没有 `typescript`、没有 `.bin`**,
随后所有门禁都是 127(命令找不到)—— 读起来像代码坏了;它还顺手从锁文件删掉 204 行 `libc` 字段。
npm 11 默认**不执行安装脚本**,装完补一次 `npm rebuild @parcel/watcher unrs-resolver fsevents @sentry/cli`。
改锁文件同样用 `npx npm@11 install …`,提交前 `git diff --stat package-lock.json` 看一眼没有成片删掉 `libc`。
**2026-09-18 补正:npm 11(实测 11.19.1)的 `npm ci` 也会删掉锁文件里的 `libc` 字段**(204 行)—— 上面「npm 10 删、npm 11 不删」的说法不成立;
npm 10 与 11 的真正区别在装出来的树是否完整。所以**装完一律 `git checkout -- package-lock.json` 还原锁文件**,只有有意改依赖时才提交锁文件改动。

**Android 模拟器(2026-09-24/25 实测):**
- 连本机后端要放行 `10.0.2.2`:`ALLOWED_HOSTS=10.0.2.2,localhost runserver 0.0.0.0:8000`,不然首次登录 400 `DisallowedHost`。
- 本 App 是 dev-client,不能用 Expo Go(`expo-notifications` 在 Expo Go 里被移除);`adb reverse tcp:8081 tcp:8081` 连 Metro。
- **主机负载高时不要开模拟器。** 先看 `uptime`:1 分钟负载超过 10,或 jest / playwright / gradle / pytest 在跑,就先等。
  2026-09-24 22:02 在 15 分钟负载约 36 时,六个系统应用和 SoulLedger 同时 ANR,读起来像 App 缺陷;
  空闲时连续操作 25 分钟零 ANR。
- 书信在本机没配 Matrix 时 `/me/chat/session/` 返回 503 `chat_not_configured`,这是设计如此;App 现在收到它只问一次。
- **改了原生依赖(如 `expo-image-picker`、`expo-image-manipulator`)要重建 dev client**:`npm run --workspace mobile android` / `ios`
  (即 `expo run:*`,`mobile/package.json` 的脚本)。`expo start --clear` 只换 JS bundle,不会把新的原生模块装进已安装的 App。

**语音入口(Siri / 快捷方式)怎么在模拟器上验(2026-10-09/10 实测):**
- **iOS 不用对着 Siri 说话**:打开模拟器里的「快捷指令」App → 资料库 → 底部「App」里点对应 App,
  每个 App Intent 是一个图标,点它就执行。念出来的那句话以顶部横幅的形式出现,**约 1 秒就消失**,截图抓不到:
  用 `xcrun simctl io <udid> recordVideo --codec=h264 --force out.mp4`,点完等 9 秒再 `pkill -INT -f recordVideo`,
  然后 `ffmpeg -i out.mp4 -vf fps=6 f%02d.png` 取帧。模拟器刚启动的头一两分钟里点了没反应,是系统服务还没起来,不是代码坏了。
- 数字缓存在 App Group 里:`xcrun simctl get_app_container <udid> <bundle id> groups` 拿到目录,
  再 `xcrun simctl spawn <udid> defaults read <目录>/Library/Preferences/<group id>`。直接 `plutil -p` 读 plist 会读到还没落盘的旧值。
- **模拟器上「提问」的追问弹框是英文,连系统自带的 Cancel / Done 也是英文**,把模拟器语言改成 zh-Hans-CN 重启也一样;
  同一个 App 念数字的句子是中文。这是模拟器里运行快捷指令的那个系统进程的语言,不是我们的文案缺了,要真机才能下结论。
- **安卓桌面长按快捷方式会重建 Activity**(启动标志带 `CLEAR_TASK`):JS 运行时还在,根组件重新挂载,而且**不发 `url` 事件**。
  所以「打开时带的链接」不能只在模块加载时读一次 —— `mobile/src/deepLink.ts` 的 `readOpening()` 在每次根组件挂载时读。
  同理 `navigationRef.isReady()` 在重挂后仍然报旧容器的「已就绪」,要同时看本次挂载的 `ready` 计数(`navigation.tsx`)。
  `adb shell am start -a android.intent.action.VIEW -d <链接>` 走的是 `onNewIntent`,**验不到这条路径**;
  要么真的长按图标,要么加 `-f 0x1000c000`。
- 长按菜单的文字跟**系统语言**走,不跟 App 内的语言设置走;模拟器系统是英文时看到英文是对的。
- 插件生成的 Swift 文件要按 `<工程名>/文件名` 登记进 Xcode 工程(Expo 模板的组没有自己的路径),写成裸文件名会让 iOS 整个编译不过,
  而插件的 jest 测试只测纯函数,测不出这一点 —— **改了 `mobile/plugins/` 就要真的 `expo run:ios` 一次。**
- **验完就关**:`xcrun simctl shutdown all`、`adb emu kill`,连同为它起的 Metro 和 runserver。
- **iOS 重建在这台机器上要先设 UTF-8 locale(2026-10-11 实测)**:不设时 CocoaPods 死在
  `Unicode Normalization not appropriate for ASCII-8BIT`,读起来像 Podfile 坏了。
  `export LANG=en_US.UTF-8 LC_ALL=en_US.UTF-8`,再 `npx expo run:ios --device <udid> --no-bundler`;
  装好后另起 Metro(`npx expo start --dev-client --port 8081`,不带 `CI=1`)。
- **Android 重建要有 `ANDROID_HOME`**:`export ANDROID_HOME=~/Library/Android/sdk`,否则 gradle 报 `SDK location not found`
  (这台机器的非交互 shell 里没有这个变量,2026-10-11)。没有安卓的设备工具时用 `adb exec-out screencap -p` 截图、`adb shell input tap/text` 操作。
- **改了 `app.json` 的 plugins(权限文案、新的原生模块)要先 `npx expo prebuild --platform ios|android --no-install`,再 `expo run:*`。**
  `ios/` 和 `android/` 是生成物(gitignored),目录已存在时 `expo run:*` 不会重新生成,新权限进不了 Info.plist / Manifest。
  iOS 重新生成后还要 `cd ios && pod install`。2026-10-11:加了扫码,点「扫码」直接崩在 `missing NSCameraUsageDescription`。
- **两个插件写同一个权限时,后者会被前者删掉**:`expo-image-picker` 的 `cameraPermission: false` 会移除相机权限,不管 `expo-camera` 要了什么
  (`cameraPermissionSurvivesPlugins.test.ts` 守着)。
- **jest 看不见、只有设备上才现形的几类(2026-10-11 一轮抓到六处)**:`opacity: 0` 的视图在 iOS 上收不到触摸(用透明文字,别用透明视图);
  受控 TextInput 被 React 回填旧值时 iOS 也发一次 `onChangeText`;嵌在页头下面的 `KeyboardAvoidingView` 要给 `keyboardVerticalOffset`
  (它在窗口里的 y),否则少让出页头那么高;语言包里的 `↗` 在 iOS 上是彩色表情(`translate()` 现在统一补 U+FE0E);
  安卓多行 TextInput 用宋体(Noto Serif SC)时,`lineHeight` 低于约 1.8 倍字号就裁掉第一行顶部(10-31 华为实测:15/24、15/26、13/23 裁,
  15/27、13/24 完整;不设 `lineHeight` 也完整)。看「向」字上那一点在不在,10-30 就是把一张被裁的截图当成了修好。
  所以**界面改动合并后要真的上一次模拟器**,测试全绿不够。
- **iOS 模拟器的钥匙串不强制生物验证**:`requireAuthentication: true` 的 secure-store 条目不弹面容就能读。面容相关只能真机验(清单在备忘 `real-device-checklist`)。
- **本机连 115 的 Matrix 要先开隧道**:`ssh -f -N -L 8008:127.0.0.1:8008 tardis@pi`;runserver 的 `ALLOWED_HOSTS` 还要加本机局域网地址
  (Synapse 回调 `/chat/hooks/new-message/` 用的是它,否则 400 `DisallowedHost`,信能发、推送钩子丢)。验完 `pkill -f "ssh -f -N -L 8008"`。
- **装到 iOS 真机(2026-10-11):这台 Mac 的签名是免费的个人开发团队,签不了「推送」和「App 组」——这是必然的,不是配置坏了。**
  `expo run:ios --device <udid>` 会报 `Personal development teams … do not support the Push Notifications capability` /
  `doesn't support the App Groups capability`。做法:只在生成的工程里(`mobile/ios/SoulLedger/SoulLedger.entitlements`,gitignored)删掉
  `aps-environment` 与 `com.apple.security.application-groups` 两项再编:
  `/usr/libexec/PlistBuddy -c "Delete :aps-environment" …` 、`-c "Delete :com.apple.security.application-groups" …`。
  这样装上的版本没有推送、语音入口读不到 App 组里的数字;其余功能正常。**不要改 `app.json` 去掉这两项**——那是正式构建要的。
  下次 `expo prebuild` 会把这两项生成回来,真机要再删一次。设备 UDID 用 `xcrun devicectl list devices` 看。
  手机首次打开要在「设置 › 通用 › VPN 与设备管理」里信任开发者;手机连本机后端用 Mac 的局域网地址
  (起 Metro 时带 `EXPO_PUBLIC_API_URL=http://<Mac 地址>:8000/api/v1`,runserver 的 `ALLOWED_HOSTS` 也要加这个地址)。
  我的工具只能点模拟器,真机上的操作要用户自己点。
- **一次只开一个模拟器、一个 App**:这台机器内存吃紧(交换区近满),模拟器启动或编译时 1 分钟负载会冲到几百。
  重步骤之间等负载回到 12 以下再点;模拟器截图会慢一帧,操作后截两张看第二张。
- **只收字母数字的输入框要设 `keyboardType="ascii-capable"`**(编号、恢复码):不设时中文拼音键盘会把输入当拼音、弹候选条。
  2026-10-11 灵魂端和官员端的恢复码框都漏了;编号框(`auth.tsx`、`letters.tsx`)早就设了。
- **2026-10-30 第二轮设备验证得到的四条事实**:
  - 改了 JS 依赖(如官员端删 `react-native-screens`)之后,unRAID 上还在跑的旧 Metro 会报 `Unable to resolve "react-native"`,
    读起来像依赖坏了。10-31 起 `metro sync` / `metro open` 比对 Metro 容器的依赖哈希(`SL_DEPS`),不一致就先同步再自动重启 Metro
    (`scripts/mobile-remote.sh`,守卫 `TestMobileRemoteMetroFollowsTheDependencies`);手动处理仍是 `metro stop` 再 `metro start`。
  - **release 包只有 debug 清单开了明文 http**(`usesCleartextTraffic`),release 连 `http://` 后端请求全失败、停在出错页 —— 生产走 https,
    不是 R8 的问题。验 release 包要么给它 https 的后端,要么接受只能看「能启动、无 ClassNotFound / 崩溃」。
  - 登录页的截图拿不到画面:安卓 `screencap` 得到 0 字节 —— **是华为的安全键盘,不是 App**(10-31 查明)。密码框一获得焦点,
    EMUI 就把输入法换成 `com.huawei.secime`,它的窗口 `secure=true`(`dumpsys window` 可见),键盘在屏上时整屏截图为空;
    收起键盘(`input keyevent 4`)立即恢复。两步验证页的密码框同样如此。要截有密码框的页,先截再点框,或填完收起键盘再截。
    iOS 模拟器那次全黑**不是 App 的问题**:10-31 同一模拟器 `simctl launch` 报「system shell probably crashed」,
    `simctl shutdown` 后 `bootstatus -b` 重启,登录页截图正常。模拟器上登录不用手输凭据:`xcrun simctl pbcopy <udid>` 把值放进剪贴板,
    长按输入框点「粘贴」。拼音输入要先给模拟器加键盘(`simctl spawn <udid> defaults write -g AppleKeyboards -array
    "zh_Hans-Pinyin@sw=Pinyin-Simplified;hw=Automatic" …`,再 `set_keyboard show`),验完 `defaults delete -g AppleKeyboards`。
  - **115 上的 Synapse 可能停着**:10-30 发现 `soulledger_synapse` 已停 6 天(启动时解析不到 `postgres` 主机名,exit 1),
    书信相关的验证会因此全部失败。`ssh tardis@pi docker ps -a | grep synapse` 看状态,停了就 `ssh tardis@pi docker start soulledger_synapse`。

**原生重编用 `scripts/build-mobile-dev.sh <mobile|mobile-officer> <ios|android> [--device <udid>]`(2026-10-27 用户决定)**:
utility QoS + nice 10;Xcode 同时编译限 4 个任务(`IOS_JOBS` 覆盖,写进 `com.apple.dt.xcodebuild` 的 user default);
ccache 由 `mobile/plugins/withBuildTuning.js` 打开(要 `brew install ccache`,已装);没设 Sentry DSN 的构建不编 Sentry 原生代码
(各 App 的 `react-native.config.js`,实测官员 App 721 个编译单元里 Sentry 占 243)。DSN 要在构建时和打包时一起设。
**编译缓存在这里不管用(2026-10-27 实测,Xcode 27.2 + RN 0.86.3,灵魂端 App,arm64,4 任务)**:
ccache 已接上(Pods 里 CC/CXX 指向 `ccache-clang.sh`),一次全量后缓存仍只有约 1 MB;
Xcode 自带的 `COMPILATION_CACHE_ENABLE_CACHING=YES`(并绕开 ccache 包装):冷 575 s、clean 后热 503 s,
缓存目录 60 KB —— 也几乎没命中。原因没查清(疑为显式模块构建绕过了编译器包装)。**别再重复这组测试**;
真正起作用的是下面的「少重编」、只编 arm64、限 4 任务、开发版不编 Sentry。还剩的一条路是 Expo 的
第三方库预编译包(`EXPO_PRECOMPILED_MODULES_PATH`,要用 Expo 自己的工具链产出,实验性),尚未尝试。
**只有改了原生依赖或 app.json plugins 才重编 —— 脚本自己判断**:用 `@expo/fingerprint` 算原生指纹(加 `react-native.config.js` 与 DSN 状态),和上次编成的一样就直接退出、提示只起 Metro;不一样才自动 prebuild + pod install + 编译(`FORCE=1` 强制)。上次的指纹在 `<git common dir>/soulledger-native-builds/`。实测 prebuild 前后指纹不变(生成的 ios/ 不计入)。改 JS 只要 Metro。编译完、负载回到 12 以下再开模拟器 —— 10-27 两件事挤在一起,负载 575、交换区 19/20 GB。

**App(`mobile/`)换了代码而模拟器上没变,先怀疑 Metro 没看见,别先怀疑代码。**
2026-09-19 App 聊天那一轮实测:用 `cp` 还原的文件 Metro **不会自动察觉** —— 文件监视看不到这类变更,
而 `CI=1` 启动时 Metro 根本不监视文件 —— App 跑的仍是旧 bundle,且不报任何错,于是「改动没生效」
读起来像「改动是错的」。换过文件之后要 `npx expo start --clear` 重启(**不要带 `CI=1`**),
再看模拟器上的行为;在那之前观察到的一切都是旧代码的。

**后端的解释器是 `backend/.venv`,不是 PATH 上的任何 `python`。**
Python **3.11** + `requirements.lock` + `requirements-dev.txt`(只有钉死的 ruff)——
与镜像(`backend/Dockerfile`)和 CI(`ci.yml`)装的是**同一份**。建法,在仓库根:

    cd backend && uv venv --python 3.11 .venv && uv pip install --python .venv/bin/python --no-deps -r requirements.lock -r requirements-dev.txt

(没有 uv:`python3.11 -m venv backend/.venv` 后用 `backend/.venv/bin/pip install
--no-deps -r …` 装同样两份。)`.venv` 被 `.gitignore` 与 `.dockerignore` 挡住。

为什么不再用别的环境(2026-09-14 用户决定):此前本地命令与钩子用的是共享的 conda
`vision` 环境 —— Python 3.12,依赖停在 `d561340` 升级之前,即仍是 pip-audit 报
46 个已知漏洞的那批版本。**本地绿测的是另一套依赖**,而它和线上那套只在
「碰巧兼容」时一致。不要往 `vision` 里装东西去「对齐」:它是共享环境,里面有别的项目。

PATH 上的 `python` 仍然**几乎肯定不是你要的那个**:这台机器上它是 anaconda
**base**,没有 Django,`python -m pytest` 退出 **4** 并报 `ModuleNotFoundError:
No module named 'django'` —— 那句话指向「缺依赖」,真正的原因是「解释器选错了」。
所以下面的命令都写 `.venv/bin/python` / `.venv/bin/ruff`。先
`.venv/bin/python -c "import django"` 问一句,比读一条 pytest 的 collection error 快;
`.venv` 不存在时 shell 会直接说 `no such file or directory`,照上面那行建。

`.git/hooks/pre-push`(由 `scripts/install-hooks.sh` 生成)**优先用 `backend/.venv`**;
worktree 里没有 `.venv`(gitignored),就用主 checkout 的,和 `.prepush.env` 的
退回规则一样。两个都没有就**拒绝**并打印上面那行建法 —— 不再退回裸 `python`:
2026-09-11 在 worktree 里推送,正是那个裸 `python`(base,无 Django)让钩子把
`ModuleNotFoundError` 报成「a model changed without a migration」拒了两次。
`.prepush.env` 里的 `PYTHON_BIN` / `RUFF_BIN` 仍可**覆盖** venv,且运行时会打印
`python: … (PYTHON_BIN override; backend/.venv not used)`。**旧的 `.prepush.env`
若还写着 vision 的路径,覆盖会赢** —— 看钩子输出里那一行,或删掉那两行。
**改了 `scripts/install-hooks.sh` 要在主 checkout 重跑 `bash scripts/install-hooks.sh`**:
钩子是生成出来的副本,源文件变了它不会跟着变。**2026-09-30 起钩子只剩一层壳**:它把 git 的
stdin 变成改动文件清单(`PREPUSH_CHANGED`),然后 `exec` 被推送的 checkout 里的
`scripts/run-gates.sh` —— 门禁逻辑只有这一份,改它当场生效,不用重装。重装只在改了壳本身、
或要更新壳旁边那份备用副本(`.git/hooks/soulledger-gates/`,给还没有 `run-gates.sh` 的
老分支用)时才需要。

**pre-push 只跑受影响的测试:jest(2026-09-30 起)和后端 pytest(2026-10-27 起,按 app 选)。**
**每个测试运行器默认 2 个进程(2026-10-27 用户决定)**:jest / pytest / vitest 各 2(`JEST_WORKERS` /
`PYTEST_WORKERS` / `VITEST_WORKERS` 覆盖)。此前各 4 个,内存进交换区,一晚上四轮全量把电脑卡死。
**不要自己加 `--full`**:提交推送只测改动部分(用户 10-27 明确要求);全量只在用户要求时跑,并先问时间。
会话里要跑「推送时会跑的那一套」,直接跑同一个脚本,它自己拿门禁锁:

    scripts/run-gates.sh                 # 与 base 比:已提交 + 已暂存 + 未暂存 + 未跟踪
    scripts/run-gates.sh --base <ref>    # base 默认是与 origin/main 的 merge-base
    scripts/run-gates.sh --full          # jest 也全跑
    scripts/run-gates.sh --help

- **怎么选**:`jest --findRelatedTests <改动文件>`,**加上** `frontend/jest.always-run.txt` 里的
  58 个测试(2026-10-02)。`--roots` 在命令行上补了 `packages/core`:`jest.config.js` 的 roots 只有 `frontend/`,
  于是改了 core 的文件 `--findRelatedTests` 返回**空**、不报错 —— 实测 `useSouls.ts` 不补是 0 个、
  补了是 20 个,总测试文件数两种都是 196。
- **always-run 清单**是「读文件而不是 import」的测试(`readFileSync` / `readdirSync` /
  `execSync` / `git` …,或 import 了这样一个 `support/` 模块):契约测试、egy 词表、语言包对齐、
  设计守卫。import 图看不见它们读的文件,所以每次都跑。清单是**推导**的,不是手写的:
  `src/__tests__/jestAlwaysRunList.test.ts` 用同一条正则扫测试源码,少一条、多一条都红。
  2026-09-30 验过:加一个 `readFileSync` 的一次性测试 → 红;清单里塞一个不存在的文件 → 红。
  新写了读文件的测试,把它加进清单(守卫会点名)。
- **同一份代码已全量通过，推送就不再跑(2026-10-19 用户决定)**:`scripts/run-gates.sh --full` 在**干净的工作区**
  (已跟踪文件与 HEAD 一致，`backend/` `frontend/` `packages/` `mobile*` `scripts/` 下没有未跟踪文件)跑通后，
  把 HEAD 的树哈希记进 `<git common dir>/soulledger-gates-passed`;推送时被推的提交树哈希在里面，钩子打印
  「already passed」直接放行。改了任何一个字节就是另一棵树，照旧按改动跑。(2026-10-24 前推到 main 跑的正是 `--full` 那一套，
  所以两者等价。)真 PostgreSQL 与 E2E 本来就不在钩子里，不受影响。守卫:`test_prepush_runs_the_gates_a_change_can_break.py`
  的 `TestATreeThatAlreadyPassedFull`(去掉放行那行会红，已验)。
- **推到 main 不再强制全跑(2026-10-24 用户决定)**:此前推 main 一律全量，每次 15–20 分钟、负载近 20,而这里的推送全是推 main。
  现在 main 和任何分支一样按改动跑;要全量就 `scripts/run-gates.sh --full` 或 `GATES_FULL=1`。跨区漏网靠「读文件」清单兜底。
- **什么强制全跑**(输出里逐条写明是哪条规则、哪个文件):`--full`、`GATES_FULL=1`、
  `frontend/` 或 `packages/core/` 下的 JSON / MD / YAML(语言包除外)、这两处的顶层配置文件(jest / ts / next / eslint 配置、package.json,
  也包括 `jest.always-run.txt` 本身)、根上的 JS 依赖树(package*.json、.nvmrc)、删掉或改名的文件、
  不认识的根文件、以及门禁脚本本身(`run-gates.sh` / `install-hooks.sh`)。
  `--affected` 就是默认行为;**没有任何办法强制选择性运行** —— `GATES_FULL=0` 不是开关。
- **2026-10-27 起(用户决定)三处放宽、一处加限**:
  - 语言包不再强制全跑:运行时全是静态 `import`,`--findRelatedTests` 追得到(实测 en.json 选 312 个测试文件里的 204 个)。
    此前 10-13 到 10-27 的 497 个提交里 204 个因此全跑。**语言包只能静态 import**,拼路径加载就追不到。
  - mobile / 官员端 jest 也按 `--findRelatedTests` 选,再加该 App 读文件的测试(`run-gates.sh` 的 `app_jest`)。
    App 目录里 `src/` 以外或非代码文件改了、删改名、或上面任一条全跑规则命中 → 该 App 全跑。
    实测:mobile `navigation.tsx` 选 58 个里的 20 个;官员端 `judgmentActions.tsx` 选 39 个里的 16 个。
  - 钩子的 pytest 带 `-o faulthandler_timeout=300 -o faulthandler_exit_on_timeout=true`(`PYTEST_TEST_TIMEOUT` 覆盖):
    单条测试挂住只赔那个 worker,不再握着门禁锁挂几个小时。
  - 门禁锁被一个活进程握超过 45 分钟时，等待方每分钟打印持有者的 `ps` / `kill` 命令;不自动抢。
- **2026-10-27 第二批(用户决定)**:
  - **选择性通过也记账**:`run-gates.sh` 在干净工作区按改动跑通后，把树哈希和它当作「改动」的文件清单记进
    `<git common dir>/soulledger-gates-passed-selective`。推送时被推提交的树相同、且推送改动的文件**全在**记下的清单里，
    钩子打印「already passed … for these changes」直接放行。改动更多就照跑;推送时带 `--full` / `GATES_FULL=1` 也照跑。
    所以会话里先跑 `scripts/run-gates.sh`(工作区要干净，即先提交)再推送，只跑一遍。
  - **静态检查全部排在测试之前**:core / 前端 / 两个 App 的 tsc 与 eslint、ruff、makemigrations 先跑，再跑 vitest / jest / pytest。
  - **前端读文件测试按目录选**:`jest.always-run.txt` 每行后面写着它读的顶层条目(`*` = 跑 git 或子进程、或摸到仓库根却没点名;
    `frontend` = 只读 frontend/)。前端不跑时只跑点名了本次改动顶层条目的行和 `*` 行;实测只改后端时 69 个里跑 22 个。
    标注由 `jestAlwaysRunList.test.ts` 推导并核对(注释先剥掉;与 `reads-outside-backend.txt` 同一条规则)。
- **2026-10-28(用户决定)真 PostgreSQL 进了 `run-gates.sh`**:
  - 日常 `scripts/run-gates.sh --real-pg`:和推送同一套按 app 选的测试，加上全部 PG-only 测试(28 条，由 `test_concurrency.py`
    钉住名单的那个扫描器列出);迁移往返只在改了迁移时跑。只跑 pytest,不跑 jest / tsc / eslint / ruff / makemigrations。
    数据库读 `backend/.env` 的 `DATABASE_URL`(worktree 用主 checkout 的),不认 `.prepush.env` 的 SQLite 覆盖;115 连不上就**拒绝**,不退回 SQLite。
    自带 `--create-db`、单条测试 600 s 限时、一次性 Redis、门禁锁。
  - 全量 `scripts/run-gates.sh --real-pg --full`(含迁移往返)**只在大分支合进 main 前跑一次**。实测 `-n 2` 含往返约 45 分钟(10-28)。
  - **`--dist worksteal` 已打开(2026-10-29),`--ff` 仍不加。** 10-28 加过又撤回:实时类测试随顺序变红(两次 9 / 11 条)。
    根因是 `test_event_bus.py` 的 `EventBus().reset()` 清空了全进程共用的事件处理器表,之后同一 worker 上通知、事件、
    WebSocket 推送全丢;根 `conftest.py` 的 `_restore_event_handlers` 现在每条测试后还原(`6d2c21dd`),worksteal 全量两轮 8076 passed。
    打开它是因为不带时 xdist 预先分块,1–2 分钟一条的迁移往返堆在同一个 worker 上:全量在 99% 停 30–40 分钟、七个 worker 空等。
    2026-10-30 起 `--durations=30 --durations-min=5`(此前 `--durations=10`):列出最慢的三十条里超过 5 秒的。
  - **整轮门禁放到 unRAID 上跑(2026-10-28 用户决定，做法一)**:`.prepush.env` 设 `GATES_REMOTE=unraid`(ssh 别名 → `root@192.168.2.2`,
    私钥 `~/.ssh/unraid-host`)和 `GATES_REMOTE_DB_URL`。本机只算「跑什么」、rsync 同步树(含 `.git`,`--no-owner`)到
    `/mnt/cache/appdata/sl-gates/work/<checkout>-<哈希>/`,然后在容器 `sl-gates-all:1`(node 20.19.5 + Python 3.11 + git/redis)里跑
    **同一个 `run-gates.sh`**(`GATES_IN_REMOTE=1`,改动清单经 `PREPUSH_CHANGED` 交过去),输出与退出码传回;成功后「已通过」记账仍记在本机。
    `node_modules` 与 `backend/.venv` 装在那棵同步树里;**2026-10-30 起两个哈希分开判断**(`run-gates.sh` 的 `REMOTE_DEPS`):
    JS 哈希 = 各 package.json 的依赖字段(不含 version / scripts)+ 锁文件,变了才 `npm ci`;Python 哈希 = `requirements.lock` +
    `requirements-dev.txt`,变了只把现有 venv 同步过去(`pip install` 再卸掉清单外的包,`scripts/venv-extras.py`),**不再删掉重建**。
    此前改一个 package.json 的版本号就两样全重装。数据库是网络 `sl-gates` 里的
    `sl-pg-test`(pgvector:pg16,tmpfs、fsync 关),所以同时跑 PG-only 测试。容器限 12 核 / 24 GB,
    **2026-10-30 起后端 pytest 与 JS 测试(core vitest、web jest、两个 App 的 jest)在容器里同时跑**,各 6 个 worker
    (`GATES_REMOTE_PYTEST_WORKERS` / `GATES_REMOTE_JS_WORKERS` 覆盖;此前各 8 个、先后跑),各写各的日志,一边红另一边照样跑完,
    最后两份日志都打印、两个退出码一起决定。本机仍是先后跑(本机缺的是内存不是 CPU)。
    三份 jest 配置(web、灵魂端、官员端)的 `cacheDirectory` 在 `node_modules/.cache/jest`,随同步树留着,下一轮转译命中缓存。
    各 checkout 的运行在那台上用 `flock` 排队。**连不上就拒绝，不退回本机**(本机跑正是卡死电脑的原因);临时要在本机跑就注释掉 `GATES_REMOTE`。
    远端失败日志在 `/mnt/cache/appdata/sl-gates/tmp/<checkout>-<哈希>/`,留一天。**临时目录不能放在同步树里**:放在 `/app` 下时，
    `test_testdb_name` 的子 pytest 会在它的 tmp_path 上层找到仓库根的 conftest,配置生效两次，每次委托运行都红(10-28)。
    实测(后端同一组：judgment 选择 + 28 条 PG-only):unRAID `-n 8` **2983 passed / 306 s,本机 CPU ≈ 0**;本机 SQLite `-n 2` 313 s / CPU 566 s;
    本机进程连树莓派 PG 830 s;全在树莓派 753 s。当时约 100 s 是开头单线程建模板库。
    **2026-10-30 起远端的 PG 模板库按输入哈希留着复用**(`backend/config/testdb.py`,只在 `GATES_IN_REMOTE=1` 时):
    模板名 `test_soulledger_tpl_h<哈希>`,哈希与 SQLite 模板同一套输入(`config/sqlite_template.py`)加服务器版本;
    同哈希已有就直接克隆、不迁移,跑完不删,按最近使用留最新 3 个。真迁移的运行(`--full` / `GATES_FULL=1` / 本轮含迁移往返)
    照样新建模板、在它上面跑，再和留着的同哈希模板逐项比(结构 + 全部行，时间戳屏蔽),不一致就删掉留着的并让本轮红(`TemplateDriftError`)。
    本机、CI、其他不带 `GATES_IN_REMOTE=1` 的运行不变：每轮一个模板，跑完删。
    实测(10-30,unRAID 整轮门禁):选择性**冷 392 s / 模板命中 280 s**;`--full` **625 s**。
    搬过去时撞到的三处 Linux/macOS 差异(都已修):GNU `mktemp` 要 `XXXXXX`;rsync 保留 Mac 的 uid 时 git 在容器里拒认仓库
    (门禁测试设了 `GIT_CONFIG_NOSYSTEM`);外层的 `GATES_*` 环境串进门禁测试起的子门禁(`_clean_env` 现在去掉全部 `GATES_*`)。
    10-28 本机全量推送那次 15 条实时类测试红(`test_realtime_bus` 等)，空闲时本机与 unRAID 都 34/34 过 —— 交换区满时的超时，不是代码。
  - **E2E 也在 unRAID 上跑(2026-10-28 用户决定)**:`scripts/run-gates.sh --e2e`(chromium)、`--e2e=all`(三个)、
    `--e2e=chromium,mobile-chrome`(列表)。镜像 `sl-gates-e2e:1` = `sl-gates-all:1` + Playwright 1.63 的 chromium / firefox;
    先 `next build`,4 个 worker、`--retries=1`(重试才过的按名字报 flaky,不藏),`--reporter=line`(html 报告器失败时会起服务等人看，
    在容器里会挂住)。没有 `GATES_REMOTE` 就拒绝，不在本机跑。**2026-10-30 起所有 project 一次 `playwright test` 跑完**
    (一个 `next start`,worker 不在每个 project 的尾巴上空等),各 project 的 passed / failed / flaky 与失败、flaky 的测试名
    由 json 报告器经 `scripts/e2e-report.py` 汇总。日志在 unRAID 的 `sl-gates/tmp/<checkout>/e2e.log`(此前每个 project 一份)。
    **2026-10-29 起 E2E 有自己的同步树(`work/<checkout>-<哈希>-e2e`)和自己的锁(`e2e.lock`,容器默认 8 核 / 16 GB,
    `GATES_REMOTE_E2E_CPUS` / `GATES_REMOTE_E2E_MEMORY` 覆盖)**,可以和一轮门禁同时跑,不再排在 `run.lock` 后面。
    安卓调试包与 Metro 也能放到那台上:`scripts/mobile-remote.sh`(本机只剩 adb 装包,`67fa9e90` / `7d4c36e7`)。
    实测(10-28,逐 project 跑的时候):build 31 s;chromium 236 passed / 70 s;firefox 236 / 86 s;mobile-chrome 229 / 68 s;`--e2e=all` 全程 243 s
    (本机 10-27:3.6 / 7.9 / 4.5 分钟)。10-30 一次调用之后 `--e2e=all` 全程 **309 s**(unRAID,与 10-28 不是同一棵树)。mobile-chrome 在 4 worker 下偶有一条慢到超时(两轮里各一条、每次不同),单独跑 10/10 过 ——
    所以用一次重试并点名，不加 skip。
  - **E2E 不用 Playwright 的 `--only-changed`**:它按 spec 的 import 关系选，而这里的 spec 用网址打开页面、不 import 页面，
    改了页面它一个 spec 都选不中。E2E 仍按上面那条(日常 chromium,改布局加 mobile-chrome,合 main 前三个全跑)。
- **后端 pytest 按 app 选(2026-10-27 用户决定)**:`scripts/select-backend-tests.py` 选「在该 app 目录下 /
  源码里写了 `apps.<app>` / 调了该 app 的 `/api/v1/<前缀>/`」的测试文件,前缀从 `config/urls.py` 读;
  再加上 `reads-outside-backend.txt` 里命中的读文件测试。改了 `backend/config/`、任一 conftest、`pytest.ini`、
  依赖、`backend/` 顶层文件 → 全量。实测:只改 judgment 一个文件选 474 个里的 113 个,2348 passed,
  `-n 2` 4 分 41 秒(全量 `-n 4` 是 10–28 分钟)。**可能漏的**:只经别的 app 间接走到某 app、源码里既没写它
  名字也没调它网址的测试 —— 用户接受,没有夜间全量兜底。守卫 `tests/test_backend_test_selection.py`。
  下面那段 testmon 的实测是当时不选的理由(按 import 选太宽且会漏 URLconf),按 app 选是另一条路。
- tsc / eslint / core / mobile / ruff / makemigrations 照旧在对应区域有改动时跑。
  pytest-testmon 做进去并实测过(2026-09-30,`-n 4`,同一棵树),**没有采用**,因为安全的版本比全跑慢:

      全量,不记录            5647 passed   130 s
      全量,testmon 记录       5647 passed   277 s   (xdist 能跑,但记录开销 2.1 倍)
      选择性,什么都没改        1145 passed   101 s   (读文件的 59 个后端测试文件必须每次跑)

  而且 testmon 只把**测试运行期间**执行到的行算作依赖,Django 在 import 时求值的东西
  (模型字段、serializer 的 Meta、viewset 的类属性、urls、常量表)它看不见:把 souls 的
  router 前缀改掉,`apps/souls` 177 条里红 72 条,testmon 只选中其中 4 条。要安全就得在
  模块级改动时全跑 —— 按最近 150 个后端提交算,约四分之三会落到全跑上。
- **推只改门禁脚本的提交,现在会跑后端**:这些脚本唯一的测试是
  `backend/tests/test_prepush_runs_the_gates_a_change_can_break.py`,它读脚本而不 import。
  此前这样的推送什么都不跑。
- **两条「测套件本身」的元测试按改动选择(2026-10-19 起)**:`test_collection_scope.py`(子进程里把整套
  再收集一遍,而它是 `*` 读者,此前**任何推送**都跑)与 `test_audit_assertions_are_not_vacuous.py`
  (嵌套 pytest + 新迁移的库)。只在改到 `pytest.ini`、任一 conftest、`requirements.lock`、`backend/config/`、
  `apps/audit/`、`apps/tenants/`、`lock_join_guard.py`、某个 `apps/*/tests.py`、这两个文件本身,
  不认识的根文件,或 `--full` / `GATES_FULL=1` 时才跑;其余推送用 `--ignore` 去掉,输出里写明。
  规则是 `run-gates.sh` 的 `META_PATH_RE`,`classify-meta` 一行;
  `TestSuiteAboutTheSuiteRunsOnlyWhenRelevant` 守着,四种变异(规则漏 pytest.ini、恒为 1、丢 `--ignore`、
  读者清单不过滤)各自变红。它们守的东西多了一类,就往 `META_PATH_RE` 里补。
- **读别区文件的测试,别区改了也跑(2026-10-02 起)**。此前区域只按改动文件所在目录决定:
  A1 工作流改版只改了 `frontend/`,弄红了 `backend/tests/test_workflow_preset_case_types.py`
  (它解析 `WorkflowEditor.tsx`),所有 frontend-only 推送都绿着过去,直到后来一个分支碰巧改了 `backend/`。
  现在某个区域**不全跑**时,它的「读文件的测试」照样跑:
  - 后端:`backend/tests/reads-outside-backend.txt`,49 个能摸到仓库根的测试文件,每行带它点名的
    顶层条目(`frontend` / `packages` / `config` / `docker-compose.*.yml` …,一个都没点名就是 `*`)。
    `backend/` 下没有改动时,跑条目命中改动首段路径的行和全部 `*` 行(不跑 ruff / makemigrations)。
    清单是推导的:`test_reads_outside_backend_list.py` 按「仓库根句柄(`parents[N]` / `REPO_ROOT` …)
    + `tests.*` 的传递 import」重算,少行、多行、条目不对都红。新写了读别区文件的后端测试,照它点名的补一行。
  - 前端不跑时跑 `jest.always-run.txt`(其中 6 个读 `backend/*.py`);mobile 不跑时跑 grep 出来的
    6 个读文件的 mobile 测试。
  - 代价(2026-10-02,负载 13–30):frontend-only 推送多出后端 15 个文件 / 662 条,`-n 4` 约 49 s
    (串行 105 s),其中门禁自己的测试占一半 —— 它把 `frontend/...` 当测试数据写,被保守地选中;
    core 改动选 31 个文件;只改 README / docs 选 3 个,另跑 jest 读文件测试(58 个,约 19 s)。
- 验证(2026-09-30,6 个真实提交各跑选择性与全量,再各注入一处会让测试红的改动)。
  方法:在本分支尖端上 `git revert` 该提交再 `cherry-pick` 回来,`--base` 取 revert 那一格,
  于是改动集恰好是那个提交的 diff,依赖是今天的;`127dff04` revert 冲突,改用 `PREPUSH_CHANGED`
  给出它的文件清单。时间是锁拿到之后的门禁时间(负载 5–12)。注入的破坏各让选择性与全量
  **红在同一组测试上**:

      提交       内容              jest 选中/总数        门禁时间 选择性/全量   注入破坏 → 两边都红
      905bbe84   前端组件           53/197 文件 (1437/3295 条)  19 s / 33 s   Breadcrumb 不再跳过无页前缀 → AppLayout.test
      c1fc7d77   core hook         104/197 (2066/3295)        76 s / 74 s   useBatchRecycleSouls 判断取反 → useSouls.test 4 条
      40dfcdc4   语言包            全量(规则:语言包)            102 s / 78 s  egy.json 一个值 → egyLexiconRules 2 条
      8b50dca9   后端 view         不涉及 jest;pytest 全量      108 s / 122 s views.py 分支取反 → 6 条
      4033dcc1   迁移              不涉及 jest;pytest 全量+往返  565 s / 497 s 0002 反向不删官员会话 → 1 条
      127dff04   语料 md + 语言包   全量(规则)                   254 s / 267 s md 加一个未知 code → 语料测试 2 条

  jest 本身:选择性 9 s 对全量 25 s(组件那条);core 那条选中 58 个相关文件,和全量差不多快。
  后端两列本来就是同一条命令,差值是噪声。c1fc7d77 那条的 `useSouls.test.ts` **不在** always-run
  里,只能靠 `--roots` 补上 core 之后的关联选中 —— 不补那一项,这次破坏在选择性运行里会是绿的。

pip-audit 不装进 venv(CI 也是临时装):`cd backend && uvx pip-audit --strict --desc
-r requirements.lock --no-deps --disable-pip`,与 CI 同一条参数。

**worktree 里还缺 `SECRET_KEY`。** `backend/.env` 同样 gitignored,
`.claude/worktrees/*` 里没有它,`config/settings.py:14-16` 于是直接拒绝加载 ——
每一条后端命令都先死在这里;只补 `SECRET_KEY` 还不够,`DEBUG=False` 时
`ALLOWED_HOSTS` 也必填(2026-09-11 两个都实测撞到)。照 CI(`ci.yml:14-15`)
在下面每条后端命令前加 `SECRET_KEY=ci-test-key-not-for-production-32-bytes-min DEBUG=true`。
**key 至少 32 字节**(2026-09-29 起):simplejwt 用它签 HS256,短于 32 字节 PyJWT 每签/验一次
就发一条 `InsecureKeyLengthWarning`(当时 4,519 条),而 `pytest.ini` 现在把它升成 error ——
短 key 下每条 JWT 测试都红。旧值 `ci-test-key-not-for-production` 是 30 字节。
**主 checkout 的 `backend/.env` 里那个 key 是 20 字节**(2026-09-29 实测长度),所以下面
两条 pytest 命令在主 checkout 里也要显式带上这个 `SECRET_KEY`(环境变量优先于 `.env`)。
**不要**把主 checkout 的 `backend/.env` 拷过来:它的 DATABASE_URL 与 REDIS_URL
都指向 115。钩子在没有 `backend/.env` 时自己补这两个值,并打印一行说明。

worktree 里的 `.venv`:它是 gitignored 的,所以 worktree 里没有;直接用主 checkout 的
绝对路径(`<主 checkout>/backend/.venv/bin/python`),或在 worktree 里照上面那行另建一个。

```bash
# Backend — matches CI pipeline exactly (same interpreter version, same lock)
# ISOLATE BOTH BACKING SERVICES. `.env` points DATABASE_URL *and* REDIS_URL at
# the shared box (192.168.2.115). Overriding only the database still lets the
# suite write permission-cache keys into the real Redis — verified 2026-08-27.
# Throwaway Redis first:
#   redis-server --port 6399 --daemonize yes --save '' --appendonly no
cd backend && SECRET_KEY=ci-test-key-not-for-production-32-bytes-min \
  DATABASE_URL="sqlite:///:memory:" REDIS_URL="redis://127.0.0.1:6399/0" \
  CELERY_BROKER_URL="redis://127.0.0.1:6399/1" \
  CELERY_RESULT_BACKEND="redis://127.0.0.1:6399/2" \
  .venv/bin/python -m pytest --tb=short -q
# ↑ 这是 CI 的形状:全部测试 + 覆盖率与 80% 下限。CI 2026-10-30 起另加 `-n auto --dist worksteal`(此前串行)。**pre-push 不是这条**,见下。
#
# pre-push 的后端 pytest(2026-09-29 起)与上面有三处不同,都是有意的:
#   --no-cov            覆盖率与 `--cov-fail-under=80` **只在 CI 里查**。而 CI 不在推送上跑
#                       (2026-10-30 起每天、`v*` tag 与手动)—— 所以覆盖率跌破下限,最晚
#                       要等第二天的运行才会被发现,不再是推送时。这是为了每次推送省下几分钟而接受的代价,不是疏忽。
#   -m "not migration"  26 条迁移往返测试(`migration` marker,pytest.ini 注册;用
#                       `migration_round_trip` fixture 的自动带上,见 backend/tests/conftest.py)
#                       每条 2–67 秒,合计 813 秒,约占 23 分钟全量的 13.5 分钟。推送
#                       改到迁移、`tests/migration_roundtrip.py`、任一 conftest、`pytest.ini`、
#                       `requirements.lock`、或含这类测试的文件(按内容 grep)时才跑它们。
#                       CI 与下面的真 PostgreSQL 命令永远全跑。
#   SECRET_KEY          钩子给 pytest 的永远是上面那个 ≥32 字节的测试 key,不读 .env 的。
#   -n 4                装了 pytest-xdist(requirements-dev.txt)就用 4 进程。实测 4:21 对串行 5:43;
#                       -n 6 不更快(每个 worker 先花约 36 秒建自己的测试库)。PYTEST_WORKERS=0 退回串行。
#   SQLite 模板库      2026-10-19 起 worker 不再各自迁移:第一次在 `<git common dir>/soulledger-sqlite-templates/`
#                       建一份迁移好的库(文件名带输入哈希),之后各 worker 用 sqlite `backup` 拷进自己的内存库。
#                       实测同一组 31 条测试:用模板 4 s,真迁移 42–49 s。逻辑在 `backend/config/sqlite_template.py`。
#                       输入哈希 = `backend/apps/` 全部非测试文件 + `backend/config/` + `requirements.lock`
#                       + 影响迁移的设置 + Python/Django/SQLite 版本 —— 故意放宽:迁移 import 的代码和
#                       `post_migrate` 接收器都在 apps/ 里,逐个列会漏。代价是后端代码一改就重建一次。
#                       **真迁移并核对**:`--full` / `GATES_FULL=1`(run-gates 导出
#                       `SOULLEDGER_SQLITE_TEMPLATE=0`),或这次运行含 `migration` 测试。核对把真迁移的库和同一
#                       哈希下的模板逐表比(结构 + 全部行,时间戳屏蔽),不一致就删掉模板并让所有用库的测试
#                       报 `TemplateDriftError` —— 那说明哈希漏了某个输入,把它补进哈希。
#                       手动关:`SOULLEDGER_SQLITE_TEMPLATE=0`。模板坏了直接删那个目录,下次重建。
#                       参数化里别放 uuid4() 这类每次不同的值而不给 ids —— 各 worker 收集到的用例名
#                       不同,xdist 整个拒跑(2026-09-29 撞到三处)。
# 钩子跑 pytest 时每 30 秒打一行进度(百分比 · 用时 · 已失败数),失败时保留完整日志。
# 钩子开跑前先拿 `scripts/gate-lock.sh` 的锁(git common dir 里,所有 worktree 共用):
# 同一时刻只跑一个重门禁,后来的每分钟打印一次在等谁。几个会话同时跑门禁时每个慢 2–3 倍
# (2026-09-29:空闲 19 分钟的 SQLite 全量,负载 50 下 38 分钟才到 77%)。GATE_LOCK=0 跳过。
# 自己跑的全量脚本也应先 `. scripts/gate-lock.sh; gate_lock "<说明>"`。
# **所有重门禁都拿锁,真 PG 那条也拿(2026-10-19 起)。** 此前它不拿,理由是「慢在和 115 的网络往返、
# 本机几乎空闲」;2026-09-30 的实测推翻了这一点:往返 0.57ms、Pi 负载 0.09,同一套件本机空闲时
# 17 分钟、被别的门禁挤着时 35 分钟 —— 吃 CPU 的是本机的测试客户端,`-n 4` 就是四个。
# 门禁脚本整段在 `taskpolicy -c utility` + `nice 10` 下跑(`run-gates.sh` 开头,`GATES_QOS=none` 关掉):
# 机器空闲时照样用满,前台有操作时让路。jest 三份配置的 worker 上限是核数一半(`JEST_WORKERS` 覆盖)。
# 手动复现钩子那条:在上面的命令后加 `--no-cov -m "not migration" -n 4`。
# 整套推送门禁(含选择性 jest)一条命令:`scripts/run-gates.sh`,见上面那节。
cd backend && DATABASE_URL="sqlite:///:memory:" .venv/bin/python manage.py makemigrations --check --dry-run
cd backend && .venv/bin/ruff check .
cd backend && uvx pip-audit --strict --desc -r requirements.lock --no-deps --disable-pip

# Frontend — matches CI pipeline exactly
cd frontend && npx tsc --noEmit
cd frontend && npm run lint
# 2026-09-05 起 `lint` 是 `eslint . --max-warnings 0`。此前是裸 `eslint .`,
# 于是 **warning 不改变退出码**:唯一会拦下 warning 的是 pre-commit 钩子里那条
# `--max-warnings 0`,而它只扫暂存文件。pre-push 和 CI 走的都是这个脚本,所以
# 本地提交被挡、CI 却是绿的。真踩过一次:一条 `no-unused-vars` warning 让
# pre-commit 拒了提交,而在那之前刚跑的 `npm run lint` 退出码是 0。
# `packages/core` 的 lint 脚本同时收紧。收紧当天两个 workspace 的 warning 数都是 0。
# 2026-10-19 起四个 workspace 的 lint 都带 `--cache`(缓存在 `node_modules/.cache/`),
# core / mobile / 官员端的 typecheck 带 `--incremental`。前端的 eslint 缓存目录名带
# `eslint.design-guard-baseline.json` 的哈希:配置在加载时读这份文件,eslint 自己的缓存键看不见它。
# 前端 eslint 不再设 `parserOptions.project` —— 没有任何规则用类型信息,它只是又建了一遍 TS 程序
# (实测冷启动 10 s → 6 s,有缓存 1 s)。将来加了要类型信息的规则,eslint 会直接报错,不会静默失效。
# jest 三份配置的 worker 上限是核数一半(`maxWorkers: JEST_WORKERS || '50%'`)加
# `workerIdleMemoryLimit: '1GB'`:默认的「核数 − 1」在这台 8 核 16 GB 的机器上开 7 个 jsdom worker,
# 吃满 CPU 并把内存压进交换区。临时要全速:`JEST_WORKERS=7`,或命令行 `-w`。
cd frontend && npm run build
# `test:coverage`, NOT `npm test`. `npm test` is bare `jest`, and
# `jest.config.js` sets `coverageThreshold` without `collectCoverage` — so the
# threshold is only evaluated when `--coverage` is passed. Measured 2026-09-05:
# `npm test` prints the word "coverage" zero times. The gate this repo lowered
# deliberately (with the arithmetic written into jest.config.js) is invisible
# to the command this file used to name.
# 两份 React(2026-09-19,feat/react-19):web 的生产构建与 jest 用的都是 Next
# 自带的 canary(`next/dist/compiled/react`;jest.config.js 的 moduleNameMapper
# 把 react / react-dom 映射过去,`jestRunsNextVendoredReact.test.ts` 守着);
# packages/core 的 vitest 与 mobile 用已安装的 react 19.2.3 —— Expo 57 钉了
# 19.2.3,而 Next 的每个版本都只自带 canary,两边无法取同一个版本。升级 next
# 会顺带换掉 web 测试里的 React。
cd frontend && npm run test:coverage

# packages/core — three separate gates, and `.git/hooks/pre-push` runs all
# three on any `^packages/` change. They were missing from this list, so the
# way to find out they exist was to be refused by the hook.
# `test` is vitest, not jest: `domBoundary.test.ts` builds a TS program from
# the package's own tsconfig and asserts that the 150 DOM type names leaked in by
# `@types/react` 19.2 stay unused (146 under 18.3; the list is derived at test
# time from `@types/react/global.d.ts`, so this number is a reading, not a
# config — re-measured 2026-09-19 on feat/react-19). `typecheck` alone does NOT catch that —
# they are empty interfaces, so `const el: HTMLElement = {}` compiles.
npm run --workspace packages/core typecheck
npm run --workspace packages/core lint
npm run --workspace packages/core test
# No `test:coverage` here anymore (removed 2026-09-14): the vitest coverage
# floor it used to run measured only the ~7 files core has its own tests for
# (9%), against a denominator of core's whole source — most of core (hooks,
# API modules) is exercised by the frontend's jest suites instead, which
# vitest cannot see. `frontend/jest.config.js` now has `rootDir` at the repo
# root and a path-scoped `coverageThreshold` for `packages/core/src`
# (81/74/66/82; 2026-09-14: 83.44/76.65/68.10/84.39), so that command —
# `cd frontend && npm run test:coverage` above — is where core's coverage is
# actually gated now.

# mobile/(灵魂端 App,Expo)—— 同样三条,脚本名见 `mobile/package.json`;
# pre-push 在任何 `^mobile/` 或 `frontend/app/globals.css` 改动上全跑,CI 的 `mobile` job 也跑这三条。
npm run --workspace mobile typecheck
npm run --workspace mobile lint
npm run --workspace mobile test      # jest + jest-expo

# E2E —— **先 build;本地按改动挑 project,合进 main 之前三个全跑**(2026-10-19 用户决定):
#   日常改动          只跑 chromium
#   改了布局或样式     chromium + mobile-chrome(393px 窄屏,下面那条真缺陷只有它抓得到)
#   合进 main 之前     chromium + firefox + mobile-chrome,三个全跑
# 本地默认 2 个 worker(`playwright.config.ts`,`PW_WORKERS=4` 临时调高;CI 仍是 1):
# 默认的「核数一半」是 4 套浏览器加 `next start`,会把这台机器吃满。CI 的 matrix 仍是三个都跑。
# 下面是这条规矩之前的理由 —— 三个 project 为什么都存在:
# `playwright.config.ts:55-59` 定义 chromium / firefox / mobile-chrome,而
# `.github/workflows/ci.yml` 的 matrix 三个都跑。这份文件此前只给了 chromium,
# 于是「跑过 E2E」在本地和在 CI 是两件不同的事 —— 393px 下工作流工具栏的按钮
# 压在输入框上那条真缺陷,在 main 上待了一整轮,因为没有人跑过那个 project。
#
# `webServer` 现在跑 `npm run start:e2e`(构建产物),不再是 `next dev`。
# 所以**先 build,再 playwright**。理由见 playwright.config.ts 里那段注释:
# dev server 按需编译,于是 `waitForLoadState("networkidle")` 等的是「编译完
# 没有」;实测同一份代码连跑三次,失败 3/4/2 条且中招路由每次都换,而任何一条
# 单独跑都过。换成构建产物之后,三个 project 各 108 passed,且快三倍。
cd frontend && npm run build
cd frontend && npx playwright test --project=chromium
cd frontend && npx playwright test --project=firefox
cd frontend && npx playwright test --project=mobile-chrome
# **跑 E2E 之前先看 3333 有没有人在听,而且要在推送之前跑(2026-10-11)。**
# `lsof -iTCP:3333 -sTCP:LISTEN` 有输出就查那个进程的 cwd:config 默认 3333 且 reuseExistingServer,
# 一次连到了子代理没关的 `next-server`,测的是它 worktree 里的旧代码,结果不作数(子代理说「已关」不可信)。
# 自己起服务用别的端口 + `PLAYWRIGHT_BASE_URL`。同一轮里先推送后跑 E2E,漏过 3 条真回归
# (评议区拿到非数组响应把整个审判页打成 500)—— jest 与 pytest 全绿。

# 真 PostgreSQL 上跑一遍 —— 上面那条 SQLite 命令跑不到的东西在这里
# 先拿门禁锁(上面「所有重门禁都拿锁」):在仓库根 `. scripts/gate-lock.sh; gate_lock "real PG"`,同一个 shell 里再跑下面这条。
# 不设 DATABASE_URL,让 Django 读 .env 指向 115;pytest-django 自建测试库
# 再删掉,不碰真库。`--create-db` 是必需的:陈旧的 test_soulledger 会造成上千条
# 「环境错误」,那正是这条路径当初被判成不可用的原因。
# 2026-09-29 起库名是每次运行一个:`test_soulledger_<8 位 hex>`(根 conftest +
# `backend/config/testdb.py`),两个会话同时 `--create-db` 不再撞同一个库
# (此前第二个全部 `DuplicateDatabase` / `ObjectInUse`)。要固定名字(找库、
# `--reuse-db`)就设 `SOULLEDGER_TEST_DB_SUFFIX=<[a-z0-9_]{1,20}>`。
#
# **只放开数据库,Redis 仍然用一次性的那台(见最上面)。** 这条命令此前什么都
# 不覆盖,于是 REDIS_URL 也读 `.env` 指向 115 —— 最上面那段 2026-08-27 验证过的
# 情形:`apps/perm/cache.py` 自开 Redis 客户端(conftest 的 LocMem 覆盖不到它),
# 套件往 115 写权限缓存键,每次无前缀的 `invalidate_all_permissions()` 还会删掉
# 那里所有 `perm:*`。`28a374a` 给 pre-push 修的是同一件事,这条漏了。
# 另:`test_invalidate_all_clears_its_own_prefix_and_only_its_own` 在 REDIS_URL
# 不是本机时跳过(它不往共享 Redis 写)—— 不带下面三个变量跑,skip 会多一条。
cd backend && SECRET_KEY=ci-test-key-not-for-production-32-bytes-min \
  REDIS_URL="redis://127.0.0.1:6399/0" \
  CELERY_BROKER_URL="redis://127.0.0.1:6399/1" \
  CELERY_RESULT_BACKEND="redis://127.0.0.1:6399/2" \
  .venv/bin/python -m pytest -q --no-cov --create-db -n 4 -m "not migration" \
  -o faulthandler_timeout=600 -o faulthandler_exit_on_timeout=true
# 最后一行是挂死探测(2026-10-19 起):2026-10-19 一次真 PG 停在 96% 五个半小时 —— gw0 在 115 上
# `idle in transaction`(一条 INSERT souls_soulrecord),另一个 worker 卡在 Python 线程锁上,四个 worker CPU 全 0,
# 没有任何输出;`-q` 不打印正在跑的测试名,也就查不出是哪条。重跑没有复现(偶发)。带上这两项,
# 单条测试超过 10 分钟就打印全部线程的栈并退出那个 worker,整轮照样跑完,栈留在日志里。
# 2026-10-09 起(用户决定):**4 进程并行，迁移往返只在改了迁移时跑。**
# 串行全量 53 分钟(6384 passed),
# 卡在 76% 附近的是迁移往返与 transaction=True 的并发测试。
# `-n 4 -m "not migration"` 实测 13.5 分钟(`d51b7d2e`:6360 passed / 7 skipped / exit 0,
# 跑完 115 残留 NONE)。每个 worker 在 115 上建自己的库(`test_soulledger_gw0_<后缀>`)。
# **2026-10-19 起这些库从一个模板克隆**(根 `conftest.py` + `backend/config/testdb.py`):xdist 主进程先建
# `test_soulledger_tpl_<后缀>` 并完整迁移一次,worker 用 `CREATE DATABASE … TEMPLATE` 建自己的库,迁移无事可做;
# 会话结束(或建模板失败时当场)`DROP DATABASE … WITH (FORCE)`。此前四个 worker 各自重放约 389 个迁移。
# 只对 PostgreSQL 且带 `-n` 时生效;SQLite、`-n 0`、`--reuse-db`、`--nomigrations` 走原路径。
# 查残留时 `like 'test_soulledger%'` 同样匹配 `_tpl_`。
# 实测(2026-10-19,`6a10df06`):7654 passed / 15 skipped / exit 0,**950 s**(10-10 那次各自迁移是约 18 分钟,
# 测试还少一千多条);跑完 `_tpl_` 已删,本轮无残留。被 Ctrl-C 打断时模板同样被删,只留下当时那个 worker 的库。
# 改到迁移、`tests/migration_roundtrip.py`、conftest 或 `pytest.ini` 时，去掉 `-m "not migration"`
# 跑全量(规则同 pre-push 的 SQLite 那条)。
# 多库守卫(G3/G7,opt-in,2026-10-09):第二个别名 `tenant_shadow` + 测试路由,只在这个 settings 下存在,
# 正常门禁不跑(skip)。说明与限制见 docs/ARCHITECTURE-tenant-sharding.md 4.1。
cd backend && SECRET_KEY=ci-test-key-not-for-production-32-bytes-min DEBUG=true \
  DATABASE_URL=sqlite:///:memory: REDIS_URL=redis://127.0.0.1:6399/0 \
  .venv/bin/python -m pytest --ds=config.settings_multidb -m multidb --no-cov tests/test_multidb_shadow.py
```

**`tests/test_concurrency.py` 里有 4 条 `skipif(SQLITE)` 的测试,是这个仓库里唯一
真正检验 `select_for_update` 的东西** —— 上面那条 SQLite 命令一条都不跑它们。
`test_the_postgres_only_set_is_the_set_we_think_it_is` 钉住这个集合,
让它不能再无声地增长。

**两条路径实跑对照(2026-09-05,同一份代码):**

    SQLite 内存库     3478 passed /  7 skipped / exit 0
    真 PostgreSQL     3483 passed /  2 skipped / exit 0

(2026-08-31 那次是 3435 / 3440。绝对值会随测试增长,**+5/−5 这个差值才是结论**。)

**2026-09-25 复测(`638929e2`,云端十个任务合入后):** SQLite **4809 passed / 25 skipped**,
真 PostgreSQL **4829 passed / 5 skipped**,差值 **+20/−20** —— 正好是
`test_the_postgres_only_set_is_the_set_we_think_it_is` 名单的长度(20)。PG-only 集合随并发认领等功能增长,
**差值应等于那份名单的长度**,不是固定的 5。同一天前端 jest 182 suites / 2974,mobile 235,core vitest 122,
E2E 三个 project 各 140。

**2026-09-25 再测(`07706a5e`,读退出码):** pre-push SQLite **5040 passed / 26 skipped**;真 PostgreSQL(`26554de7` + 修复)**5060 passed / 5 skipped / 1 failed**,修后重跑那 15 条全过。
差值 26 − 5 = **21**,等于此时名单长度(21)。integ `8c799840` 门禁:jest 186 suites / 3045,
core vitest 15 文件 / 145,mobile 259,E2E chromium 153 / firefox 153 / mobile-chrome 149。

**2026-09-26 再测(读退出码):** main `35f2d95f` pre-push SQLite **5328 passed / 26 skipped**;
真 PostgreSQL(第六轮 integ `33a38e77`)**5349 passed / 5 skipped**,跑完 `test_soulledger*` 残留 `NONE`。
差值 26 − 5 = **21** = 名单长度(21);通过数之差大于 21,因为两个数量的是不同的树。
第六轮 integ 门禁:jest 192 suites / 3183(egy-sec14 之后 3187),core vitest 16 文件 / 158,
mobile 300,E2E chromium 155 / firefox 155 / mobile-chrome 151,egyLexiconRules 28。

**2026-10-10 再测(`d6242d87`,读退出码):** pre-push SQLite **6608 passed / 40 skipped**;真 PostgreSQL
**6602 passed / 15 skipped**,跑完 `test_soulledger*` 残留 `NONE`。PG 的 15 = 原来的 7 加 8 条多库守卫
(`tests/test_multidb_shadow.py`,不带 `--ds=config.settings_multidb` 就跳过,设计如此)。
jest 250 suites / 4252,core vitest 18 文件 / 180(改到 core 时),mobile 616,官员端 244。E2E 这两天没有跑。
`-n 4` 下真 PG 约 18 分钟(测试变多了,此前 13.5 分钟)。

**2026-10-12 再测(`03fb1f2c`,读退出码):** 前端 jest **270 suites / 4526**,core vitest 22 文件 / 228,灵魂端 856,
官员端 407,E2E chromium 234 / firefox 234 / mobile-chrome 227(这三项在 `fd69f56c` 之后的树上跑,其后只改了语言包与 App)。
后端这两天只改了测试与文案:pre-push 的读文件测试 904 passed;全量 SQLite 与真 PostgreSQL 没有重跑,
上一次是 `1e17a4aa` 的真 PG 含迁移 7020 passed / 1 failed(那一条是后端一处文案副本,随后修掉;修后没有重跑全量)。

**事件日志(`EventService.log*`)是业务记录的一部分(2026-10-10 用户决定):**写 `SoulEvent` 失败,整笔业务回滚,
调用方拿到原始异常。因此 **`log*` 必须写在它所描述的那笔业务的事务里面**,给人的通知和推送才放 `transaction.on_commit`。
写在事务之后的 `log*` 在失败时业务已经提交、无从回滚;写在内层 `atomic` 里又被吞掉异常的,会静默回滚却报成功 ——
修之前有 17 处是后一种。`tests/test_event_log_inside_transactions.py` 按「不在事务里 / 调用方有事务 / 调用方之后还查询」
三种上下文逐条注入失败。新加一个会写事件的业务路径,就在那张网格里加一格。
**入口(2026-10-30 统一,与 `apps/events/services.py` 文件头同一句)**:只上灵魂时间线的用 `EventService.log*`;
还要发网页实时推送与租户 webhook、或要记在灵魂原属租户的,用 `event_bus.publish_soul_event(soul, …, domain=…, tenant=…)`
(调拨走 dispatch 域、受刑计划走 sentence_plan 域)。两条都由 `AuditHandler` 写行,规则相同;**不要直接 `SoulEvent.objects.create`**
—— 那样的行到不了任何别的处理器(此前调拨与受刑计划就是这样,推送靠 post_save 补接,webhook / 实时推送收不到)。
`AuditHandler` 找不到灵魂(软删、不在事件租户、也不在其原属租户)**抛 `SoulEventTargetError`**,业务随之回滚,不再静默跳过。
同一轮:`AuditUserFields.save(update_fields=[…])` 部分保存自动补写 `version` / `update_user` / `update_time`(`apps/core/models.py`,
`tests/test_partial_save_persists_bookkeeping.py`),调用方不要再手写这三项。
事件类型必须先登记进 `EventType`(`tests/test_event_types_fit_the_column.py` 会点名),登记后前端那几道守卫会跟着要词条;
egy 没有 Design 的词时把键写进 `frontend/src/__tests__/support/egyPendingKeys.json`,后端和前端的守卫现在都认这份清单。

**`scripts/run-gates.sh` 自己起的临时 Redis 现在在被打断时也会关掉**(EXIT trap,2026-10-10)。
此前只有正常跑完才关:2026-10-09 一次中途停掉的推送留下一个 `redis-server`(随机端口)挂了一天。
`pgrep -fl redis-server` 看到除 6399 以外的,先看启动时间和 `lsof -p <pid> | grep cwd`,确认是门禁留下的空库再 `redis-cli -p <端口> shutdown nosave`。

多的 5 条正是那 4 条并发测试加 `test_two_judges_cannot_both_decide_one_node.py`;
剩下的 2 个 skip 是 `Menu` / `MenuButton`,它们**确实没有 tenant 字段**。
**「7 skipped」不是噪音,是 5 条从没在这条路径上跑过的测试。**

跑完记得看 115 上有没有留下 `test_soulledger*`:pytest-django 正常会删掉它,
中断或 xdist 会留下。库名现在带每次运行的后缀(`test_soulledger_3f9a0c1e`),
下面的 `like 'test_soulledger%'` 照样匹配;**别在另一个会话还在跑时删**,
后缀不同的那个可能正在用。2026-08-31 清理时那里躺着 **8 个**(最老的是 2026-06-06 的),
每一个都是空库,而**陈旧的 test_soulledger 正是那上千条「环境错误」的成因**。

    psql -U soulledger -d postgres -Atc \
      "select datname from pg_database where datname like 'test_soulledger%'"

**这台机器上没有 `psql`**(2026-09-05 实测 `command -v psql` 为空),所以上面那条
按原样跑不了。用 Django 自己的连接参数问同一个问题:

    # 解释器是 backend/.venv(psycopg2-binary 在 requirements.lock 里)。
    # **不要 source `.prepush.env`**:它的职责就是把 DATABASE_URL 覆盖成 SQLite,
    # 一旦 source,下面这段会去连本地 socket 而不是 115 —— 问错了数据库,
    # 而它会安静地失败在「连不上」而不是「查不到」。2026-09-05 两种都试过。
    cd backend && .venv/bin/python -c "
    import os, django; os.environ.setdefault('DJANGO_SETTINGS_MODULE','config.settings'); django.setup()
    from django.db import connection as c; import psycopg2
    d=c.settings_dict
    k=psycopg2.connect(dbname='postgres',user=d['USER'],password=d['PASSWORD'],host=d['HOST'],port=d['PORT'] or 5432)
    q=k.cursor(); q.execute(\"select datname from pg_database where datname like 'test_soulledger%'\")
    print(q.fetchall() or 'NONE')"

2026-09-05 实跑这条:`NONE`。
2026-09-05 复核了这条路径的两个说法:**teardown 本身没坏** —— 一次真建库的
`--create-db` 跑完(12 秒、有迁移)之后是 `NONE`;而当时确实躺着一个 17MB / 58 张表的
残留,**不是空库**。删它之前先确认 `pg_stat_activity` 里对它的连接数为 0。
成因没查出来:我自己那次全量跑是正常结束的(exit 0、打了汇总行),
所以要么残留早于它,要么有一次没被观察到的 teardown 被打断 —— **分不出是哪种**。
**2026-09-26 查到并修掉(`bf406a6f`):两种都不是。** `database_sync_to_async` 的单线程
executor 因 `conn_max_age` 一直握着一条连接,DROP 失败,而 pytest-django 把它降成一条
warning —— exit 0、汇总行照打,残留照留。修法是根 `conftest.py` 的 `django_db_setup`
包装(会话结束前关掉那条连接),加 `pytest.ini` 把那条 warning 升成 error。

**断一次连接只赔一条测试(2026-10-19)。** 那天真 PG `-n 4` 时 gw2 到 115 的连接断了
(`could not receive data from server: Operation timed out`,服务端什么都没记，还把会话当 idle 握着),
Django 留着那个死连接,gw2 之后每条测试都是 `InterfaceError: connection already closed`,**一次断线 150 条红**,
收尾时 DROP 又被那个 idle 会话挡住,gw2 的库留在了 115。现在 `config/testdb.py`(由 `pytest.ini` 的
`-p config.testdb` 挂上):某条测试任一阶段抛连接级错误，它照样红，收尾后关掉连接，下一条重新连;
真 PG 的连接带 TCP keepalive(30 s 起探、10 s 一次、3 次不回即断)和 `connect_timeout=10`,只在测试里加;
根 `conftest.py` 的 `django_db_setup` 收尾先终止本次测试库上残留的会话再交给 pytest-django DROP
(只碰 `test_soulledger_` 开头的库)。守卫:`tests/test_dropped_connection_costs_one_test.py`。

**SQLITE HIDES A WHOLE CLASS OF DEFECT, AND THE SUITE ONLY RUNS ON SQLITE.**
Two shipped bugs surfaced the first time this code met a real PostgreSQL
(2026-08-27), with 2665 tests green throughout:

- A failed statement **aborts the transaction** on PostgreSQL and does not on
  SQLite. So `except Exception: pass` around a query is a no-op in tests and a
  migration-killer in production — see `apps/perm/migrations/0017`, where it
  turned a missing column into `current transaction is aborted` reported
  against a line that had nothing to do with the fault.
- `varchar(n)` length is **enforced** on PostgreSQL and ignored by SQLite.
  `Statute.source` was `CharField(500)` while `INFERNO_SOURCE` was 524
  characters, from the day that corpus landed.

Neither is testable on SQLite: an assertion added there would be one of the
checks that can never fire. Before trusting a green suite on anything touching
transactions, constraints, or column widths, run it against PostgreSQL.

**CI/Local Differences:**
- **CI 什么时候自己跑(2026-10-30 用户决定)**:`ci.yml` 每天 03:00 UTC 跑 main(**main 过去 24 小时没有新提交就整轮跳过**,`changes` job 判断;用户 10-30)、推 `v*` tag 时跑、手动跑;
  `security.yml` 每周一 04:00 UTC 与手动。**不在分支推送与 PR 上跑** —— 额度耗尽过,而这里的推送几乎全是推 main,
  一天几十次。仓库已公开,GitHub 托管的 Linux runner 对公开仓库不计分钟,所以「每天」不再受分钟额度限制。
  推送的门禁是本地(unRAID)的 `scripts/run-gates.sh`;CI 每天兜一次底:覆盖率下限、真 PostgreSQL 全量、
  三个 E2E 引擎、npm / pip audit。所以 CI 发现问题最晚晚一天,而且红的那次对应的是一天的提交,不是一个。
  每个 job 有 `timeout-minutes`,同 ref 旧运行被取消。估算每次约 120 runner 分钟,是读 job 清单估的,
  第一轮真跑后按 Actions 的计时重估。守卫 `backend/tests/test_ci_runs_on_a_budget.py`。
- CI runs `python manage.py migrate` before tests (local uses existing DB)
- CI runs `pip-audit --strict` (local can skip)
- CI runs `npm audit --audit-level=high` (local can skip)
- CI runs E2E separately (local can run on demand)
- CI has a separate `mobile` job (`ci.yml:183-199`): `npm ci`, then mobile typecheck / lint / test.
  Locally pre-push runs the same three only when `^mobile/` or `frontend/app/globals.css` changed
  (`scripts/run-gates.sh:169`)

## Verification & Root Cause

- NEVER claim `fixed`, `verified`, or `production ready` without execution evidence
- Claiming a suite passed requires the command, its exit code, and the passed count
- **读退出码,不读输出。** `ruff check . | tail -1` 在失败时给的是
  「[*] 1 fixable…」而不是「Found 1 error.」;`cmd | tail` 的退出码是 `tail` 的,
  永远是 0;`| grep` 只给你要找的,不会告诉你还有别的。三次事故全出在这里 ——
  2026-08-30 的两条 ruff 错误躺在 main 上、2026-08-31 把 playwright 的
  「3 failed」读成绿的、2026-09-01 又让一条 ruff 错误跟着提交合进 main。
  写成 `cmd >/dev/null 2>&1; echo "exit: $?"`,或对管道用 `${PIPESTATUS[0]}`
- A green run from before the change is not evidence — re-run after editing
- Before fixing a bug, write it out first: symptom → root cause → proposed fix
- If the root cause is unknown, say so — do not ship a patch that only hides the symptom
- After fixing, check whether the same root cause exists elsewhere in the codebase
- A new check must be proven to fail: mutate the thing it guards, watch it go red, then trust the green
- Assert absence as well as presence — "the right value is shown" stays green while the wrong one sits beside it
- A test double that behaves like the bug is worse than no test: it makes correct code look broken and broken code look fine
- Do not state as fact anything you did not execute or query — an adjacent command does not answer a different question
- A comment, a mock, and a chat message each make a claim on behalf of code you did not run; the ones that read as settled are the ones nobody re-derives

*Why:* `docs/PRODUCTION_READINESS_REPORT.md` claimed "Production Ready / Security 8.5" on
2026-05-30; the 2026-08-07 M15 audit found 4 CRITICAL tenant-isolation gaps in that same code.
Many of the 61 fix commits in 2026-08 patch what the previous fix missed — e.g. `d879960`
"close the last two tenant-scoping gaps the M15 pass missed".

*Why:* the 2026-08-14 BRIEF §4.6 session hit the same unverified-claim shape four times.
A comment in `app/dispatch/page.tsx` said "the raw member goes to `title` instead" above a badge
with no `title` attribute; it shipped through review. A Jest stub in
`src/__tests__/WorkflowPage.test.tsx` (`DomainEnum: ({value}) => <span>{value}</span>`) reproduced
the exact defect under test, so the test measured the stub. A contract rule in
`src/__tests__/domainDisplayContract.test.tsx` checked that `title={...}` existed near an enum
render but never what was inside it, so `title={t("some.key")}` would have passed a rule whose
whole point is that the raw member stays recoverable. And an agent ran `git branch --show-current`,
read `main`, and reported that a named branch did not exist — it existed locally and on origin.

## Setup

```bash
# Install Git hooks (run after cloning)
bash scripts/install-hooks.sh
```

## Git

**这里是提交格式的唯一权威。** `CONTRIBUTING.md` 与 `AGENTS.md` 都指回这一节 ——
此前三处各写一份清单,三份互不相同,而没有 commit-msg 钩子会发现这件事。

- Format: `type(scope): description`
- Types: feat, fix, docs, style, refactor, test, ci, chore

scope 可省,但**多数派是带的**。2026-09-06 实测 818 条提交:

    带 scope   type(scope):   543  (66%)
    不带 scope type:          250  (31%)
    两者都不是                 25  ( 3%)   ← 多为 Merge,及早期的 "fix + feat:" 写法

上面八个 type 覆盖 **765 / 802 = 95.4%**。落在外面的是 `merge`(21)、`i18n`(4)、
`security`(3)、`perf`(3)、`build`(3)、`misc`/`migrate`/`infra` 各 1 ——
**刻意不收进清单**:它们合计不到 5%,为八个类之外的长尾扩表,只会让清单再次
和实践脱节。要用就用,别为它改这一行。

复核命令(数字会随提交增长,别信这里的绝对值,信这条命令):

```bash
git log --format="%s" | grep -oE '^[a-z0-9]+' | sort | uniq -c | sort -rn
```

## Lazy-Load Reference

Load `docs/claude-reference.md` only when explicitly required for:
- Agent communication patterns and examples
- Swarm routing and topology configuration
- Memory/learning MCP tools and hooks
- CLI commands and setup
