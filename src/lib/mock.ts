// Dev-only mock data, used by `lib/queries.ts` when the app is opened in a
// regular browser (not the Tauri runtime). Real users always see their own
// data — these names are illustrative only and intentionally issuer-agnostic
// and merchant-agnostic.
import type { Card, Category, Transaction } from "./ipc";

export const MOCK_CARDS: Card[] = [
  {
    id: "card-personal",
    name: "Personal Card",
    brand: "mastercard",
    last4: "4421",
    closingDay: 24,
    dueDay: 2,
    color: "#b45309",
    creditLimitCents: 1800000,
  },
  {
    id: "card-shopping",
    name: "Shopping Card",
    brand: "visa",
    last4: "8812",
    closingDay: 15,
    dueDay: 22,
    color: "#0ea5e9",
    creditLimitCents: 900000,
  },
  {
    id: "card-travel",
    name: "Travel Card",
    brand: "mastercard",
    last4: "1109",
    closingDay: 6,
    dueDay: 14,
    color: "#7e22ce",
    creditLimitCents: 2500000,
  },
];

export const MOCK_CATEGORIES: Category[] = [
  { id: "cat-food", name: "Food", icon: "utensils", color: "#ea580c", parentId: null },
  { id: "cat-delivery", name: "Delivery", icon: "bike", color: "#dc2626", parentId: "cat-food" },
  { id: "cat-market", name: "Groceries", icon: "shopping-cart", color: "#16a34a", parentId: "cat-food" },
  { id: "cat-transport", name: "Transportation", icon: "car", color: "#2563eb", parentId: null },
  { id: "cat-fuel", name: "Fuel", icon: "fuel", color: "#1e40af", parentId: "cat-transport" },
  { id: "cat-rideshare", name: "Rideshare", icon: "car-taxi-front", color: "#1d4ed8", parentId: "cat-transport" },
  { id: "cat-subs", name: "Subscriptions", icon: "repeat", color: "#9333ea", parentId: null },
  { id: "cat-health", name: "Health", icon: "heart-pulse", color: "#e11d48", parentId: null },
  { id: "cat-home", name: "Home", icon: "home", color: "#65a30d", parentId: null },
  { id: "cat-leisure", name: "Leisure", icon: "ticket", color: "#c026d3", parentId: null },
  { id: "cat-others", name: "Other", icon: "circle-dashed", color: "#64748b", parentId: null },
];

function daysAgo(n: number): string {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d.toISOString();
}

