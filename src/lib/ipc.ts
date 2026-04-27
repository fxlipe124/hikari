import { invoke as tauriInvoke } from "@tauri-apps/api/core";

export const isTauri = typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

export async function invoke<T>(command: string, args?: Record<string, unknown>): Promise<T> {
  if (!isTauri) {
    throw new Error(
      `IPC '${command}' called outside Tauri runtime. Use 'npm run tauri dev' to run with the native backend.`
    );
  }
  return tauriInvoke<T>(command, args);
}

export interface IpcError {
  code: string;
  message: string;
}

export function isIpcError(e: unknown): e is IpcError {
  return (
    typeof e === "object" &&
    e !== null &&
    "code" in e &&
    typeof (e as IpcError).code === "string"
  );
}

/**
 * Pull a human-readable message out of anything thrown by an IPC call.
 * The Tauri bridge surfaces errors as plain `{code, message}` objects, so
 * `String(e)` gives the dreaded "[object Object]" — extract `e.message`
 * (or the JS Error message) explicitly.
 */
export function errorMessage(e: unknown): string {
  if (isIpcError(e)) return e.message;
  if (e instanceof Error) return e.message;
  if (typeof e === "string") return e;
  try {
    return JSON.stringify(e);
  } catch {
    return String(e);
  }
}

export type VaultState =
  | { kind: "locked"; path: string | null }
  | { kind: "unlocked"; path: string; openedAt: string };

export interface RecentVault {
  path: string;
  name: string;
  lastOpenedAt: string;
}

export interface Card {
  id: string;
  name: string;
  brand: string;
  last4: string | null;
  closingDay: number;
  dueDay: number;
  color: string;
  creditLimitCents: number | null;
}

export interface Category {
  id: string;
  name: string;
  icon: string;
  color: string;
  parentId: string | null;
}

export interface Transaction {
  id: string;
  cardId: string;
  postedAt: string;
  description: string;
  merchantClean: string | null;
  amountCents: number;
  currency: string;
  fxRate: number | null;
  categoryId: string | null;
  notes: string | null;
  installmentGroupId: string | null;
  installmentIndex: number | null;
  installmentTotal: number | null;
  isRefund: boolean;
  isVirtualCard: boolean;
  sourceImportId: string | null;
  /**
   * Statement period this row was assigned to at insert time. Optional on
   * the write side (backend computes via card.closing_day when omitted);
   * the read shape always carries it (string or null when migration
   * couldn't determine it).
   */
  statementYearMonth?: string | null;
}

export interface InstallmentGroup {
  id: string;
  totalN: number;
  totalCents: number;
  firstPostedAt: string;
  description: string;
}

export type Issuer = "sofisa" | "mercado_pago" | "nubank" | "generic";

export interface ParsedTransaction {
  postedAt: string;
  description: string;
  merchantClean: string | null;
  amountCents: number;
  currency: string;
  fxRate: number | null;
  installment: [number, number] | null;
  isRefund: boolean;
  isVirtualCard: boolean;
  categoryId: string | null;
  raw: string;
}

export interface CardMetadata {
  closingDay: number;
  dueDay: number;
  statementYearMonth: string;
}

export interface ImportPreviewResult {
  issuer: Issuer;
  transactions: ParsedTransaction[];
  cardMetadata?: CardMetadata | null;
}

export interface ImportRow {
  postedAt: string;
  description: string;
  merchantClean: string | null;
  amountCents: number;
  currency?: string;
  categoryId: string | null;
  installmentIndex: number | null;
  installmentTotal: number | null;
  isRefund: boolean;
  isVirtualCard: boolean;
  /**
   * Pre-computed statement period (YYYY-MM) for this row. The frontend
   * computes it during ImportPreview commit using the closing_day from
   * the parsed Sofisa header (or card.closingDay fallback). Backend
   * persists it verbatim, never recomputes.
   */
  statementYearMonth?: string;
}

export interface ImportResult {
  inserted: number;
  skipped: number;
  total: number;
  /**
   * Stamped on every row of this import. Pass to `transactions.removeByImport`
   * to roll the whole fatura back as the redo of an undo.
   */
  importId: string;
}

