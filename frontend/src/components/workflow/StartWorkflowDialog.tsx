"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { judgmentApi, soulsApi, workflowApi, type Soul } from "@soulledger/core/api";
import { useSoul } from "@soulledger/core/hooks/useSouls";
import { useI18n } from "@/src/contexts/I18nContext";
import { useToast } from "@/src/contexts/ToastContext";
import { resolveEnumDisplay } from "@/src/lib/domainDisplay";
import { DomainEnum } from "@/src/components/ui/DomainValue";
import { civSkinOf } from "@/src/lib/civSkin";
import { BaseModal } from "@/src/components/ui/Modal";
import { Button } from "@/src/components/ui/Button";
import { SelectField, TextAreaField, type SelectOption } from "@/src/components/ui/Field";
import { SearchSelectField } from "@/src/components/ui/SearchSelectField";
import { cn } from "@/lib/utils";
import { FlowStationPicker, useFlowPreview } from "@/src/components/workflow/segments/FlowStationPicker";
import { segmentRefusalText } from "@soulledger/core/domain/workflowSegments";

const REASON_MAX = 1000;
const FORM_ID = "start-workflow-form";

type Field = "soul" | "case_type" | "template" | "judgment";
/** 表头下的提示条:哪一格出错(加粗边框;改了它提示就消失),以及 duplicate 那条审批的 id(「去看那条」)。 */
interface Refusal {
  message: string;
  field: Field | null;
  viewId?: string;
}

type Translate = (key: string, params?: Record<string, string>) => string;

/** 后端的拒绝 → 提示条(W-11c)。只有 409 `workflow_in_progress` 带「去看那条」。 */
export function startWorkflowRefusal(error: unknown, t: Translate, civilization?: string): Refusal {
  const r = (error as { response?: { status?: number; data?: Record<string, unknown> } })?.response;
  const data = r?.data ?? {};
  const code = typeof data.code === "string" ? data.code : "";
  const failed = { message: t("workflow.start.errors.failed"), field: null };
  if (r?.status === 403) return { message: t("workflow.start.errors.forbidden"), field: null };
  // 原审的审批流程还没走完时不能发起申诉审批(2026-10-29,审查 B;灵魂端同一个码)。
  if (r?.status === 400 && code === "origin_flow_open") return { message: t("workflow.start.errors.origin_flow_open"), field: "case_type" };
  if (r?.status === 400 && code === "invalid_case_type") {
    const civ = resolveEnumDisplay(t, "souls.civilizations", civilization).label ?? "";
    return { message: t("workflow.start.errors.case_type_civ", { civ }), field: "case_type" };
  }
  if (r?.status === 404) {
    if (code === "soul_not_found") return { message: t("workflow.start.errors.soul_not_found"), field: "soul" };
    if (code === "template_not_found") return { message: t("workflow.start.errors.template_invalid"), field: "template" };
    if (code === "judgment_not_found") return { message: t("workflow.start.errors.judgment_mismatch"), field: "judgment" };
  }
  if (r?.status === 409) {
    if (code === "workflow_in_progress" && typeof data.workflow === "string") {
      const type = resolveEnumDisplay(t, "workflow.case_types", String(data.case_type ?? "")).label ?? "";
      return {
        // 审批编号(`WF-0582`);老后端没带时退回 uuid 前 8 位。
        message: t("workflow.start.errors.duplicate", {
          type,
          id: typeof data.number === "string" && data.number ? data.number : data.workflow.slice(0, 8),
        }),
        field: "case_type",
        viewId: data.workflow,
      };
    }
    if (code === "judgment_has_workflow") return { message: t("workflow.start.errors.judgment_taken"), field: "judgment" };
  }
  // 选站被拒(终审 / 驳回目标,第四十三批):说是哪一站,而不是笼统的「没能生成」。
  const segment = segmentRefusalText(t, { status: r?.status, code, data });
  if (segment) return { message: segment, field: null };
  return failed;
}

/** 殿名按灵魂所在租户的文明取(地府 第十殿 · 欧洲 米诺斯之庭 …),同身份带。 */
function courtOf(t: Translate, tenantCode: string | undefined) {
  const civ = civSkinOf(tenantCode ?? null);
  return t(`plaque.office.court.${civ === "neutral" ? "cn" : civ}`);
}

/** 搜索下拉里的「文明 · 殿」:`<option>` 只能放文字,所以是字符串。 */
function useSoulPlace() {
  const { t } = useI18n();
  return (s: { civilization: string; tenant_code?: string }) => {
    const civLabel = resolveEnumDisplay(t, "souls.civilizations", s.civilization).label ?? "";
    return `${civLabel} · ${courtOf(t, s.tenant_code)}`;
  };
}

