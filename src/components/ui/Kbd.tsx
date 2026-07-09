import { cn } from "@/lib/utils";

export function Kbd({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <kbd
      className={cn(
        "inline-flex h-[18px] min-w-[18px] items-center justify-center rounded border border-border bg-muted px-1 text-[10px] tabular text-fg-subtle",
        className
      )}
    >
      {children}
    </kbd>
  );
}
