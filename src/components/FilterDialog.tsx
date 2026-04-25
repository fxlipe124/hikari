import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/Dialog";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Switch } from "@/components/ui/Switch";
import { Field } from "@/components/ui/Field";
import { useCategories } from "@/lib/queries";
import { cn } from "@/lib/utils";

export type SortBy = "date_desc" | "date_asc" | "amount_desc" | "amount_asc";

export interface FilterState {
  categoryIds: string[];
  refundOnly: boolean;
  installmentsOnly: boolean;
  uncategorizedOnly: boolean;
  virtualOnly: boolean;
  amountMin: string;
  amountMax: string;
  postedFrom: string;
  postedTo: string;
  sortBy: SortBy;
}

export const emptyFilter: FilterState = {
  categoryIds: [],
  refundOnly: false,
  installmentsOnly: false,
  uncategorizedOnly: false,
  virtualOnly: false,
  amountMin: "",
  amountMax: "",
  postedFrom: "",
  postedTo: "",
  sortBy: "date_desc",
};

export function countActiveFilters(f: FilterState): number {
  let n = 0;
  if (f.categoryIds.length) n += 1;
  if (f.refundOnly) n += 1;
  if (f.installmentsOnly) n += 1;
  if (f.uncategorizedOnly) n += 1;
  if (f.virtualOnly) n += 1;
  if (f.amountMin || f.amountMax) n += 1;
  if (f.postedFrom || f.postedTo) n += 1;
  if (f.sortBy !== "date_desc") n += 1;
  return n;
}

const SORT_OPTIONS: SortBy[] = [
  "date_desc",
  "date_asc",
  "amount_desc",
  "amount_asc",
];

export function FilterDialog({
  open,
  onOpenChange,
  filter,
  onApply,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  filter: FilterState;
  onApply: (f: FilterState) => void;
}) {
  const { t } = useTranslation();
  const { data: categories } = useCategories();
  const [draft, setDraft] = useState<FilterState>(filter);

  useEffect(() => {
    if (open) setDraft(filter);
  }, [open, filter]);

  const roots = (categories ?? []).filter((c) => !c.parentId);

  function toggleCategory(id: string) {
    setDraft((d) => ({
      ...d,
      categoryIds: d.categoryIds.includes(id)
        ? d.categoryIds.filter((x) => x !== id)
        : [...d.categoryIds, id],
    }));
  }

  function clearAll() {
    setDraft(emptyFilter);
  }

  function apply() {
    onApply(draft);
    onOpenChange(false);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-[520px]">
        <DialogHeader>
          <DialogTitle>{t("filter.title")}</DialogTitle>
        </DialogHeader>

        <div className="px-5 py-4 space-y-4 overflow-auto flex-1">
          <Field label={t("filter.categories")}>
            <div className="flex flex-wrap gap-1.5 max-h-[180px] overflow-auto">
              {roots.flatMap((root) => {
                const children = (categories ?? []).filter(
                  (c) => c.parentId === root.id,
                );
                return [root, ...children].map((c) => {
                  const active = draft.categoryIds.includes(c.id);
                  const isChild = !!c.parentId;
                  return (
                    <button
                      key={c.id}
                      type="button"
                      onClick={() => toggleCategory(c.id)}
                      className={cn(
                        "flex items-center gap-1.5 rounded-[var(--radius)] border px-2 py-1 text-xs transition-colors",
                        active
                          ? "border-accent bg-accent/10 text-accent"
                          : "border-border text-fg-muted hover:bg-surface-hover",
                        isChild && "ml-2",
                      )}
                    >
                      <span
                        className="h-1.5 w-1.5 rounded-full"
                        style={{ backgroundColor: c.color }}
                      />
                      {t(`category.${c.id}`, { defaultValue: c.name })}
                    </button>
                  );
                });
              })}
              {roots.length === 0 && (
                <span className="text-xs text-fg-subtle">
                  {t("dashboard.no_categorized")}
                </span>
              )}
            </div>
          </Field>

          <div className="space-y-2">
            <div className="flex items-center justify-between rounded-[var(--radius)] border border-border p-3">
              <span className="text-sm">{t("filter.refund_only")}</span>
              <Switch
                checked={draft.refundOnly}
                onChange={(v) => setDraft((d) => ({ ...d, refundOnly: v }))}
              />
            </div>
            <div className="flex items-center justify-between rounded-[var(--radius)] border border-border p-3">
              <span className="text-sm">{t("filter.installments_only")}</span>
              <Switch
                checked={draft.installmentsOnly}
                onChange={(v) =>
                  setDraft((d) => ({ ...d, installmentsOnly: v }))
                }
              />
            </div>
            <div className="flex items-center justify-between rounded-[var(--radius)] border border-border p-3">
              <span className="text-sm">{t("filter.uncategorized_only")}</span>
              <Switch
                checked={draft.uncategorizedOnly}
                onChange={(v) =>
                  setDraft((d) => ({ ...d, uncategorizedOnly: v }))
                }
              />
            </div>
            <div className="flex items-center justify-between rounded-[var(--radius)] border border-border p-3">
              <span className="text-sm">{t("filter.virtual_only")}</span>
              <Switch
                checked={draft.virtualOnly}
                onChange={(v) =>
                  setDraft((d) => ({ ...d, virtualOnly: v }))
                }
              />
            </div>
          </div>

          <Field label={t("filter.amount_range")}>
            <div className="flex gap-2">
              <Input
                placeholder={t("filter.amount_min")}
                value={draft.amountMin}
                onChange={(e) =>
                  setDraft((d) => ({ ...d, amountMin: e.target.value }))
                }
                inputMode="decimal"
              />
              <Input
                placeholder={t("filter.amount_max")}
                value={draft.amountMax}
                onChange={(e) =>
                  setDraft((d) => ({ ...d, amountMax: e.target.value }))
                }
                inputMode="decimal"
              />
            </div>
          </Field>

          <Field label={t("filter.date_range")}>
            <div className="flex gap-2">
              <Input
                type="date"
                value={draft.postedFrom}
                onChange={(e) =>
                  setDraft((d) => ({ ...d, postedFrom: e.target.value }))
                }
              />
              <Input
                type="date"
                value={draft.postedTo}
                onChange={(e) =>
                  setDraft((d) => ({ ...d, postedTo: e.target.value }))
                }
              />
            </div>
          </Field>

          <Field label={t("filter.sort")}>
            <div className="flex flex-wrap gap-1.5">
              {SORT_OPTIONS.map((s) => (
                <button
                  key={s}
                  type="button"
                  onClick={() => setDraft((d) => ({ ...d, sortBy: s }))}
                  className={cn(
                    "rounded-[var(--radius)] border px-2.5 py-1 text-xs transition-colors",
                    draft.sortBy === s
                      ? "border-accent bg-accent/10 text-accent"
                      : "border-border text-fg-muted hover:bg-surface-hover",
                  )}
                >
                  {t(`filter.sort_${s}`)}
                </button>
              ))}
            </div>
          </Field>
        </div>

        <DialogFooter className="justify-between">
          <Button variant="ghost" size="sm" onClick={clearAll}>
            {t("filter.clear")}
          </Button>
          <div className="flex gap-2">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => onOpenChange(false)}
            >
              {t("common.cancel")}
            </Button>
            <Button size="sm" onClick={apply}>
              {t("filter.apply")}
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
