import { useQuery } from "@tanstack/react-query";
import { ipc, isTauri } from "./ipc";
import { MOCK_CARDS, MOCK_CATEGORIES, MOCK_TRANSACTIONS } from "./mock";
import { statementPeriod } from "./utils";
import type { Card, Category, Transaction } from "./ipc";

export function useCards() {
  return useQuery({
    queryKey: ["cards"],
    queryFn: async (): Promise<Card[]> => (isTauri ? ipc.cards.list() : MOCK_CARDS),
  });
}

export function useCategories() {
  return useQuery({
    queryKey: ["categories"],
    queryFn: async (): Promise<Category[]> =>
      isTauri ? ipc.categories.list() : MOCK_CATEGORIES,
  });
}

export function useTransactions(filter?: {
  yearMonth?: string;
  year?: string;
  cardId?: string;
  categoryId?: string;
  query?: string;
}) {
  return useQuery({
    queryKey: ["transactions", filter],
    queryFn: async (): Promise<Transaction[]> => {
      if (isTauri) return ipc.transactions.list(filter);
      let list = [...MOCK_TRANSACTIONS];
      // Mirror backend filter logic so dev-mode (no Tauri) doesn't silently
      // diverge. When both card and yearMonth are set, group by statement
      // period (closing-day-aware) instead of calendar month.
      if (filter?.yearMonth && filter?.cardId) {
        const card = MOCK_CARDS.find((c) => c.id === filter.cardId);
        if (card) {
          list = list.filter(
            (t) => statementPeriod(t.postedAt, card.closingDay) === filter.yearMonth,
          );
        } else {
          list = list.filter((t) => t.postedAt.slice(0, 7) === filter.yearMonth);
        }
      } else if (filter?.yearMonth) {
        list = list.filter((t) => t.postedAt.slice(0, 7) === filter.yearMonth);
      } else if (filter?.year && filter?.cardId) {
        const card = MOCK_CARDS.find((c) => c.id === filter.cardId);
        if (card) {
          list = list.filter(
            (t) => statementPeriod(t.postedAt, card.closingDay).slice(0, 4) === filter.year,
          );
        } else {
          list = list.filter((t) => t.postedAt.slice(0, 4) === filter.year);
        }
      } else if (filter?.year) {
        list = list.filter((t) => t.postedAt.slice(0, 4) === filter.year);
      }
      if (filter?.cardId) list = list.filter((t) => t.cardId === filter.cardId);
      if (filter?.categoryId) list = list.filter((t) => t.categoryId === filter.categoryId);
      if (filter?.query) {
        const q = filter.query.toLowerCase();
        list = list.filter(
          (t) =>
            t.description.toLowerCase().includes(q) ||
            t.merchantClean?.toLowerCase().includes(q)
        );
      }
      return list;
    },
  });
}

export function useYearSummary(year: string, cardId?: string) {
  return useQuery({
    queryKey: ["yearSummary", year, cardId ?? null],
    queryFn: async () => {
      if (isTauri) return ipc.transactions.yearSummary(year, cardId);
      // Mock-mode: aggregate from MOCK_TRANSACTIONS, using statement period
      // when scoped to a single card so the buckets match the backend's
      // closing-day-aware grouping.
      const card = cardId ? MOCK_CARDS.find((c) => c.id === cardId) : undefined;
      const periodOf = (t: (typeof MOCK_TRANSACTIONS)[number]) =>
        card
          ? statementPeriod(t.postedAt, card.closingDay)
          : t.postedAt.slice(0, 7);
      const inYear = (t: (typeof MOCK_TRANSACTIONS)[number]) => {
        if (cardId && t.cardId !== cardId) return false;
        return periodOf(t).startsWith(year);
      };
      const txs = MOCK_TRANSACTIONS.filter(inYear);
      const totalCents = txs.reduce(
        (s, t) => s + (t.isRefund ? -t.amountCents : t.amountCents),
        0,
      );
      const monthAcc = new Map<string, number>();
      for (let m = 1; m <= 12; m += 1) {
        monthAcc.set(`${year}-${String(m).padStart(2, "0")}`, 0);
      }
      for (const t of txs) {
        const ym = periodOf(t);
        monthAcc.set(ym, (monthAcc.get(ym) ?? 0) + (t.isRefund ? -t.amountCents : t.amountCents));
      }
      const byMonth = [...monthAcc.entries()]
        .map(([yearMonth, totalCents]) => ({ yearMonth, totalCents }))
        .sort((a, b) => a.yearMonth.localeCompare(b.yearMonth));
      const byCategory = Object.entries(
        txs.reduce<Record<string, number>>((acc, t) => {
          const k = t.categoryId ?? "_uncategorized";
          acc[k] = (acc[k] ?? 0) + (t.isRefund ? -t.amountCents : t.amountCents);
          return acc;
        }, {})
      )
        .map(([categoryId, totalCents]) => ({
          categoryId: categoryId === "_uncategorized" ? null : categoryId,
          totalCents,
        }))
        .sort((a, b) => b.totalCents - a.totalCents);
      const byCard = Object.entries(
        txs.reduce<Record<string, number>>((acc, t) => {
          acc[t.cardId] = (acc[t.cardId] ?? 0) + (t.isRefund ? -t.amountCents : t.amountCents);
          return acc;
        }, {})
      ).map(([cardId, totalCents]) => ({ cardId, totalCents }));
      return { totalCents, byMonth, byCategory, byCard };
    },
  });
}

export function useMonthSummary(yearMonth: string, cardId?: string) {
  return useQuery({
    queryKey: ["monthSummary", yearMonth, cardId ?? null],
    queryFn: async () => {
      if (isTauri) return ipc.transactions.monthSummary(yearMonth, cardId);
      // Mock-mode aggregation. Match the backend's statement-period pivot
      // when a card is filtered.
      const card = cardId ? MOCK_CARDS.find((c) => c.id === cardId) : undefined;
      const inPeriod = (t: (typeof MOCK_TRANSACTIONS)[number]) => {
        if (cardId && t.cardId !== cardId) return false;
        if (card) return statementPeriod(t.postedAt, card.closingDay) === yearMonth;
        return t.postedAt.slice(0, 7) === yearMonth;
      };
      const txs = MOCK_TRANSACTIONS.filter(inPeriod);
      const totalCents = txs.reduce((s, t) => s + (t.isRefund ? -t.amountCents : t.amountCents), 0);
      const byCategory = Object.entries(
        txs.reduce<Record<string, number>>((acc, t) => {
          const k = t.categoryId ?? "_uncategorized";
          acc[k] = (acc[k] ?? 0) + (t.isRefund ? -t.amountCents : t.amountCents);
          return acc;
        }, {})
      )
        .map(([categoryId, totalCents]) => ({
          categoryId: categoryId === "_uncategorized" ? null : categoryId,
          totalCents,
        }))
        .sort((a, b) => b.totalCents - a.totalCents);
      const byCard = Object.entries(
        txs.reduce<Record<string, number>>((acc, t) => {
          acc[t.cardId] = (acc[t.cardId] ?? 0) + (t.isRefund ? -t.amountCents : t.amountCents);
          return acc;
        }, {})
      ).map(([cardId, totalCents]) => ({ cardId, totalCents }));
      return { totalCents, byCategory, byCard };
    },
  });
}
