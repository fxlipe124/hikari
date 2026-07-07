/**
 * Shared Recharts tooltip frame, replacing the per-chart inline
 * contentStyle objects. Recharts injects active/payload/label; the chart
 * supplies the money formatter and an optional extra line rendered from
 * the hovered datum (e.g. a month-over-month delta).
 */
export function ChartTooltip({
  active,
  payload,
  label,
  formatter,
  renderExtra,
}: {
  active?: boolean;
  payload?: Array<{
    value?: number | string;
    name?: string;
    payload?: unknown;
  }>;
  label?: string | number;
  formatter: (cents: number) => string;
  renderExtra?: (datum: unknown) => React.ReactNode;
}) {
  if (!active || !payload || payload.length === 0) return null;
  const first = payload[0];
  const value = Number(first?.value);
  const title = label ?? first?.name;
  return (
    <div className="rounded-[var(--radius)] border border-border bg-surface px-2.5 py-1.5 text-xs shadow-lg">
      {title !== undefined && title !== "" && (
        <div className="text-fg-muted">{title}</div>
      )}
      <div className="flex items-baseline gap-1.5">
        <span className="tabular font-medium text-fg">
          {Number.isFinite(value) ? formatter(value) : ""}
        </span>
        {renderExtra?.(first?.payload)}
      </div>
    </div>
  );
}
