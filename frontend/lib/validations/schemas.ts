import { z } from 'zod'

import { CIVILIZATION_OPTIONS } from '@/src/config/civilizations'

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
  // Derived from CIVILIZATION_OPTIONS, not retyped. This enum spelled three
  // members while the pick-list it validates spelled four, so 希腊 was
  // selectable and unsubmittable: choosing it failed with '请选择文明' against
  // a select that plainly had one chosen. That is the gap
  // src/config/civilizations.ts names in its own header — "the gap GREEK
  // slipped through" — and this was the place it slipped through.
  //
  // No UNKNOWN here — this is a pick-list for a human creating a soul, and
  // UNKNOWN is a symptom of a misconfigured tenant, not a cosmology anyone
  // would deliberately choose. UNKNOWN is absent from CIVILIZATION_OPTIONS for
  // the same reason, so deriving keeps that property instead of restating it.
  civilization: z.enum(CIVILIZATION_OPTIONS, {
    error: '请选择文明',
  }),
  birth_date: z.string().optional().nullable(),
  origin_location: z.string().max(200, '地点最多200位').optional().nullable(),
})

export const soulUpdateSchema = z.object({
  name: z.string().min(1, '请输入灵魂名称').max(100, '名称最多100位'),
  birth_date: z.string().optional().nullable(),
  origin_location: z.string().max(200, '地点最多200位').optional(),
  // Includes SETTLED even though nothing lets an operator pick it (see
  // soulTransitionSchema below): this schema validates the edit form, which
  // round-trips whatever state the soul already has. A soul already at
  // SETTLED must still pass validation so the rest of the form stays usable.
  current_state: z.enum(['ALIVE', 'JUDGING', 'DISPOSED', 'REINCARNATING', 'LOST', 'SETTLED']).optional(),
})

export const soulTransitionSchema = z.object({
  // SETTLED is deliberately absent — it's a terminal state the backend
  // assigns when a terminal disposition executes, never a manual transition
  // target.
  target_state: z.enum(['ALIVE', 'JUDGING', 'DISPOSED', 'REINCARNATING', 'LOST'], {
    error: '请选择有效目标状态',
  }),
  reason: z.string().max(500, '原因最多500位').optional(),
})

// ── Judgment ─────────────────────────────────────────

export const judgmentCreateSchema = z.object({
  soul_id: z.string().uuid('无效的灵魂ID'),
  court: z.string().min(1, '请选择审判庭'),
  // Same reasoning as soulCreateSchema.civilization — derived, no UNKNOWN.
  // This one had drifted too, and had no consumer to notice: it would have
  // shipped the identical GREEK defect the day anything started using it.
  civilization: z.enum(CIVILIZATION_OPTIONS, {
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
  // 六道 (docs/07_六道轮回详解.md): 三善道 DIVINE/HUMAN/ASURA, then 三恶道
  // ANIMAL/HUNGRY_GHOST/HELL_BEING. OTHER is legacy-only — kept so existing
  // records validate, not offered for new rebirths.
  rebirth_form: z.enum(
    ['DIVINE', 'HUMAN', 'ASURA', 'ANIMAL', 'HUNGRY_GHOST', 'HELL_BEING', 'OTHER'],
    { error: '请选择轮回形态' }
  ),
  new_identity: z.string().max(100, '新身份最多100位').optional(),
})

// ── Disposition ──────────────────────────────────────
//
// There is deliberately no dispositionExecuteSchema here. The body of
// POST /disposition/{id}/execute/ is validated server-side by
// DispositionExecuteSerializer (backend/apps/disposition/serializers.py),
// which declares exactly one optional field, `new_identity`. Everything the
// execution needs — destination_realm, memory_reset, is_eternal, notes — is
// already on the Disposition row and read from it by DispositionService;
// none of it is accepted in the request body. The only caller,
// frontend/app/disposition/page.tsx, posts no body at all.
//
// A schema stood here until it was removed: it required destination_realm_id
// and typed memory_reset as NONE/PARTIAL/FULL. Two of those three values have
// never existed server-side — the real enum is
// apps.disposition.models.MemoryResetMechanism (MENGPO / LETHE / SPELL /
// NONE) — and nothing ever imported the schema, so the mismatch could not
// surface as a failure. Reinstate one only alongside a form that submits it,
// and derive its fields from the serializer.

// ── Ledger Record ────────────────────────────────────

export const ledgerRecordSchema = z.object({
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
export type LedgerRecordInput = z.infer<typeof ledgerRecordSchema>
