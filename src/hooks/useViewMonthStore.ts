import { create } from "zustand";
import { currentYearMonth } from "@/lib/utils";

/**
 * Lightweight in-memory store for the period the user is currently
 * browsing in the main views (Dashboard, Transactions). Persisting it
 * here instead of `useState` per route means switching from Dashboard
 * to Transactions, or popping a sub-dialog, doesn't snap the period
 * back to "today".
 *
 * Two modes:
 *   - "month": browse a single statement period (YYYY-MM). The default.
 *   - "year": browse a full calendar year — Dashboard renders by-month
 *     aggregates and Transactions lists every row in the year. Useful
 *     for tax season / yearly review.
 *
 * Intentionally not persisted to disk — when the app starts cold or
 * the vault re-locks, "current month" is the right default. The
 * persistence is only for the user's session navigation.
 */
export type ViewMode = "month" | "year";

interface ViewMonthState {
  mode: ViewMode;
  /** YYYY-MM — the month the user last browsed in Dashboard / Transactions. */
  ym: string;
  /** YYYY — the year currently selected in year mode. */
  year: number;
  setMode: (mode: ViewMode) => void;
  setYm: (ym: string) => void;
  setYear: (year: number) => void;
}

const today = currentYearMonth();

export const useViewMonthStore = create<ViewMonthState>((set) => ({
  mode: "month",
  ym: today,
  year: parseInt(today.slice(0, 4), 10),
  setMode: (mode) => set({ mode }),
  setYm: (ym) => set({ ym }),
  setYear: (year) => set({ year }),
}));
