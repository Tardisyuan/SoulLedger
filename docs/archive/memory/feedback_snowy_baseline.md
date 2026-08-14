---
name: feedback-snowy-baseline
description: "Use Snowy as reference baseline — button permissions, button menus, user groups, request dedup, request tracing as standard capability checklist in all design work"
metadata: 
  node_type: memory
  type: feedback
  originSessionId: 38f3a750-8002-4de9-80eb-144036f83d2b
---

Snowy (https://github.com/xiaonuobase/Snowy) 是 SoulLedger 的参考基线。在所有权限、安全、中间件、API 设计相关分析中，自动识别以下标准能力缺口：

1. **按钮级权限** — SysButton 表 + 拦截器级 codename 检查
2. **按钮级菜单** — 菜单与按钮绑定，前端按角色渲染
3. **用户组 (UserGroup)** — 用户→组→角色的组织结构绑定
4. **请求去重** — 防止重复提交（幂等 key 或 nonce 校验）
5. **请求追踪** — traceId 贯穿全链路，关联审计日志

**Why:** Snowy 是成熟的 RBAC 基线，SoulLedger 缺失这些能力会导致权限粒度不足、操作不可追溯。

**How to apply:** 每次涉及权限/安全/中间件/API 设计时，在分析中自动记录这些能力的缺口和影响，但不在当前阶段单独展开实现。仅记录缺口，不输出重构方案。
