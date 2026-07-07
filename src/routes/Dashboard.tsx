import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { NavLink, useNavigate } from "react-router-dom";
import { ArrowUpRight, CreditCard, Plus } from "lucide-react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { PeriodPicker } from "@/components/ui/PeriodPicker";
import { Skeleton } from "@/components/ui/Skeleton";
import { EmptyState } from "@/components/ui/EmptyState";
import { DeltaBadge } from "@/components/ui/DeltaBadge";
import { Sparkline } from "@/components/ui/Sparkline";
import { PageHeader } from "@/components/PageHeader";
import { CardFilterChips } from "@/components/CardFilterChips";
import { ChartTooltip } from "@/components/charts/ChartTooltip";
import { CardDialog } from "@/components/CardDialog";
import {
  useCards,
  useCategories,
  useMonthSummary,
  useTrailingMonths,
  useTransactions,
  useYearSummary,
} from "@/lib/queries";
import { useViewMonthStore } from "@/hooks/useViewMonthStore";
import {
  cn,
  currentYearMonth,
  formatCompact,
  formatDate,
  monthLabel,
  periodBounds,
  shiftYearMonth,
  statementPeriod,
  useFormatMoney,
} from "@/lib/utils";

function Stat({
  label,
  value,
  hint,
  badge,
  footer,
  tone = "default",
}: {
  label: string;
  value: string;
  hint?: string;
  badge?: React.ReactNode;
  footer?: React.ReactNode;
  tone?: "default" | "accent" | "warning";
}) {
  return (
    <Card className="flex-1">
      <CardContent className="space-y-1 py-4">
        <div className="text-xs text-fg-muted">{label}</div>
        <div className="flex items-baseline gap-2">
          <div
            className={cn(
              "text-2xl font-semibold tabular tracking-tight",
              tone === "accent" && "text-accent",
              tone === "warning" && "text-warning"
            )}
          >
            {value}
          </div>
          {badge}
        </div>
        {hint && <div className="text-xs text-fg-subtle">{hint}</div>}
        {footer && <div className="pt-1.5">{footer}</div>}
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
  const { data: cards, isLoading: cardsLoading } = useCards();
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
  const { data: txs, isLoading: txsLoading } = useTransactions(
    mode === "month"
      ? { yearMonth: ym, cardId: cardFilter ?? undefined }
      : { year: yearStr, cardId: cardFilter ?? undefined },
  );
  const { data: categories } = useCategories();
  const [createCardOpen, setCreateCardOpen] = useState(false);
  // Cross-highlight between the donut and its legend: hovering either side
  // dims every other slice/row.
  const [activeCatId, setActiveCatId] = useState<string | null>(null);
  const formatMoney = useFormatMoney();
  // Recharts series animations don't respect prefers-reduced-motion on
  // their own. Read once per mount — the preference doesn't change often
  // enough to warrant a listener.
  const reduceMotion = useMemo(
    () => window.matchMedia("(prefers-reduced-motion: reduce)").matches,
    [],
  );

  const filteredCard = cardFilter
    ? (cards?.find((c) => c.id === cardFilter) ?? null)
    : null;
  const closingDay = filteredCard?.closingDay ?? null;
  // Previous-period baselines for the delta badges. The month IPC accepts
  // any YYYY-MM, so "last period" is one more cached query — no new backend
  // surface. prevTxs feeds the same-point-in-cycle comparison while a
  // period is still in progress.
  const prevYm = shiftYearMonth(ym, -1);
  const { data: prevMonthSummary } = useMonthSummary(
    prevYm,
    cardFilter ?? undefined,
  );
  const { data: prevTxs } = useTransactions({
    yearMonth: prevYm,
    cardId: cardFilter ?? undefined,
  });
  const prevYearStr = String(year - 1);
  const { data: prevYearSummary } = useYearSummary(
    prevYearStr,
    cardFilter ?? undefined,
  );
  const { months: trailingMonths } = useTrailingMonths(
    ym,
    cardFilter ?? undefined,
  );

  // All hooks must be called unconditionally and in the same order on every
  // render. Keep useMemo calls above the empty-state early return so React
  // doesn't see a different hook count before vs after the first card lands.

  // Period math for the month view: statement bounds, days elapsed, spend
  // so far vs already-registered future rows (parcelas booked past today),
  // run-rate projection, and the same-point baseline in the previous
  // period. Every sum follows the backend's sign rule: refunds are stored
  // positive with isRefund=true and subtract from aggregates.
  const periodStats = useMemo(() => {
    if (mode !== "month") return null;
    const MS_DAY = 86_400_000;
    const { start, end } = periodBounds(ym, closingDay);
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const todayIso = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;
    const dayCount = Math.round((end.getTime() - start.getTime()) / MS_DAY) + 1;
    const isCurrent = today >= start && today <= end;
    const elapsed = isCurrent
      ? Math.round((today.getTime() - start.getTime()) / MS_DAY) + 1
      : dayCount;

    let past = 0;
    let committedFuture = 0;
    const pastByCat = new Map<string | null, number>();
    for (const tx of txs ?? []) {
      const s = tx.isRefund ? -tx.amountCents : tx.amountCents;
      if (tx.postedAt.slice(0, 10) <= todayIso) {
        past += s;
        const k = tx.categoryId ?? null;
        pastByCat.set(k, (pastByCat.get(k) ?? 0) + s);
      } else {
        committedFuture += s;
      }
    }
    const remaining = Math.max(0, dayCount - elapsed);
    const runRate = elapsed > 0 ? past / elapsed : 0;
    // Projection = known spend + already-booked future rows + run-rate over
    // the remaining days. Only meaningful while the period is in progress —
    // a closed month has a real total and a future one has nothing to
    // extrapolate from.
    const projection = isCurrent
      ? Math.round(past + committedFuture + runRate * remaining)
      : null;
    const total = summary?.totalCents ?? 0;
    const dailyAvg = isCurrent ? runRate : dayCount > 0 ? total / dayCount : 0;

    // Baseline for the pace badge: an in-progress period compares against
    // the previous period truncated at the same day offset ("am I ahead of
    // where I was last month?"); a closed period compares total vs total.
    let paceBaseline: number | null = null;
    let prevSameByCat: Map<string | null, number> | null = null;
    if (isCurrent) {
      if (prevTxs) {
        const prevStart = periodBounds(prevYm, closingDay).start;
        paceBaseline = 0;
        prevSameByCat = new Map();
        for (const tx of prevTxs) {
          const [py, pm, pd] = tx.postedAt.slice(0, 10).split("-").map(Number);
          const offset =
            Math.round(
              (new Date(py, pm - 1, pd).getTime() - prevStart.getTime()) / MS_DAY,
            ) + 1;
          if (offset > elapsed) continue;
          const s = tx.isRefund ? -tx.amountCents : tx.amountCents;
          paceBaseline += s;
          const k = tx.categoryId ?? null;
          prevSameByCat.set(k, (prevSameByCat.get(k) ?? 0) + s);
        }
      }
    } else if (prevMonthSummary) {
      paceBaseline = prevMonthSummary.totalCents;
      prevSameByCat = new Map(
        prevMonthSummary.byCategory.map((e) => [e.categoryId, e.totalCents]),
      );
    }

    const prevB = periodBounds(prevYm, closingDay);
    const prevDayCount =
      Math.round((prevB.end.getTime() - prevB.start.getTime()) / MS_DAY) + 1;
    const prevDailyAvg =
      prevMonthSummary && prevDayCount > 0
        ? prevMonthSummary.totalCents / prevDayCount
        : null;

    return {
      isCurrent,
      remaining,
      dailyAvg,
      projection,
      paceNow: isCurrent ? past : total,
      paceBaseline,
      prevDailyAvg,
      pastByCat,
      prevSameByCat,
    };
  }, [mode, ym, closingDay, txs, summary, prevTxs, prevMonthSummary, prevYm]);

  // Year-mode counterparts. "Today"'s position within the year is derived
  // in the same terms as the buckets — statement periods when a card is
  // filtered (a July 7th past the closing day already sits in the August
  // statement), calendar months otherwise. The pace side counts only spend
  // actually incurred (postedAt <= today, refund-aware), mirroring month
  // mode, so future-booked parcelas don't inflate the year-over-year badge
  // or the monthly average. The prev-year baseline is month-granular: full
  // prior buckets plus the in-progress bucket pro-rated by days elapsed —
  // coarse, but honest enough at year scale.
  const yearStats = useMemo(() => {
    if (mode !== "year" || !yearSummary) return null;
    const MS_DAY = 86_400_000;
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const todayIso = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;
    const curYm =
      closingDay != null
        ? statementPeriod(todayIso, closingDay)
        : currentYearMonth();
    const isCurrentYear = curYm.slice(0, 4) === String(year);
    const bucketIdx = isCurrentYear
      ? parseInt(curYm.slice(5, 7), 10) - 1
      : 11;
    const monthsElapsed = bucketIdx + 1;

    let past = 0;
    for (const tx of txs ?? []) {
      const s = tx.isRefund ? -tx.amountCents : tx.amountCents;
      if (tx.postedAt.slice(0, 10) <= todayIso) past += s;
    }
    const paceNow = isCurrentYear ? past : yearSummary.totalCents;
    const monthlyAvg = monthsElapsed > 0 ? paceNow / monthsElapsed : 0;
    const prevMonthlyAvg = prevYearSummary
      ? prevYearSummary.totalCents / 12
      : null;

    let paceBaseline: number | null = null;
    if (prevYearSummary) {
      if (!isCurrentYear) {
        paceBaseline = prevYearSummary.totalCents;
      } else {
        const { start, end } = periodBounds(curYm, closingDay);
        const dayCount =
          Math.round((end.getTime() - start.getTime()) / MS_DAY) + 1;
        const elapsed = Math.min(
          dayCount,
          Math.max(1, Math.round((today.getTime() - start.getTime()) / MS_DAY) + 1),
        );
        const frac = dayCount > 0 ? elapsed / dayCount : 1;
        paceBaseline = prevYearSummary.byMonth.reduce((s, b, i) => {
          if (i < bucketIdx) return s + b.totalCents;
          if (i === bucketIdx) return s + b.totalCents * frac;
          return s;
        }, 0);
      }
    }
    return { isCurrentYear, monthlyAvg, prevMonthlyAvg, paceBaseline, paceNow };
  }, [mode, yearSummary, prevYearSummary, year, txs, closingDay]);

  const topCategories = useMemo(() => {
    if (!summary || !categories) return [];
    const total = summary.totalCents || 1;
    // Per-category baseline for the legend deltas: same-point sums while a
    // month is in progress, the full previous period once it's closed, the
    // full previous year in year mode. Skipped for the in-progress year,
    // where no cheap honest baseline exists.
    let baseline: Map<string | null, number> | null = null;
    if (mode === "month") {
      baseline = periodStats?.prevSameByCat ?? null;
    } else if (yearStats && !yearStats.isCurrentYear && prevYearSummary) {
      baseline = new Map(
        prevYearSummary.byCategory.map((e) => [e.categoryId, e.totalCents]),
      );
    }
    // While the period is in progress the displayed total includes booked
    // future parcelas, but the delta must compare like with like: spend so
    // far vs the truncated previous period.
    const currentSide =
      mode === "month" && periodStats?.isCurrent ? periodStats.pastByCat : null;
    return summary.byCategory.slice(0, 6).map((entry) => {
      const cat = categories.find((c) => c.id === entry.categoryId);
      const key = entry.categoryId ?? null;
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
        deltaNow: currentSide ? (currentSide.get(key) ?? 0) : entry.totalCents,
        prevCents: baseline?.get(key) ?? null,
      };
    });
  }, [summary, categories, t, mode, periodStats, yearStats, prevYearSummary]);

  // Month-by-month bar data for the year view. Empty array in month mode —
  // the bar chart isn't rendered there. Uses the active i18n locale for the
  // month abbreviation so the chart axis matches the rest of the UI (e.g.
  // "fev" instead of "Feb" in pt-BR mode).
  const monthsBar = useMemo(() => {
    if (mode !== "year" || !yearSummary) return [];
    const fmt = new Intl.DateTimeFormat(i18n.language, { month: "short" });
    return yearSummary.byMonth.map((b, i, arr) => {
      const monthIdx = parseInt(b.yearMonth.slice(5, 7), 10) - 1;
      const date = new Date(year, monthIdx, 1);
      const label = fmt.format(date);
      return {
        ym: b.yearMonth,
        label,
        total: b.totalCents,
        // Previous bucket's total feeds the tooltip's month-over-month
        // delta without a second lookup at hover time.
        prevTotal: i > 0 ? arr[i - 1].totalCents : null,
      };
    });
  }, [mode, yearSummary, year, i18n.language]);

  // The statement (or calendar) period that "today" falls into — used to
  // render the in-progress bar in full accent while the rest stay muted.
  const currentPeriodYm = useMemo(() => {
    const today = new Date();
    const iso = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;
    return closingDay != null ? statementPeriod(iso, closingDay) : currentYearMonth();
  }, [closingDay]);

  // Donut data = top-6 categories plus an aggregated "Others" slice so the
  // slice angles actually match the legend percentages (the pie normalizes
  // angles to the sum of what it's given — top-6 alone distorts them
  // whenever more than 6 categories have spend).
  const donutData = useMemo(() => {
    if (!summary || topCategories.length === 0) return [];
    const total = summary.totalCents || 1;
    const topSum = topCategories.reduce((s, c) => s + c.cents, 0);
    const rest = summary.totalCents - topSum;
    if (rest <= 0) return topCategories;
    return [
      ...topCategories,
      {
        id: "_others",
        name: t("dashboard.other_categories"),
        color: "var(--fg-subtle)",
        cents: rest,
        pct: Math.min(100, Math.round((rest / total) * 100)),
        deltaNow: rest,
        prevCents: null,
      },
    ];
  }, [summary, topCategories, t]);

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

  const headerSubtitle = filteredCard
    ? t("route.dashboard.statement_subtitle", { card: filteredCard.name })
    : t("route.dashboard.subtitle");

  // Queries still resolving: show the page skeleton instead of falling
  // through to the welcome card — `undefined` data is not an empty vault,
  // and the old code flashed "Welcome to Hikari" on every unlock. Header
  // and card chips render for real (same tree position as the loaded
  // branch, so React keeps their DOM) — swapping a filter shouldn't yank
  // the control the user just clicked.
  const isLoading = cardsLoading || txsLoading;
  if (isLoading) {
    return (
      <div className="pb-10">
        <PageHeader
          title={t("route.dashboard.title")}
          subtitle={headerSubtitle}
          actions={periodPicker}
        />
        <div className="space-y-4 px-6 py-4">
          <CardFilterChips
            cards={cards ?? []}
            value={cardFilter}
            onChange={setCardFilter}
          />
          <div className="flex gap-3">
            {Array.from({ length: 4 }).map((_, i) => (
              <Skeleton key={i} className="h-[104px] flex-1 rounded-[var(--radius-lg)]" />
            ))}
          </div>
          <div className="grid grid-cols-5 gap-4">
            <Skeleton className="col-span-3 h-60 rounded-[var(--radius-lg)]" />
            <Skeleton className="col-span-2 h-60 rounded-[var(--radius-lg)]" />
          </div>
          <div className="space-y-2">
            {Array.from({ length: 5 }).map((_, i) => (
              <Skeleton key={i} className="h-9 w-full" />
            ))}
          </div>
        </div>
      </div>
    );
  }

  const isEmpty = (cards?.length ?? 0) === 0 && (txs?.length ?? 0) === 0;
  if (isEmpty) {
    return (
      <div className="pb-10">
        <PageHeader
          title={t("route.dashboard.title")}
          subtitle={t("route.dashboard.subtitle")}
          actions={periodPicker}
        />
        <div className="px-6 py-12">
          <div className="mx-auto max-w-md">
            <Card>
              <EmptyState
                icon={CreditCard}
                title={t("route.dashboard.welcome_title")}
                description={t("route.dashboard.empty_state")}
                action={
                  <Button onClick={() => setCreateCardOpen(true)}>
                    <Plus className="h-3.5 w-3.5" />
                    {t("common.add_card")}
                  </Button>
                }
              />
            </Card>
          </div>
        </div>
        <CardDialog open={createCardOpen} onOpenChange={setCreateCardOpen} />
      </div>
    );
  }

  // Legend deltas only get a column when at least one category has a
  // baseline — otherwise the empty reserved width just shifts the layout.
  const hasCategoryBaseline = topCategories.some((c) => c.prevCents !== null);
  const categoryDeltaTitle =
    mode === "month"
      ? periodStats?.isCurrent
        ? t("stats.vs_same_point")
        : t("stats.vs_prev_month")
      : t("stats.vs_prev_year");

  return (
    <div className="pb-10">
      <PageHeader
        title={t("route.dashboard.title")}
        subtitle={headerSubtitle}
        actions={periodPicker}
      />

      <div className="space-y-4 px-6 py-4">
        <CardFilterChips
          cards={cards ?? []}
          value={cardFilter}
          onChange={setCardFilter}
        />

        <div className="flex gap-3">
          <Stat
            label={mode === "year" ? t("stats.year_total") : t("stats.month_total")}
            value={formatMoney(summary?.totalCents ?? 0)}
            hint={t("stats.transactions_count", { count: txs?.length ?? 0 })}
            badge={
              mode === "month" && periodStats ? (
                <DeltaBadge
                  current={periodStats.paceNow}
                  previous={periodStats.paceBaseline}
                  title={
                    periodStats.isCurrent
                      ? t("stats.vs_same_point")
                      : t("stats.vs_prev_month")
                  }
                />
              ) : mode === "year" && yearStats ? (
                <DeltaBadge
                  current={yearStats.paceNow}
                  previous={yearStats.paceBaseline}
                  title={
                    yearStats.isCurrentYear
                      ? t("stats.vs_same_point_year")
                      : t("stats.vs_prev_year")
                  }
                />
              ) : undefined
            }
            footer={
              mode === "month" && trailingMonths && trailingMonths.length >= 2 ? (
                <span title={t("stats.trend_12m")}>
                  <Sparkline data={trailingMonths.map((b) => b.totalCents)} />
                </span>
              ) : undefined
            }
          />
          {mode === "month" && periodStats ? (
            <Stat
              label={t("stats.daily_avg")}
              value={formatMoney(Math.round(periodStats.dailyAvg))}
              hint={t("stats.daily_avg_hint")}
              badge={
                <DeltaBadge
                  current={periodStats.dailyAvg}
                  previous={periodStats.prevDailyAvg}
                  title={t("stats.vs_prev_month")}
                />
              }
            />
          ) : (
            <Stat
              label={t("stats.monthly_avg")}
              value={formatMoney(Math.round(yearStats?.monthlyAvg ?? 0))}
              hint={t("stats.monthly_avg_hint")}
              badge={
                yearStats ? (
                  <DeltaBadge
                    current={yearStats.monthlyAvg}
                    previous={yearStats.prevMonthlyAvg}
                    title={t("stats.vs_prev_year")}
                  />
                ) : undefined
              }
            />
          )}
          {mode === "month" && periodStats?.projection !== null && periodStats?.projection !== undefined ? (
            <Stat
              label={t("stats.projection")}
              value={formatMoney(periodStats.projection)}
              hint={
                periodStats.remaining === 0
                  ? t("stats.projection_hint_last_day")
                  : t("stats.projection_hint", { count: periodStats.remaining })
              }
            />
          ) : (
            <Stat
              label={t("stats.active_installments")}
              value={String(installmentsActive)}
              hint={t("stats.installments_hint")}
            />
          )}
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
              <ResponsiveContainer width="100%" height={180}>
                <BarChart data={monthsBar}>
                  <CartesianGrid vertical={false} stroke="var(--border)" />
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
                      return Number.isFinite(n) ? formatCompact(n) : "";
                    }}
                  />
                  <Tooltip
                    cursor={{ fill: "var(--surface-hover)" }}
                    content={
                      <ChartTooltip
                        formatter={formatMoney}
                        renderExtra={(datum) => {
                          const row = datum as
                            | { total?: number; prevTotal?: number | null }
                            | undefined;
                          return row?.prevTotal != null && row.prevTotal > 0 ? (
                            <DeltaBadge
                              compact
                              current={row.total ?? 0}
                              previous={row.prevTotal}
                            />
                          ) : null;
                        }}
                      />
                    }
                  />
                  <Bar
                    dataKey="total"
                    radius={[3, 3, 0, 0]}
                    activeBar={{ fill: "var(--accent-hover)" }}
                    isAnimationActive={!reduceMotion}
                    animationBegin={0}
                    animationDuration={250}
                    animationEasing="ease-out"
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
                  >
                    {monthsBar.map((b) => (
                      <Cell
                        key={b.ym}
                        fill={
                          b.ym === currentPeriodYm
                            ? "var(--accent)"
                            : "color-mix(in oklch, var(--accent) 55%, transparent)"
                        }
                      />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
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
                <EmptyState as="p" title={t("dashboard.no_categorized")} className="py-8" />
              ) : (
                <div className="flex items-center gap-4">
                  <div className="relative shrink-0">
                    <PieChart width={180} height={180}>
                      <Pie
                        data={donutData}
                        dataKey="cents"
                        nameKey="name"
                        cx="50%"
                        cy="50%"
                        innerRadius={50}
                        outerRadius={80}
                        paddingAngle={2}
                        stroke="none"
                        isAnimationActive={!reduceMotion}
                        animationBegin={0}
                        animationDuration={250}
                        animationEasing="ease-out"
                        onMouseEnter={(_, index) =>
                          setActiveCatId(donutData[index]?.id ?? null)
                        }
                        onMouseLeave={() => setActiveCatId(null)}
                        onClick={(slice: unknown) => {
                          const id = (slice as { id?: string } | undefined)?.id;
                          if (id && id !== "_" && id !== "_others") {
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
                        {donutData.map((c) => (
                          <Cell
                            key={c.id}
                            fill={c.color}
                            fillOpacity={
                              activeCatId && activeCatId !== c.id ? 0.35 : 1
                            }
                            className={cn(
                              "outline-none transition-[fill-opacity]",
                              c.id !== "_others" && c.id !== "_" && "cursor-pointer",
                            )}
                          />
                        ))}
                      </Pie>
                      <Tooltip
                        content={
                          <ChartTooltip
                            formatter={formatMoney}
                            renderExtra={(datum) => {
                              const row = datum as { pct?: number } | undefined;
                              return row?.pct !== undefined ? (
                                <span className="text-fg-subtle tabular">
                                  {row.pct}%
                                </span>
                              ) : null;
                            }}
                          />
                        }
                      />
                    </PieChart>
                    <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
                      <span className="text-[10px] text-fg-subtle">
                        {mode === "year" ? t("stats.year_total") : t("stats.month_total")}
                      </span>
                      <span className="text-sm font-semibold tabular tracking-tight">
                        {formatMoney(summary?.totalCents ?? 0)}
                      </span>
                    </div>
                  </div>
                  <div className="flex-1 space-y-2 min-w-0">
                    {donutData.map((c) => (
                      <div
                        key={c.id}
                        onMouseEnter={() => setActiveCatId(c.id)}
                        onMouseLeave={() => setActiveCatId(null)}
                        className={cn(
                          "flex items-center gap-2 text-sm transition-opacity",
                          activeCatId && activeCatId !== c.id && "opacity-40",
                        )}
                      >
                        <span
                          className="h-2 w-2 rounded-full shrink-0"
                          style={{ backgroundColor: c.color }}
                        />
                        <span className="truncate flex-1 text-fg">{c.name}</span>
                        <span className="tabular text-fg-muted">{formatMoney(c.cents)}</span>
                        <span className="text-xs text-fg-subtle tabular w-10 text-right">
                          {c.pct}%
                        </span>
                        {hasCategoryBaseline && (
                          <span className="w-9 text-right shrink-0">
                            {c.prevCents !== null && c.prevCents > 0 && (
                              <DeltaBadge
                                compact
                                current={c.deltaNow}
                                previous={c.prevCents}
                                title={categoryDeltaTitle}
                              />
                            )}
                          </span>
                        )}
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
                      <td className="px-5 py-2 w-20 text-xs text-fg-muted tabular">
                        {formatDate(tx.postedAt, "day")}
                      </td>
                      <td className="py-2 min-w-0">
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
                      <td className="px-3 py-2 w-32">
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
                      <td className="px-3 py-2 w-28 text-xs text-fg-subtle">
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
                      <td className="pl-3 pr-5 py-2 w-28 text-right tabular text-sm font-medium">
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