export const ipc = {
  vault: {
    create: (path: string, password: string, locale?: string) =>
      invoke<void>("vault_create", { path, password, locale: locale ?? null }),
    open: (path: string, password: string) =>
      invoke<VaultState>("vault_open", { path, password }),
    lock: () => invoke<void>("vault_lock"),
    status: () => invoke<VaultState>("vault_status"),
    recent: () => invoke<RecentVault[]>("vault_recent"),
  },
  import: {
    extractPdf: (path: string, password?: string) =>
      invoke<string>("import_extract_pdf", { path, password: password ?? null }),
    parse: (
      text: string,
      issuerHint?: Issuer,
      referenceYearMonth?: string,
      cardId?: string | null,
    ) =>
      invoke<ImportPreviewResult>("import_parse", {
        text,
        issuerHint: issuerHint ?? null,
        referenceYearMonth: referenceYearMonth ?? null,
        cardId: cardId ?? null,
      }),
    commit: (cardId: string, rows: ImportRow[]) =>
      invoke<ImportResult>("import_commit", { cardId, rows }),
  },
  backup: {
    now: () => invoke<string>("vault_backup_now"),
  },
  export: {
    csv: (path: string, yearMonth?: string) =>
      invoke<number>("export_csv", { path, yearMonth: yearMonth ?? null }),
  },
  cards: {
    list: () => invoke<Card[]>("cards_list"),
    create: (input: Omit<Card, "id">) => invoke<Card>("cards_create", { input }),
    update: (
      id: string,
      patch: Partial<Card> & { recomputeStatements?: boolean },
    ) => invoke<Card>("cards_update", { id, patch }),
    remove: (id: string) => invoke<void>("cards_remove", { id }),
    /** Re-insert a card with its original id; used by undo of cards.remove. */
    restore: (card: Card) => invoke<Card>("cards_restore", { card }),
  },
  categories: {
    list: () => invoke<Category[]>("categories_list"),
    create: (input: Omit<Category, "id">) =>
      invoke<Category>("categories_create", { input }),
    update: (id: string, patch: Partial<Category>) =>
      invoke<Category>("categories_update", { id, patch }),
    remove: (id: string) => invoke<void>("categories_remove", { id }),
    /** Re-insert a category with its original id; used by undo of categories.remove. */
    restore: (category: Category) =>
      invoke<Category>("categories_restore", { category }),
  },
  transactions: {
    list: (filter?: {
      yearMonth?: string;
      year?: string;
      cardId?: string;
      categoryId?: string;
      query?: string;
    }) => invoke<Transaction[]>("transactions_list", { filter: filter ?? null }),
    create: (input: Omit<Transaction, "id">) =>
      invoke<Transaction>("transactions_create", { input }),
    update: (id: string, patch: Partial<Transaction>) =>
      invoke<Transaction>("transactions_update", { id, patch }),
    remove: (id: string) => invoke<void>("transactions_remove", { id }),
    /** Re-insert a batch of full transaction rows with their original ids. */
    restore: (rows: Transaction[]) =>
      invoke<number>("transactions_restore", { rows }),
    /** Drop every row tagged with this source_import_id. */
    removeByImport: (importId: string) =>
      invoke<number>("transactions_remove_by_import", { importId }),
    bulkUpdate: (
      ids: string[],
      patch: {
        description?: string;
        merchantClean?: string | null;
        categoryId?: string | null;
      },
    ) =>
      invoke<number>("transactions_bulk_update", {
        ids,
        patch,
      }),
    bulkRemove: (ids: string[]) =>
      invoke<number>("transactions_bulk_remove", { ids }),
    /** Restore exact statement_year_month per id; used by closing-day cascade undo. */
    bulkSetStatementPeriods: (
      patches: Array<{ id: string; statementYearMonth: string | null }>,
    ) =>
      invoke<number>("transactions_bulk_set_statement_periods", { patches }),
    monthSummary: (yearMonth: string, cardId?: string) =>
      invoke<{ totalCents: number; byCategory: Array<{ categoryId: string | null; totalCents: number }>; byCard: Array<{ cardId: string; totalCents: number }> }>(
        "transactions_month_summary",
        { yearMonth, cardId: cardId ?? null }
      ),
    yearSummary: (year: string, cardId?: string) =>
      invoke<{
        totalCents: number;
        byMonth: Array<{ yearMonth: string; totalCents: number }>;
        byCategory: Array<{ categoryId: string | null; totalCents: number }>;
        byCard: Array<{ cardId: string; totalCents: number }>;
      }>("transactions_year_summary", { year, cardId: cardId ?? null }),
  },
};
