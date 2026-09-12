import { z } from 'zod'

import { CIVILIZATION_OPTIONS } from '../config/civilizations'

// ── Auth ─────────────────────────────────────────────
//
// `registerSchema` and `changePasswordSchema` were here with ZERO consumers,
// alongside `loginSchema` (now wired into app/(auth)/login/page.tsx) and
// `judgmentCreateSchema` (which drifted to three civilizations while unused —
// see the note on its `civilization` field, and the defect that shipped
// because its twin had a caller). A validator nothing calls does not fail; it
// quietly stops describing the form it was written for. Deleting them is
// cheaper than keeping unchecked claims: there is no registration form in this
// app at all, and `app/profile/page.tsx` validates its password change by hand
// against different rules than these stated.
//
// Six more went the same way on 2026-09-13 (soulTransition, judgmentConclude,
// workflowAdvance, workflowApprove, reincarnationReborn, ledgerRecord): each
// had exactly one reference in the tree, its own `export`. What is left is
// what a form imports, plus `judgmentCreateSchema`, which
// `civilizationMapCoverage.test.ts` pins to the four civilizations.

export const loginSchema = z.object({
  username: z.string().min(1, '请输入用户名'),
  password: z.string().min(1, '请输入密码'),
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
  // Includes SETTLED even though nothing lets an operator pick it (it is the
  // terminal state the backend assigns when a terminal disposition executes,
  // never a manual transition target): this schema validates the edit form,
  // which round-trips whatever state the soul already has. A soul already at
  // SETTLED must still pass validation so the rest of the form stays usable.
  current_state: z.enum(['ALIVE', 'JUDGING', 'DISPOSED', 'REINCARNATING', 'LOST', 'SETTLED']).optional(),
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

// ── Type inference ───────────────────────────────────

export type LoginInput = z.infer<typeof loginSchema>
export type SoulCreateInput = z.infer<typeof soulCreateSchema>
export type SoulUpdateInput = z.infer<typeof soulUpdateSchema>
export type JudgmentCreateInput = z.infer<typeof judgmentCreateSchema>
