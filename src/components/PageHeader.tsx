export function PageHeader({
  title,
  subtitle,
  actions,
}: {
  title: string;
  subtitle?: string;
  actions?: React.ReactNode;
}) {
  return (
    <div className="border-b border-border px-6 py-5">
      <div className="flex items-center justify-between gap-4">
        <h1 className="text-xl font-semibold tracking-tight">{title}</h1>
        {actions}
      </div>
      {subtitle && <p className="mt-0.5 text-sm text-fg-muted">{subtitle}</p>}
    </div>
  );
}