export const MOCK_TRANSACTIONS: Transaction[] = [
  { id: "t1", cardId: "card-personal", postedAt: daysAgo(1), description: "DOORDASH*PIZZA NONNA", merchantClean: "DoorDash — Pizza Nonna", amountCents: 8790, currency: "BRL", fxRate: null, categoryId: "cat-delivery", notes: null, installmentGroupId: null, installmentIndex: null, installmentTotal: null, isRefund: false, isVirtualCard: false, sourceImportId: null, statementYearMonth: null },
  { id: "t2", cardId: "card-personal", postedAt: daysAgo(2), description: "SHELL STATION", merchantClean: "Shell", amountCents: 22000, currency: "BRL", fxRate: null, categoryId: "cat-fuel", notes: null, installmentGroupId: null, installmentIndex: null, installmentTotal: null, isRefund: false, isVirtualCard: false, sourceImportId: null, statementYearMonth: null },
  { id: "t3", cardId: "card-personal", postedAt: daysAgo(3), description: "PAY*SPOTIFY", merchantClean: "Spotify", amountCents: 2190, currency: "BRL", fxRate: null, categoryId: "cat-subs", notes: null, installmentGroupId: null, installmentIndex: null, installmentTotal: null, isRefund: false, isVirtualCard: false, sourceImportId: null, statementYearMonth: null },
  { id: "t4", cardId: "card-shopping", postedAt: daysAgo(4), description: "AMAZON.COM", merchantClean: "Amazon", amountCents: 15980, currency: "BRL", fxRate: null, categoryId: "cat-others", notes: null, installmentGroupId: "inst-1", installmentIndex: 2, installmentTotal: 6, isRefund: false, isVirtualCard: false, sourceImportId: null, statementYearMonth: null },
  { id: "t5", cardId: "card-shopping", postedAt: daysAgo(5), description: "UBER *TRIP", merchantClean: "Uber", amountCents: 3450, currency: "BRL", fxRate: null, categoryId: "cat-rideshare", notes: null, installmentGroupId: null, installmentIndex: null, installmentTotal: null, isRefund: false, isVirtualCard: false, sourceImportId: null, statementYearMonth: null },
  { id: "t6", cardId: "card-travel", postedAt: daysAgo(6), description: "CVS PHARMACY", merchantClean: "CVS", amountCents: 8470, currency: "BRL", fxRate: null, categoryId: "cat-health", notes: null, installmentGroupId: null, installmentIndex: null, installmentTotal: null, isRefund: false, isVirtualCard: false, sourceImportId: null, statementYearMonth: null },
  { id: "t7", cardId: "card-travel", postedAt: daysAgo(7), description: "WHOLE FOODS", merchantClean: "Whole Foods Market", amountCents: 38200, currency: "BRL", fxRate: null, categoryId: "cat-market", notes: null, installmentGroupId: null, installmentIndex: null, installmentTotal: null, isRefund: false, isVirtualCard: false, sourceImportId: null, statementYearMonth: null },
  { id: "t8", cardId: "card-travel", postedAt: daysAgo(8), description: "NETFLIX.COM", merchantClean: "Netflix", amountCents: 5590, currency: "BRL", fxRate: null, categoryId: "cat-subs", notes: null, installmentGroupId: null, installmentIndex: null, installmentTotal: null, isRefund: false, isVirtualCard: false, sourceImportId: null, statementYearMonth: null },
  { id: "t9", cardId: "card-personal", postedAt: daysAgo(10), description: "DOORDASH*SUSHI HOUSE", merchantClean: "DoorDash — Sushi House", amountCents: 11230, currency: "BRL", fxRate: null, categoryId: "cat-delivery", notes: null, installmentGroupId: null, installmentIndex: null, installmentTotal: null, isRefund: false, isVirtualCard: false, sourceImportId: null, statementYearMonth: null },
  { id: "t10", cardId: "card-personal", postedAt: daysAgo(12), description: "DELL ONLINE", merchantClean: "Dell", amountCents: 129900, currency: "BRL", fxRate: null, categoryId: "cat-others", notes: null, installmentGroupId: "inst-2", installmentIndex: 3, installmentTotal: 12, isRefund: false, isVirtualCard: false, sourceImportId: null, statementYearMonth: null },
  { id: "t11", cardId: "card-shopping", postedAt: daysAgo(14), description: "UDEMY COURSES", merchantClean: "Udemy", amountCents: 8490, currency: "BRL", fxRate: null, categoryId: "cat-subs", notes: null, installmentGroupId: null, installmentIndex: null, installmentTotal: null, isRefund: false, isVirtualCard: false, sourceImportId: null, statementYearMonth: null },
  { id: "t12", cardId: "card-travel", postedAt: daysAgo(16), description: "AMC THEATRES", merchantClean: "AMC", amountCents: 5400, currency: "BRL", fxRate: null, categoryId: "cat-leisure", notes: null, installmentGroupId: null, installmentIndex: null, installmentTotal: null, isRefund: false, isVirtualCard: false, sourceImportId: null, statementYearMonth: null },
  { id: "t13", cardId: "card-personal", postedAt: daysAgo(18), description: "LYFT *RIDE", merchantClean: "Lyft", amountCents: 2180, currency: "BRL", fxRate: null, categoryId: "cat-rideshare", notes: null, installmentGroupId: null, installmentIndex: null, installmentTotal: null, isRefund: false, isVirtualCard: false, sourceImportId: null, statementYearMonth: null },
  { id: "t14", cardId: "card-shopping", postedAt: daysAgo(20), description: "RENT PAYMENT", merchantClean: "Rent", amountCents: 68000, currency: "BRL", fxRate: null, categoryId: "cat-home", notes: null, installmentGroupId: null, installmentIndex: null, installmentTotal: null, isRefund: false, isVirtualCard: false, sourceImportId: null, statementYearMonth: null },
  { id: "t15", cardId: "card-travel", postedAt: daysAgo(22), description: "TRADER JOE'S", merchantClean: "Trader Joe's", amountCents: 24560, currency: "BRL", fxRate: null, categoryId: "cat-market", notes: null, installmentGroupId: null, installmentIndex: null, installmentTotal: null, isRefund: false, isVirtualCard: false, sourceImportId: null, statementYearMonth: null },
];
