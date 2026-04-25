import { forwardRef, type ButtonHTMLAttributes } from "react";
import { cn } from "@/lib/utils";

export interface SwitchProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, "onChange"> {
  checked: boolean;
  onChange: (next: boolean) => void;
}

export const Switch = forwardRef<HTMLButtonElement, SwitchProps>(
  ({ checked, onChange, className, ...props }, ref) => {
    return (
      <button
        ref={ref}
        type="button"
        role="switch"
        aria-checked={checked}
        onClick={() => onChange(!checked)}
        className={cn(
          "relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors",
          checked ? "bg-accent" : "bg-muted",
          "focus:outline-none focus:ring-2 focus:ring-accent focus:ring-offset-1",
          className
        )}
        {...props}
      >
        <span
          className={cn(
            "inline-block h-4 w-4 rounded-full bg-white shadow-sm transition-transform",
            checked ? "translate-x-[18px]" : "translate-x-0.5"
          )}
        />
      </button>
    );
  }
);
Switch.displayName = "Switch";
