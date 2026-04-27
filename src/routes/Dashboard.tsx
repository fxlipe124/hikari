import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { NavLink, useNavigate } from "react-router-dom";
import { ArrowUpRight, CreditCard, Plus } from "lucide-react";
import { Bar, BarChart, Cell, Pie, PieChart, Tooltip, XAxis, YAxis } from "recharts";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { PeriodPicker } from "@/components/ui/PeriodPicker";
import { CardDialog } from "@/components/CardDialog";
import {
  useCards,
  useCategories,
  useMonthSummary,
  useTransactions,
  useYearSummary,
} from "@/lib/queries";
import { useViewMonthStore } from "@/hooks/useViewMonthStore";
import { cn, formatDate, monthLabel, useFormatMoney } from "@/lib/utils";

function PeriodHeader({
  subtitle,
  children,
}: {
  subtitle?: string;
  children: React.ReactNode;
}) {
  const { t } = useTranslation();
  return (
    <div className="border-b border-border px-6 py-5">
      <div className="flex items-center justify-between gap-4">
        <h1 className="text-xl font-semibold tracking-tight capitalize">{t("route.dashboard.title")}</h1>
        {children}
      </div>
      {subtitle && <p className="mt-0.5 text-sm text-fg-muted">{subtitle}</p>}
    </div>
  );
}

function Stat({
  label,
  value,
  hint,
  tone = "default",
}: {
  label: string;
  value: string;
  hint?: string;
  tone?: "default" | "accent" | "warning";
}) {
  return (
    <Card className="flex-1">
      <CardContent className="space-y-1 py-5">
        <div className="text-xs text-fg-muted">{label}</div>
        <div
          className={cn(
            "text-2xl font-semibold tabular tracking-tight",
            tone === "accent" && "text-accent",
            tone === "warning" && "text-warning"
          )}
        >
          {value}
        </div>
        {hint && <div className="text-xs text-fg-subtle">{hint}</div>}
      </CardContent>
    </Card>
  );
}

