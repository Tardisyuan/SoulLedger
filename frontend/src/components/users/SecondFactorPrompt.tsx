"use client";

import { useCallback, useState, type ReactNode } from "react";
import type { SecondFactorProof } from "@soulledger/core/api";
import { useI18n } from "@/src/contexts/I18nContext";
import { BaseModal } from "@/src/components/ui/Modal";
import { Button } from "@/src/components/ui/Button";
import { TextField } from "@/src/components/ui/Field";
import { showToast } from "@/src/components/ui/Toast";
import { responseCode, responseData } from "@soulledger/core/api/client";

/**
 * Acting on another administrator (reset password / two-step, deactivate, delete, edit, change roles) needs the
 * caller's own second factor (2026-10-29 decision 8; `backend/apps/authentication/views.py::_admin_target_refusal`).
 *
 * `run(fn)` calls `fn()` as before. When the server answers 403 `second_factor_required` it opens the prompt and
 * re-sends `fn(proof)` with what the operator typed — so each caller changes only its `mutationFn`. A wrong code
 * stays in the prompt with the attempts left; cancelling rejects with the original refusal. The two refusals no
 * code can fix (`admin_target_global_only`, `second_factor_unavailable`) are said in words and rejected.
 */
export function useSecondFactor(targetName: string): {
  run: <T>(fn: (proof?: SecondFactorProof) => Promise<T>) => Promise<T>;
  prompt: ReactNode;
} {
  const { t } = useI18n();
  const [pending, setPending] = useState<{
    submit: (proof: SecondFactorProof) => Promise<void>;
    cancel: () => void;
  } | null>(null);

  const run = useCallback(
    <T,>(fn: (proof?: SecondFactorProof) => Promise<T>): Promise<T> =>
      fn().catch((err: unknown) => {
        const code = responseCode(err);
        if (code === "admin_target_global_only" || code === "second_factor_unavailable") {
          showToast(t(`users.second_factor.${code}`), "error");
          throw err;
        }
        if (code !== "second_factor_required") throw err;
        return new Promise<T>((resolve, reject) => {
          setPending({
            submit: async (proof) => {
              const result = await fn(proof); // a refusal propagates to the prompt, which shows it
              setPending(null);
              resolve(result);
            },
            cancel: () => {
              setPending(null);
              reject(err);
            },
          });
        });
      }),
    [t]
  );

  const prompt = pending ? (
    <SecondFactorPrompt name={targetName} onSubmit={pending.submit} onCancel={pending.cancel} />
  ) : null;
  return { run, prompt };
}

function SecondFactorPrompt({
  name,
  onSubmit,
  onCancel,
}: {
  name: string;
  onSubmit: (proof: SecondFactorProof) => Promise<void>;
  onCancel: () => void;
}) {
  const { t } = useI18n();
  const [method, setMethod] = useState<SecondFactorProof["mfa_method"]>("totp");
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      await onSubmit({ mfa_method: method, mfa_code: code.trim() });
    } catch (err) {
      const code = responseCode(err);
      const data = responseData<{ remaining_attempts: number; retry_after: number }>(err);
      if (code === "locked") {
        showToast(t("users.second_factor.locked", { minutes: String(Math.ceil((data?.retry_after ?? 900) / 60)) }), "error");
        onCancel();
        return;
      }
      if (code === "expired") setError(t("users.second_factor.expired"));
      else if (code === "wrong") setError(t("users.second_factor.wrong", { n: String(data?.remaining_attempts ?? 0) }));
      else throw err;
      setCode("");
    } finally {
      setBusy(false);
    }
  };

  return (
    <BaseModal
      isOpen
      dismissOnOutsideClick={false}
      title={t("users.second_factor.title")}
      onClose={() => !busy && onCancel()}
      footer={
        <div className="flex justify-end gap-2">
          <Button type="button" variant="ghost" onClick={onCancel} disabled={busy}>
            {t("common.cancel")}
          </Button>
          <Button
            type="button"
            variant="primary"
            data-testid="second-factor-submit"
            disabled={!code.trim() || busy}
            loading={busy}
            onClick={() => void submit()}
          >
            {t("users.second_factor.submit")}
          </Button>
        </div>
      }
    >
      <div className="flex flex-col gap-3 text-sm text-[oklch(var(--color-ink))]">
        <p>{t("users.second_factor.body", { name })}</p>
        <TextField
          label={t(method === "totp" ? "users.second_factor.code_label" : "users.second_factor.recovery_label")}
          value={code}
          onChange={(e) => setCode(e.target.value)}
          autoComplete="one-time-code"
          inputMode={method === "totp" ? "numeric" : "text"}
          data-testid="second-factor-code"
          disabled={busy}
          error={error ?? undefined}
        />
        <Button
          type="button"
          size="sm"
          variant="ghost"
          className="self-start"
          onClick={() => {
            setMethod(method === "totp" ? "recovery" : "totp");
            setCode("");
            setError(null);
          }}
        >
          {t(method === "totp" ? "users.second_factor.use_recovery" : "users.second_factor.use_totp")}
        </Button>
      </div>
    </BaseModal>
  );
}
