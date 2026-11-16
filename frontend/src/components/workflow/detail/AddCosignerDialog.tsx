"use client";

import { useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { officerAppApi } from "@soulledger/core/api";
import { cosignRefusalOf } from "@soulledger/core/api/officer-app";
import { problemDetail } from "@soulledger/core/api/client";
import { useDebouncedValue } from "@soulledger/core/hooks/useDebouncedValue";
import { useI18n } from "@/src/contexts/I18nContext";
import { useToast } from "@/src/contexts/ToastContext";
import { BaseModal } from "@/src/components/ui/Modal";
import { Button } from "@/src/components/ui/Button";
import { SearchSelectField } from "@/src/components/ui/SearchSelectField";

/** The to-do item a workflow is decided as: a plain approval by the workflow's id, a rebirth by its application's. */
export type ApprovalRef = { kind: "approval" | "rebirth"; id: string };

/**
 * 加签 on the web (officer App `CosignSheet`, sheets.tsx): the current approver adds a same-hall colleague as
 * co-signer of this node. Same rules line, same refusals: 403 `not_allowed` -- adding is not possible now (the
 * reason above a greyed confirm, no promise); 400 `not_eligible` / `duplicate` -- this person, under the field.
 * The candidate list is the server's (`signer-candidates`, searched there), never filtered here.
 */
export function AddCosignerDialog({ target, onClose, onAdded }: { target: ApprovalRef; onClose: () => void; onAdded: () => void }) {
  const { t } = useI18n();
  const { showToast } = useToast();
  const [search, setSearch] = useState("");
  const q = useDebouncedValue(search);
  const [picked, setPicked] = useState("");
  const [personError, setPersonError] = useState<string | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [unavailable, setUnavailable] = useState(false);

  const candidates = useQuery({
    queryKey: ["officer-app", "signer-candidates", q.trim()],
    queryFn: async () => (await officerAppApi.signerCandidates(q.trim() || undefined)).data,
    placeholderData: (previous) => previous,
  });
  const options = (candidates.data ?? []).map((p) => ({ value: String(p.id), label: p.name && p.name !== p.username ? `${p.name} · ${p.username}` : p.username }));

  const add = useMutation({
    mutationFn: (userId: number) => officerAppApi.addCosigner(target.kind, target.id, userId),
    onSuccess: () => {
      showToast(t("officer_app.cosign.added"), "success");
      onAdded();
      onClose();
    },
    onError: (e: unknown) => {
      const refusal = cosignRefusalOf(e);
      if (refusal === "not_allowed") setUnavailable(true);
      else if (refusal) setPersonError(t(`officer_app.cosign.${refusal}`));
      else setProblem(problemDetail(e) || t("common.error"));
    },
  });

  const confirm = () => {
    setProblem(null);
    if (!picked) {
      setPersonError(t("officer_app.cosign.search"));
      return;
    }
    add.mutate(Number(picked));
  };

  return (
    <BaseModal
      isOpen
      onClose={onClose}
      title={t("officer_app.detail.cosign")}
      footer={
        <div className="flex flex-col gap-2">
          {unavailable && (
            <p data-testid="cosign-unavailable" className="text-sm text-[oklch(var(--color-ink-muted))]">
              <span aria-hidden="true">◇ </span>
              {t("officer_app.cosign.unavailable")}
            </p>
          )}
          <div className="flex justify-end gap-2">
            <Button type="button" variant="ghost" onClick={onClose}>
              {t("common.cancel")}
            </Button>
            <Button type="button" variant="primary" data-testid="cosign-confirm" loading={add.isPending} disabled={unavailable} onClick={confirm}>
              {t("officer_app.cosign.confirm")}
            </Button>
          </div>
        </div>
      }
    >
      <div className="flex flex-col gap-4">
        <p data-testid="cosign-rules" className="text-sm text-[oklch(var(--color-ink-muted))]">
          {t("officer_app.cosign.rules")}
        </p>
        <SearchSelectField
          id="cosigner"
          name="cosigner"
          label={t("officer_app.cosign.search")}
          value={picked}
          onValueChange={(v) => {
            setPicked(v);
            setPersonError(null);
          }}
          options={options}
          searchText={search}
          onSearchTextChange={setSearch}
          loading={candidates.isLoading}
          searching={candidates.isFetching && !candidates.isLoading}
          loadingText={t("common.loading")}
          emptyText={candidates.isError ? t("officer_app.state.error_title") : t("officer_app.cosign.empty")}
          error={personError ?? (candidates.isError ? t("officer_app.state.error_title") : null)}
        />
        {problem && (
          <p role="alert" data-testid="cosign-problem" className="text-sm text-[oklch(var(--color-danger))]">
            {problem}
          </p>
        )}
      </div>
    </BaseModal>
  );
}
