# 跨租户审判与外派设计

> **OpenSpec 追踪：** `openspec/changes/multi-tenant-architecture/dispatch-design.md`
> **状态：** 设计中
> **版本：** 1.0
> **更新日期：** 2026-05-09

---

## 1. 概述

本文档详细描述跨租户审判（Cross-Tenant Judgment）与外派（Dispatch）机制的设计，用于支持多租户环境下的联合审判流程和灵魂外派执行惩罚的业务场景。

### 1.1 业务背景

SoulLedger 系统采用多租户架构，三个文明（CN_DIYU / EU_HEAVEN_HELL / EG_DUAT）作为独立租户运行。在某些特殊情况下，需要跨租户进行联合审判和惩罚执行：

- 跨文明犯罪的灵魂需要多文明共同审判
- 某些灵魂的惩罚需要在其他文明的地域执行
- 未来每个租户可能部署在独立服务器上

### 1.2 核心设计原则

1. **Soul.tenant = source tenant**：灵魂的原始归属租户不变
2. **Soul.dispatched_to_tenant = target tenant**：外派目标租户记录在灵魂上
3. **数据隔离**：除跨租户审判相关数据外，业务数据严格按租户隔离
4. **ADMIN 只读**：管理员只能查看统计数据，不能干预业务

---

## 2. 数据模型

### 2.1 Soul 模型的跨租户字段

```python
class Soul(models.Model):
    # ... 现有字段 ...
    
    # 跨租户外派相关
    dispatched_to_tenant = models.ForeignKey(
        'tenants.Tenant',
        null=True,
        blank=True,
        related_name='dispatched_souls',
        help_text='外派目标租户（惩罚执行地）'
    )
    dispatch_status = models.CharField(
        max_length=30,
        choices=[
            (None, '未外派'),
            ('PENDING_DISPATCH', '等待外派'),
            ('DISPATCHED', '已外派'),
            ('COMPLETED', '外派完成'),
        ],
        null=True,
        blank=True,
        help_text='外派状态'
    )
```

### 2.2 CrossTenantJudgment（跨租户审判）

记录跨租户联合审判会话：

```python
class CrossTenantJudgment(models.Model):
    source_tenant = models.ForeignKey(
        'tenants.Tenant',
        related_name='initiated_judgments',
        help_text='灵魂所属租户（发起方）'
    )
    soul = models.ForeignKey('souls.Soul', related_name='cross_tenant_judgments')
    court_name = models.CharField(max_length=100)
    status = models.CharField(
        choices=[
            ('PROPOSED', '已提议'),
            ('IN_REVIEW', '审查中'),
            ('APPROVED', '已批准'),
            ('REJECTED', '已拒绝'),
        ],
        default='PROPOSED'
    )
    verdict = models.CharField(
        choices=[
            ('PASSED', '通过'),
            ('FAILED', '失败'),
            ('PURGATORY', '炼狱'),
        ],
        null=True
    )
    notes = models.TextField(blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    concluded_at = models.DateTimeField(null=True)
```

### 2.3 CrossTenantJudgmentParticipant（跨租户审判参与者）

```python
class CrossTenantJudgmentParticipant(models.Model):
    class Role(models.TextChoices):
        ADVISOR = 'ADVISOR', '顾问'
        CO_JUDGE = 'CO_JUDGE', '联合法官'
        CHAIRMAN = 'CHAIRMAN', '审判长'
    
    class Vote(models.TextChoices):
        APPROVE = 'APPROVE', '赞成'
        REJECT = 'REJECT', '反对'
        ABSTAIN = 'ABSTAIN', '弃权'
    
    cross_tenant_judgment = models.ForeignKey(
        CrossTenantJudgment,
        related_name='participants'
    )
    participant_tenant = models.ForeignKey('tenants.Tenant')
    participant_user = models.ForeignKey(
        'authentication.User',
        limit_choices_to={'role': 'DISPATCH_JUDGE'}
    )
    role = models.CharField(max_length=20, choices=Role.choices)
    added_at = models.DateTimeField(auto_now_add=True)
    voted_at = models.DateTimeField(null=True)
    vote = models.CharField(max_length=20, choices=Vote.choices, null=True)
```

### 2.4 DispatchRecord（外派记录）

```python
class DispatchRecord(models.Model):
    class Status(models.TextChoices):
        PENDING = 'PENDING', '待处理'
        IN_PROGRESS = 'IN_PROGRESS', '执行中'
        COMPLETED = 'COMPLETED', '已完成'
        RETURNED = 'RETURNED', '已返回'
    
    source_tenant = models.ForeignKey(
        'tenants.Tenant',
        related_name='dispatched_records'
    )
    target_tenant = models.ForeignKey(
        'tenants.Tenant',
        related_name='received_records'
    )
    soul = models.ForeignKey('souls.Soul', related_name='dispatch_records')
    cross_tenant_judgment = models.ForeignKey(
        CrossTenantJudgment,
        null=True,
        related_name='dispatch_records'
    )
    reason = models.TextField()
    dispatched_by = models.ForeignKey('authentication.User')
    dispatched_at = models.DateTimeField(auto_now_add=True)
    returned_at = models.DateTimeField(null=True)
    status = models.CharField(max_length=20, choices=Status.choices)
```

