import { useTranslation } from "react-i18next";
import type { Card } from "@/lib/ipc";
import { cn } from "@/lib/utils";

const chipClass = (active: boolean) =>
  cn(
    "flex items-center gap-1.5 rounded-[var(--radius)] border px-2.5 py-1 text-xs transition-colors",
    active
      ? "border-accent bg-accent/10 text-accent"
      : "border-border text-fg-muted hover:bg-surface-hover"
  );

export function CardFilterChips({
  cards,
  value,
  onChange,
}: {
  cards: Card[];
  value: string | null;
  onChange: (id: string | null) => void;
}) {
  const { t } = useTranslation();
  return (
    <div className="flex flex-wrap items-center gap-1">
      <button onClick={() => onChange(null)} className={chipClass(value === null)}>
        {t("common.all")}
      </button>
      {cards.map((c) => (
        <button
          key={c.id}
          onClick={() => onChange(c.id)}
          className={chipClass(value === c.id)}
        >
          <span className="h-2 w-3 rounded-sm" style={{ backgroundColor: c.color }} />
          {c.name}
        </button>
      ))}
    </div>
  );
}
