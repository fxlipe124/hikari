import { useTranslation } from "react-i18next";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { MonthPicker } from "@/components/ui/MonthPicker";
import { cn } from "@/lib/utils";
import type { ViewMode } from "@/hooks/useViewMonthStore";

/**
 * Period picker — wraps the existing MonthPicker with a small mode toggle
 * (M / Y) so the user can flip between browsing a single statement
 * period and the full calendar year. The two modes share the same
 * physical real estate in the page header so the layout stays compact.
 *
 * Year mode uses a parallel set of prev/next arrows + a centered year
 * label; we don't show a popover here because picking 1 of ~10 years is
 * faster with arrows than a grid.
 */
export function PeriodPicker({
  mode,
  ym,
  year,
  onModeChange,
  onYmChange,
  onYearChange,
}: {
  mode: ViewMode;
  ym: string;
  year: number;
  onModeChange: (mode: ViewMode) => void;
  onYmChange: (ym: string) => void;
  onYearChange: (year: number) => void;
}) {
  const { t } = useTranslation();
  const currentYear = new Date().getFullYear();

  return (
    <div className="flex items-center gap-2">
      <div className="inline-flex rounded-[var(--radius)] border border-border p-0.5 text-[10px] font-medium uppercase tracking-wide">
        <button
          type="button"
          onClick={() => onModeChange("month")}
          className={cn(
            "rounded-[calc(var(--radius)-2px)] px-1.5 py-0.5 transition-colors",
            mode === "month"
              ? "bg-accent text-accent-fg"
              : "text-fg-subtle hover:text-fg",
          )}
          title={t("period.mode_month")}
        >
          {t("period.mode_month_short")}
        </button>
        <button
          type="button"
          onClick={() => onModeChange("year")}
          className={cn(
            "rounded-[calc(var(--radius)-2px)] px-1.5 py-0.5 transition-colors",
            mode === "year"
              ? "bg-accent text-accent-fg"
              : "text-fg-subtle hover:text-fg",
          )}
          title={t("period.mode_year")}
        >
          {t("period.mode_year_short")}
        </button>
      </div>

      {mode === "month" ? (
        <MonthPicker value={ym} onChange={onYmChange} />
      ) : (
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={() => onYearChange(year - 1)}
            className="rounded-[var(--radius)] p-1 text-fg-subtle hover:text-fg hover:bg-surface-hover transition-colors"
            aria-label={t("nav.prev_year")}
            title={t("nav.prev_year")}
          >
            <ChevronLeft className="h-4 w-4" />
          </button>
          <span className="min-w-[80px] rounded-[var(--radius)] px-2 py-1 text-center text-sm font-medium tabular">
            {year}
          </span>
          <button
            type="button"
            onClick={() => onYearChange(year + 1)}
            className="rounded-[var(--radius)] p-1 text-fg-subtle hover:text-fg hover:bg-surface-hover transition-colors"
            aria-label={t("nav.next_year")}
            title={t("nav.next_year")}
          >
            <ChevronRight className="h-4 w-4" />
          </button>
          {year !== currentYear && (
            <button
              type="button"
              onClick={() => onYearChange(currentYear)}
              className="ml-2 rounded-[var(--radius)] border border-border px-2 py-1 text-xs text-fg-muted hover:bg-surface-hover hover:text-fg transition-colors"
            >
              {t("nav.current_year")}
            </button>
          )}
        </div>
      )}
    </div>
  );
}
