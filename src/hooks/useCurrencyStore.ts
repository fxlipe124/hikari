import { create } from "zustand";
import { getStoredCurrency, setStoredCurrency } from "@/lib/config";

export const SUPPORTED_CURRENCIES = ["BRL", "USD"] as const;
export type Currency = (typeof SUPPORTED_CURRENCIES)[number];
export const DEFAULT_CURRENCY: Currency = "BRL";

export function isSupportedCurrency(value: unknown): value is Currency {
  return typeof value === "string" && (SUPPORTED_CURRENCIES as readonly string[]).includes(value);
}

interface CurrencyState {
  currency: Currency;
  setCurrency: (c: Currency) => Promise<void>;
  hydrate: () => Promise<void>;
}

export const useCurrencyStore = create<CurrencyState>((set) => ({
  currency: DEFAULT_CURRENCY,
  setCurrency: async (c: Currency) => {
    set({ currency: c });
    await setStoredCurrency(c);
  },
  hydrate: async () => {
    const stored = await getStoredCurrency();
    if (stored && isSupportedCurrency(stored)) {
      set({ currency: stored });
    }
  },
}));
