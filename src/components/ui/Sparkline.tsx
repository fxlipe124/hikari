import { cn } from "@/lib/utils";

/**
 * Minimal trend line for a stat card: hand-rolled SVG polyline with a dot
 * on the latest point. No axes, no tooltip — it's a shape, not a chart.
 */
export function Sparkline({
  data,
  width = 140,
  height = 24,
  className,
}: {
  data: number[];
  width?: number;
  height?: number;
  className?: string;
}) {
  if (data.length < 2) return null;
  const pad = 3;
  const max = Math.max(...data);
  const min = Math.min(...data, 0);
  const range = max - min || 1;
  const x = (i: number) => pad + (i * (width - pad * 2)) / (data.length - 1);
  const y = (v: number) => pad + (height - pad * 2) * (1 - (v - min) / range);
  const points = data.map((v, i) => `${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(" ");
  const last = data[data.length - 1];
  return (
    <svg
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      className={cn("shrink-0", className)}
      aria-hidden="true"
    >
      <polyline
        points={points}
        fill="none"
        stroke="var(--accent)"
        strokeWidth="1.5"
        strokeLinejoin="round"
        strokeLinecap="round"
      />
      <circle cx={x(data.length - 1)} cy={y(last)} r="2" fill="var(--accent)" />
    </svg>
  );
}
