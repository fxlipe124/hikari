import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Copy, Trash2 } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/Dialog";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Select } from "@/components/ui/Select";
import { Field, FieldRow } from "@/components/ui/Field";
import { Switch } from "@/components/ui/Switch";
import {
  BulkApplyDialog,
  type BulkCandidate,
  type BulkChange,
} from "@/components/BulkApplyDialog";
import { useCards, useCategories, useTransactions } from "@/lib/queries";
import {
  useCreateTransaction,
  useUpdateTransaction,
  useUndoableBulkRemoveTransactions,
  useUndoableBulkUpdateTransactions,
  useUndoableDeleteTransaction,
  useUndoableUpdateTransaction,
} from "@/lib/mutations";
import type { Transaction } from "@/lib/ipc";
import { toast } from "@/lib/toast";
import { currentYearMonth, formatMoney, parseMoney } from "@/lib/utils";
import { useCurrencyStore } from "@/hooks/useCurrencyStore";

interface FormState {
  cardId: string;
  postedAt: string;
  description: string;
  merchantClean: string;
  amountInput: string;
  categoryId: string | null;
  notes: string;
  isInstallment: boolean;
  installmentIndex: number;
  installmentTotal: number;
  isRefund: boolean;
}

function emptyForm(defaultCardId: string | null): FormState {
  const ym = currentYearMonth();
  const today = `${ym}-${String(new Date().getDate()).padStart(2, "0")}`;
  return {
    cardId: defaultCardId ?? "",
    postedAt: today,
    description: "",
    merchantClean: "",
    amountInput: "",
    categoryId: null,
    notes: "",
    isInstallment: false,
    installmentIndex: 1,
    installmentTotal: 2,
    isRefund: false,
  };
}

// Lower-case the user-facing name (merchantClean if set, else description),
// trimmed, so two rows that differ only in case/whitespace are still
// considered the same merchant for rename-cascade purposes.
function nameKey(tx: Transaction | { merchantClean: string | null; description: string }): string {
  const raw = (tx.merchantClean ?? tx.description ?? "").trim();
  return raw.toLowerCase();
}

/**
 * Find transactions that share enough identity with the just-edited row
 * to deserve a bulk-apply prompt. Two reasons can make a row a
 * candidate:
 *   - It belongs to the same installment_group_id (parcela of the same
 *     purchase plan; almost always the user wants the change to apply).
 *   - It has the same name (merchantClean or description) as the row's
 *     *previous* state — useful both for renames ("AMAZON.COM*BR-9X7"
 *     → "Amazon" everywhere) and for category sweeps (assigning a
 *     category to one row of a recurring merchant should offer to fix
 *     the rest).
 * Excludes the edited row itself. The two reasons are deduped so a
 * parcela that also matches by name doesn't show up twice.
 */
function findBulkCandidates(
  edited: Transaction,
  pool: Transaction[],
): BulkCandidate[] {
  const out: BulkCandidate[] = [];
  const seen = new Set<string>([edited.id]);
  if (edited.installmentGroupId) {
    for (const tx of pool) {
      if (seen.has(tx.id)) continue;
      if (tx.installmentGroupId === edited.installmentGroupId) {
        out.push({ tx, reason: "installment" });
        seen.add(tx.id);
      }
    }
  }
  const oldKey = nameKey(edited);
  if (oldKey.length > 0) {
    for (const tx of pool) {
      if (seen.has(tx.id)) continue;
      if (nameKey(tx) === oldKey) {
        out.push({ tx, reason: "same_name" });
        seen.add(tx.id);
      }
    }
  }
  return out;
}

