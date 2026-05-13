import { z } from 'zod'

// ── Auth ─────────────────────────────────────────────

export const loginSchema = z.object({
  username: z.string().min(1, '请输入用户名'),
  password: z.string().min(1, '请输入密码'),
})

export const registerSchema = z.object({
  username: z.string().min(3, '用户名至少3位').max(50, '用户名最多50位'),
  email: z.string().email('邮箱格式不正确'),
  password1: z.string().min(8, '密码至少8位'),
  password2: z.string().min(8, '确认密码至少8位'),
}).refine((data) => data.password1 === data.password2, {
  message: '两次密码不一致',
  path: ['password2'],
})

export const changePasswordSchema = z.object({
  old_password: z.string().min(1, '请输入旧密码'),
  new_password: z.string().min(8, '新密码至少8位'),
})

// ── Soul ─────────────────────────────────────────────

export const soulCreateSchema = z.object({
  name: z.string().min(1, '请输入灵魂名称').max(100, '名称最多100位'),
  civilization: z.enum(['CHINESE', 'EUROPEAN', 'EGYPTIAN'], {
    error: '请选择文明',
  }),
  birth_date: z.string().optional().nullable(),
  origin_location: z.string().max(200, '地点最多200位').optional().nullable(),
})

export const soulUpdateSchema = z.object({
  name: z.string().min(1, '请输入灵魂名称').max(100, '名称最多100位'),
  birth_date: z.string().optional().nullable(),
  origin_location: z.string().max(200, '地点最多200位').optional(),
  current_state: z.enum(['ALIVE', 'JUDGING', 'DISPOSED', 'REINCARNATING', 'LOST']).optional(),
})

export const soulTransitionSchema = z.object({
  target_state: z.enum(['ALIVE', 'JUDGING', 'DISPOSED', 'REINCARNATING', 'LOST'], {
    error: '请选择有效目标状态',
  }),
  reason: z.string().max(500, '原因最多500位').optional(),
})

// ── Judgment ─────────────────────────────────────────

export const judgmentCreateSchema = z.object({
  soul_id: z.string().uuid('无效的灵魂ID'),
  court: z.string().min(1, '请选择审判庭'),
  civilization: z.enum(['CHINESE', 'EUROPEAN', 'EGYPTIAN'], {
    error: '请选择文明',
  }),
})

export const judgmentConcludeSchema = z.object({
  verdict: z.enum(['PASSED', 'FAILED', 'PURGATORY', 'RETRY'], {
    error: '请选择裁决',
  }),
  notes: z.string().max(1000, '备注最多1000位').optional(),
})

// ── Workflow ──────────────────────────────────────────

export const workflowAdvanceSchema = z.object({
  notes: z.string().max(500, '备注最多500位').optional(),
})

export const workflowApproveSchema = z.object({
  verdict: z.enum(['APPROVED', 'REJECTED', 'RETURNED'], {
    error: '请选择裁决',
  }),
  notes: z.string().max(1000, '备注最多1000位').optional(),
})

// ── Reincarnation ────────────────────────────────────

export const reincarnationRebornSchema = z.object({
  soul_id: z.string().uuid('无效的灵魂ID'),
  target_realm_id: z.string().uuid('无效的目标领域ID'),
  rebirth_form: z.enum(['HUMAN', 'ANIMAL', 'DIVINE', 'OTHER'], {
    error: '请选择轮回形态',
  }),
  new_identity: z.string().max(100, '新身份最多100位').optional(),
})

// ── Disposition ──────────────────────────────────────

export const dispositionExecuteSchema = z.object({
  destination_realm_id: z.string().uuid('无效的目标领域ID'),
  memory_reset: z.enum(['NONE', 'PARTIAL', 'FULL']).optional(),
  is_eternal: z.boolean().optional(),
  notes: z.string().max(500, '备注最多500位').optional(),
})

// ── Karma Record ─────────────────────────────────────

export const karmaRecordSchema = z.object({
  soul_id: z.string().uuid('无效的灵魂ID'),
  record_type: z.enum(['MERIT', 'DEMERIT'], {
    error: '请选择记录类型',
  }),
  category: z.string().min(1, '请选择类别'),
  description: z.string().min(1, '请输入描述').max(500, '描述最多500位'),
  weight: z.number().min(0, '权重不能为负'),
  event_date: z.string().optional().nullable(),
})

// ── Type inference ───────────────────────────────────

export type LoginInput = z.infer<typeof loginSchema>
export type RegisterInput = z.infer<typeof registerSchema>
export type ChangePasswordInput = z.infer<typeof changePasswordSchema>
export type SoulCreateInput = z.infer<typeof soulCreateSchema>
export type SoulUpdateInput = z.infer<typeof soulUpdateSchema>
export type SoulTransitionInput = z.infer<typeof soulTransitionSchema>
export type JudgmentCreateInput = z.infer<typeof judgmentCreateSchema>
export type JudgmentConcludeInput = z.infer<typeof judgmentConcludeSchema>
export type WorkflowAdvanceInput = z.infer<typeof workflowAdvanceSchema>
export type WorkflowApproveInput = z.infer<typeof workflowApproveSchema>
export type ReincarnationRebornInput = z.infer<typeof reincarnationRebornSchema>
export type DispositionExecuteInput = z.infer<typeof dispositionExecuteSchema>
export type KarmaRecordInput = z.infer<typeof karmaRecordSchema>
