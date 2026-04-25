import { type ReactNode } from "react";
import { cn } from "@/lib/utils";

export function Field({
  label,
  hint,
  error,
  className,
  children,
  span = 1,
}: {
  label: string;
  hint?: string;
  error?: string;
  className?: string;
  children: ReactNode;
  span?: 1 | 2;
}) {
  return (
    <div
      className={cn(
        "flex flex-col gap-1.5",
        span === 2 && "col-span-2",
        className
      )}
    >
      <label className="text-xs font-medium text-fg-muted">{label}</label>
      {children}
      {error ? (
        <p className="text-[11px] text-danger">{error}</p>
      ) : hint ? (
        <p className="text-[11px] text-fg-subtle">{hint}</p>
      ) : null}
    </div>
  );
}

export function FieldRow({
  className,
  children,
}: {
  className?: string;
  children: ReactNode;
}) {
  return (
    <div className={cn("grid grid-cols-2 gap-3", className)}>{children}</div>
  );
}
