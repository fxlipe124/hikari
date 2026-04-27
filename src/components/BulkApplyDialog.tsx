import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Layers, Tag } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/Dialog";
import { Button } from "@/components/ui/Button";
import type { Transaction } from "@/lib/ipc";
import { cn, formatDate, useFormatMoney } from "@/lib/utils";

export type BulkApplyReason = "installment" | "same_name";

export interface BulkCandidate {
  tx: Transaction;
  /**
   * Why this row showed up:
   *   - "installment": shares the editing tx's installment_group_id
   *   - "same_name": same merchantClean (or description) as the editing
   *     row's *previous* name, on a different installment group
   */
  reason: BulkApplyReason;
}

/**
 * What's about to be applied to each selected candidate. Mirrors the
 * shape of the backend's BulkPatch — only fields the user actually
 * changed should be set, so we don't trample unrelated columns.
 */
export interface BulkChange {
  description?: string;
  /** explicit null clears the field; undefined leaves it alone */
  merchantClean?: string | null;
  /** explicit null clears the category; undefined leaves it alone */
  categoryId?: string | null;
  /** Display label for the new category (used in the dialog header). */
  categoryLabel?: string | null;
}

/**
 * Follow-up modal for cascading a single-row edit onto related rows.
 * Two intents:
 *   - "apply" (default): rename / categorize cascade after a save.
 *     Caller's onApply hits transactions_bulk_update.
 *   - "delete": cascade a deletion. Caller's onApply hits
 *     transactions_bulk_remove. The button turns danger-red and the
 *     copy says "Delete N selected" instead of "Apply".
 * Defaults all candidates checked since the common case is
 * "apply / delete everywhere".
 */
