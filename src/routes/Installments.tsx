import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { Layers } from "lucide-react";
import { useTransactions, useCards } from "@/lib/queries";
import { Card, CardContent } from "@/components/ui/Card";
import { Skeleton } from "@/components/ui/Skeleton";
import { EmptyState } from "@/components/ui/EmptyState";
import { PageHeader } from "@/components/PageHeader";
import { useFormatMoney } from "@/lib/utils";

export function Installments() {
  const { t } = useTranslation();
  const formatMoney = useFormatMoney();
  // Query every transaction in the vault — installments span months by
  // design, so a single-month filter would silently miss any group that
  // doesn't happen to bill in the current statement.
  const { data: txs, isLoading } = useTransactions();
  const { data: cards } = useCards();

  const groups = useMemo(() => {
    if (!txs) return [];
    const todayIso = new Date().toISOString().slice(0, 10);
    const byGroup = new Map<string, typeof txs>();
    for (const tx of txs) {
      if (!tx.installmentGroupId) continue;
      const list = byGroup.get(tx.installmentGroupId) ?? [];
      list.push(tx);
      byGroup.set(tx.installmentGroupId, list);
    }
    const built = Array.from(byGroup.entries()).map(([id, items]) => {
      // Sort so "first" is reliably installment 1/N (or the lowest index).
      const sorted = [...items].sort(
        (a, b) => (a.installmentIndex ?? 0) - (b.installmentIndex ?? 0)
      );
      const first = sorted[0];
      const total = first.installmentTotal ?? sorted.length;
      // "Current" = highest installment index already billed (postedAt <= today).
      // Falls back to the highest index in the group if none have posted yet.
      const billed = sorted.filter((i) => i.postedAt.slice(0, 10) <= todayIso);
      const current = billed.length > 0
        ? Math.max(...billed.map((i) => i.installmentIndex ?? 0))
        : 0;
      const perInstallment = first.amountCents;
      return {
        id,
        description: first.merchantClean ?? first.description,
        cardId: first.cardId,
        total,
        current,
        perInstallment,
        fullTotal: perInstallment * total,
        remaining: perInstallment * Math.max(0, total - current),
      };
    });
    // Show only groups that still have unpaid installments, ordered by how
    // many remain — most-pending first.
    return built
      .filter((g) => g.current < g.total)
      .sort((a, b) => b.total - b.current - (a.total - a.current));
  }, [txs]);

  return (
    <div>
      <PageHeader
        title={t("route.installments.title")}
        subtitle={t("route.installments.subtitle", { count: groups.length })}
      />

      <div className="p-6 space-y-3">
        {isLoading &&
          Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} className="h-28 w-full rounded-[var(--radius-lg)]" />
          ))}
        {!isLoading && groups.length === 0 && (
          <EmptyState
            icon={Layers}
            title={t("installments_view.no_open")}
            description={t("installments_view.empty_description")}
          />
        )}
        {groups.map((g) => {
          const card = cards?.find((c) => c.id === g.cardId);
          const pct = Math.min(100, Math.round((g.current / g.total) * 100));
          return (
            <Card key={g.id}>
              <CardContent className="space-y-3 py-4">
                <div className="flex items-start justify-between">
                  <div>
                    <div className="text-sm font-semibold">{g.description}</div>
                    {card && (
                      <div className="mt-0.5 flex items-center gap-1.5 text-xs text-fg-muted">
                        <span
                          className="h-1.5 w-2.5 rounded-sm"
                          style={{ backgroundColor: card.color }}
                        />
                        {card.name}
                      </div>
                    )}
                  </div>
                  <div className="text-right">
                    <div className="text-sm font-semibold tabular">
                      {formatMoney(g.fullTotal)}
                    </div>
                    <div className="text-xs text-fg-subtle tabular">
                      {t("installments_view.per_installment", {
                        count: g.total,
                        amount: formatMoney(g.perInstallment),
                      })}
                    </div>
                  </div>
                </div>

                <div>
                  <div className="flex justify-between text-xs mb-1.5">
                    <span className="text-fg-muted tabular">
                      {t("installments_view.paid_format", {
                        current: g.current,
                        total: g.total,
                      })}
                    </span>
                    <span className="text-fg-subtle tabular">
                      {t("installments_view.remaining", { amount: formatMoney(g.remaining) })}
                    </span>
                  </div>
                  <div className="h-1.5 w-full rounded-full bg-muted overflow-hidden">
                    <div
                      className="h-full rounded-full bg-accent transition-[width]"
                      style={{ width: `${pct}%` }}
                    />
                  </div>
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>
    </div>
  );
}