// Shift a YYYY-MM-DD or full ISO date forward by `months`, clamping the day
// when the target month is shorter (e.g. Jan 31 + 1 month → Feb 28/29).
function shiftIsoByMonths(iso: string, months: number): string {
  if (months === 0) return iso;
  const [datePart, timePart] = iso.split("T");
  const [y, m, d] = datePart.split("-").map(Number);
  // Probe day 1 first so JS Date doesn't roll over (Date(2024, 1, 31) → Mar 2).
  const target = new Date(y, m - 1 + months, 1);
  const lastDay = new Date(target.getFullYear(), target.getMonth() + 1, 0).getDate();
  target.setDate(Math.min(d, lastDay));
  const yyyy = String(target.getFullYear()).padStart(4, "0");
  const mm = String(target.getMonth() + 1).padStart(2, "0");
  const dd = String(target.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}${timePart ? "T" + timePart : ""}`;
}

function fromTx(tx: Transaction): FormState {
  // Strip every currency symbol and grouping separator so the value lands in
  // the input as a plain locale-aware number.
  const amountInput = formatMoney(tx.amountCents).replace(/[^\d.,-]/g, "").trim();
  return {
    cardId: tx.cardId,
    postedAt: tx.postedAt.slice(0, 10),
    description: tx.description,
    merchantClean: tx.merchantClean ?? "",
    amountInput,
    categoryId: tx.categoryId,
    notes: tx.notes ?? "",
    isInstallment: tx.installmentTotal !== null,
    installmentIndex: tx.installmentIndex ?? 1,
    installmentTotal: tx.installmentTotal ?? 2,
    isRefund: tx.isRefund,
  };
}

export function TransactionDialog({
  open,
  onOpenChange,
  editing,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  editing?: Transaction | null;
}) {
  const { t } = useTranslation();
  const { data: cards } = useCards();
  const { data: categories } = useCategories();
  // We need every transaction (no card / month filter) so we can build the
  // rename-cascade candidate list — the user might want the rename to
  // propagate across months/cards. The hook key is unique enough that this
  // doesn't fight with the screen's primary list query.
  const { data: allTxs } = useTransactions();
  const create = useCreateTransaction();
  const update = useUpdateTransaction();
  const undoableUpdate = useUndoableUpdateTransaction();
  const undoableDelete = useUndoableDeleteTransaction();
  const undoableBulkUpdate = useUndoableBulkUpdateTransactions();
  const undoableBulkRemove = useUndoableBulkRemoveTransactions();

  const [form, setForm] = useState<FormState>(() =>
    editing ? fromTx(editing) : emptyForm(cards?.[0]?.id ?? null)
  );
  const [error, setError] = useState<string | null>(null);

  // Follow-up modal state. Set after a save where description/merchantClean
  // and/or categoryId changed AND there are related rows to offer the same
  // change to. Also reused on delete to offer cascading the deletion across
  // related parcelas / same-name rows — `intent` switches dialog copy and
  // the action callback.
  const [bulkContext, setBulkContext] = useState<{
    candidates: BulkCandidate[];
    change: BulkChange;
    intent: "apply" | "delete";
    /** For delete: the editing row's id, deleted alongside selected ones. */
    primaryId?: string;
  } | null>(null);

  useEffect(() => {
    if (open) {
      setForm(editing ? fromTx(editing) : emptyForm(cards?.[0]?.id ?? null));
      setError(null);
    }
  }, [open, editing, cards]);

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

  const set = <K extends keyof FormState>(k: K, v: FormState[K]) =>
    setForm((s) => ({ ...s, [k]: v }));

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    const cents = parseMoney(form.amountInput);
    if (cents === null || cents <= 0) {
      setError(t("error.invalid_amount"));
      return;
    }
    if (!form.cardId) {
      setError(t("error.card_required"));
      return;
    }
    if (!form.description.trim()) {
      setError(t("error.description_required"));
      return;
    }
    if (form.isInstallment) {
      if (
        form.installmentTotal < 2 ||
        form.installmentIndex < 1 ||
        form.installmentIndex > form.installmentTotal
      ) {
        setError(t("error.invalid_installments"));
        return;
      }
    }

    const postedAtIso = `${form.postedAt}T00:00:00Z`;

    const basePayload = {
      cardId: form.cardId,
      postedAt: postedAtIso,
      description: form.description.trim(),
      merchantClean: form.merchantClean.trim() || null,
      amountCents: cents,
      currency: useCurrencyStore.getState().currency,
      fxRate: null,
      categoryId: form.categoryId,
      notes: form.notes.trim() || null,
      installmentGroupId: editing?.installmentGroupId ?? null,
      installmentIndex: form.isInstallment ? form.installmentIndex : null,
      installmentTotal: form.isInstallment ? form.installmentTotal : null,
      isRefund: form.isRefund,
      // Virtual-card flag is set automatically by the import parsers; manual
      // entries default to false. When editing an existing tx, preserve the
      // value that was tagged at import time.
      isVirtualCard: editing?.isVirtualCard ?? false,
      sourceImportId: editing?.sourceImportId ?? null,
    };

    // Spawning the *future* installments — used by both "create new k/N
    // purchase" and "edit existing single tx into k/N purchase" paths.
    async function spawnFutureRows(
      groupId: string,
      startIdxExclusive: number,
      totalIdx: number,
    ) {
      let n = 0;
      for (let idx = startIdxExclusive + 1; idx <= totalIdx; idx += 1) {
        const offset = idx - startIdxExclusive;
        await create.mutateAsync({
          ...basePayload,
          postedAt: shiftIsoByMonths(postedAtIso, offset),
          installmentGroupId: groupId,
          installmentIndex: idx,
        });
        n += 1;
      }
      return n;
    }

    try {
      if (editing) {
        // If the user is "promoting" a previously-single tx into an
        // installment purchase (was no group, now isInstallment with k<N),
        // attach a fresh group_id to this row AND spawn rows k+1..N. Just
        // updating the row would leave 9 missing months of a 10x — the
        // exact bug the cascade was meant to fix.
        const wasNotInstallment = editing.installmentGroupId == null;
        const promoting =
          wasNotInstallment &&
          form.isInstallment &&
          form.installmentIndex < form.installmentTotal;
        if (promoting) {
          const groupId = crypto.randomUUID();
          await update.mutateAsync({
            id: editing.id,
            patch: { ...basePayload, installmentGroupId: groupId },
          });
          const spawned = await spawnFutureRows(
            groupId,
            form.installmentIndex,
            form.installmentTotal,
          );
          toast.success(
            t("toast.installments_created", { count: spawned + 1 }),
          );
        } else {
          await undoableUpdate.mutateAsync({
            original: editing,
            patch: basePayload,
          });
          // After a successful save, look for related rows that probably
          // want the same change applied:
          //  - other parcelas in the same installment_group_id
          //  - other purchases with the *previous* name (lets the user
          //    rebrand "AMAZON.COM*BR-3DXJ" → "Amazon" everywhere, or
          //    sweep a category onto every "Spotify" row at once)
          // Trigger when description/merchantClean or categoryId changed.
          const renamed =
            basePayload.description !== editing.description ||
            basePayload.merchantClean !== editing.merchantClean;
          const recategorized = basePayload.categoryId !== editing.categoryId;
          const change: BulkChange = {};
          if (renamed) {
            change.description = basePayload.description;
            change.merchantClean = basePayload.merchantClean;
          }
          if (recategorized) {
            change.categoryId = basePayload.categoryId;
            const cat = categories?.find((c) => c.id === basePayload.categoryId);
            change.categoryLabel = cat
              ? t(`category.${cat.id}`, { defaultValue: cat.name })
              : null;
          }
          const candidates =
            renamed || recategorized ? findBulkCandidates(editing, allTxs ?? []) : [];
          if (candidates.length > 0) {
            setBulkContext({ candidates, change, intent: "apply" });
            // Keep the editor dialog open beneath; BulkApplyDialog stacks
            // on top. Once the user picks an option there, we close both.
            return;
          }
        }
      } else if (form.isInstallment && form.installmentIndex < form.installmentTotal) {
        // New k/N purchase: create the user-entered row k, then cascade
        // k+1..N — each on the same day in the following months, all
        // sharing one installment_group_id.
        const groupId = crypto.randomUUID();
        await create.mutateAsync({
          ...basePayload,
          installmentGroupId: groupId,
        });
        const spawned = await spawnFutureRows(
          groupId,
          form.installmentIndex,
          form.installmentTotal,
        );
        toast.success(
          t("toast.installments_created", { count: spawned + 1 }),
        );
      } else {
        await create.mutateAsync(basePayload);
        toast.success(t("toast.transaction_created"));
      }
      onOpenChange(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      toast.fromError(e, t("toast.transaction_save_failed"));
    }
  }

  async function onDelete() {
    if (!editing) return;
    // If there are related rows (other parcelas of the same purchase, or
    // other transactions with the same name), defer the delete to
    // BulkApplyDialog with intent="delete" so the user can pick which
    // related rows to drop alongside this one. With no candidates we fall
    // back to the simple confirm-then-delete flow.
    const candidates = findBulkCandidates(editing, allTxs ?? []);
    if (candidates.length > 0) {
      setBulkContext({
        candidates,
        change: {},
        intent: "delete",
        primaryId: editing.id,
      });
      return;
    }
    if (!window.confirm(t("dialog.transaction.delete_confirm"))) return;
    try {
      await undoableDelete.mutateAsync(editing);
      onOpenChange(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      toast.fromError(e, t("toast.transaction_delete_failed"));
    }
  }

  async function onDuplicate() {
    if (!editing) return;
    setError(null);
    // Snapshot the form so any tweaks the user made before clicking Duplicate
    // land on the new row. Reset identity-bound fields: fresh tx, never part
    // of the original installment group, and not tied to the source import
    // (otherwise the dedup hash check would skip it on the next re-import).
    const cents = parseMoney(form.amountInput);
    if (cents === null || cents <= 0) {
      setError(t("error.invalid_amount"));
      return;
    }
    if (!form.cardId) {
      setError(t("error.card_required"));
      return;
    }
    if (!form.description.trim()) {
      setError(t("error.description_required"));
      return;
    }
    try {
      await create.mutateAsync({
        cardId: form.cardId,
        postedAt: `${form.postedAt}T00:00:00Z`,
        description: form.description.trim(),
        merchantClean: form.merchantClean.trim() || null,
        amountCents: cents,
        currency: useCurrencyStore.getState().currency,
        fxRate: null,
        categoryId: form.categoryId,
        notes: form.notes.trim() || null,
        installmentGroupId: null,
        installmentIndex: null,
        installmentTotal: null,
        isRefund: form.isRefund,
        isVirtualCard: editing.isVirtualCard,
        sourceImportId: null,
      });
      toast.success(t("toast.transaction_duplicated"));
      onOpenChange(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      toast.fromError(e, t("toast.transaction_save_failed"));
    }
  }

  const busy =
    create.isPending ||
    update.isPending ||
    undoableUpdate.isPending ||
    undoableDelete.isPending;

  async function applyBulkChange(selectedIds: string[]) {
    if (!bulkContext) return;
    try {
      if (bulkContext.intent === "delete") {
        // Delete the editing row plus any related rows the user kept
        // checked. Even if nothing else is selected we still want the
        // primary row gone — that's what the user clicked Delete for.
        const ids = bulkContext.primaryId
          ? [bulkContext.primaryId, ...selectedIds]
          : selectedIds;
        if (ids.length === 0) {
          setBulkContext(null);
          onOpenChange(false);
          return;
        }
        const rows = (allTxs ?? []).filter((x) => ids.includes(x.id));
        await undoableBulkRemove.mutateAsync(rows);
        setBulkContext(null);
        onOpenChange(false);
        return;
      }
      if (selectedIds.length === 0) {
        setBulkContext(null);
        onOpenChange(false);
        return;
      }
      const change = bulkContext.change;
      // Strip the display-only categoryLabel before sending to the
      // backend — it's not a column.
      const { categoryLabel: _, ...patch } = change;
      const rows = (allTxs ?? []).filter((x) => selectedIds.includes(x.id));
      await undoableBulkUpdate.mutateAsync({ rows, patch });
    } catch (e) {
      toast.fromError(e, t("toast.transaction_save_failed"));
    } finally {
      setBulkContext(null);
      onOpenChange(false);
    }
  }

  return (
    <>
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-[520px]">
        <DialogHeader>
          <DialogTitle>{editing ? t("dialog.transaction.edit_title") : t("dialog.transaction.new_title")}</DialogTitle>
        </DialogHeader>

        <form onSubmit={onSubmit} className="px-5 py-4 space-y-3 overflow-auto flex-1">
          <FieldRow>
            <Field label={t("form.label.card")}>
              <Select value={form.cardId} onChange={(e) => set("cardId", e.target.value)}>
                <option value="">{t("form.option.choose")}</option>
                {(cards ?? []).map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label={t("form.label.date")}>
              <Input
                type="date"
                value={form.postedAt}
                onChange={(e) => set("postedAt", e.target.value)}
              />
            </Field>
          </FieldRow>

          <Field label={t("form.label.description")}>
            <Input
              value={form.description}
              onChange={(e) => set("description", e.target.value)}
              placeholder={t("form.placeholder.transaction_desc")}
              autoFocus
            />
          </Field>

          <FieldRow>
            <Field label={t("form.label.merchant_clean")} hint={t("form.hint.optional_display")}>
              <Input
                value={form.merchantClean}
                onChange={(e) => set("merchantClean", e.target.value)}
                placeholder={t("form.placeholder.merchant_name")}
              />
            </Field>
            <Field label={t("form.label.amount")}>
              <Input
                value={form.amountInput}
                onChange={(e) => set("amountInput", e.target.value)}
                placeholder={t("form.placeholder.amount_simple")}
                inputMode="decimal"
              />
            </Field>
          </FieldRow>

          <Field label={t("form.label.category")}>
            <Select
              value={form.categoryId ?? ""}
              onChange={(e) => set("categoryId", e.target.value || null)}
            >
              <option value="">{t("form.option.no_category")}</option>
              {sortedCategories.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.depth ? "  ↳  " : ""}{c.label}
                </option>
              ))}
            </Select>
          </Field>

          <div className="rounded-[var(--radius)] border border-border p-3 space-y-3">
            <div className="flex items-center justify-between">
              <div>
                <div className="text-sm font-medium">{t("form.label.installment")}</div>
                <div className="text-xs text-fg-subtle">
                  {t("form.description.installment")}
                </div>
              </div>
              <Switch
                checked={form.isInstallment}
                onChange={(v) => set("isInstallment", v)}
              />
            </div>
            {form.isInstallment && (
              <>
                <FieldRow>
                  <Field label={t("form.label.current_installment")}>
                    <Input
                      type="number"
                      min={1}
                      max={form.installmentTotal}
                      value={form.installmentIndex}
                      onChange={(e) => set("installmentIndex", Number(e.target.value))}
                    />
                  </Field>
                  <Field label={t("form.label.total_installments")}>
                    <Input
                      type="number"
                      min={2}
                      max={99}
                      value={form.installmentTotal}
                      onChange={(e) => set("installmentTotal", Number(e.target.value))}
                    />
                  </Field>
                </FieldRow>
                {form.installmentIndex < form.installmentTotal &&
                  (!editing || editing.installmentGroupId == null) && (
                    <p className="text-[10px] text-fg-subtle">
                      {t("form.hint.installment_cascade", {
                        count:
                          form.installmentTotal - form.installmentIndex + 1,
                      })}
                    </p>
                  )}
              </>
            )}
          </div>

          <Field label={t("form.label.notes")} hint={t("form.hint.optional")}>
            <textarea
              value={form.notes}
              onChange={(e) => set("notes", e.target.value)}
              rows={2}
              className="selectable w-full resize-none rounded-[var(--radius)] border border-border bg-surface px-3 py-2 text-sm text-fg placeholder:text-fg-subtle focus:outline-none focus:border-accent focus:ring-2 focus:ring-accent/20"
            />
          </Field>

          <div className="flex items-center justify-between rounded-[var(--radius)] border border-border p-3">
            <div>
              <div className="text-sm font-medium">{t("form.label.refund")}</div>
              <div className="text-xs text-fg-subtle">{t("form.description.refund")}</div>
            </div>
            <Switch
              checked={form.isRefund}
              onChange={(v) => set("isRefund", v)}
            />
          </div>

          {error && <p className="text-xs text-danger">{error}</p>}
        </form>

        <DialogFooter className="justify-between">
          <div className="flex gap-2">
            {editing && (
              <>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={onDelete}
                  disabled={busy}
                  className="text-danger hover:bg-danger/10"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                  {t("common.delete")}
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={onDuplicate}
                  disabled={busy}
                >
                  <Copy className="h-3.5 w-3.5" />
                  {t("common.duplicate")}
                </Button>
              </>
            )}
          </div>
          <div className="flex gap-2">
            <Button variant="ghost" size="sm" onClick={() => onOpenChange(false)} disabled={busy}>
              {t("common.cancel")}
            </Button>
            <Button size="sm" onClick={onSubmit} disabled={busy}>
              {busy ? t("common.saving") : editing ? t("common.save") : t("common.create")}
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
    {bulkContext && (
      <BulkApplyDialog
        open={bulkContext !== null}
        onOpenChange={(o) => {
          if (!o) {
            setBulkContext(null);
            onOpenChange(false);
          }
        }}
        candidates={bulkContext.candidates}
        change={bulkContext.change}
        intent={bulkContext.intent}
        onApply={applyBulkChange}
        busy={undoableBulkUpdate.isPending || undoableBulkRemove.isPending}
      />
    )}
  </>);
}
