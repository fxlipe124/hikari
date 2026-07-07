import type { LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

export function EmptyState({
  icon: Icon,
  title,
  description,
  action,
  className,
  as: Heading = "h2",
}: {
  icon?: LucideIcon;
  title: string;
  description?: string;
  action?: React.ReactNode;
  className?: string;
  /**
   * Heading element for the title. Use "p" when the empty state lives
   * inside a card that already has its own heading, so the document
   * outline doesn't jump backwards.
   */
  as?: "h2" | "h3" | "p";
}) {
  return (
    <div
      className={cn(
        "flex flex-col items-center gap-3 py-12 text-center",
        className
      )}
    >
      {Icon && (
        <div className="flex h-10 w-10 items-center justify-center rounded-full bg-muted text-fg-subtle">
          <Icon className="h-4 w-4" />
        </div>
      )}
      <div className="space-y-1">
        <Heading className="text-sm font-medium">{title}</Heading>
        {description && (
          <p className="mx-auto max-w-xs text-xs text-fg-subtle">{description}</p>
        )}
      </div>
      {action}
    </div>
  );
}
