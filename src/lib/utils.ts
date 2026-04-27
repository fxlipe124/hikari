import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";
import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import i18n from "./i18n";
import { useCurrencyStore, DEFAULT_CURRENCY } from "@/hooks/useCurrencyStore";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/**
 * Format a cents value as currency. Reads the active currency from the
 * zustand store at call time. Components should prefer the {@link useFormatMoney}
 * hook when displaying money so they re-render when the currency changes.
 */
export function formatMoney(cents: number, currency?: string): string {
  const code = currency ?? useCurrencyStore.getState().currency ?? DEFAULT_CURRENCY;
  return new Intl.NumberFormat(i18n.language, {
    style: "currency",
    currency: code,
    minimumFractionDigits: 2,
  }).format(cents / 100);
}

/**
 * Reactive money formatter — components that render amounts should call this
 * at the top and use the returned closure. The closure subscribes to the
 * currency store and the i18n locale so changing either triggers a re-render.
 */
export function useFormatMoney(): (cents: number) => string {
  const { i18n: i18nInstance } = useTranslation();
  const currency = useCurrencyStore((s) => s.currency);
  return useMemo(() => {
    const fmt = new Intl.NumberFormat(i18nInstance.language, {
      style: "currency",
      currency,
      minimumFractionDigits: 2,
    });
    return (cents: number) => fmt.format(cents / 100);
  }, [currency, i18nInstance.language]);
}

export function formatCompact(cents: number): string {
  return new Intl.NumberFormat(i18n.language, {
    notation: "compact",
    maximumFractionDigits: 1,
  }).format(cents / 100);
}

/**
 * Parse a number that the user typed in their locale's convention. Handles
 * BR-style ("1.234,56") and US-style ("1,234.56") by detecting which
 * separator appears last and treating it as the decimal separator.
 */
export function parseMoney(input: string): number | null {
  if (!input || !input.trim()) return null;
  const stripped = input.trim().replace(/[R$€£¥$\s]/g, "");
  const lastDot = stripped.lastIndexOf(".");
  const lastComma = stripped.lastIndexOf(",");
  let normalized: string;
  if (lastDot >= 0 && lastComma >= 0) {
    if (lastComma > lastDot) {
      normalized = stripped.replace(/\./g, "").replace(",", ".");
    } else {
      normalized = stripped.replace(/,/g, "");
    }
  } else if (lastComma >= 0) {
    normalized = stripped.replace(",", ".");
  } else {
    normalized = stripped;
  }
  const n = Number(normalized);
  if (!Number.isFinite(n)) return null;
  return Math.round(n * 100);
}

/** @deprecated use {@link useFormatMoney} or {@link formatMoney}. */
export const formatBRL = formatMoney;
/** @deprecated use {@link parseMoney}. */
export const parseBRL = parseMoney;

export function formatDate(iso: string, style: "short" | "long" | "day" = "short"): string {
  // posted_at is stored as `YYYY-MM-DDTHH:MM:SSZ`. Going through `new Date(iso)`
  // parses the trailing `Z` as UTC and then `.getDate()` returns the *local*
  // calendar day — in UTC-3 a row stamped 2024-08-15T00:00:00Z renders as
  // "14 ago" because midnight UTC is 21:00 of the previous day locally.
  // Treat the prefix as a calendar date instead: parse YYYY-MM-DD directly,
  // and only build a Date for the month-name lookup using local-time
  // constructor so the formatter sees the day we actually want.
  const datePart = iso.slice(0, 10);
  const [yStr, mStr, dStr] = datePart.split("-");
  const y = parseInt(yStr, 10);
  const m = parseInt(mStr, 10);
  const dy = parseInt(dStr, 10);
  if (!Number.isFinite(y) || !Number.isFinite(m) || !Number.isFinite(dy)) {
    return iso;
  }
  const localDate = new Date(y, m - 1, dy);
  const day = String(dy).padStart(2, "0");
  const month = new Intl.DateTimeFormat(i18n.language, {
    month: style === "long" ? "long" : "short",
  }).format(localDate);
  if (style === "day") return `${day} ${month}`;
  return `${day} ${month} ${y}`;
}

export function monthLabel(yearMonth: string): string {
  const [y, m] = yearMonth.split("-").map(Number);
  const d = new Date(y, m - 1, 1);
  const month = new Intl.DateTimeFormat(i18n.language, { month: "long" }).format(d);
  return `${month} ${y}`;
}

export function currentYearMonth(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

/**
 * Maps a transaction date + the card's closing day to the "YYYY-MM" of the
 * statement that purchase belongs to. Mirrors the Rust helper in
 * src-tauri/src/repo/transactions.rs::statement_period.
 *
 * Examples with `closingDay = 16`:
 *   2024-08-14 → "2024-08"
 *   2024-07-17 → "2024-08" (after July's closing → August statement)
 *   2024-12-17 → "2025-01" (year rolls over)
 */
export function statementPeriod(postedAt: string, closingDay: number): string {
  const date = postedAt.slice(0, 10);
  const y = parseInt(date.slice(0, 4), 10) || new Date().getFullYear();
  const m = parseInt(date.slice(5, 7), 10) || 1;
  const d = parseInt(date.slice(8, 10), 10) || 1;
  if (d <= closingDay) {
    return `${String(y).padStart(4, "0")}-${String(m).padStart(2, "0")}`;
  }
  const ny = m === 12 ? y + 1 : y;
  const nm = m === 12 ? 1 : m + 1;
  return `${String(ny).padStart(4, "0")}-${String(nm).padStart(2, "0")}`;
}