export function Dashboard() {
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  // Period state lives in a tiny zustand store shared with the Transactions
  // route, so navigating between the two — or popping a sub-dialog and
  // coming back — doesn't snap us back to "today". Cleared on app
  // restart / vault relock, where "today" is the right default.
  const mode = useViewMonthStore((s) => s.mode);
  const setMode = useViewMonthStore((s) => s.setMode);
  const ym = useViewMonthStore((s) => s.ym);
  const setYm = useViewMonthStore((s) => s.setYm);
  const year = useViewMonthStore((s) => s.year);
  const setYear = useViewMonthStore((s) => s.setYear);
  // When a card is selected, the period picker is statement-period-aware
  // (closing-day-aware) — that's the user's mental model. With "all cards",
  // we fall back to calendar month/year since multi-card statements have no
  // shared period.
  const [cardFilter, setCardFilter] = useState<string | null>(null);
  const { data: cards } = useCards();
  // Auto-default to the only card when the vault has exactly one card. With
  // a single card, "All cards" and that card are semantically the same set of
  // rows but treated differently by the period filter (calendar vs
  // statement) — defaulting avoids a confusing "August" view that silently
  // shows calendar August when the user expects the closing-day-pivoted
  // statement period.
  useEffect(() => {
    if (cardFilter === null && cards && cards.length === 1) {
      setCardFilter(cards[0].id);
    }
  }, [cards, cardFilter]);
  const yearStr = String(year);
  const { data: monthSummary } = useMonthSummary(ym, cardFilter ?? undefined);
  const { data: yearSummary } = useYearSummary(yearStr, cardFilter ?? undefined);
  const summary = mode === "month" ? monthSummary : yearSummary;
  const { data: txs } = useTransactions(
    mode === "month"
      ? { yearMonth: ym, cardId: cardFilter ?? undefined }
      : { year: yearStr, cardId: cardFilter ?? undefined },
  );
  const { data: categories } = useCategories();
  const [createCardOpen, setCreateCardOpen] = useState(false);
  const formatMoney = useFormatMoney();

  // All hooks must be called unconditionally and in the same order on every
  // render. Keep useMemo calls above the empty-state early return so React
  // doesn't see a different hook count before vs after the first card lands.
  const topCategories = useMemo(() => {
    if (!summary || !categories) return [];
    const total = summary.totalCents || 1;
    return summary.byCategory.slice(0, 6).map((entry) => {
      const cat = categories.find((c) => c.id === entry.categoryId);
      return {
        id: entry.categoryId ?? "_",
        name: cat
          ? t(`category.${cat.id}`, { defaultValue: cat.name })
          : t("common.no_category"),
        color: cat?.color ?? "#64748b",
        cents: entry.totalCents,
        // Clamp at 100 — rounding can push the sum of a few categories over
        // 100% by a hair when the underlying totals don't divide evenly.
        pct: Math.min(100, Math.round((entry.totalCents / total) * 100)),
      };
    });
  }, [summary, categories, t]);

  // Month-by-month bar data for the year view. Empty array in month mode —
  // the bar chart isn't rendered there. Uses the active i18n locale for the
  // month abbreviation so the chart axis matches the rest of the UI (e.g.
  // "fev" instead of "Feb" in pt-BR mode).
  const monthsBar = useMemo(() => {
    if (mode !== "year" || !yearSummary) return [];
    const fmt = new Intl.DateTimeFormat(i18n.language, { month: "short" });
    return yearSummary.byMonth.map((b) => {
      const monthIdx = parseInt(b.yearMonth.slice(5, 7), 10) - 1;
      const date = new Date(year, monthIdx, 1);
      const label = fmt.format(date);
      return { ym: b.yearMonth, label, total: b.totalCents };
    });
  }, [mode, yearSummary, year, i18n.language]);

  const recent = useMemo(() => (txs ?? []).slice(0, 8), [txs]);

  const installmentsActive = useMemo(() => {
    // Count unique installment groups, not rows. A 10x purchase has 10
    // rows in the same group; treating each as a separate "active
    // installment" makes the stat balloon and stop matching the
    // Installments page count.
    const groups = new Set<string>();
    for (const tx of txs ?? []) {
      if (tx.installmentGroupId) groups.add(tx.installmentGroupId);
    }
    return groups.size;
  }, [txs]);

  // "Active" cards = cards with at least one transaction in the picked
  // month. The previous version counted every registered card, contradicting
  // the "with recent activity" hint right under the number.
  const cardsActive = useMemo(() => {
    if (!summary || !cards) return 0;
    const idsWithActivity = new Set(summary.byCard.map((b) => b.cardId));
    return cards.filter((c) => idsWithActivity.has(c.id)).length;
  }, [summary, cards]);

  const nextDue = useMemo(() => {
    if (!cards || cards.length === 0) return null;
    const today = new Date().getDate();
    const sorted = [...cards].sort((a, b) => {
      const da = a.dueDay >= today ? a.dueDay - today : a.dueDay - today + 31;
      const db = b.dueDay >= today ? b.dueDay - today : b.dueDay - today + 31;
      return da - db;
    });
    return sorted[0];
  }, [cards]);

  const periodPicker = (
    <PeriodPicker
      mode={mode}
      ym={ym}
      year={year}
      onModeChange={setMode}
      onYmChange={setYm}
      onYearChange={setYear}
    />
  );

  const isEmpty = (cards?.length ?? 0) === 0 && (txs?.length ?? 0) === 0;
  if (isEmpty) {
    return (
      <div className="pb-10">
        <PeriodHeader subtitle={t("route.dashboard.subtitle")}>{periodPicker}</PeriodHeader>
        <div className="px-6 py-12">
          <div className="mx-auto max-w-md">
            <Card>
              <CardContent className="py-10 text-center space-y-4">
                <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-accent/10 text-accent">
                  <CreditCard className="h-5 w-5" />
                </div>
                <div className="space-y-1">
                  <h2 className="text-base font-medium">{t("route.dashboard.welcome_title")}</h2>
                  <p className="text-sm text-fg-muted">
                    {t("route.dashboard.empty_state")}
                  </p>
                </div>
                <Button onClick={() => setCreateCardOpen(true)}>
                  <Plus className="h-3.5 w-3.5" />
                  {t("common.add_card")}
                </Button>
              </CardContent>
            </Card>
          </div>
        </div>
        <CardDialog open={createCardOpen} onOpenChange={setCreateCardOpen} />
      </div>
    );
  }

  const filteredCard = cardFilter ? cards?.find((c) => c.id === cardFilter) : null;
  const headerSubtitle = filteredCard
    ? t("route.dashboard.statement_subtitle", { card: filteredCard.name })
    : t("route.dashboard.subtitle");

  return (
    <div className="pb-10">
      <PeriodHeader subtitle={headerSubtitle}>{periodPicker}</PeriodHeader>

      <div className="px-6 pt-4 flex items-center gap-1 flex-wrap">
        <button
          onClick={() => setCardFilter(null)}
          className={cn(
            "rounded-[var(--radius)] border px-2.5 py-1 text-xs transition-colors",
            cardFilter === null
              ? "border-accent bg-accent/10 text-accent"
              : "border-border text-fg-muted hover:bg-surface-hover",
          )}
        >
          {t("common.all")}
        </button>
        {(cards ?? []).map((c) => (
          <button
            key={c.id}
            onClick={() => setCardFilter(c.id)}
            className={cn(
              "flex items-center gap-1.5 rounded-[var(--radius)] border px-2.5 py-1 text-xs transition-colors",
              cardFilter === c.id
                ? "border-accent bg-accent/10 text-accent"
                : "border-border text-fg-muted hover:bg-surface-hover",
            )}
          >
            <span className="h-2 w-3 rounded-sm" style={{ backgroundColor: c.color }} />
            {c.name}
          </button>
        ))}
      </div>

      <div className="space-y-6 px-6 py-6">
        <div className="flex gap-3">
          <Stat
            label={mode === "year" ? t("stats.year_total") : t("stats.month_total")}
            value={formatMoney(summary?.totalCents ?? 0)}
            hint={t("stats.transactions_count", { count: txs?.length ?? 0 })}
          />
          <Stat
            label={t("stats.active_installments")}
            value={String(installmentsActive)}
            hint={t("stats.installments_hint")}
          />
          <Stat
            label={t("stats.active_cards")}
            value={String(cardsActive)}
            hint={t("stats.active_cards_hint")}
          />
          <Stat
            label={t("stats.next_due")}
            value={nextDue ? t("stats.due_day_format", { day: nextDue.dueDay }) : t("common.empty_dash")}
            hint={nextDue?.name ?? t("dashboard.add_card_prompt")}
            tone="accent"
          />
        </div>

        {mode === "year" && monthsBar.length > 0 && (
          <Card>
            <CardHeader className="flex-row items-center justify-between">
              <CardTitle>{t("dashboard.year_by_month")}</CardTitle>
              <span className="text-xs text-fg-subtle tabular">{year}</span>
            </CardHeader>
            <CardContent className="pt-0">
              <BarChart width={760} height={180} data={monthsBar}>
                <XAxis
                  dataKey="label"
                  tick={{ fontSize: 11, fill: "var(--fg-subtle)" }}
                  axisLine={{ stroke: "var(--border)" }}
                  tickLine={false}
                />
                <YAxis
                  tick={{ fontSize: 11, fill: "var(--fg-subtle)" }}
                  axisLine={false}
                  tickLine={false}
                  width={48}
                  tickFormatter={(v) => {
                    const n = Number(v);
                    if (!Number.isFinite(n)) return "";
                    if (Math.abs(n) >= 100000) return `${Math.round(n / 100000) / 10}k`;
                    return String(n / 100);
                  }}
                />
                <Tooltip
                  cursor={{ fill: "var(--surface-hover)" }}
                  formatter={(value) => {
                    const n = Number(value);
                    return Number.isFinite(n) ? formatMoney(n) : "";
                  }}
                  contentStyle={{
                    background: "var(--surface)",
                    border: "1px solid var(--border)",
                    borderRadius: "var(--radius)",
                    fontSize: "12px",
                    padding: "6px 10px",
                  }}
                  labelStyle={{ color: "var(--fg)" }}
                />
                <Bar
                  dataKey="total"
                  fill="var(--accent)"
                  radius={[3, 3, 0, 0]}
                  onClick={(d: unknown) => {
                    const ymHit = (d as { ym?: string } | undefined)?.ym;
                    if (ymHit) {
                      // Drill into the picked month — flips the store back
                      // to month mode so the user sees the standard view
                      // for that fatura.
                      setMode("month");
                      setYm(ymHit);
                    }
                  }}
                  className="cursor-pointer"
                />
              </BarChart>
            </CardContent>
          </Card>
        )}

        <div className="grid grid-cols-5 gap-6">
          <Card className="col-span-3">
            <CardHeader className="flex-row items-center justify-between">
              <CardTitle>{t("dashboard.top_categories")}</CardTitle>
              <span className="text-xs text-fg-subtle capitalize">
                {mode === "year" ? year : monthLabel(ym)}
              </span>
            </CardHeader>
            <CardContent>
              {topCategories.length === 0 ? (
                <p className="text-sm text-fg-subtle py-12 text-center">
                  {t("dashboard.no_categorized")}
                </p>
              ) : (
                <div className="flex items-center gap-4">
                  <PieChart width={180} height={180}>
                    <Pie
                      data={topCategories}
                      dataKey="cents"
                      nameKey="name"
                      cx="50%"
                      cy="50%"
                      innerRadius={50}
                      outerRadius={80}
                      paddingAngle={2}
                      stroke="none"
                      onClick={(slice: unknown) => {
                        const id = (slice as { id?: string } | undefined)?.id;
                        if (id && id !== "_") {
                          // Carry the dashboard's selected period so the
                          // Transactions page opens scoped to the same
                          // window — without it, it falls back to
                          // currentYearMonth() and the click looks broken
                          // when browsing past months / years.
                          navigate("/transactions", {
                            state:
                              mode === "year"
                                ? { year: yearStr, categoryIds: [id] }
                                : { ym, categoryIds: [id] },
                          });
                        }
                      }}
                    >
                      {topCategories.map((c) => (
                        <Cell
                          key={c.id}
                          fill={c.color}
                          className="cursor-pointer outline-none"
                        />
                      ))}
                    </Pie>
                    <Tooltip
                      formatter={(value) => {
                        const n = Number(value);
                        return Number.isFinite(n) ? formatMoney(n) : "";
                      }}
                      contentStyle={{
                        background: "var(--surface)",
                        border: "1px solid var(--border)",
                        borderRadius: "var(--radius)",
                        fontSize: "12px",
                        padding: "6px 10px",
                      }}
                      labelStyle={{ color: "var(--fg)" }}
                    />
                  </PieChart>
                  <div className="flex-1 space-y-2 min-w-0">
                    {topCategories.map((c) => (
                      <div key={c.id} className="flex items-center gap-2 text-sm">
                        <span
                          className="h-2 w-2 rounded-full shrink-0"
                          style={{ backgroundColor: c.color }}
                        />
                        <span className="truncate flex-1 text-fg">{c.name}</span>
                        <span className="tabular text-fg-muted">{formatMoney(c.cents)}</span>
                        <span className="text-xs text-fg-subtle tabular w-10 text-right">
                          {c.pct}%
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </CardContent>
          </Card>

          <Card className="col-span-2">
            <CardHeader className="flex-row items-center justify-between">
              <CardTitle>{t("dashboard.cards_section")}</CardTitle>
              <span className="text-xs text-fg-subtle">
                {mode === "year"
                  ? t("dashboard.year_total_label", { year })
                  : t("dashboard.current_statement")}
              </span>
            </CardHeader>
            <CardContent className="space-y-3">
              {(cards ?? []).map((card) => {
                const entry = summary?.byCard.find((b) => b.cardId === card.id);
                const used = entry?.totalCents ?? 0;
                const limit = card.creditLimitCents ?? 0;
                // Credit-limit % only makes sense against a single statement;
                // a year aggregate routinely exceeds the monthly limit, so
                // the bar would always show 100% and the % would mislead.
                const showLimitMeter = mode === "month" && limit > 0;
                const pct = showLimitMeter
                  ? Math.min(100, Math.round((used / limit) * 100))
                  : 0;
                return (
                  <div key={card.id} className="space-y-1.5">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <span
                          className="h-6 w-9 rounded"
                          style={{ backgroundColor: card.color }}
                        />
                        <div>
                          <div className="text-sm font-medium">{card.name}</div>
                          {card.last4 && (
                            <div className="text-[10px] text-fg-subtle tabular">
                              •••• {card.last4}
                            </div>
                          )}
                        </div>
                      </div>
                      <div className="text-right">
                        <div className="text-sm tabular font-medium">{formatMoney(used)}</div>
                        {showLimitMeter && (
                          <div className="text-[10px] text-fg-subtle tabular">
                            {t("dashboard.limit_usage", { pct, limit: formatMoney(limit) })}
                          </div>
                        )}
                      </div>
                    </div>
                    {showLimitMeter && (
                      <div className="h-1 w-full rounded-full bg-muted overflow-hidden">
                        <div
                          className="h-full rounded-full"
                          style={{
                            width: `${pct}%`,
                            backgroundColor: card.color,
                          }}
                        />
                      </div>
                    )}
                  </div>
                );
              })}
            </CardContent>
          </Card>
        </div>

        <Card>
          <CardHeader className="flex-row items-center justify-between">
            <CardTitle>{t("dashboard.recent_transactions")}</CardTitle>
            <NavLink
              to="/transactions"
              className="flex items-center gap-1 text-xs text-fg-muted hover:text-fg transition-colors"
            >
              {t("common.see_all")} <ArrowUpRight className="h-3 w-3" />
            </NavLink>
          </CardHeader>
          <CardContent className="p-0">
            <table className="w-full">
              <tbody>
                {recent.map((tx) => {
                  const card = cards?.find((c) => c.id === tx.cardId);
                  const cat = categories?.find((c) => c.id === tx.categoryId);
                  return (
                    <tr
                      key={tx.id}
                      className="border-b border-border last:border-0 hover:bg-surface-hover transition-colors"
                    >
                      <td className="px-5 py-2.5 w-20 text-xs text-fg-muted tabular">
                        {formatDate(tx.postedAt, "day")}
                      </td>
                      <td className="py-2.5 min-w-0">
                        <div className="flex items-center gap-2">
                          <div className="text-sm truncate">
                            {tx.merchantClean ?? tx.description}
                          </div>
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
                      <td className="px-3 py-2.5 w-32">
                        {cat && (
                          <div className="inline-flex items-center gap-1.5 rounded-full border border-border px-2 py-0.5 text-[10px]">
                            <span
                              className="h-1.5 w-1.5 rounded-full"
                              style={{ backgroundColor: cat.color }}
                            />
                            <span className="text-fg-muted">{t(`category.${cat.id}`, { defaultValue: cat.name })}</span>
                          </div>
                        )}
                      </td>
                      <td className="px-3 py-2.5 w-28 text-xs text-fg-subtle">
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
                      <td className="pl-3 pr-5 py-2.5 w-28 text-right tabular text-sm font-medium">
                        {formatMoney(tx.amountCents)}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