### 2.5 Tenant 模型扩展

```python
class Tenant(models.Model):
    # ... 现有字段 ...
    
    dispatch_enabled = models.BooleanField(
        default=True,
        help_text='是否允许接收外派灵魂'
    )
    api_endpoint = models.URLField(
        max_length=255,
        blank=True,
        help_text='独立部署时的 API 端点 URL'
    )
```

---

## 3. 工作流程

### 3.1 跨租户联合审判流程

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                        跨租户联合审判流程                                    │
└─────────────────────────────────────────────────────────────────────────────┘

  源租户 (CN_DIYU)                    目标租户 (EG_DUAT)
        │                                    │
        │  1. 创建 CrossTenantJudgment        │
        │     (PROPOSED)                     │
        │ ─────────────────────────────────►│
        │                                    │
        │                          2. DISPATCH_JUDGE 收到邀请
        │                                    │
        │  3. 加入参与者                     │
        │◄────────────────────────────────────│
        │                                    │
        │  4. 状态 → IN_REVIEW               │
        │     (多租户共同审查)               │
        │                                    │
        │◄═══════════════════════════════════│
        │      跨租户审查讨论                 │
        │◄═══════════════════════════════════│
        │                                    │
        │  5. 投票 (APPROVE/REJECT)          │
        │◄────────────────────────────────────│
        │                                    │
        │  6. 状态 → APPROVED                │
        │     verdict = FAILED               │
        │                                    │
        │  7. 触发外派流程                   │
        ▼                                    │
   ┌─────────┐                               │
   │ DISPATCH │                              │
   └────┬────┘                               │
        │                                    │
        ▼                                    │
   DispatchRecord 创建                        │
   Soul.dispatch_status = DISPATCHED          │
   Soul.dispatched_to_tenant = EG_DUAT       │
        │                                    │
        ▼                                    │
   ┌──────────────────────────────────────────┐
   │        目标租户执行惩罚                   │
   │  (EG_DUAT 的 Anubis 执行惩罚)            │
   └──────────────────────────────────────────┘
```

### 3.2 外派惩罚完整生命周期

```
Soul.tenant = CN_DIYU (源租户)
Soul.dispatched_to_tenant = EG_DUAT (目标租户)
Soul.dispatch_status 流转:

null ──────────────────────────────────────────────────────────────────► null
  │                                                                      ▲
  │                                                                      │
  │   ┌─────────────────────────────────────────────────────────────┐    │
  │   │                                                             │    │
  │   ▼                                                             │    │
[PENDING_DISPATCH] ──approve()──► [DISPATCHED] ──execute_dispatch()──► [REINCARNATING]
  │                                                               │          │
  │                                                               │          │
  │   (reject/cancel)                                             │          ▼
  └───────────────────────────────────────────────────────────────┘    [ALIVE]
         (返回 DISPOSED，本地处置)                                          │
                                                                            ▲
                                                              (目标租户地域轮回)
