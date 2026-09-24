# 负载下的偶发失败——根因与修复

分支 `fix/mobile-flaky-tests`,基于 `main` 的 `4e0b7785`。2026-09-24,云端容器,4 核,node 20.19.5。

**负载**:12 个 `yes > /dev/null` 占住 4 个核,跑完即杀。
**循环**:每个文件 `npx jest --runInBand <file>` 连跑 20 次,按退出码计红绿。
「全量」指整个 mobile 套件 `npx jest --runInBand`。

## 总表

| 循环(负载下,各 20 次) | 修改前 | 修改后 |
|---|---|---|
| `chat.test.tsx` | 12 绿 / 8 红 | **20 / 0** |
| `session.test.tsx` | 20 / 0 | 20 / 0 |
| mobile 全量 | 10 绿 / 10 红 | **20 / 0** |
| `frontend … SoulCredentialsPage` | 20 / 0 | 未改动 |
| web 全量(并行,10 次) | 10 / 0 | 未改动 |

session 这一行前后都是绿的,这个循环分不出改动前后,所以不作为那几条的证据。那几条的证据是下面逐条列出的确定性对照。

修改前 mobile 全量那 10 次红,按用例拆开:

- 「没有书信 tab」6 次;
- 「四个 tab」5 次;
- 「skins the app」1 次。

其中有两次同一轮红了两条,所以合计多于 10。

## 1. 「four tabs: 本世 / 转生 / 书信 / 朋友圈 …」:act() 警告

- **重现**:chat 循环 20 次红 3 次,mobile 全量 20 次红 5 次。消息都是
  `An update to BottomTabView inside a test was not wrapped in act(...)`。
- **根因**:tab 切换的末尾是一条两级计时器链。计时器打点后的调用栈如下:
  1. jest-preset 的 `NativeAnimatedModule.startAnimatingNode` 替身用
     `setTimeout(endCallback, 16)` 结束动画;
  2. 动画结束回调里,`BottomTabView.tsx:189` 再挂一个 32 ms 的 `setTimeout`,
     执行 `setLastUpdate({animating:false})`。

  测试用的是裸 `fireEvent.press`,然后 `findByText` 立即命中,测试体就结束了。
  打点实测:32 ms 计时器在测试体结束**之后**才挂上(测试体 405 ms 结束,
  410 ms 挂上,414 ms 卸载)。负载下「挂上 → 卸载」这段拉长到 32 ms 以上,
  更新就落在 act 之外。
- **同一根因的另一处**:`stubApi.ts` 里的 `settleTabs` 也有这个漏洞。它只等一个
  100 ms 计时器;事件循环被堵住超过 100 ms 时,16 ms 和 100 ms 在同一轮到期,
  16 ms 先触发并挂上 32 ms,100 ms 随即结束等待,32 ms 还挂着。
  用确定性放大器验证过:切 tab 后排一个 0 ms 计时器,在其中阻塞 150 ms,
  测试体末尾再阻塞 60 ms。**旧 settleTabs 5/5 红,新的 0/5 红。**
- **修复**:
  - 这条用例改用 `pressTab`;
  - `settleTabs` 按链逐级等待,先 `tick(16)` 再 `tick(32)`。依据是 Node 把同一时长的
    计时器放在同一条链表里、按插入顺序触发,所以同时长、后挂上的计时器必然在
    它之后触发;不同时长之间没有这个保证,这就是用原链的时长而不是余量的原因。
  - 代价:若库改了这两个常数,保证会退化,注释里写明了。

## 2. 「chat not configured here: no 书信 tab at all」:两种失败

- **重现**:chat 循环 20 次红 5 次,mobile 全量 20 次红 6 次。
  都是 5 s 的 waitFor 超时,而且耗时呈双峰:
  - 这 5 次,整个文件跑了 26–29 s;
  - 其余 15 次都是 12–14 s。
- **根因一:失败的断言本身太慢。** 失败的
  `expect(screen.queryByTestId("tab-Letters")).toBeNull()` 要把收到的值 pretty-print
  出来,而那个值是 `ReactTestInstance`,它的 `_fiber` 连着整棵应用树。
  - 单次失败检查实测 **488–499 ms**;换成 `not.toBeOnTheScreen()` 只要 **2 ms**。
    这组打点都是在同样的 12 个 `yes` 下测的:session 的基线循环当时正在跑。
  - 打点显示:`setAvailability("not_configured")` 发生在 197 ms,
    `MainTabs` 却到 1210 ms 才重新渲染。中间是两次失败的检查,各 ~500 ms。
  - 原因:过期的 waitFor interval 在 Node 的 timers 阶段先于 React Scheduler 的
    `setImmediate` 执行。渲染每晚一次,就多一次 ~500 ms 的失败检查;失败的那几轮里,5 s 预算就耗在这些检查上。
  - 换成廉价检查之后,整个等待从 1405 ms 缩到 301 ms。
