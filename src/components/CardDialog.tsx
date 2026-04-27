import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Trash2 } from "lucide-react";
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
import {
  useCreateCard,
  useUndoableDeleteCard,
  useUndoableUpdateCardWithCascade,
  useUpdateCard,
} from "@/lib/mutations";
import { ipc } from "@/lib/ipc";
import type { Card } from "@/lib/ipc";
import { toast } from "@/lib/toast";
import { parseBRL, cn } from "@/lib/utils";

type BrandEntry = { value: string; label?: string; labelKey?: string };

const BRANDS: BrandEntry[] = [
  { value: "mastercard", label: "Mastercard" },
  { value: "visa", label: "Visa" },
  { value: "elo", label: "Elo" },
  { value: "amex", label: "American Express" },
  { value: "hipercard", label: "Hipercard" },
  { value: "outro", labelKey: "form.option.brand_other" },
];

const COLORS = [
  "#b45309", "#0ea5e9", "#7e22ce", "#16a34a", "#dc2626",
  "#0891b2", "#65a30d", "#c026d3", "#1e40af", "#475569",
];

interface FormState {
  name: string;
  brand: string;
  last4: string;
  closingDay: number;
  dueDay: number;
  color: string;
  creditLimitInput: string;
}

function emptyForm(): FormState {
  return {
    name: "",
    brand: "mastercard",
    last4: "",
    closingDay: 1,
    dueDay: 10,
    color: COLORS[0],
    creditLimitInput: "",
  };
}

function fromCard(c: Card): FormState {
  return {
    name: c.name,
    brand: c.brand,
    last4: c.last4 ?? "",
    closingDay: c.closingDay,
    dueDay: c.dueDay,
    color: c.color,
    creditLimitInput:
      c.creditLimitCents !== null
        ? (c.creditLimitCents / 100).toFixed(2).replace(".", ",")
        : "",
  };
}

