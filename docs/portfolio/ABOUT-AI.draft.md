# About AI in this project — DRAFT, awaiting the author's review

> **待作者审定。** 这份草稿由 Claude 起草，作者还没审过，README 也没链接它。
>
> 下面的事实每条都附了核对命令，数字是 2026-11-14 在 `feat/github-first-impression` 上读的。
> 标 **[作者填写]** 的地方只有作者知道答案，请按真实情况写。不知道的就删掉，不要留空话。
>
> 定稿后的处理：
> 1. 把英文段落放进 `README.md`，位置在「Three things worth a look」之前。
> 2. 把中文段落放进 `README.zh-CN.md` 的同一位置。
> 3. 删掉这个文件。

## English (for README.md)

> **About AI.** Most of the code in this repository was written by Claude Code, not typed by me line by
> line: 3,773 of its 4,571 commits carry a `Co-Authored-By: Claude` line, and 62 more are authored by Claude.
> What I did is the part this project is meant to show:
>
> 1. **I set the model.** The four civilizations are not flattened into one karma number
>    ([`ledger/readings.py`](../../backend/apps/ledger/readings.py)). **[作者填写：这是你自己定的，还是否掉了 AI 的
>    哪一版方案？写一句真实经过。]**
> 2. **I did not trust "done".** On 2026-05-30 a report in this repository declared the code "Production
>    Ready". On 2026-08-07 an audit of the same code found four critical tenant-isolation gaps. The report
>    is still here, marked superseded ([`PRODUCTION_READINESS_REPORT.md`](../PRODUCTION_READINESS_REPORT.md)).
>    **[作者填写：审计是谁发起、怎么组织的。]**
> 3. **I turned each lesson into a check that goes red.** Tenant scoping was consolidated behind one
>    function with a contract test over every ViewSet (2026-08-14, ADR 0001). The suite runs on real
>    PostgreSQL as well as SQLite (ADR 0003). The rule "no claim of *fixed* without the command, its exit
>    code and the passed count" is written into the agents' instructions.
>
> If you want to test me, ask about the details of any of these three.

## 中文（给 README.zh-CN.md）

> **关于 AI。**这个仓库的大部分代码是 Claude Code 写的，不是我逐行手写的。4,571 个提交里，3,773 个带
> `Co-Authored-By: Claude`，另有 62 个的作者就是 Claude。我做的部分，正是这个项目想展示的：
>
> 1. **定模型。**四种文明不抹平成一个功过数（[`ledger/readings.py`](../../backend/apps/ledger/readings.py)）。
>    **[作者填写：同上。]**
> 2. **不信「已完成」。**2026-05-30，仓库里一份报告宣称「Production Ready」。2026-08-07，对同一份代码的审计
>    找出 4 个严重的租户隔离缺口。那份报告还留着，标了「已作废」。**[作者填写：同上。]**
> 3. **把教训变成会变红的检查。**
>    - 2026-08-14，租户过滤收口成一个函数，并用契约测试逐个检查 ViewSet（ADR 0001）。
>    - 测试同时跑真 PostgreSQL 和 SQLite（ADR 0003）。
>    - 「没有命令、退出码、通过数，就不许说已修复」写进了给 AI 的规则。
>
> 想考我，就问这三件事里任何一件的细节。

## 每条事实怎么核对

| 说法 | 核对 |
|---|---|
| 4,571 个提交 | `git rev-list --count HEAD`。数字随提交增长，定稿当天重读 |
| 3,773 个带 Claude co-author | `git log --format=%B \| grep -c 'Co-Authored-By: Claude'` |
| 62 个作者是 Claude | `git log --format=%ae \| grep -c noreply@anthropic.com` |
| 2026-05-30「Production Ready」 | `git show 45a4a6358 --stat`；`docs/PRODUCTION_READINESS_REPORT.md` 第 1–12 行 |
| 2026-08-07 审计找到 4 个严重缺口 | `docs/MILESTONE_M15.md`；`git log --oneline --grep=M15 --since=2026-08-07 --until=2026-08-08` |
| 2026-08-14 租户过滤收口成一个函数 | `git show c4ed08402 --stat`；`docs/adr/0001-tenant-isolation-in-the-view-layer.md` |
| 「没有执行证据不许宣称」写在规则里 | `CLAUDE.md` 的「Verification & Root Cause」一节 |

## 徽章建议（先不改，等作者定）

现在徽章行的前两个是 "Built with Claude Code" 和 "Designed with Claude Design"，后面才是 Live demo 和 CI。

建议：

1. **去掉 "Designed with Claude Design"。**
   - 它链到 anthropic.com 首页，不是一个产品页，点进去什么也证明不了。
   - 「界面用 Claude Design 设计」在致谢里已经写了。
2. **"Built with Claude Code" 留着，挪到徽章行末尾。**
   - 第一眼该看到的是 Live demo 和 CI。
   - AI 的事由上面那段正文交代，不靠一个徽章；藏起来反而更糟，3,700 多个 co-author 藏不住。
3. **前提是这段正文已经放进 README。**
   - 没有正文时，只挪徽章就成了「淡化」，读者会自己往坏处猜。
   - 所以徽章改动和正文一起上线。

挪完之后的顺序：Live demo · CI · License · Django · Next.js · Expo · PostgreSQL · Built with Claude Code。
