import { create } from "zustand";
import { currentYearMonth } from "@/lib/utils";

/**
 * Lightweight in-memory store for the month the user is currently
 * browsing in the main views (Dashboard, Transactions). Persisting it
 * here instead of `useState` per route means switching from Dashboard
 * to Transactions, or popping a sub-dialog, doesn't snap the month
 * back to "today".
 *
 * Intentionally not persisted to disk — when the app starts cold or
 * the vault re-locks, "current month" is the right default. The
 * persistence is only for the user's session navigation.
 */
interface ViewMonthState {
  /** YYYY-MM the user last browsed in Dashboard / Transactions. */
  ym: string;
  setYm: (ym: string) => void;
}

export const useViewMonthStore = create<ViewMonthState>((set) => ({
  ym: currentYearMonth(),
  setYm: (ym) => set({ ym }),
}));
