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
import { useCategories } from "@/lib/queries";
import {
  useCreateCategory,
  useDeleteCategory,
  useUpdateCategory,
} from "@/lib/mutations";
import type { Category } from "@/lib/ipc";
import { toast } from "@/lib/toast";
import { cn } from "@/lib/utils";

const COLORS = [
  "#ea580c", "#dc2626", "#16a34a", "#2563eb", "#1e40af", "#1d4ed8",
  "#9333ea", "#e11d48", "#65a30d", "#c026d3", "#0891b2", "#64748b",
];

const ICONS = [
  "circle-dashed", "utensils", "shopping-cart", "shopping-bag", "car",
  "fuel", "car-taxi-front", "bike", "home", "heart-pulse", "ticket",
  "repeat", "gift", "graduation-cap", "plane", "wrench",
];

export function CategoryDialog({
  open,
  onOpenChange,
  defaultParentId,
  editing,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  defaultParentId?: string | null;
  editing?: Category | null;
}) {
  const { t } = useTranslation();
  const { data: categories } = useCategories();
  const create = useCreateCategory();
  const update = useUpdateCategory();
  const del = useDeleteCategory();

  const [form, setForm] = useState({
    name: "",
    icon: "circle-dashed",
    color: COLORS[11],
    parentId: defaultParentId ?? null,
  });
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      if (editing) {
        setForm({
          name: t(`category.${editing.id}`, { defaultValue: editing.name }) as string,
          icon: editing.icon,
          color: editing.color,
          parentId: editing.parentId,
        });
      } else {
        setForm({
          name: "",
          icon: "circle-dashed",
          color: COLORS[11],
          parentId: defaultParentId ?? null,
        });
      }
      setError(null);
    }
  }, [open, editing, defaultParentId, t]);

  const roots = (categories ?? []).filter(
    (c) => !c.parentId && c.id !== editing?.id,
  );

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!form.name.trim()) {
      setError(t("error.name_required"));
      return;
    }
    try {
      if (editing) {
        await update.mutateAsync({
          id: editing.id,
          patch: {
            name: form.name.trim(),
            icon: form.icon,
            color: form.color,
            parentId: form.parentId,
          },
        });
        toast.success(t("toast.category_updated"));
      } else {
        await create.mutateAsync({
          name: form.name.trim(),
          icon: form.icon,
          color: form.color,
          parentId: form.parentId,
        });
        toast.success(t("toast.category_created"));
      }
      onOpenChange(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      toast.fromError(
        e,
        editing ? t("toast.category_save_failed") : t("toast.category_create_failed"),
      );
    }
  }

  async function onDelete() {
    if (!editing) return;
    if (!window.confirm(t("dialog.category.delete_confirm"))) return;
    try {
      await del.mutateAsync(editing.id);
      toast.success(t("toast.category_deleted"));
      onOpenChange(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      toast.fromError(e, t("toast.category_delete_failed"));
    }
  }

  const busy = create.isPending || update.isPending || del.isPending;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-[440px]">
        <DialogHeader>
          <DialogTitle>{editing ? t("dialog.category.edit_title") : t("dialog.category.new_title")}</DialogTitle>
        </DialogHeader>

        <form onSubmit={onSubmit} className="px-5 py-4 space-y-3 overflow-auto flex-1">
          <FieldRow>
            <Field label={t("form.label.name")}>
              <Input
                value={form.name}
                onChange={(e) => setForm((s) => ({ ...s, name: e.target.value }))}
                placeholder={t("form.placeholder.category_name")}
                autoFocus
              />
            </Field>
            <Field label={t("form.label.parent_category")}>
              <Select
                value={form.parentId ?? ""}
                onChange={(e) =>
                  setForm((s) => ({
                    ...s,
                    parentId: e.target.value || null,
                  }))
                }
              >
                <option value="">{t("form.option.root")}</option>
                {roots.map((c) => (
                  <option key={c.id} value={c.id}>
                    {t(`category.${c.id}`, { defaultValue: c.name })}
                  </option>
                ))}
              </Select>
            </Field>
          </FieldRow>

          <Field label={t("form.label.color")}>
            <div className="flex flex-wrap gap-2">
              {COLORS.map((c) => (
                <button
                  key={c}
                  type="button"
                  onClick={() => setForm((s) => ({ ...s, color: c }))}
                  className={cn(
                    "h-7 w-7 rounded-full border-2 transition-transform",
                    form.color === c
                      ? "border-fg scale-110"
                      : "border-transparent hover:scale-105"
                  )}
                  style={{ backgroundColor: c }}
                />
              ))}
            </div>
          </Field>

          <Field label={t("form.label.icon")}>
            <Select
              value={form.icon}
              onChange={(e) => setForm((s) => ({ ...s, icon: e.target.value }))}
            >
              {ICONS.map((i) => (
                <option key={i} value={i}>
                  {i}
                </option>
              ))}
            </Select>
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
              {busy
                ? t("common.saving")
                : editing
                  ? t("common.save")
                  : t("common.create")}
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
