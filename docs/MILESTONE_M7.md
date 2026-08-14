# M7 里程碑 - 用户与组织架构重构

## 概述

将 Actors 合并到 User 表，各文明从"地域"改为"组织架构"，实现多租户 RBAC 模型。

## 子任务清单

### M7.1 组织架构模型
- [x] 创建 Organization 模型 (`apps/org/models.py`)
- [x] 创建数据迁移 (`0001_initial`)
- [x] 更新 perm.Role 添加 scope 字段 (`0009_role_organization_role_scope`)
- [x] 现有角色更新为 GLOBAL scope
- [x] 组织架构初始化脚本 (init_organizations.py)

### M7.2 用户模型扩展
- [x] 扩展 User 模型添加 organization 和 position 字段
- [x] 创建数据迁移

### M7.3 数据迁移脚本
- [x] 创建 Actor → User 迁移脚本 (migrate_actors_to_users.py)
- [x] 执行迁移 (86 Actors → Users)

### M7.4 前端变更
- [x] 更新 TypeScript 类型定义
- [x] 创建 Organization 管理页面
- [x] 更新 User 管理页面
- [ ] 更新权限控制逻辑

### M7.5 收尾
- [x] 删除 Actor API 端点（或保留只读）
- [x] 测试验证

## 关键设计决策

### 组织代码命名
| 组织 | Code |
|------|------|
| 中国地府 | DIYU |
| 欧洲天堂地狱 | HEAVEN |
| 埃及冥界 | DUAT |

### 部门代码命名
- `DIYU_01` - 第一殿
- `DIYU_02` - 第二殿
- `HEAVEN_ANGEL` - 天使体系
- `DUAT_HALL` - 真理大厅

### 初始角色分配
| 职位类别 | 分配角色 |
|---------|---------|
| 最高神祇（酆都大帝/上帝/奥西里斯） | ADMIN |
| 十殿阎王/冥王 | JUDGE |
| 判官/天使长 | ADMIN |
| 执行层（黑白无常/牛头马面） | GUARDIAN |
| 普通执行人员 | VIEWER |

## 文件索引

- [M7_用户组织架构重构.md](./M7_用户组织架构重构.md) - 详细设计文档

## 测试覆盖

### 测试文件
- `apps/org/tests.py` - 组织模型测试 (6 tests)
- `apps/authentication/tests.py` - 用户模型测试 (8 tests)
- `apps/authentication/test_actor_migration.py` - Actor迁移测试 (5 tests)
- `apps/perm/tests.py` - Role权限模型测试 (14 tests)

### 测试结果
```
Ran 33 tests in 8.906s - OK
```