export function BulkApplyDialog({
  open,
  onOpenChange,
  candidates,
  change,
  intent = "apply",
  onApply,
  busy,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  candidates: BulkCandidate[];
  change: BulkChange;
  intent?: "apply" | "delete";
  onApply: (selectedIds: string[]) => Promise<void>;
  busy?: boolean;
}) {
  const { t } = useTranslation();
  const formatMoney = useFormatMoney();
  const [selected, setSelected] = useState<Set<string>>(() => new Set());

  // Reset the checkbox state every time the dialog reopens with a new
  // candidate set — otherwise stale ids from a previous edit linger.
  useEffect(() => {
    if (open) {
      setSelected(new Set(candidates.map((c) => c.tx.id)));
    }
  }, [open, candidates]);

  function toggle(id: string) {
    setSelected((s) => {
      const next = new Set(s);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleGroup(reason: BulkApplyReason) {
    const groupIds = candidates.filter((c) => c.reason === reason).map((c) => c.tx.id);
    const allSelected = groupIds.every((id) => selected.has(id));
    setSelected((s) => {
      const next = new Set(s);
      for (const id of groupIds) {
        if (allSelected) next.delete(id);
        else next.add(id);
      }
      return next;
    });
  }

  const installmentRows = candidates.filter((c) => c.reason === "installment");
  const sameNameRows = candidates.filter((c) => c.reason === "same_name");

  // Build a one-line summary of what's about to be applied so the user
  // can sanity-check before committing. Inlined so the i18next `t` is in
  // scope without juggling its TFunction signature.
  const summaryParts: string[] = [];
  const newName =
    change.merchantClean !== undefined &&
    change.merchantClean !== null &&
    change.merchantClean.trim().length > 0
      ? change.merchantClean
      : change.description;
  if (newName) {
    summaryParts.push(t("bulk_apply.summary_rename", { name: newName }));
  }
  if (change.categoryId !== undefined) {
    summaryParts.push(
      t("bulk_apply.summary_category", {
        category: change.categoryLabel ?? t("bulk_apply.summary_no_category"),
      }),
    );
  }
  const summary = summaryParts.join(" · ");
  const hasRename = change.description != null || change.merchantClean !== undefined;
  const hasCategory = change.categoryId !== undefined;
  const titleKey =
    intent === "delete"
      ? "bulk_apply.title_delete"
      : hasRename && hasCategory
        ? "bulk_apply.title_combined"
        : hasCategory
          ? "bulk_apply.title_category"
          : "bulk_apply.title_rename";
  const subtitleKey =
    intent === "delete" ? "bulk_apply.subtitle_delete" : "bulk_apply.subtitle";

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-[560px]">
        <DialogHeader>
          <DialogTitle>{t(titleKey)}</DialogTitle>
          <DialogDescription>
            {t(subtitleKey, { summary })}
          </DialogDescription>
        </DialogHeader>

        <div className="px-5 py-3 space-y-4 overflow-auto flex-1 max-h-[60vh]">
          {installmentRows.length > 0 && (
            <Section
              icon={<Layers className="h-3.5 w-3.5" />}
              label={t("bulk_apply.section_installments")}
              count={installmentRows.length}
              allSelected={installmentRows.every((c) => selected.has(c.tx.id))}
              onToggleAll={() => toggleGroup("installment")}
            >
              {installmentRows.map((c) => (
                <Row
                  key={c.tx.id}
                  tx={c.tx}
                  checked={selected.has(c.tx.id)}
                  onToggle={() => toggle(c.tx.id)}
                  formatMoney={formatMoney}
                />
              ))}
            </Section>
          )}
          {sameNameRows.length > 0 && (
            <Section
              icon={<Tag className="h-3.5 w-3.5" />}
              label={t("bulk_apply.section_same_name")}
              count={sameNameRows.length}
              allSelected={sameNameRows.every((c) => selected.has(c.tx.id))}
              onToggleAll={() => toggleGroup("same_name")}
            >
              {sameNameRows.map((c) => (
                <Row
                  key={c.tx.id}
                  tx={c.tx}
                  checked={selected.has(c.tx.id)}
                  onToggle={() => toggle(c.tx.id)}
                  formatMoney={formatMoney}
                />
              ))}
            </Section>
          )}
        </div>

        <DialogFooter>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => onOpenChange(false)}
            disabled={busy}
          >
            {t("bulk_apply.skip")}
          </Button>
          <Button
            size="sm"
            onClick={() => onApply([...selected])}
            disabled={busy || selected.size === 0}
            className={
              intent === "delete"
                ? "bg-danger text-danger-fg hover:bg-danger/90"
                : undefined
            }
          >
            {busy
              ? t("common.saving")
              : intent === "delete"
                ? t("bulk_apply.delete_action", { count: selected.size })
                : t("bulk_apply.apply", { count: selected.size })}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function Section({
  icon,
  label,
  count,
  allSelected,
  onToggleAll,
  children,
}: {
  icon: React.ReactNode;
  label: string;
  count: number;
  allSelected: boolean;
  onToggleAll: () => void;
  children: React.ReactNode;
}) {
  return (
    <div>
      <div className="flex items-center justify-between mb-1.5">
        <div className="flex items-center gap-1.5 text-xs font-medium text-fg-muted uppercase tracking-wide">
          {icon}
          <span>{label}</span>
          <span className="text-fg-subtle tabular">({count})</span>
        </div>
        <button
          type="button"
          onClick={onToggleAll}
          className="text-[10px] uppercase tracking-wide text-accent hover:underline"
        >
          {allSelected ? "−" : "+"}
        </button>
      </div>
      <div className="space-y-0.5">{children}</div>
    </div>
  );
}

function Row({
  tx,
  checked,
  onToggle,
  formatMoney,
}: {
  tx: Transaction;
  checked: boolean;
  onToggle: () => void;
  formatMoney: (cents: number) => string;
}) {
  const name = tx.merchantClean ?? tx.description;
  const installmentLabel =
    tx.installmentTotal && tx.installmentIndex
      ? ` · ${tx.installmentIndex}/${tx.installmentTotal}`
      : "";
  return (
    <label
      className={cn(
        "flex items-center gap-2 rounded-[var(--radius)] px-2 py-1.5 text-xs cursor-pointer",
        "hover:bg-surface-hover transition-colors",
        checked ? "bg-accent/5" : "",
      )}
    >
      <input
        type="checkbox"
        checked={checked}
        onChange={onToggle}
        className="h-3.5 w-3.5 accent-accent"
      />
      <span className="text-fg-muted tabular w-16 shrink-0">
        {formatDate(tx.postedAt, "day")}
      </span>
      <span className="flex-1 truncate text-fg">
        {name}
        {installmentLabel && (
          <span className="text-fg-subtle tabular">{installmentLabel}</span>
        )}
      </span>
      <span className="text-fg-subtle tabular shrink-0">
        {formatMoney(tx.amountCents)}
      </span>
    </label>
  );
}
