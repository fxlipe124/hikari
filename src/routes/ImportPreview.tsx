import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, Check, Sparkles, Wand2 } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Select } from "@/components/ui/Select";
import { useCards, useCategories } from "@/lib/queries";
import { useUpdateCard } from "@/lib/mutations";
import { useImportStore } from "@/hooks/useImportStore";
import { useCurrencyStore } from "@/hooks/useCurrencyStore";
import { errorMessage, ipc, isTauri, type ImportRow } from "@/lib/ipc";
import { toast } from "@/lib/toast";
import {
  cn,
  currentYearMonth,
  parseMoney,
  statementPeriod,
  useFormatMoney,
} from "@/lib/utils";

export function ImportPreview() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { rows, cardId, issuer, cardMetadata, rowMetadata, updateRow, clear } = useImportStore();
  const { data: cards } = useCards();
  const { data: categories } = useCategories();
  const updateCard = useUpdateCard();
  const formatMoney = useFormatMoney();
  const [metadataDismissed, setMetadataDismissed] = useState(false);

  const [included, setIncluded] = useState<boolean[]>(() =>
    rows.map(() => true)
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Year that shows as "selected" in the dropdown. Defaults to whatever year
  // the parser settled on for the majority of rows (auto-detected from the
  // statement text). The user can override if the auto-detection was wrong
  // — changing it shifts the year on every row's postedAt.
  const [refYear, setRefYear] = useState<number>(() => {
    const counts = new Map<number, number>();
    for (const r of rows) {
      const y = parseInt(r.postedAt.slice(0, 4), 10);
      if (Number.isFinite(y)) counts.set(y, (counts.get(y) ?? 0) + 1);
    }
    return (
      [...counts.entries()].sort(([, a], [, b]) => b - a)[0]?.[0] ??
      new Date().getFullYear()
    );
  });

  useEffect(() => {
    if (rows.length === 0) {
      navigate("/transactions");
    }
  }, [rows.length, navigate]);

  function shiftAllToYear(targetYear: number) {
    if (targetYear === refYear) return;
    const delta = targetYear - refYear;
    rows.forEach((r, i) => {
      const y = parseInt(r.postedAt.slice(0, 4), 10);
      if (!Number.isFinite(y)) return;
      const newYear = y + delta;
      const newPostedAt = `${String(newYear).padStart(4, "0")}${r.postedAt.slice(4)}`;
      updateRow(i, { postedAt: newPostedAt });
    });
    setRefYear(targetYear);
  }

  // 8 years in the dropdown: 5 past + current + 2 future, plus refYear if it
  // somehow fell outside that window.
  const yearOptions = useMemo(() => {
    const cur = new Date().getFullYear();
    const set = new Set<number>([cur - 5, cur - 4, cur - 3, cur - 2, cur - 1, cur, cur + 1, cur + 2, refYear]);
    return [...set].sort((a, b) => b - a);
  }, [refYear]);

  const sortedCategories = useMemo(() => {
    if (!categories) return [];
    const label = (c: { id: string; name: string }) =>
      t(`category.${c.id}`, { defaultValue: c.name }) as string;
    const roots = categories.filter((c) => !c.parentId);
    const out: Array<{ id: string; label: string; depth: number }> = [];
    for (const root of roots) {
      out.push({ id: root.id, label: label(root), depth: 0 });
      for (const child of categories.filter((c) => c.parentId === root.id)) {
        out.push({ id: child.id, label: label(child), depth: 1 });
      }
    }
    return out;
  }, [categories, t]);

  const card = cards?.find((c) => c.id === cardId);
  const includedCount = included.filter(Boolean).length;
  const includedTotal = rows.reduce(
    (s, r, i) => (included[i] && !r.isRefund ? s + r.amountCents : s),
    0
  );
  const autoCategorized = rows.filter((r) => r.categoryId).length;

  function toggle(i: number) {
    setIncluded((s) => s.map((v, idx) => (idx === i ? !v : v)));
  }

  function setAmountText(i: number, text: string) {
    const cents = parseMoney(text);
    if (cents !== null) updateRow(i, { amountCents: cents });
  }

  async function commit() {
    if (!cardId) return;
    setError(null);
    setBusy(true);
    try {
      const currency = useCurrencyStore.getState().currency;
      // Statement period priority per row:
      //   1. parser's own statement_year_month (extracted from the
      //      Sofisa header — source of truth for "which fatura is
      //      this row billed in"). Critical for parcela rows where
      //      Sofisa prints the *original purchase date* on every
      //      installment: parcela 2/10 dated 04/07 imported in the
      //      Sep fatura would otherwise group with Aug because
      //      `posted_at + closing_day` puts day-04 in the closing
      //      month containing it.
      //   2. closing_day pivot — fallback for non-Sofisa or paste
      //      mode where the parser couldn't see a header.
      //   3. nothing (backend then computes via card.closing_day on
      //      insert).
      const fallbackClosingDay =
        cardMetadata?.closingDay ?? card?.closingDay ?? null;
      const fallbackStmt = cardMetadata?.statementYearMonth ?? null;
      const payload: ImportRow[] = rows
        .map((r, i) => ({ r, i }))
        .filter(({ i }) => included[i])
        .map(({ r, i }) => {
          const postedAt =
            r.postedAt.length === 10 ? `${r.postedAt}T00:00:00Z` : r.postedAt;
          const rowMeta = rowMetadata[i] ?? null;
          // Parser-detected period (per row in batch imports, otherwise
          // the import-wide one). Wins outright when present.
          const parsedStmt = rowMeta?.statementYearMonth ?? fallbackStmt;
          const rowClosingDay = rowMeta?.closingDay ?? fallbackClosingDay;
          const statementYearMonth =
            parsedStmt ??
            (rowClosingDay !== null
              ? statementPeriod(postedAt, rowClosingDay)
              : undefined);
          return {
            postedAt,
            description: r.description,
            merchantClean: r.merchantClean,
            amountCents: r.amountCents,
            // Mirror the manual-entry path (TransactionDialog) — store the
            // user's active currency, not the parser's hardcoded "BRL".
            currency,
            categoryId: r.categoryId,
            installmentIndex: r.installment ? r.installment[0] : null,
            installmentTotal: r.installment ? r.installment[1] : null,
            isRefund: r.isRefund,
            isVirtualCard: r.isVirtualCard,
            statementYearMonth,
          };
        });

      if (!isTauri) {
        // Dev-only fallback: no real backend; just clear and go.
        clear();
        navigate("/transactions");
        return;
      }

      const result = await ipc.import.commit(cardId, payload);
      qc.invalidateQueries({ queryKey: ["transactions"] });
      qc.invalidateQueries({ queryKey: ["monthSummary"] });

      // Pick the year-month that holds the most imported rows so the
      // Transactions screen opens already on the right page.
      const monthCounts = new Map<string, number>();
      for (const row of payload) {
        const key = row.postedAt.slice(0, 7);
        monthCounts.set(key, (monthCounts.get(key) ?? 0) + 1);
      }
      const targetYm =
        [...monthCounts.entries()].sort(([, a], [, b]) => b - a)[0]?.[0] ??
        currentYearMonth();

      clear();
      navigate("/transactions", {
        state: {
          ym: targetYm,
          toast: t("toast.import_complete", {
            inserted: result.inserted,
            skipped: result.skipped,
          }),
        },
      });
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  function cancel() {
    clear();
    navigate("/transactions");
  }

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-between border-b border-border px-6 py-4">
        <div className="flex items-center gap-3">
          <button
            onClick={cancel}
            className="rounded-[var(--radius)] p-1 text-fg-subtle hover:text-fg hover:bg-surface-hover transition-colors"
          >
            <ArrowLeft className="h-4 w-4" />
          </button>
          <div>
            <h1 className="text-lg font-semibold tracking-tight">{t("route.import_preview.title")}</h1>
            <p className="text-xs text-fg-muted">
              {issuer && (
                <span className="mr-2 inline-flex items-center gap-1 rounded-full bg-accent/10 px-1.5 py-0.5 text-accent text-[10px]">
                  <Sparkles className="h-2.5 w-2.5" />
                  {t(`import.issuer.${issuer}`, { defaultValue: issuer })}
                </span>
              )}
              {card && <span>{card.name} · </span>}
              {t("route.import_preview.subtitle", {
                included: includedCount,
                total: rows.length,
                auto: autoCategorized,
              })}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-4">
          <div className="flex flex-col items-end gap-0.5">
            <label className="text-[10px] uppercase tracking-wide text-fg-subtle">
              {t("import_preview.reference_year")}
            </label>
            <Select
              value={String(refYear)}
              onChange={(e) => shiftAllToYear(parseInt(e.target.value, 10))}
              className="h-8 w-24 text-xs"
            >
              {yearOptions.map((y) => (
                <option key={y} value={y}>
                  {y}
                </option>
              ))}
            </Select>
          </div>
          <div className="text-right">
            <div className="text-xs text-fg-subtle">{t("import.total")}</div>
            <div className="text-lg font-semibold tabular">{formatMoney(includedTotal)}</div>
          </div>
          <Button onClick={commit} disabled={busy || includedCount === 0}>
            {busy ? t("common.importing") : t("import.import_count", { count: includedCount })}
          </Button>
        </div>
      </div>

      {/* Sofisa header detected card-level metadata that disagrees with the
          chosen card. Offer a one-click sync so the user doesn't have to
          re-enter closing/due day from memory after every first import. */}
      {!metadataDismissed && card && cardMetadata
        && (cardMetadata.closingDay !== card.closingDay
            || cardMetadata.dueDay !== card.dueDay) && (
        <div className="border-b border-accent/30 bg-accent/5 px-6 py-3 flex items-center gap-3 text-xs">
          <Wand2 className="h-4 w-4 text-accent shrink-0" />
          <div className="flex-1 min-w-0">
            <div className="font-medium text-fg">
              {t("import_preview.detected_card_metadata", {
                closing: cardMetadata.closingDay,
                due: cardMetadata.dueDay,
              })}
            </div>
            <div className="text-fg-subtle mt-0.5">
              {t("import_preview.detected_card_metadata_hint", {
                cardClosing: card.closingDay,
                cardDue: card.dueDay,
              })}
            </div>
          </div>
          <Button
            size="sm"
            variant="secondary"
            onClick={async () => {
              try {
                // Cascade-recompute statement_year_month on the existing tx
                // of this card too — otherwise rows imported under the old
                // closing_day stay grouped wrong, only future imports get
                // the new value.
                await updateCard.mutateAsync({
                  id: card.id,
                  patch: {
                    closingDay: cardMetadata.closingDay,
                    dueDay: cardMetadata.dueDay,
                    recomputeStatements: true,
                  },
                });
                toast.success(t("toast.card_metadata_updated"));
                setMetadataDismissed(true);
              } catch (e) {
                toast.fromError(e, t("toast.card_save_failed"));
              }
            }}
            disabled={updateCard.isPending}
          >
            {t("import_preview.update_card")}
          </Button>
          <button
            onClick={() => setMetadataDismissed(true)}
            className="text-fg-subtle hover:text-fg transition-colors text-xs"
          >
            {t("common.dismiss")}
          </button>
        </div>
      )}

      {error && (
        <div className="border-b border-danger/30 bg-danger/10 px-6 py-2 text-xs text-danger">
          {error}
        </div>
      )}

      <div className="flex-1 overflow-auto">
        <table className="w-full">
          <thead className="sticky top-0 bg-surface border-b border-border z-10">
            <tr className="text-xs text-fg-muted">
              <th className="pl-6 pr-2 py-2 w-8" />
              <th className="px-2 py-2 text-left font-medium w-24">{t("table.header.date")}</th>
              <th className="px-2 py-2 text-left font-medium">{t("table.header.description")}</th>
              <th className="px-2 py-2 text-left font-medium w-44">{t("table.header.category")}</th>
              <th className="px-2 py-2 text-left font-medium w-28">{t("table.header.installment")}</th>
              <th className="px-2 pr-6 py-2 text-right font-medium w-32">{t("table.header.amount")}</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => {
              const cat = categories?.find((c) => c.id === r.categoryId);
              const on = included[i];
              // Composite key keeps React's row identity stable even if the
              // underlying ParsedTransaction list is reordered (e.g. by a
              // future sort filter).
              const rowKey = `${r.postedAt}-${r.amountCents}-${r.description.slice(0, 24)}-${i}`;
              return (
                <tr
                  key={rowKey}
                  className={cn(
                    "border-b border-border transition-colors",
                    on ? "hover:bg-surface-hover" : "opacity-50"
                  )}
                >
                  <td className="pl-6 pr-2 py-1.5">
                    <button
                      onClick={() => toggle(i)}
                      className={cn(
                        "flex h-4 w-4 items-center justify-center rounded border transition-colors",
                        on
                          ? "border-accent bg-accent text-accent-fg"
                          : "border-border bg-surface"
                      )}
                    >
                      {on && <Check className="h-3 w-3" strokeWidth={3} />}
                    </button>
                  </td>
                  <td className="px-2 py-1.5 whitespace-nowrap">
                    <Input
                      type="date"
                      value={r.postedAt.slice(0, 10)}
                      onChange={(e) => updateRow(i, { postedAt: e.target.value })}
                      className="h-7 px-2 text-xs"
                      disabled={!on}
                    />
                  </td>
                  <td className="px-2 py-1.5 min-w-0">
                    <div className="flex items-center gap-1.5">
                      <Input
                        value={r.merchantClean ?? r.description}
                        onChange={(e) =>
                          updateRow(i, {
                            merchantClean: e.target.value || null,
                          })
                        }
                        className="h-7 px-2 text-xs flex-1"
                        disabled={!on}
                      />
                      {r.isVirtualCard && (
                        <span className="shrink-0 rounded-full border border-accent/40 bg-accent/10 px-1.5 py-0 text-[9px] uppercase tracking-wide text-accent">
                          {t("transactions.virtual_card_badge")}
                        </span>
                      )}
                    </div>
                  </td>
                  <td className="px-2 py-1.5">
                    <Select
                      value={r.categoryId ?? ""}
                      onChange={(e) =>
                        updateRow(i, { categoryId: e.target.value || null })
                      }
                      className="h-7 px-2 text-xs"
                      disabled={!on}
                    >
                      <option value="">{t("common.empty_dash")}</option>
                      {sortedCategories.map((c) => (
                        <option key={c.id} value={c.id}>
                          {c.depth ? "  ↳  " : ""}
                          {c.label}
                        </option>
                      ))}
                    </Select>
                    {cat && (
                      <span
                        className="ml-1 inline-block h-1.5 w-1.5 rounded-full"
                        style={{ backgroundColor: cat.color }}
                      />
                    )}
                  </td>
                  <td className="px-2 py-1.5">
                    <div className="flex items-center gap-1">
                      <Input
                        type="number"
                        min={0}
                        max={99}
                        value={r.installment?.[0] ?? ""}
                        onChange={(e) => {
                          const idx = parseInt(e.target.value, 10) || 0;
                          const tot = r.installment?.[1] ?? 0;
                          updateRow(i, {
                            installment: idx > 0 && tot > 0 ? [idx, Math.max(tot, idx)] : null,
                          });
                        }}
                        className="h-7 px-1 text-xs text-center w-10 tabular"
                        placeholder="—"
                        disabled={!on}
                      />
                      <span className="text-xs text-fg-subtle">/</span>
                      <Input
                        type="number"
                        min={0}
                        max={99}
                        value={r.installment?.[1] ?? ""}
                        onChange={(e) => {
                          const tot = parseInt(e.target.value, 10) || 0;
                          const idx = r.installment?.[0] ?? (tot > 0 ? 1 : 0);
                          updateRow(i, {
                            installment: idx > 0 && tot > 0 ? [Math.min(idx, tot), tot] : null,
                          });
                        }}
                        className="h-7 px-1 text-xs text-center w-10 tabular"
                        placeholder="—"
                        disabled={!on}
                      />
                    </div>
                  </td>
                  <td className="px-2 pr-6 py-1.5">
                    <Input
                      value={(r.amountCents / 100).toFixed(2).replace(".", ",")}
                      onChange={(e) => setAmountText(i, e.target.value)}
                      className="h-7 px-2 text-xs text-right tabular"
                      disabled={!on}
                    />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
