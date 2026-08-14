---
name: feedback_compaction
description: User wants Claude to remember context across compactions
type: feedback
originSessionId: 38f3a750-8002-4de9-80eb-144036f83d2b
---
## 用户反馈：每次压缩后Claude会忘记上下文

**问题**: Claude Code在上下文压缩后丢失之前的记忆和工作状态。

**Why**: 当前项目的CLAUDE.md文件中没有关于如何处理压缩后恢复上下文的指导。

**How to apply**: 
- 在每次会话开始时检查memory文件
- 如果发现之前的未完成工作，使用TaskCreate记录任务状态
- 将关键上下文保存在MEMORY.md中，确保压缩后可以恢复