/**
 * 手动发起审批(W-11)。两处入口共用:审批页「实例」页签(灵魂可搜)与灵魂详情 ⋯(`lockedSoul`,已填好且锁定)。
 * 先选灵魂,再选案件类型(按灵魂的文明取),再选模板。被拒时弹层不关、已填的不丢。
 */
export function StartWorkflowDialog({
  isOpen,
  onClose,
  lockedSoul,
}: {
  isOpen: boolean;
  onClose: () => void;
  lockedSoul?: Soul;
}) {
  const { t } = useI18n();
  const { showToast } = useToast();
  const router = useRouter();
  const queryClient = useQueryClient();
  const place = useSoulPlace();

  const [pickedSoulId, setPickedSoulId] = useState("");
  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState("");
  const [caseType, setCaseType] = useState("");
  const [template, setTemplate] = useState("");
  /** `null` = 跟随模板:请求里不带 priority。 */
  const [priority, setPriority] = useState<number | null>(null);
  const [reason, setReason] = useState("");
  const [reasonError, setReasonError] = useState<string | null>(null);
  const [judgment, setJudgment] = useState("");
  const [refusal, setRefusal] = useState<Refusal | null>(null);
  /** 第 1 步填表,第 2 步选站(第四十三批 W-1a:审批页手动发起时选站是第 2 步)。 */
  const [step, setStep] = useState<1 | 2>(1);
  /** 第 2 步取消勾选的站(站序)。换了灵魂 / 案件类型 / 模板就作废。 */
  const [skipOrders, setSkipOrders] = useState<Set<string>>(new Set());

  const soulId = lockedSoul?.id ?? pickedSoulId;

  // 300ms,同 app/dispatch/propose 的灵魂搜索。
  useEffect(() => {
    const timer = setTimeout(() => setSearch(searchInput), 300);
    return () => clearTimeout(timer);
  }, [searchInput]);

  const soulSearch = useQuery({
    queryKey: ["start-workflow", "souls", search],
    queryFn: async () => (await soulsApi.list({ page: 1, search: search || undefined })).data,
    enabled: isOpen && !lockedSoul,
    placeholderData: (previous) => previous,
  });
  const soulOptions: SelectOption[] = (soulSearch.data?.results ?? []).map((s) => ({
    value: s.id,
    label: `${s.name} · ${place(s)}`,
  }));

  // 列表行没有租户主键;模板按殿筛要它,所以选中后取一次详情。锁定时就是传进来的那个。
  const picked = useSoul(lockedSoul ? "" : pickedSoulId);
  const soul: Soul | undefined = lockedSoul ?? picked.data;

  const caseTypes = useQuery({
    queryKey: ["start-workflow", "case-types", soulId],
    queryFn: async () => (await workflowApi.caseTypes({ soul: soulId })).data,
    enabled: isOpen && Boolean(soulId),
  });
  const templates = useQuery({
    queryKey: ["workflow-templates"],
    queryFn: async () => (await workflowApi.templates.list()).data,
    enabled: isOpen,
  });
  const judgments = useQuery({
    queryKey: ["start-workflow", "judgments", soulId],
    queryFn: async () => (await judgmentApi.list({ soul: soulId })).data,
    enabled: isOpen && Boolean(soulId),
  });

  /**
   * 可用的模板,按后端 `_resolve_template` 的口径:本殿(灵魂的租户)、已启用、文明相符、有节点、案件类型相同,
   * 次序是列表本身的(模型 ordering = civilization, case_type, name —— 后端 `.first()` 取的就是这个次序的第一个)。
   * 所以默认模板 = 第一个;一个都没有时后端用内置流程,这里以案件类型名称呼它。
   */
  const usable = useMemo(
    () =>
      soul && caseType
        ? (templates.data ?? []).filter(
            (tpl) =>
              tpl.is_active &&
              tpl.node_count > 0 &&
              tpl.civilization === soul.civilization &&
              tpl.case_type === caseType &&
              (soul.tenant == null || tpl.tenant === soul.tenant)
          )
        : [],
    [templates.data, soul, caseType]
  );
  const caseTypeLabel = (value: string) => resolveEnumDisplay(t, "workflow.case_types", value).label ?? value;
  const defaultName = usable[0]?.name ?? (caseType ? caseTypeLabel(caseType) : "");

  const start = useMutation({
    mutationFn: async () =>
      (
        await workflowApi.start({
          soul: soulId,
          // 选了具体模板就只带模板(后端以模板的案件类型为准);否则带案件类型,模板由后端按类型取默认。
          ...(template ? { template } : { case_type: caseType }),
          ...(priority === null ? {} : { priority }),
          reason: reason.trim(),
          ...(judgment ? { judgment } : {}),
          ...(skipOrders.size ? { skip_node_orders: [...skipOrders].map(Number) } : {}),
        })
      ).data,
    onSuccess: (created) => {
      queryClient.invalidateQueries({ queryKey: ["workflows"] });
      showToast(t("workflow.start.done"), "success");
      // 下次打开从第 1 步、全选开始。
      setStep(1);
      setSkipOrders(new Set());
      onClose();
      router.push(`/workflow/${created.id}`);
    },
    onError: (e) => {
      // 提示条在第 1 步的表头下(哪一格出错就回到那一格)。
      setRefusal(startWorkflowRefusal(e, t, soul?.civilization));
      setStep(1);
    },
  });

  // 第 2 步选站的预览;本域没有一站能跳过(第四十五批 `nothing_to_pick`)时直接「发起」,不进第 2 步。
  const previewParams = {
    soul: soulId,
    ...(template ? { template } : { case_type: caseType }),
    ...(judgment ? { judgment } : {}),
  };
  const preview = useFlowPreview(previewParams, isOpen && Boolean(soulId) && Boolean(caseType));
  const noPick = preview.data?.nothing_to_pick === true;

  /** 改了出错的那一格,提示条就消失。 */
  const touched = (field: Field) => {
    if (refusal?.field === field) setRefusal(null);
  };
  const bold = (field: Field) =>
    refusal?.field === field &&
    "[&_input]:border-2 [&_input]:border-[oklch(var(--color-ink))] [&_select]:border-2 [&_select]:border-[oklch(var(--color-ink))]";

  const priorities: { value: number | null; label: string }[] = [
    { value: null, label: t("workflow.start.priority_template") },
    { value: 0, label: t("workflow.detail.normal") },
    { value: 1, label: t("workflow.detail.urgent") },
    { value: 2, label: t("workflow.detail.critical") },
  ];

  const judgmentOptions: SelectOption[] = [
    { value: "", label: t("workflow.start.judgment_none") },
    ...(judgments.data?.results ?? []).map((j) => ({
      value: j.id,
      label: j.workflow ? `${j.case_number} · ${t("workflow.start.judgment_taken")}` : j.case_number,
      disabled: Boolean(j.workflow),
    })),
  ];

  return (
    <BaseModal
      isOpen={isOpen}
      onClose={() => !start.isPending && onClose()}
      title={t("workflow.start.title")}
      footer={
        <div className="flex justify-end gap-2">
          {step === 1 ? (
            <Button type="button" variant="ghost" onClick={onClose} disabled={start.isPending}>
              {t("common.cancel")}
            </Button>
          ) : (
            <Button type="button" variant="ghost" onClick={() => setStep(1)} disabled={start.isPending}>
              {t("workflow.pick.back")}
            </Button>
          )}
          <Button type="submit" form={FORM_ID} variant="primary" loading={start.isPending} disabled={!soulId || !caseType}>
            {step === 1 && !noPick ? t("workflow.pick.next") : t("workflow.start.submit")}
          </Button>
        </div>
      }
    >
      <form
        id={FORM_ID}
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          if (!soulId || !caseType) return;
          // 理由为空:不出提示条,只在理由框下写一行。
          if (!reason.trim()) {
            setReasonError(t("workflow.start.errors.reason_required"));
            setStep(1);
            return;
          }
          if (step === 1 && !noPick) {
            setRefusal(null);
            setStep(2);
            return;
          }
          start.mutate();
        }}
      >
        {step === 2 ? (
          <FlowStationPicker
            params={previewParams}
            skipped={skipOrders}
            onChange={setSkipOrders}
          />
        ) : null}
        {refusal ? (
          <div role="alert" className="flex flex-col gap-2 rounded-control border border-[oklch(var(--color-ink))] px-3 py-3 text-sm">
            <span className="text-pretty">{refusal.message}</span>
            {refusal.viewId ? (
              <Button
                type="button"
                variant="secondary"
                size="sm"
                className="self-start"
                onClick={() => {
                  onClose();
                  router.push(`/workflow/${refusal.viewId}`);
                }}
              >
                {t("workflow.start.errors.duplicate_view")}
              </Button>
            ) : null}
          </div>
        ) : null}
        <div hidden={step === 2} className="space-y-4">

        {lockedSoul ? (
          <div data-locked-soul="" className="flex flex-col gap-1">
            <span className="text-xs text-[oklch(var(--color-ink-muted))]">{t("workflow.start.soul")}</span>
            <span
              className={cn(
                "flex min-h-(--control-h-md) items-center gap-2 rounded-control border border-[oklch(var(--color-line-strong))] px-3 text-sm",
                refusal?.field === "soul" && "border-2 border-[oklch(var(--color-ink))]"
              )}
            >
              {lockedSoul.name}
              <span data-soul-place="" className="text-xs text-[oklch(var(--color-ink-muted))]">
                <DomainEnum namespace="souls.civilizations" value={lockedSoul.civilization} /> · {courtOf(t, lockedSoul.tenant_code)}
              </span>
            </span>
          </div>
        ) : (
          <SearchSelectField
            id="start-workflow-soul"
            name="soul"
            label={t("workflow.start.soul")}
            required
            className={cn(bold("soul"))}
            value={pickedSoulId}
            onValueChange={(next) => {
              setPickedSoulId(next);
              // 换了灵魂,依赖它的三格都作废。
              setCaseType("");
              setTemplate("");
              setJudgment("");
              setSkipOrders(new Set());
              touched("soul");
            }}
            options={soulOptions}
            searchText={searchInput}
            onSearchTextChange={setSearchInput}
            loading={soulSearch.isLoading}
            searching={soulSearch.isFetching && !soulSearch.isLoading}
            placeholder={t("workflow.start.soul_placeholder")}
            loadingText={t("common.loading")}
            emptyText={soulSearch.isError ? t("dispatch.soul_search_error") : t("dispatch.soul_search_empty")}
          />
        )}

        <SelectField
          id="start-workflow-case-type"
          label={t("workflow.detail.case_type")}
          required
          className={cn(bold("case_type"))}
          disabled={!soulId}
          value={caseType}
          onChange={(e) => {
            setCaseType(e.target.value);
            setTemplate("");
            setSkipOrders(new Set());
            touched("case_type");
          }}
          options={[
            // 选了灵魂之前整格不可用,占位写「先选灵魂」;选了之后同一行留空,等人挑。
            { value: "", label: soulId ? "" : t("workflow.start.case_type_placeholder") },
            ...(caseTypes.data ?? []).map((c) => ({ value: c.value, label: caseTypeLabel(c.value) })),
          ]}
        />

        {caseType ? (
          usable.length > 1 ? (
            <SelectField
              id="start-workflow-template"
              label={t("workflow.detail.template")}
              className={cn(bold("template"))}
              value={template}
              onChange={(e) => {
                setTemplate(e.target.value);
                setSkipOrders(new Set());
                touched("template");
              }}
              options={[
                { value: "", label: t("workflow.start.template_default", { name: defaultName }) },
                ...usable.map((tpl) => ({ value: tpl.id, label: tpl.name })),
              ]}
            />
          ) : (
            <div className="flex flex-col gap-1">
              <span className="text-xs text-[oklch(var(--color-ink-muted))]">{t("workflow.detail.template")}</span>
              <span
                data-template-only=""
                className={cn("text-sm text-[oklch(var(--color-ink))]", refusal?.field === "template" && "font-semibold")}
              >
                {t("workflow.start.template_only", { name: defaultName })}
              </span>
            </div>
          )
        ) : null}

        <div className="flex flex-col gap-1">
          <span id="start-workflow-priority" className="text-xs text-[oklch(var(--color-ink-muted))]">
            {t("workflow.detail.priority")}
          </span>
          <div
            role="group"
            aria-labelledby="start-workflow-priority"
            className="flex self-start overflow-hidden rounded-control border border-[oklch(var(--color-line-strong))] text-sm"
          >
            {priorities.map((p) => (
              <button
                key={String(p.value)}
                type="button"
                aria-pressed={priority === p.value}
                onClick={() => setPriority(p.value)}
                className={cn(
                  "min-h-(--control-h-sm) px-3",
                  priority === p.value
                    ? "bg-[oklch(var(--color-ink))] text-[oklch(var(--color-canvas))]"
                    : "text-[oklch(var(--color-ink))] hover:bg-[oklch(var(--color-surface-2))]"
                )}
              >
                {p.label}
              </button>
            ))}
          </div>
        </div>

        <div className="flex flex-col gap-1">
          <TextAreaField
            id="start-workflow-reason"
            label={t("workflow.start.reason")}
            required
            rows={4}
            maxLength={REASON_MAX}
            placeholder={t("workflow.start.reason_placeholder")}
            error={reasonError}
            value={reason}
            onChange={(e) => {
              setReason(e.target.value);
              setReasonError(null);
            }}
          />
          <span className="self-end text-2xs text-[oklch(var(--color-ink-muted))]">
            {t("workflow.start.reason_count", { n: String(reason.length) })}
          </span>
        </div>

        <SelectField
          id="start-workflow-judgment"
          label={t("workflow.start.judgment")}
          className={cn(bold("judgment"))}
          disabled={!soulId}
          value={judgment}
          onChange={(e) => {
            setJudgment(e.target.value);
            touched("judgment");
          }}
          options={judgmentOptions}
        />
        </div>
      </form>
    </BaseModal>
  );
}
