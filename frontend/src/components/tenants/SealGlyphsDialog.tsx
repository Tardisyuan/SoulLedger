"use client";

import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { tenantsApi, type Tenant } from "@soulledger/core/api";
import { useI18n } from "@/src/contexts/I18nContext";
import { useTenant } from "@/src/contexts/TenantContext";
import { useToast } from "@/src/contexts/ToastContext";
import { BaseModal } from "@/src/components/ui/Modal";
import { Button } from "@/src/components/ui/Button";
import { TextField } from "@/src/components/ui/Field";
import { DEFAULT_SEAL_GLYPHS, Seal, type SealCiv } from "@/src/components/plaque/Seal";
import { civSkinOf } from "@/src/lib/civSkin";

/** 输入框里的字 → 印字数组:按码位切(埃及圣书字在 BMP 之外),空白不算字。不截断 —— 超长交给服务端 400。 */
export function parseSealGlyphs(value: string): string[] {
  return Array.from(value).filter((c) => !/\s/.test(c));
}

/** DRF 的 400:`seal_glyphs` 可能是字符串数组,也可能是按下标的对象(子项出错时)。全部摊平成一句。 */
export function sealGlyphsError(error: unknown): string | null {
  const data = (error as { response?: { status?: number; data?: unknown } })?.response;
  if (data?.status !== 400 || !data.data || typeof data.data !== "object") return null;
  const out: string[] = [];
  const walk = (node: unknown) => {
    if (typeof node === "string") out.push(node);
    else if (Array.isArray(node)) node.forEach(walk);
    else if (node && typeof node === "object") Object.values(node).forEach(walk);
  };
  const body = data.data as Record<string, unknown>;
  walk("seal_glyphs" in body ? body.seal_glyphs : body);
  return out.length ? out.join(" ") : null;
}

const isSealCiv = (civ: string): civ is SealCiv => civ in DEFAULT_SEAL_GLYPHS;

/**
 * 租户印字编辑(规范 v2 补足 A6:由管理员在租户设置里配置,只有管理员能改)。
 * 调 `PATCH /tenants/{code}/seal-glyphs/`;400 的校验信息原样显示在字段下面。
 * 改的是当前用户自己的租户时,顺手把新印字写回 TenantContext —— 页头的印读的就是那里,
 * 于是不用重新登录印文就换了。
 */
export function SealGlyphsDialog({ tenant, onClose }: { tenant: Tenant | null; onClose: () => void }) {
  const { t } = useI18n();
  const { user, setUser } = useTenant();
  const { showToast } = useToast();
  const queryClient = useQueryClient();
  const [value, setValue] = useState((tenant?.seal_glyphs ?? []).join(""));
  const [error, setError] = useState<string | null>(null);

  const skin = civSkinOf(tenant?.code ?? null);
  const civ = isSealCiv(skin) ? skin : null;
  const glyphs = parseSealGlyphs(value);

  const save = useMutation({
    mutationFn: () => tenantsApi.updateSealGlyphs(tenant!.code, glyphs).then((r) => r.data),
    onSuccess: (saved) => {
      void queryClient.invalidateQueries({ queryKey: ["tenants"] });
      if (user?.tenant && user.tenant.code === saved.code) {
        setUser({ ...user, tenant: { ...user.tenant, seal_glyphs: saved.seal_glyphs ?? [] } });
      }
      showToast(t("tenants.seal.saved"), "success");
      onClose();
    },
    onError: (e) => {
      const message = sealGlyphsError(e);
      if (message) setError(message);
      else showToast(t("tenants.seal.save_failed"), "error");
    },
  });

  const defaultGlyph = civ ? DEFAULT_SEAL_GLYPHS[civ].join("") : "";

  return (
    <BaseModal
      isOpen={tenant !== null}
      onClose={() => !save.isPending && onClose()}
      title={t("tenants.seal.title", { name: tenant?.display_name ?? "" })}
      footer={
        <div className="flex justify-end gap-2">
          <Button type="button" variant="ghost" onClick={onClose} disabled={save.isPending}>
            {t("common.cancel")}
          </Button>
          <Button type="submit" form="seal-glyphs-form" variant="primary" loading={save.isPending}>
            {t("common.save")}
          </Button>
        </div>
      }
    >
      <form
        id="seal-glyphs-form"
        className="flex items-start gap-4"
        onSubmit={(e) => {
          e.preventDefault();
          setError(null);
          save.mutate();
        }}
      >
        <TextField
          className="min-w-0 flex-1"
          label={t("tenants.seal.column")}
          description={civ ? t(civ === "eg" ? "tenants.seal.hint_two" : "tenants.seal.hint_one", { glyph: defaultGlyph }) : undefined}
          error={error}
          value={value}
          onChange={(e) => {
            setValue(e.target.value);
            setError(null);
          }}
          autoComplete="off"
          spellCheck={false}
          disabled={save.isPending}
        />
        {civ ? (
          <div className="flex flex-col items-center gap-1" data-testid="seal-preview">
            <span className="text-xs text-[oklch(var(--color-ink-muted))]">{t("tenants.seal.preview")}</span>
            <Seal size={52} civ={civ} glyphs={glyphs} court={tenant?.display_name} />
          </div>
        ) : null}
      </form>
    </BaseModal>
  );
}
