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

export interface RenameCandidate {
  tx: Transaction;
  /**
   * Why this row showed up:
   *   - "installment": shares the editing tx's installment_group_id
   *   - "same_name": same merchantClean (or description) as the editing
   *     row's *previous* name, on a different installment group
   */
  reason: "installment" | "same_name";
}

/**
 * Follow-up modal that opens after the user renames a single transaction
 * in TransactionDialog. Shows the rows that *could* receive the same
 * rename and lets the user pick which to apply it to. Defaults: all
 * checked — that's the common case ("rebrand the merchant everywhere"
 * or "the parcela got the right name, fix the rest of the group").
 */
export function BulkRenameDialog({
  open,
  onOpenChange,
  candidates,
  newDescription,
  newMerchantClean,
  onApply,
  busy,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  candidates: RenameCandidate[];
  newDescription: string;
  newMerchantClean: string | null;
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

  function toggleGroup(reason: RenameCandidate["reason"]) {
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
  const displayName =
    newMerchantClean && newMerchantClean.trim().length > 0
      ? newMerchantClean
      : newDescription;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-[560px]">
        <DialogHeader>
          <DialogTitle>{t("bulk_rename.title")}</DialogTitle>
          <DialogDescription>
            {t("bulk_rename.subtitle", { name: displayName })}
          </DialogDescription>
        </DialogHeader>

        <div className="px-5 py-3 space-y-4 overflow-auto flex-1 max-h-[60vh]">
          {installmentRows.length > 0 && (
            <Section
              icon={<Layers className="h-3.5 w-3.5" />}
              label={t("bulk_rename.section_installments")}
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
              label={t("bulk_rename.section_same_name")}
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
            {t("bulk_rename.skip")}
          </Button>
          <Button
            size="sm"
            onClick={() => onApply([...selected])}
            disabled={busy || selected.size === 0}
          >
            {busy
              ? t("common.saving")
              : t("bulk_rename.apply", { count: selected.size })}
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