export function CardDialog({
  open,
  onOpenChange,
  editing,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  editing?: Card | null;
}) {
  const { t } = useTranslation();
  const create = useCreateCard();
  const update = useUpdateCard();
  const updateWithCascade = useUndoableUpdateCardWithCascade();
  const del = useUndoableDeleteCard();
  // Init with empty state and let the effect below populate from `editing` when
  // the dialog opens. Avoids the brief first-render flash where the lazy
  // useState initializer captured a stale `editing` prop.
  const [form, setForm] = useState<FormState>(emptyForm);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setForm(editing ? fromCard(editing) : emptyForm());
      setError(null);
    }
  }, [open, editing]);

  const set = <K extends keyof FormState>(k: K, v: FormState[K]) =>
    setForm((s) => ({ ...s, [k]: v }));

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!form.name.trim()) {
      setError(t("error.name_required"));
      return;
    }
    if (form.last4 && !/^\d{4}$/.test(form.last4)) {
      setError(t("error.last4_invalid"));
      return;
    }
    if (form.closingDay < 1 || form.closingDay > 31) {
      setError(t("error.closing_day_range"));
      return;
    }
    if (form.dueDay < 1 || form.dueDay > 31) {
      setError(t("error.due_day_range"));
      return;
    }
    const limitCents = form.creditLimitInput.trim()
      ? parseBRL(form.creditLimitInput)
      : null;
    if (form.creditLimitInput.trim() && (limitCents === null || limitCents < 0)) {
      setError(t("error.limit_invalid"));
      return;
    }

    // Detect closing-day change: if the user shifted it on an existing card,
    // ask the backend to recompute statement_year_month for every tx of this
    // card. Without this flag the cascade is a no-op — preserving any
    // accurate per-statement values the import path may have stamped.
    const closingChanged =
      editing != null && form.closingDay !== editing.closingDay;

    const payload = {
      name: form.name.trim(),
      brand: form.brand,
      last4: form.last4 || null,
      closingDay: form.closingDay,
      dueDay: form.dueDay,
      color: form.color,
      creditLimitCents: limitCents,
    };

    try {
      if (editing) {
        if (closingChanged) {
          // Capture the affected tx list *before* the cascade fires so the
          // undo wrapper can replay each row's exact prior
          // statement_year_month — the cascade unconditionally re-derives
          // SY_M from posted_at + closing_day, which would clobber any
          // value the import path had hand-stamped from a Sofisa header.
          const allTxs = await ipc.transactions.list();
          const cardTransactions = allTxs.filter((tx) => tx.cardId === editing.id);
          await updateWithCascade.mutateAsync({
            original: editing,
            cardTransactions,
            patch: { ...payload, recomputeStatements: true },
          });
        } else {
          await update.mutateAsync({ id: editing.id, patch: payload });
          toast.success(t("toast.card_updated"));
        }
      } else {
        await create.mutateAsync(payload);
        toast.success(t("toast.card_created"));
      }
      onOpenChange(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      toast.fromError(e, t("toast.card_save_failed"));
    }
  }

  async function onDelete() {
    if (!editing) return;
    if (!window.confirm(t("dialog.card.delete_confirm"))) return;
    try {
      // Snapshot the cascade footprint before delete so undo can rebuild the
      // card AND every transaction it owned. Cheap fetch (the backend list
      // returns the full table; cards rarely have >10k rows).
      const allTxs = await ipc.transactions.list();
      const cardTransactions = allTxs.filter((tx) => tx.cardId === editing.id);
      await del.mutateAsync({ card: editing, cardTransactions });
      onOpenChange(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      toast.fromError(e, t("toast.card_delete_failed"));
    }
  }

  const busy =
    create.isPending ||
    update.isPending ||
    updateWithCascade.isPending ||
    del.isPending;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-[480px]">
        <DialogHeader>
          <DialogTitle>{editing ? t("dialog.card.edit_title") : t("dialog.card.new_title")}</DialogTitle>
        </DialogHeader>

        <form onSubmit={onSubmit} className="px-5 py-4 space-y-3 overflow-auto flex-1">
          <FieldRow>
            <Field label={t("form.label.name")}>
              <Input
                value={form.name}
                onChange={(e) => set("name", e.target.value)}
                placeholder={t("form.placeholder.card_name")}
                autoFocus
              />
            </Field>
            <Field label={t("form.label.brand")}>
              <Select value={form.brand} onChange={(e) => set("brand", e.target.value)}>
                {BRANDS.map((b) => (
                  <option key={b.value} value={b.value}>
                    {b.label ?? (b.labelKey ? t(b.labelKey) : b.value)}
                  </option>
                ))}
              </Select>
            </Field>
          </FieldRow>

          <FieldRow>
            <Field label={t("form.label.last4")} hint={t("form.hint.optional")}>
              <Input
                value={form.last4}
                onChange={(e) => set("last4", e.target.value.replace(/\D/g, "").slice(0, 4))}
                placeholder={t("form.placeholder.last4")}
                inputMode="numeric"
              />
            </Field>
            <Field label={t("form.label.credit_limit")} hint={t("form.hint.optional")}>
              <Input
                value={form.creditLimitInput}
                onChange={(e) => set("creditLimitInput", e.target.value)}
                placeholder={t("form.placeholder.limit")}
                inputMode="decimal"
              />
            </Field>
          </FieldRow>

          <FieldRow>
            <Field label={t("form.label.closing_day")}>
              <Input
                type="number"
                min={1}
                max={31}
                value={form.closingDay}
                onChange={(e) => set("closingDay", Number(e.target.value))}
              />
            </Field>
            <Field label={t("form.label.due_day")}>
              <Input
                type="number"
                min={1}
                max={31}
                value={form.dueDay}
                onChange={(e) => set("dueDay", Number(e.target.value))}
              />
            </Field>
          </FieldRow>

          <Field label={t("form.label.color")}>
            <div className="flex flex-wrap gap-2">
              {COLORS.map((c) => (
                <button
                  key={c}
                  type="button"
                  onClick={() => set("color", c)}
                  className={cn(
                    "h-7 w-7 rounded-full border-2 transition-transform",
                    form.color === c
                      ? "border-fg scale-110"
                      : "border-transparent hover:scale-105"
                  )}
                  style={{ backgroundColor: c }}
                  title={c}
                />
              ))}
            </div>
          </Field>

          {error && <p className="text-xs text-danger">{error}</p>}
        </form>

        <DialogFooter className="justify-between">
          <div>
            {editing && (
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
  );
}
