import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { useLocation, useNavigate } from "react-router-dom";
import { FileText, Plus, Search, SlidersHorizontal } from "lucide-react";
import { Input } from "@/components/ui/Input";
import { Button } from "@/components/ui/Button";
import { MonthPicker } from "@/components/ui/MonthPicker";
import { TransactionDialog } from "@/components/TransactionDialog";
import {
  countActiveFilters,
  emptyFilter,
  FilterDialog,
  type FilterState,
} from "@/components/FilterDialog";
import { useCards, useCategories, useTransactions } from "@/lib/queries";
import { useViewMonthStore } from "@/hooks/useViewMonthStore";
import type { Transaction } from "@/lib/ipc";
import { toast } from "@/lib/toast";
import {
  cn,
  formatDate,
  monthLabel,
  parseMoney,
  useFormatMoney,
} from "@/lib/utils";

interface NavState {
  ym?: string;
  toast?: string;
  categoryIds?: string[];
}

export function Transactions() {
  const { t } = useTranslation();
  const location = useLocation();
  const navigate = useNavigate();
  const navState = location.state as NavState | null;
  const initialFilter: FilterState = navState?.categoryIds
    ? { ...emptyFilter, categoryIds: navState.categoryIds }
    : emptyFilter;

  const [query, setQuery] = useState("");
  const [cardFilter, setCardFilter] = useState<string | null>(null);
  const [editing, setEditing] = useState<Transaction | null>(null);
  const [creating, setCreating] = useState(false);
  // Month state shared with Dashboard via a zustand store — see the same
  // hook in Dashboard.tsx for the rationale.
  const ym = useViewMonthStore((s) => s.ym);
  const setYm = useViewMonthStore((s) => s.setYm);
  // If we got a forwarded `ym` from another route (e.g. Dashboard click on
  // the donut chart, ImportPreview commit) prefer that, but only on first
  // mount of this navigation — don't keep slamming the store on every
  // re-render.
  useEffect(() => {
    if (navState?.ym && navState.ym !== ym) {
      setYm(navState.ym);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const [filter, setFilter] = useState<FilterState>(initialFilter);
  const [filterOpen, setFilterOpen] = useState(false);
  const { data: cards } = useCards();
  // Single-card vaults: pick the lone card automatically so the month picker
  // pivots on its closing_day. Mirrors the same auto-default in Dashboard —
  // avoids "August view shows calendar August instead of the statement"
  // gotcha when the user only ever has one card chip to click.
  useEffect(() => {
    if (cardFilter === null && cards && cards.length === 1) {
      setCardFilter(cards[0].id);
    }
  }, [cards, cardFilter]);
  const { data: txs } = useTransactions({ yearMonth: ym, query, cardId: cardFilter ?? undefined });
  const { data: categories } = useCategories();
  const formatMoney = useFormatMoney();

  // Pop a forwarded toast (e.g. "X imported, Y skipped" from ImportPreview),
  // then clear the navigation state so a refresh doesn't replay it.
  useEffect(() => {
    const incoming = navState?.toast;
    if (incoming) {
      toast.success(incoming);
      navigate(location.pathname, { replace: true, state: null });
    }
    // navState is read once per location change; re-running with the same state
    // would replay the toast.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [location.pathname]);

  const filteredTxs = useMemo(() => {
    if (!txs) return [];
    const minCents = filter.amountMin ? parseMoney(filter.amountMin) : null;
    const maxCents = filter.amountMax ? parseMoney(filter.amountMax) : null;
    const passes = txs.filter((tx) => {
      if (filter.categoryIds.length && !filter.categoryIds.includes(tx.categoryId ?? "")) return false;
      if (filter.refundOnly && !tx.isRefund) return false;
      if (filter.installmentsOnly && !tx.installmentGroupId) return false;
      if (filter.uncategorizedOnly && tx.categoryId) return false;
      if (filter.virtualOnly && !tx.isVirtualCard) return false;
      if (minCents !== null && tx.amountCents < minCents) return false;
      if (maxCents !== null && tx.amountCents > maxCents) return false;
      const date = tx.postedAt.slice(0, 10);
      if (filter.postedFrom && date < filter.postedFrom) return false;
      if (filter.postedTo && date > filter.postedTo) return false;
      return true;
    });
    const sorted = [...passes];
    sorted.sort((a, b) => {
      switch (filter.sortBy) {
        case "date_asc":
          return a.postedAt.localeCompare(b.postedAt);
        case "amount_desc":
          return b.amountCents - a.amountCents;
        case "amount_asc":
          return a.amountCents - b.amountCents;
        default:
          return b.postedAt.localeCompare(a.postedAt);
      }
    });
    return sorted;
  }, [txs, filter]);

  const total = useMemo(
    // Mirror the backend monthSummary: refunds subtract from the running
    // total instead of inflating it. Refunded amounts are stored positive
    // with isRefund=true, so we negate them in the sum.
    () =>
      filteredTxs.reduce(
        (s, x) => s + (x.isRefund ? -x.amountCents : x.amountCents),
        0,
      ),
    [filteredTxs],
  );
  const activeFilterCount = countActiveFilters(filter);

  return (
    <div>
      <div className="border-b border-border px-6 py-5">
        <div className="flex items-center justify-between gap-4">
          <h1 className="text-xl font-semibold tracking-tight capitalize">{t("route.transactions.title")}</h1>
          <MonthPicker value={ym} onChange={setYm} />
        </div>
        <p className="mt-0.5 text-sm text-fg-muted">
          {t("route.transactions.summary", {
            count: txs?.length ?? 0,
            total: formatMoney(total),
          })}
        </p>
      </div>

      <div className="px-6 py-4 border-b border-border flex items-center gap-2">
        <div className="relative flex-1 max-w-[320px]">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-fg-subtle" />
          <Input
            placeholder={t("search.placeholder")}
            className="pl-8"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>

        <div className="flex items-center gap-1">
          <button
            onClick={() => setCardFilter(null)}
            className={`rounded-[var(--radius)] border px-2.5 py-1 text-xs transition-colors ${
              cardFilter === null
                ? "border-accent bg-accent/10 text-accent"
                : "border-border text-fg-muted hover:bg-surface-hover"
            }`}
          >
            {t("common.all")}
          </button>
          {(cards ?? []).map((c) => (
            <button
              key={c.id}
              onClick={() => setCardFilter(c.id)}
              className={`flex items-center gap-1.5 rounded-[var(--radius)] border px-2.5 py-1 text-xs transition-colors ${
                cardFilter === c.id
                  ? "border-accent bg-accent/10 text-accent"
                  : "border-border text-fg-muted hover:bg-surface-hover"
              }`}
            >
              <span className="h-2 w-3 rounded-sm" style={{ backgroundColor: c.color }} />
              {c.name}
            </button>
          ))}
        </div>

        <div className="ml-auto">
          <Button
            variant="secondary"
            size="sm"
            onClick={() => setFilterOpen(true)}
            className={cn(activeFilterCount > 0 && "border-accent text-accent")}
          >
            <SlidersHorizontal className="h-3.5 w-3.5" />
            {t("common.filters")}
            {activeFilterCount > 0 && (
              <span className="ml-1 rounded-full bg-accent/20 px-1.5 py-0.5 text-[10px] tabular text-accent">
                {activeFilterCount}
              </span>
            )}
          </Button>
        </div>
      </div>

      <table className="w-full">
        <thead className="sticky top-0 bg-surface border-b border-border">
          <tr className="text-xs text-fg-muted">
            <th className="pl-6 pr-3 py-2 text-left font-medium w-[72px] whitespace-nowrap">{t("table.header.date")}</th>
            <th className="py-2 text-left font-medium">{t("table.header.description")}</th>
            <th className="px-3 py-2 text-left font-medium w-36">{t("table.header.category")}</th>
            <th className="px-3 py-2 text-left font-medium w-32">{t("table.header.card")}</th>
            <th className="px-6 py-2 text-right font-medium w-32">{t("table.header.amount")}</th>
          </tr>
        </thead>
        <tbody>
          {filteredTxs.length === 0 && (
            <tr>
              <td colSpan={5} className="px-6 py-16">
                <div className="flex flex-col items-center justify-center gap-3 text-center">
                  <div className="flex h-10 w-10 items-center justify-center rounded-full bg-muted text-fg-subtle">
                    <FileText className="h-4 w-4" />
                  </div>
                  <div>
                    <p className="text-sm font-medium">
                      {query || cardFilter || activeFilterCount > 0
                        ? t("transactions.no_match")
                        : t("transactions.nothing_entered", { month: monthLabel(ym).toLowerCase() })}
                    </p>
                    <p className="text-xs text-fg-subtle mt-0.5">
                      {query || cardFilter || activeFilterCount > 0
                        ? t("transactions.clear_filters")
                        : t("transactions.manual_or_import")}
                    </p>
                  </div>
                  {!query && !cardFilter && activeFilterCount === 0 && (
                    <Button size="sm" onClick={() => setCreating(true)}>
                      <Plus className="h-3.5 w-3.5" />
                      {t("common.new_transaction")}
                    </Button>
                  )}
                </div>
              </td>
            </tr>
          )}
          {filteredTxs.map((tx) => {
            const card = cards?.find((c) => c.id === tx.cardId);
            const cat = categories?.find((c) => c.id === tx.categoryId);
            return (
              <tr
                key={tx.id}
                onClick={() => setEditing(tx)}
                className="border-b border-border hover:bg-surface-hover transition-colors cursor-pointer"
              >
                <td className="pl-6 pr-3 py-2 text-xs text-fg-muted tabular whitespace-nowrap">
                  {formatDate(tx.postedAt, "day")}
                </td>
                <td className="py-2 min-w-0">
                  <div className="flex items-center gap-2">
                    <div className="text-sm truncate">{tx.merchantClean ?? tx.description}</div>
                    {tx.isVirtualCard && (
                      <span className="shrink-0 rounded-full border border-accent/40 bg-accent/10 px-1.5 py-0 text-[9px] uppercase tracking-wide text-accent">
                        {t("transactions.virtual_card_badge")}
                      </span>
                    )}
                  </div>
                  {tx.installmentGroupId && (
                    <div className="text-[10px] text-fg-subtle tabular">
                      {t("transactions.installment_format", {
                        index: tx.installmentIndex,
                        total: tx.installmentTotal,
                      })}
                    </div>
                  )}
                </td>
                <td className="px-3 py-2">
                  {cat ? (
                    <div className="inline-flex items-center gap-1.5 rounded-full border border-border px-2 py-0.5 text-[10px]">
                      <span
                        className="h-1.5 w-1.5 rounded-full"
                        style={{ backgroundColor: cat.color }}
                      />
                      <span className="text-fg-muted">{t(`category.${cat.id}`, { defaultValue: cat.name })}</span>
                    </div>
                  ) : (
                    <span className="text-[10px] text-fg-subtle">{t("transactions.no_category_short")}</span>
                  )}
                </td>
                <td className="px-3 py-2 text-xs text-fg-muted">
                  {card && (
                    <div className="flex items-center gap-1.5">
                      <span
                        className="h-2 w-3 rounded-sm"
                        style={{ backgroundColor: card.color }}
                      />
                      <span>{card.name}</span>
                    </div>
                  )}
                </td>
                <td className="px-6 py-2 text-right tabular text-sm font-medium">
                  {formatMoney(tx.amountCents)}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>

      <TransactionDialog
        open={editing !== null}
        onOpenChange={(o) => !o && setEditing(null)}
        editing={editing}
      />
      <TransactionDialog
        open={creating}
        onOpenChange={setCreating}
      />
      <FilterDialog
        open={filterOpen}
        onOpenChange={setFilterOpen}
        filter={filter}
        onApply={setFilter}
      />
    </div>
  );
}
