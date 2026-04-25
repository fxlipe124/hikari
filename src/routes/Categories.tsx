import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { CategoryDialog } from "@/components/CategoryDialog";
import { useCategories } from "@/lib/queries";
import type { Category } from "@/lib/ipc";

export function Categories() {
  const { t } = useTranslation();
  const { data: categories } = useCategories();
  const roots = (categories ?? []).filter((c) => !c.parentId);
  const [open, setOpen] = useState(false);
  const [parentId, setParentId] = useState<string | null>(null);
  const [editing, setEditing] = useState<Category | null>(null);

  function newRoot() {
    setEditing(null);
    setParentId(null);
    setOpen(true);
  }
  function newChild(rootId: string) {
    setEditing(null);
    setParentId(rootId);
    setOpen(true);
  }
  function editCategory(c: Category) {
    setEditing(c);
    setParentId(c.parentId);
    setOpen(true);
  }

  return (
    <div>
      <div className="flex items-end justify-between border-b border-border px-6 py-5">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">{t("route.categories.title")}</h1>
          <p className="mt-0.5 text-sm text-fg-muted">
            {t("route.categories.count", { count: categories?.length ?? 0 })}
          </p>
        </div>
        <Button size="sm" onClick={newRoot}>
          <Plus className="h-3.5 w-3.5" />
          {t("common.new_category")}
        </Button>
      </div>

      <div className="px-6 py-6 space-y-1">
        {roots.map((root) => {
          const children = (categories ?? []).filter((c) => c.parentId === root.id);
          return (
            <div key={root.id} className="group/root">
              <button
                type="button"
                onClick={() => editCategory(root)}
                className="flex w-full items-center gap-2.5 rounded-[var(--radius)] px-3 py-2 text-left hover:bg-surface-hover transition-colors cursor-pointer"
              >
                <span
                  className="h-2.5 w-2.5 rounded-full"
                  style={{ backgroundColor: root.color }}
                />
                <span className="text-sm font-medium">{t(`category.${root.id}`, { defaultValue: root.name })}</span>
                {children.length > 0 && (
                  <span className="text-xs text-fg-subtle">
                    {t("categories.subcategories_count", { count: children.length })}
                  </span>
                )}
                <span
                  role="button"
                  tabIndex={0}
                  onClick={(e) => {
                    e.stopPropagation();
                    newChild(root.id);
                  }}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      e.stopPropagation();
                      newChild(root.id);
                    }
                  }}
                  className="ml-auto opacity-0 group-hover/root:opacity-100 text-fg-subtle hover:text-fg transition-opacity text-xs cursor-pointer"
                  title={t("common.new_subcategory")}
                >
                  <Plus className="h-3.5 w-3.5" />
                </span>
              </button>
              {children.map((child) => (
                <button
                  key={child.id}
                  type="button"
                  onClick={() => editCategory(child)}
                  className="flex w-full items-center gap-2.5 rounded-[var(--radius)] pl-10 pr-3 py-1.5 text-left hover:bg-surface-hover transition-colors cursor-pointer"
                >
                  <span
                    className="h-2 w-2 rounded-full"
                    style={{ backgroundColor: child.color }}
                  />
                  <span className="text-sm text-fg-muted">{t(`category.${child.id}`, { defaultValue: child.name })}</span>
                </button>
              ))}
            </div>
          );
        })}
      </div>

      <CategoryDialog
        open={open}
        onOpenChange={(o) => {
          setOpen(o);
          if (!o) setEditing(null);
        }}
        defaultParentId={parentId}
        editing={editing}
      />
    </div>
  );
}