```

**关键说明：**
- 灵魂在目标租户（EG_DUAT）的地域完成轮回，不是返回源租户
- REINCARNATING 状态在目标租户内完成
- ALIVE 意味着灵魂在目标租户地域重生
- 源租户保留灵魂记录用于历史和审计追踪

### 3.3 状态转换规则

|| 当前状态 | 事件 | 下一状态 | 触发条件 |
|---------|------|---------|---------|
| null | initiate_cross_judgment() | null | 发起跨租户审判（不改变 dispatch_status） |
| null | propose_dispatch() | PENDING_DISPATCH | 发起外派（soul.state=DISPATCHED） |
| PENDING_DISPATCH | approve() | DISPATCHED | 目标租户确认接收 |
| PENDING_DISPATCH | reject() | DISPOSED | 目标租户拒绝（灵魂返回 DISPOSED，本地处置） |
| PENDING_DISPATCH | cancel() | DISPOSED | 发起方取消（灵魂返回 DISPOSED，本地处置） |
| DISPATCHED | execute_dispatch() | REINCARNATING | 目标租户执行惩罚，灵魂迁移 |
| REINCARNATING | complete() | ALIVE | 轮回完成（在目标租户地域重生） |

**取消/拒绝后的处理：**
当 dispatch 被 reject 或 cancel 后：
- Soul.state 从 PENDING_DISPATCH 返回 DISPOSED
- 源租户法官需要决定下一步：重新提议外派或本地执行处置
- 跨租户审判记录保留用于审计

---

## 4. API 设计

### 4.1 跨租户审判 API

|| 方法 | 端点 | 描述 |
|------|------|------|
| POST | /api/v1/cross-tenant-judgments/ | 创建跨租户审判 |
| GET | /api/v1/cross-tenant-judgments/ | 列表（按 tenant 过滤，支持分页） |
| GET | /api/v1/cross-tenant-judgments/{id}/ | 详情 |
| POST | /api/v1/cross-tenant-judgments/{id}/participate/ | 加入联合审判（DISPATCH_JUDGE） |
| POST | /api/v1/cross-tenant-judgments/{id}/conclude/ | 结束审判并判决（源租户 JUDGE） |
| GET | /api/v1/cross-tenant-judgments/{id}/participants/ | 参与者列表 |

### 4.2 外派 API

|| 方法 | 端点 | 描述 |
|------|------|------|
| GET | /api/v1/dispatch/ | 列表（按 tenant 过滤，支持分页） |
| POST | /api/v1/dispatch/propose/ | 提议外派到另一个租户 |
| GET | /api/v1/dispatch/{id}/ | 外派记录详情 |
| POST | /api/v1/dispatch/{id}/approve/ | 目标租户法官批准 |
| POST | /api/v1/dispatch/{id}/reject/ | 目标租户法官拒绝 |
| POST | /api/v1/dispatch/{id}/cancel/ | 发起方取消外派 |
| POST | /api/v1/dispatch/{id}/execute/ | 执行外派（移动灵魂到目标租户） |
| GET | /api/v1/dispatch/{id}/status/ | 外派状态详情 |

---

## 5. 权限控制

### 5.1 DISPATCH_JUDGE 权限

拥有 `DISPATCH_JUDGE` 角色的用户可以：

- 收到其他租户的跨租户审判邀请
- 参与跨租户审判的投票
- 在自己租户内发起跨租户审判

### 5.2 跨租户操作权限矩阵

| 操作 | 源租户 JUDGE | 源租户 DISPATCH_JUDGE | 目标租户 DISPATCH_JUDGE | ADMIN |
|------|------------|----------------------|------------------------|------|
| 发起跨租户审判 | ✗ | ✓ | ✗ | ✗ |
| 参与跨租户审判投票 | ✗ | ✓ | ✓ | ✗ |
| 确认外派接收 | ✗ | ✗ | ✓ | ✗ |
| 完成惩罚执行 | ✗ | ✗ | ✓ | ✗ |
| 查看跨租户审判详情 | ✗ | ✓（自己租户） | ✓（参与方） | ✓ |

---

## 6. 未来独立部署支持

### 6.1 架构演进

当未来需要将各租户部署到独立服务器时：

```
┌──────────────────────────────────────────────────────────────────────────────┐
│                          未来独立部署架构                                      │
└──────────────────────────────────────────────────────────────────────────────┘

   CN_DIYU 服务器              EU_HEAVEN_HELL 服务器          EG_DUAT 服务器
┌────────────────┐       ┌────────────────┐           ┌────────────────┐
│ PostgreSQL     │       │ PostgreSQL     │           │ PostgreSQL     │
│ Redis          │       │ Redis          │           │ Redis          │
│ Django + API   │       │ Django + API   │           │ Django + API   │
│ api_endpoint: │       │ api_endpoint:  │           │ api_endpoint:  │
│ https://diyu   │       │ https://heaven │           │ https://duat   │
└───────┬────────┘       └───────┬────────┘           └───────┬────────┘
        │                          │                            │
        │◄═════════════════════════╪═══════════════════════════►│
        │            跨租户 API 调用 (REST)                      │
        │◄═════════════════════════╪═══════════════════════════►│
        │                          │                            │
        └──────────────────────────┴────────────────────────────┘
                                     │
                              ┌──────┴──────┐
                              │   Nginx     │
                              │  (反向代理) │
                              └─────────────┘
```

### 6.2 跨租户 API 调用

当 `Tenant.api_endpoint` 填充时，系统使用该 URL 进行跨租户 API 调用：

```python
class DispatchService:
    def call_target_tenant_api(self, tenant, endpoint, data):
        """跨租户 API 调用（未来独立部署后使用）"""
        if tenant.api_endpoint:
            # 独立部署模式：通过 HTTP 调用目标租户 API
            response = requests.post(
                f"{tenant.api_endpoint}{endpoint}",
                json=data,
                headers={'Authorization': f'Bearer {self.get_service_token()}'}
            )
            return response.json()
        else:
            # 共享部署模式：直接本地调用
            return self.local_dispatch(endpoint, data)
