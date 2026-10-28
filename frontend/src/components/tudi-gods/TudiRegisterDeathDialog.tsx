"use client";

import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { soulsApi, tudiGodKeys, tudiGodsApi, type TudiGod } from "@soulledger/core/api";
import { judgmentKeys, soulKeys } from "@soulledger/core/query_keys";
import { useI18n } from "@/src/contexts/I18nContext";
import { BaseModal } from "@/src/components/ui/Modal";
import { Button } from "@/src/components/ui/Button";
import { SelectField, TextAreaField, TextField, type SelectOption } from "@/src/components/ui/Field";
import { SearchSelectField } from "@/src/components/ui/SearchSelectField";
import { showToast } from "@/src/components/ui/Toast";
import { tudiRefusalMessage } from "./tudiDisplay";

/*
 * 以土地公名义登记死亡(第五十七批 S-6):和「记录身故」是同一件事(灵魂进审判、开案、到十三站的土地庙),
 * 只多一个「土地公所报」。两处入口:灵魂详情「更多操作」(灵魂已定,选土地公)与土地公列表的行菜单(土地公已定,选灵魂)。
 * 标题下写出土地公与上级城隍;提示写「登记后发给某城隍初审」。
 * 「土地公所报」落在登记的 `cause_of_death`(≤ 500 字,加密存放)—— 后端没有专门的字段,登记接口只收这几项。
 * 回来的登记是 FAILED 时(灵魂已不在世等)弹层不关,写出 `death_sync.error.<码>` 那句话(认不出的码写通用句)。
 */

const REPORT_MAX = 500;

interface Props {
  /** 从灵魂详情来:灵魂已定。 */
  soul?: { id: string; name: string };
  /** 从土地公列表来:土地公已定。 */
  tudi?: TudiGod;
  onClose: () => void;
}

const today = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

export function TudiRegisterDeathDialog({ soul, tudi, onClose }: Props) {
  const { t } = useI18n();
  const qc = useQueryClient();
  const [tudiId, setTudiId] = useState(tudi?.id ?? "");
  const [soulId, setSoulId] = useState(soul?.id ?? "");
  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState("");
  const [deathDate, setDeathDate] = useState(today);
  const [location, setLocation] = useState("");
  const [report, setReport] = useState("");
  const [refusal, setRefusal] = useState<string | null>(null);
  // 一次弹层一把幂等键:连点两下只登记一条(后端 409 答已有的那条)。
  const [idempotencyKey] = useState(() => globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random()}`);

  useEffect(() => {
    const timer = setTimeout(() => setSearch(searchInput), 300);
    return () => clearTimeout(timer);
  }, [searchInput]);

  const gods = useQuery({
    queryKey: [...tudiGodKeys.all, "list"],
    queryFn: () => tudiGodsApi.list().then((r) => r.data.results),
    enabled: !tudi,
  });
  const souls = useQuery({
    queryKey: ["tudi-register", "souls", search],
    queryFn: async () => (await soulsApi.list({ page: 1, search: search || undefined, state: "ALIVE" })).data,
    enabled: !soul,
    placeholderData: (previous) => previous,
  });
  const soulOptions: SelectOption[] = (souls.data?.results ?? []).map((s) => ({
    value: s.id,
    label: s.name,
  }));
  const chosen = tudi ?? gods.data?.find((g) => g.id === tudiId);
  const soulName = soul?.name ?? souls.data?.results.find((s) => s.id === soulId)?.name ?? "";

  const register = useMutation({
    mutationFn: () =>
      tudiGodsApi.registerDeath(tudiId, {
        soul_lookup: { soul_id: soulId },
        death_date: deathDate,
        death_location: location.trim(),
        cause_of_death: report.trim(),
        idempotency_key: idempotencyKey,
      }),
    onSuccess: ({ data }) => {
      if (data.status === "FAILED") {
        // `death_sync.error.<码>` 是这张表的拒绝原因;认不出的码写通用句,不把码本身放上屏幕。
        const key = `death_sync.error.${data.error_code}`;
        const reason = data.error_code && t(key) !== key ? t(key) : t("common.error");
        setRefusal(t("earthGods.register_failed", { reason }));
        return;
      }
      void qc.invalidateQueries({ queryKey: soulKeys.all });
      void qc.invalidateQueries({ queryKey: judgmentKeys.all });
      void qc.invalidateQueries({ queryKey: tudiGodKeys.all });
      showToast(t("earthGods.registered_toast", { name: soulName }), "success");
      onClose();
    },
    onError: (err) => setRefusal(tudiRefusalMessage(err, t)),
  });

  const subtitle = chosen ? [chosen.name, chosen.city_god_name].filter(Boolean).join(" · ") : "";
  return (
    <BaseModal
      isOpen
      onClose={onClose}
      title={t("earthGods.register_death")}
      footer={
        <>
          <Button type="button" variant="ghost" onClick={onClose} disabled={register.isPending}>
            {t("common.cancel")}
          </Button>
          <Button
            type="button"
            variant="primary"
            data-testid="tudi-register-submit"
            loading={register.isPending}
            disabled={!tudiId || !soulId || !deathDate}
            onClick={() => {
              setRefusal(null);
              register.mutate();
            }}
          >
            {t("earthGods.register_submit")}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        {subtitle && <p className="text-sm text-[oklch(var(--color-ink-muted))]" data-testid="tudi-register-subtitle">{subtitle}</p>}
        {!tudi && (
          <SelectField
            id="tudi-register-god"
            label={t("earthGods.title")}
            required
            value={tudiId}
            onChange={(e) => setTudiId(e.target.value)}
            options={[{ value: "", label: "—" }, ...(gods.data ?? []).map((g) => ({ value: g.id, label: g.name }))]}
          />
        )}
        {soul ? (
          <div>
            <p className="text-2xs text-[oklch(var(--color-ink-subtle))]">{t("earthGods.soul")}</p>
            <p className="text-sm text-[oklch(var(--color-ink))]">{soul.name}</p>
          </div>
        ) : (
          <SearchSelectField
            id="tudi-register-soul"
            name="soul"
            label={t("earthGods.soul")}
            required
            value={soulId}
            onValueChange={setSoulId}
            options={soulOptions}
            searchText={searchInput}
            onSearchTextChange={setSearchInput}
            loading={souls.isLoading}
            searching={souls.isFetching && !souls.isLoading}
            loadingText={t("common.loading")}
            emptyText={souls.isError ? t("dispatch.soul_search_error") : t("dispatch.soul_search_empty")}
          />
        )}
        <TextField
          id="tudi-register-date"
          type="date"
          label={t("earthGods.death_date")}
          required
          value={deathDate}
          onChange={(e) => setDeathDate(e.target.value)}
        />
        <TextField
          id="tudi-register-location"
          label={t("earthGods.death_location")}
          maxLength={500}
          value={location}
          onChange={(e) => setLocation(e.target.value)}
        />
        <TextAreaField
          id="tudi-register-report"
          label={t("earthGods.report_label")}
          maxLength={REPORT_MAX}
          rows={3}
          value={report}
          onChange={(e) => setReport(e.target.value)}
        />
        {chosen?.city_god_name && (
          <p className="text-xs text-[oklch(var(--color-ink-muted))]">{t("earthGods.register_hint", { city_god: chosen.city_god_name })}</p>
        )}
        {refusal && <p role="alert" data-testid="tudi-register-refusal" className="text-sm text-[oklch(var(--color-danger))]">{refusal}</p>}
      </div>
    </BaseModal>
  );
}
