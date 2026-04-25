import { forwardRef, type InputHTMLAttributes } from "react";
import { cn } from "@/lib/utils";

export interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  invalid?: boolean;
}

export const Input = forwardRef<HTMLInputElement, InputProps>(
  ({ className, invalid, type = "text", ...props }, ref) => {
    return (
      <input
        ref={ref}
        type={type}
        className={cn(
          "flex h-9 w-full rounded-[var(--radius)] border bg-surface px-3 text-sm",
          "text-fg placeholder:text-fg-subtle",
          "transition-[border-color,box-shadow] duration-[120ms]",
          "focus:outline-none focus:border-accent focus:ring-2 focus:ring-accent/20",
          "disabled:cursor-not-allowed disabled:opacity-50",
          invalid
            ? "border-danger focus:border-danger focus:ring-danger/20"
            : "border-border hover:border-border-strong",
          className
        )}
        {...props}
      />
    );
  }
);
Input.displayName = "Input";
