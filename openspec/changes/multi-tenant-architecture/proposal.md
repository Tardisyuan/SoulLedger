# Multi-Tenant Architecture Redesign

## Why

当前系统是单系统 + `civilization` 字段区分三大文明。存在两个问题：
1. **权限隔离不足**：欧洲的判官理论上能看到中国地府的记录（只是查询层过滤）
2. **业务边界不清晰**：三个文明的审判逻辑、处置路由、地域数据混在同一套表中

多租户（Multi-Tenant）架构更适合地府的业务本质：三个地府是完全独立的运营单位，只在极少数场景下需要协同（如跨文明灵魂迁移）。

## What

**新增 `Tenant` 模型，每个文明（Chinese Diyu / European Heaven-Hell / Egyptian Duat）为独立租户。**

- 所有业务表（Soul/Realm/Actor/Judgment 等）加 `tenant_id` 字段
- 每个租户用户（User）绑定租户，只能操作自己租户的数据
- ADMIN 角色可跨租户操作和查看全局统计
- 租户之间完全数据隔离

## Scope

**包含：**
- Tenant 模型与数据迁移
- 所有现有表加 `tenant_id` 外键
- Django 中间件自动注入 tenant context
- API queryset 自动按 tenant 过滤
- User 与 Tenant 的关联
- 前端租户上下文感知导航
- Admin site 按租户过滤

**不包含：**
- 跨文明灵魂迁移功能（未来 Milestone 单独处理）
- 租户级别的配额/计费（不适用）

## Outcome

- 三个文明的官员登录后只看自己租户的数据
- 数据物理隔离，一个租户的 bug 不会泄漏到另一个
- ADMIN 可访问全局统计大屏
- 迁移过程零数据丢失

## Risks

1. **迁移复杂度**：所有表加 `tenant_id`，Django migration 需要 careful planning
2. **API 兼容性**：所有现有 API 需要加 tenant 过滤逻辑，可能影响现有前端调用
3. **测试覆盖**：需要新增租户隔离的集成测试
