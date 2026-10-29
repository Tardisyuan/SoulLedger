# M8 — DDD Refactoring Milestones

> ### 后续 — 2026-08-28
>
> **编号冲突**：本文的 M8 是「DDD Refactoring」，而 [`docs/MILESTONES.md`](MILESTONES.md)
> 的 M8 是「Release Candidate Closure」；本文的 M8-2/M8-3/M8-4 对应的是那份文档里 M7 的
> P2/P3/P4。下面的复选框从未回勾，逐条核实（2026-08-28）：
>
> - **M8-1 统一角色系统 — 未做。** `User.role` 仍是 CharField；另加了 `rbac_role` 外键作桥，
>   `apps/authentication/models.py:40` 的注释写着「Once fully migrated, `role` CharField can be
>   deprecated」——迁移没有完成。
> - **M8-2 Karma BC 归位 — 已决定不做（2026-08-23）。** 理由与代价记在
>   `backend/apps/ledger/models.py` 的模块 docstring 里，并由 `apps/ledger/test_models.py` 钉住。
>   `SoulRecord` 仍定义在 `apps/souls/record_models.py`，`apps/ledger/models.py` 原样再导出。
> - **M8-3 DispatchRecord 状态机 — 已做。** `can_transition_to()` / `transition_to()` 在
>   `apps/dispatch/models.py:113,116`。
> - **M8-4 Domain Events — 未逐条复核。**
>
> 「成功标准」里的测试基线（383 backend + 126 frontend）也已过期：后端 2026-08-28 实跑
> **2,694 passed, 9 skipped**（无排除；2,672 是排除 websocket 测试时的数字，那个排除已作废）。

**目标**: DDD 成熟度从 6.5 → 8.0
**前置条件**: M7 全部完成 (已满足)
**总工作量**: 4.5-5.5 天

---

## M8-1: 统一角色系统 (P1) — 2-3 天

**问题**: `User.role` (CharField TextChoices) 与 `perm.Role` (RBAC 模型) 并存，ADMIN 有两个含义

**任务**:
- [ ] `authentication/models.py`: User.role 改为 ForeignKey(perm.Role)
- [ ] 迁移脚本: 现有 User.role 值映射到 perm.Role 记录
- [ ] 更新所有引用 User.role 的代码 (views, serializers, middleware)
- [ ] 前端 useAuth/useTenant 适配新 role 结构
- [ ] 测试: 权限检查、登录流程、角色切换

**风险**: HIGH — 影响认证全流程

---

## M8-2: Karma BC 归位 (P2) — 1 天

**问题**: SoulRecord 放在 souls app，karma BC 只有 service 层无模型

**任务**:
- [ ] 创建 `karma/models.py`，迁移 SoulRecord 定义
- [ ] 更新 `souls/record_models.py` 为 re-export 或删除
- [ ] 更新所有 import 路径 (karma/services.py, serializers, views)
- [ ] 数据库迁移: 表名不变 (karma_soulrecord)，app_label 更新
- [ ] 测试: karma CRUD、recalculation、继承

**风险**: MEDIUM — 需要仔细处理迁移

---

## M8-3: DispatchRecord 状态机 (P3) — 0.5 天

**问题**: DispatchRecord 无状态转换守卫，状态验证在 service 层

**任务**:
- [ ] DispatchRecord 添加 `can_transition_to()` / `transition_to()`
- [ ] 定义合法状态转换: PROPOSED→APPROVED→EXECUTED / REJECTED
- [ ] DispatchService 改用 model 方法
- [ ] 测试: 状态转换、非法转换拒绝

**风险**: LOW

---

## M8-4: Domain Events 补发 (P4) — 1 天

**问题**: EventType 枚举定义了 10+ 种事件，大部分从未发布

**任务**:
- [ ] `Judgment.conclude()` → 发布 JUDGMENT_CONCLUDED
- [ ] `KarmaService.recalculate_soul_karma()` → 发布 KARMA_RECALCULATED
- [ ] `ReincarnationService.execute()` → 发布 REINCARNATION_TRIGGERED
- [ ] `DispatchService` → 发布 DISPATCH_PROPOSED/APPROVED/EXECUTED/REJECTED
- [ ] `ApprovalWorkflow` → 发布 WORKFLOW_COMPLETED
- [ ] 测试: 事件日志完整性验证

**风险**: LOW

---

## 成功标准

- [ ] DDD 评分达到 8.0/10
- [ ] User.role 使用 perm.Role FK
- [ ] SoulRecord 在 karma app 中
- [ ] DispatchRecord 有状态机
- [ ] 所有 EventType 枚举都有对应触发点
- [ ] 现有测试全部通过 (383 backend + 126 frontend)