- **根因二**(修了一之后才露出来,chat 循环 20 次红 1 次):act() 警告,来自
  `BaseNavigationContainer` 和 `PreventRemoveProvider`。
  - waitFor 在「去掉 tab」的那次提交上通过。RNTL 的 `wrapAsync` 只再给一次
    `setImmediate`,就把 act 环境打开。
  - 导航器随后的簿记(容器状态同步、prevent-remove 的副作用)分片跑,
    负载下会溢出到那之后。
  - 这类后续工作从外面观察不到,换哪种 waitFor 条件都等不到它。
- **修复**:
  - 服务器的答复用 `heldReply()` 挂起,测试在 `await act(...)` 里交出答复,然后同步断言。
    依据在 React 源码(`react-test-renderer.development.js:2851–2876`):actQueue 非空时,
    根节点已排进真实 Scheduler 的工作会被取消、改排进 actQueue,act 返回前全部冲刷完。
  - 同时补了「答复前 tab 在」的断言,证明它的消失是答复造成的。
  - 两个方向的变异都验证过:总是渲染 Letters 时,失败信息是
    `expected element tree not to contain element`;总不渲染时,是
    `Unable to find … tab-Letters`。
- **同写法的其他四处**:`circlePeople:231`、`settings:347`、`circle:290`、`circle:344`
  也改成了 `not.toBeOnTheScreen()`。这四处**没有观察到失败**,属于潜在问题:
  `settings:347` 实测第一次检查就通过,所以昂贵的那条路径目前没走到。

## 3. 「a stored session › 401 whose refresh the server refuses …」

- **重现**:单跑 `-t "a stored session"` 25 次红 1 次,消息是
  `Unable to find an element with testID: login-submit`。**而超时时打印的树里
  已经有 `testID="login-submit"`。** 也就是说画面是对的,是等待预算用完了。
  - 用户报告里那次失败的原文我没有,所以不知道它是不是同一种形态。
  - 更大的 HEAD 样本(60 次)全绿,说明这是低频失败。
- **根因**:`findBy` 用的是 RNTL 默认的 1000 ms 预算,而这一步是整个应用从启动到登录。
  用 Profiler 实测:
  - 空载 138–160 ms;
  - 负载下 466–650 ms(15 次);
  - 失败那次超过 1000 ms。

  RNTL 的 `findBy` 每次检查不打印树(`printElementTree:false`),所以没有
  「检查本身太慢」的问题,单纯是 CPU 饥饿对 1 s 预算。这和兄弟分支上修过的
  那个是同一类。
- **修复**:
  - `jest.setup.js` 里设 `configure({ asyncUtilTimeout: 5000 })`;
  - `jest.config.js` 里设 `testTimeout: 15000`,这样真正找不到时仍报自己的消息,
    而不是被 jest 5 s 的测试超时抢先。
  - 实测:找一个永不出现的 testID,5007 ms 后报 `Unable to find …`。
  - 这是全局改动:mobile 所有 findBy/waitFor 预算都变成 5 s,代价是真失败要 5 s 才报出来。
- 这条用例另外也改成了 held reply,理由见第 4 节。

## 4. 修 3 时发现的产品缺陷:会话过期后,未发信件被写回磁盘

- **现象**:把「a session that expires on its own (401) takes the unsent letters off
  the device too」改成在 act() 里交出 401 之后,整文件跑 **5/5 红**:登录页已经出来了,
  `persistentStore` 里仍有那封信。给读写打点:

      TEST answering inside act
      OUTBOX clear
      OUTBOX save account=SL-CN-000042 items=1     ← 清掉之后又以旧账号写回
      TEST act returned

  这封信还**漏进了后面的用例**:403、skins 等用例一开始磁盘上就是 `items=1`。
  原因是 session.test 的 `beforeEach` 不清 `persistentStore`,而写回的源头就是这个竞态。
