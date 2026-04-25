import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { cn, currentYearMonth, monthLabel } from "@/lib/utils";

function shift(ym: string, deltaMonths: number): string {
  const [y, m] = ym.split("-").map(Number);
  const d = new Date(y, m - 1 + deltaMonths, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

export function MonthPicker({
  value,
  onChange,
  showTodayButton = true,
}: {
  value: string;
  onChange: (ym: string) => void;
  showTodayButton?: boolean;
}) {
  const { t, i18n } = useTranslation();
  const [open, setOpen] = useState(false);
  const [pickerYear, setPickerYear] = useState(() =>
    parseInt(value.slice(0, 4), 10),
  );
  const wrapRef = useRef<HTMLDivElement>(null);

  const isCurrent = value === currentYearMonth();

  // Re-anchor the popover's year to the selected value every time it
  // (re-)opens — otherwise opening the picker after navigating with the
  // outer chevrons would still show the year you started on.
  useEffect(() => {
    if (open) setPickerYear(parseInt(value.slice(0, 4), 10));
  }, [open, value]);

  useEffect(() => {
    if (!open) return;
    function onDocMouseDown(e: MouseEvent) {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    function onEsc(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onDocMouseDown);
    document.addEventListener("keydown", onEsc);
    return () => {
      document.removeEventListener("mousedown", onDocMouseDown);
      document.removeEventListener("keydown", onEsc);
    };
  }, [open]);

  const monthNames = useMemo(() => {
    const fmt = new Intl.DateTimeFormat(i18n.language, { month: "short" });
    return Array.from({ length: 12 }, (_, i) =>
      fmt.format(new Date(2000, i, 1)),
    );
  }, [i18n.language]);

  const todayYm = currentYearMonth();
  const [selectedYear, selectedMonth] = value.split("-").map(Number);

  return (
    <div ref={wrapRef} className="relative flex items-center gap-1">
      <button
        type="button"
        onClick={() => onChange(shift(value, -1))}
        className="rounded-[var(--radius)] p-1 text-fg-subtle hover:text-fg hover:bg-surface-hover transition-colors"
        aria-label={t("nav.prev_month")}
        title={t("nav.prev_month")}
      >
        <ChevronLeft className="h-4 w-4" />
      </button>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className={cn(
          "min-w-[140px] rounded-[var(--radius)] px-2 py-1 text-center text-sm font-medium tabular capitalize transition-colors",
          "hover:bg-surface-hover",
          open && "bg-surface-hover",
        )}
        title={t("nav.pick_month")}
      >
        {monthLabel(value)}
      </button>
      <button
        type="button"
        onClick={() => onChange(shift(value, 1))}
        className="rounded-[var(--radius)] p-1 text-fg-subtle hover:text-fg hover:bg-surface-hover transition-colors"
        aria-label={t("nav.next_month")}
        title={t("nav.next_month")}
      >
        <ChevronRight className="h-4 w-4" />
      </button>
      {showTodayButton && !isCurrent && (
        <button
          type="button"
          onClick={() => onChange(currentYearMonth())}
          className={cn(
            "ml-2 rounded-[var(--radius)] border border-border px-2 py-1 text-xs text-fg-muted",
            "hover:bg-surface-hover hover:text-fg transition-colors",
          )}
        >
          {t("nav.current_month")}
        </button>
      )}

      {open && (
        <div
          className={cn(
            "absolute left-1/2 top-full z-20 mt-1.5 w-[260px] -translate-x-1/2",
            "rounded-[var(--radius-lg)] border border-border bg-surface p-3 shadow-lg",
          )}
        >
          <div className="mb-2 flex items-center justify-between">
            <button
              type="button"
              onClick={() => setPickerYear((y) => y - 1)}
              className="rounded-[var(--radius)] p-1 text-fg-subtle hover:text-fg hover:bg-surface-hover transition-colors"
              aria-label={t("nav.prev_year")}
            >
              <ChevronLeft className="h-4 w-4" />
            </button>
            <span className="text-sm font-semibold tabular">{pickerYear}</span>
            <button
              type="button"
              onClick={() => setPickerYear((y) => y + 1)}
              className="rounded-[var(--radius)] p-1 text-fg-subtle hover:text-fg hover:bg-surface-hover transition-colors"
              aria-label={t("nav.next_year")}
            >
              <ChevronRight className="h-4 w-4" />
            </button>
          </div>
          <div className="grid grid-cols-3 gap-1">
            {monthNames.map((name, i) => {
              const m = i + 1;
              const ym = `${pickerYear}-${String(m).padStart(2, "0")}`;
              const isSelected =
                pickerYear === selectedYear && m === selectedMonth;
              const isToday = ym === todayYm;
              return (
                <button
                  key={i}
                  type="button"
                  onClick={() => {
                    onChange(ym);
                    setOpen(false);
                  }}
                  className={cn(
                    "rounded-[var(--radius)] px-2 py-1.5 text-xs capitalize transition-colors",
                    isSelected
                      ? "bg-accent text-accent-fg"
                      : isToday
                        ? "border border-accent/40 text-accent hover:bg-accent/10"
                        : "text-fg-muted hover:bg-surface-hover hover:text-fg",
                  )}
                >
                  {name}
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
