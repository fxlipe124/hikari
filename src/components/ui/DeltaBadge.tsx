import { ArrowDown, ArrowUp } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Spending delta vs a previous period. Spending MORE renders in danger,
 * spending LESS in success — deliberately inverted from generic "up is
 * green" metrics, since every number in Hikari is an expense. Neutral em
 * dash when there is no meaningful baseline (previous <= 0, still loading)
 * or the change is under 1%.
 */
export function DeltaBadge({
  current,
  previous,
  title,
  compact = false,
  className,
}: {
  current: number;
  previous: number | null;
  /** Native tooltip explaining what the baseline is. */
  title?: string;
  /** Icon-less ±% text for tight spots like chart legends. */
  compact?: boolean;
  className?: string;
}) {
  const baseClass = compact
    ? "text-[10px] tabular"
    : "inline-flex items-center gap-0.5 text-xs tabular";
  if (previous === null || previous <= 0) {
    return (
      <span title={title} className={cn(baseClass, "text-fg-subtle", className)}>
        —
      </span>
    );
  }
  const pct = ((current - previous) / previous) * 100;
  if (!Number.isFinite(pct) || Math.abs(pct) < 1) {
    return (
      <span title={title} className={cn(baseClass, "text-fg-subtle", className)}>
        —
      </span>
    );
  }
  const up = pct > 0;
  const label = `${Math.min(999, Math.round(Math.abs(pct)))}%`;
  return (
    <span
      title={title}
      aria-label={`${up ? "+" : "−"}${label}${title ? ` ${title}` : ""}`}
      className={cn(baseClass, up ? "text-danger" : "text-success", className)}
    >
      {compact ? (
        `${up ? "+" : "−"}${label}`
      ) : (
        <>
          {up ? <ArrowUp className="h-3 w-3" /> : <ArrowDown className="h-3 w-3" />}
          {label}
        </>
      )}
    </span>
  );
}