- **根因**:`session.tsx` 的三条登出路径(`:57`、`:77`、`:123`)都是先 `clearOutbox()`,
  再 `setState(signedOut)`。如果 ChatProvider 上一次提交里的 `save` 副作用还没执行
  (账号仍在、outbox 里有信),React 渲染下一个更新之前会先冲刷它,于是信被写回。
  - 单独跑这一条时,那个副作用恰好在答复之前就执行完了(顺序是 save, save, clear),
    所以旧测试多半是绿的。
  - 生产上同样取决于时序:401 到达时有没有挂起的副作用。
- **修复**(`chat.tsx`):`clearOutbox` 给一个模块级计数加一;ChatProvider 在账号的
  会话开始时记下这个计数,之后只要计数变了,`save` 就拒绝写入。
  `save` 自己「没有待发就删记录」那一步改为直接 `remove`,不再经过 `clearOutbox`,
  否则它会被当成一次登出。
- **证据**:
  - 修复后整文件 **0/5 红**,13/13 通过;
  - 变异「save 里仍调 `clearOutbox`」会让 chat.test 的 4 条跨重启 outbox 用例变红,
    说明这一点有测试守着。
- 同一模式还应用到「a 401 on a LATER request」和上面第 3 节那条:先等
  `/soul-auth/refresh/` 发出,再在 act() 里交出 401。

## 5. 「a stored session › skins the app by the soul's civilization」(不在原清单里)

- **重现**:修改前 mobile 全量 20 次红 1 次。act() 警告来自 `RootNavigator`、
  `MyLifeScreen`×3、`PastLivesSection`×2、`ChatProvider`×2。
- **根因**:`profile-card` 在已登录那棵树的**第一次**提交里就渲染出来(早于任何数据),
  所以 `findBy` 命中时,这棵树的挂载副作用及其引发的请求和渲染还排在 Scheduler 里,
  之后才落地。警告列表与这组副作用一一对应。
- **修复**:`/me/` 用 held reply,在 act() 里交出。

## 没解释清楚的

1. **`SoulCredentialsPage` 的超时没能重现**,根因未知,所以**没有改它**。
   - 负载下单跑 20/20 绿,最慢的用例 709 ms(中位 603 ms);
   - 负载下 web 全量并行 10/10 绿,这个文件最慢 745 ms,对 jest 的 5000 ms 超时有 6–7 倍余量。
   - 不知道当时超时的是 jest 的 5 s,还是 DTL 默认 1 s 的 `findBy`。
   - 这个文件大量用 `*ByRole`:失败的 `findByRole` 会计算全树角色并打印 DOM,
     这是个可疑点,但没有测量支持,不作结论。
2. **act 模式失败的精确交错没能确定性复现。** 第 2 节根因二、第 4 节的「跨提交挂起副作用」
   和第 5 节,机理都有源码和观察支持,但我做的放大器全是 0/10:
   - 在 `Screen` 渲染里加 8 ms 或 60 ms 忙等;
   - 把 `findBy` 的 interval 设成 1 ms。

   这几处修复不依赖那个交错(act 接管根节点工作,已在 React 源码里核实),
   修改后负载循环也全绿。但它们的原始频率约 1/20,所以 20 次全绿只是弱证据。
   第 4 节是例外:它有 5/5 → 0/5 的确定性对照。
3. **同一「findBy 命中后测试立即结束」的形状还留在别处**,没有改,修改后的 20 次全量里
   也没观察到失败:
   - session.test 的 offline、403、回到本世 tab、两条登出;
   - 其他套件。
4. session.test 的 `beforeEach` 不清 `persistentStore`(第 4 节写回的信就是这样漏过去的)。
   产品修复之后已经不再漏,而且那条用例自己就断言了删除,所以没有动它。

## 门禁(修改后,同一棵树)

| 命令 | 结果 |
|---|---|
| `cd mobile && npx jest` | exit 0,14 suites / **233 passed** |
| `cd mobile && npx tsc --noEmit` | exit 0 |
| `cd mobile && npx eslint . --max-warnings 0` | exit 0 |
| 负载 × 20:`chat.test` / `session.test` / mobile 全量 | 20/20、20/20、20/20 |
| 负载 × 20:`cd frontend && npx jest SoulCredentialsPage` | 20/20(未改动,只做了修改前的测量) |
| `cd frontend && npx jest`(空载) | exit 0,168 suites / 3118 passed |

frontend 没有改动,所以没有「修改后」的数字;上面那两行是在同一份代码上测的。
