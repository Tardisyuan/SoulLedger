"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { workflowApi, type ApprovalWorkflow, type ApprovalNode } from "@/lib/api";
import { showToast } from "@/src/components/ui/Toast";
import { useI18n } from "@/src/contexts/I18nContext";
import { workflowKeys } from "@/lib/query_keys";

// ── Workflow Queries ─────────────────────────────────────────────────

export function useWorkflows(params?: Record<string, string>) {
  return useQuery({
    queryKey: workflowKeys.list(params),
    queryFn: async () => {
      const res = await workflowApi.list(params);
      return res.data as { results: ApprovalWorkflow[]; count: number };
    },
    staleTime: 30_000,
  });
}

export function useWorkflow(id: string) {
  return useQuery({
    queryKey: workflowKeys.detail(id),
    queryFn: async () => {
      const res = await workflowApi.get(id);
      return res.data as ApprovalWorkflow;
    },
    enabled: !!id,
    staleTime: 30_000,
  });
}

// ── Template Queries ─────────────────────────────────────────────────

export function useWorkflowTemplates(params?: Record<string, string>) {
  return useQuery({
    queryKey: workflowKeys.templates.list(params),
    queryFn: async () => {
      const res = await workflowApi.templates.list(params);
      return res.data as { results: ApprovalWorkflow[]; count: number };
    },
    staleTime: 30_000,
  });
}

export function useWorkflowTemplate(id: string) {
  return useQuery({
    queryKey: workflowKeys.templates.detail(id),
    queryFn: async () => {
      const res = await workflowApi.templates.get(id);
      return res.data as ApprovalWorkflow;
    },
    enabled: !!id,
    staleTime: 30_000,
  });
}

// ── Mutations ────────────────────────────────────────────────────────

export function useCreateWorkflow() {
  const qc = useQueryClient();
  const { t } = useI18n();

  return useMutation({
    mutationFn: (data: object) => workflowApi.create(data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: workflowKeys.all });
      showToast(t("workflow.create_success") || "Workflow created", "success");
    },
    onError: () => {
      showToast(t("workflow.create_error") || "Failed to create workflow", "error");
    },
  });
}

export function useAdvanceWorkflow() {
  const qc = useQueryClient();
  const { t } = useI18n();

  return useMutation({
    mutationFn: (id: string) => workflowApi.advance(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: workflowKeys.all });
      showToast(t("workflow.advance_success") || "Workflow advanced", "success");
    },
    onError: () => {
      showToast(t("workflow.advance_error") || "Failed to advance workflow", "error");
    },
  });
}

export function useApproveNode() {
  const qc = useQueryClient();
  const { t } = useI18n();

  return useMutation({
    mutationFn: ({ nodeId, data }: { nodeId: string; data: object }) =>
      workflowApi.approveNode(nodeId, data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: workflowKeys.all });
      showToast(t("workflow.approve_success") || "Node approved", "success");
    },
    onError: () => {
      showToast(t("workflow.approve_error") || "Failed to approve node", "error");
    },
  });
}

export function useCreateWorkflowTemplate() {
  const qc = useQueryClient();
  const { t } = useI18n();

  return useMutation({
    mutationFn: (data: object) => workflowApi.templates.create(data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: workflowKeys.templates.all });
      showToast(t("workflow.template_create_success") || "Template created", "success");
    },
    onError: () => {
      showToast(t("workflow.template_create_error") || "Failed to create template", "error");
    },
  });
}

export function useUpdateWorkflowTemplate() {
  const qc = useQueryClient();
  const { t } = useI18n();

  return useMutation({
    mutationFn: ({ id, data }: { id: string; data: object }) =>
      workflowApi.templates.update(id, data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: workflowKeys.templates.all });
      showToast(t("workflow.template_update_success") || "Template updated", "success");
    },
    onError: () => {
      showToast(t("workflow.template_update_error") || "Failed to update template", "error");
    },
  });
}

export function useDeleteWorkflowTemplate() {
  const qc = useQueryClient();
  const { t } = useI18n();

  return useMutation({
    mutationFn: (id: string) => workflowApi.templates.delete(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: workflowKeys.templates.all });
      showToast(t("workflow.template_delete_success") || "Template deleted", "success");
    },
    onError: () => {
      showToast(t("workflow.template_delete_error") || "Failed to delete template", "error");
    },
  });
}