```

---

## 7. 事件驱动

### 7.1 跨租户事件

|| 事件 | 说明 | 触发时机 |
|------|------|---------|
| CROSS_JUDGMENT_CREATED | 跨租户审判创建 | 发起跨租户审判时 |
| CROSS_JUDGMENT_JOINED | 参与者加入 | DISPATCH_JUDGE 接受邀请并 join |
| CROSS_JUDGMENT_CONCLUDED | 审判结束 | 审判达成 verdict |
| DISPATCH_PROPOSED | 外派提议 | 创建 DispatchRecord |
| DISPATCH_APPROVED | 外派批准 | 目标租户 approve() |
| DISPATCH_REJECTED | 外派拒绝 | 目标租户 reject() |
| DISPATCH_EXECUTED | 外派执行 | 灵魂迁移至目标租户 execute_dispatch() |
| PERMISSION_DENIED | 权限拒绝 | 跨租户访问无权限时 |

### 7.2 SoulEvent 事件类型

所有事件记录到 SoulEvent 表，用于审计追踪：

```python
class SoulEvent(models.Model):
    class EventType(models.TextChoices):
        # 基础事件
        SOUL_CREATED = 'SOUL_CREATED', '灵魂创建'
        STATE_CHANGED = 'STATE_CHANGED', '状态变更'
        
        # 审判事件
        JUDGMENT_CREATED = 'JUDGMENT_CREATED', '审判创建'
        JUDGMENT_CONCLUDED = 'JUDGMENT_CONCLUDED', '审判结束'
        
        # 处置事件
        DISPOSITION_CREATED = 'DISPOSITION_CREATED', '处置创建'
        DISPOSITION_EXECUTED = 'DISPOSITION_EXECUTED', '处置执行'
        
        # 跨租户事件
        DISPATCH_PROPOSED = 'DISPATCH_PROPOSED', '外派提议'
        DISPATCH_APPROVED = 'DISPATCH_APPROVED', '外派批准'
        DISPATCH_REJECTED = 'DISPATCH_REJECTED', '外派拒绝'
        DISPATCH_EXECUTED = 'DISPATCH_EXECUTED', '外派执行'
        CROSS_JUDGMENT_CREATED = 'CROSS_JUDGMENT_CREATED', '跨租户审判创建'
        CROSS_JUDGMENT_JOINED = 'CROSS_JUDGMENT_JOINED', '跨租户审判参与'
        CROSS_JUDGMENT_CONCLUDED = 'CROSS_JUDGMENT_CONCLUDED', '跨租户审判结束'
        
        # 安全事件
        PERMISSION_DENIED = 'PERMISSION_DENIED', '权限拒绝'
        
        # 业力事件
        KARMA_RECORD_ADDED = 'KARMA_RECORD_ADDED', '业力记录添加'
```

### 7.3 审计日志要求

所有跨租户操作必须记录 SoulEvent：

1. **DISPATCH_PROPOSED**：记录 source_tenant, target_tenant, soul_id, proposed_by
2. **DISPATCH_APPROVED/REJECTED**：记录 approving_judge, notes
3. **DISPATCH_EXECUTED**：记录实际迁移时间、source_tenant、target_tenant
4. **CROSS_JUDGMENT_CREATED**：记录参与租户列表
5. **CROSS_JUDGMENT_JOINED**：记录 participant_tenant、participant_user
6. **CROSS_JUDGMENT_CONCLUDED**：记录最终 verdict、各参与者投票
7. **PERMISSION_DENIED**：记录尝试访问的用户、目标租户、操作类型

---

## 8. 测试场景

### 8.1 正常流程测试

1. CN_DIYU 法官（DISPATCH_JUDGE）发起对灵魂 S1 的跨租户审判
2. EG_DUAT 的 Anubis（DISPATCH_JUDGE）收到邀请并加入
3. 双方讨论后，EG_DUAT 投 REJECT，CN_DIYU 投 APPROVE
4. 审判状态变为 REJECTED，S1 在 CN_DIYU 正常审判

### 8.2 外派执行测试

1. CN_DIYU 法官对灵魂 S2 发起跨租户审判
2. 审判状态变为 APPROVED，verdict = FAILED
3. 创建 DispatchRecord，S2.dispatched_to_tenant = EG_DUAT
4. EG_DUAT 的 Anubis 确认接收（approve）
5. Anubis 在 Duat 执行惩罚（execute_dispatch）
6. S2 进入 REINCARNATING 状态（在 EG_DUAT 地域）
7. 轮回完成，S2 在 EG_DUAT 地域重生为 ALIVE
8. CN_DIYU 保留 S2 的历史记录用于审计

### 8.3 隔离性测试

1. CN_DIYU 用户无法查看 EG_DUAT 的灵魂列表
2. CN_DIYU 用户无法修改 EG_DUAT 的 DispatchRecord
3. 非 DISPATCH_JUDGE 角色的用户无法参与跨租户审判

---

*本文档由 OpenSpec 变更追踪*
