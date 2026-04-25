import { forwardRef, type SelectHTMLAttributes } from "react";
import { ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";

export interface SelectProps extends SelectHTMLAttributes<HTMLSelectElement> {
  invalid?: boolean;
}

export const Select = forwardRef<HTMLSelectElement, SelectProps>(
  ({ className, invalid, children, ...props }, ref) => {
    return (
      <div className="relative">
        <select
          ref={ref}
          className={cn(
            "flex h-9 w-full appearance-none rounded-[var(--radius)] border bg-surface pl-3 pr-8 text-sm",
            "text-fg",
            "transition-[border-color,box-shadow] duration-[120ms]",
            "focus:outline-none focus:border-accent focus:ring-2 focus:ring-accent/20",
            "disabled:cursor-not-allowed disabled:opacity-50",
            invalid
              ? "border-danger focus:border-danger focus:ring-danger/20"
              : "border-border hover:border-border-strong",
            className
          )}
          {...props}
        >
          {children}
        </select>
        <ChevronDown className="pointer-events-none absolute right-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-fg-subtle" />
      </div>
    );
  }
);
Select.displayName = "Select";
