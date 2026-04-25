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
  },
  categories: {
    list: () => invoke<Category[]>("categories_list"),
    create: (input: Omit<Category, "id">) =>
      invoke<Category>("categories_create", { input }),
    update: (id: string, patch: Partial<Category>) =>
      invoke<Category>("categories_update", { id, patch }),
    remove: (id: string) => invoke<void>("categories_remove", { id }),
  },
  transactions: {
    list: (filter?: {
      yearMonth?: string;
      cardId?: string;
      categoryId?: string;
      query?: string;
    }) => invoke<Transaction[]>("transactions_list", { filter: filter ?? null }),
    create: (input: Omit<Transaction, "id">) =>
      invoke<Transaction>("transactions_create", { input }),
    update: (id: string, patch: Partial<Transaction>) =>
      invoke<Transaction>("transactions_update", { id, patch }),
    remove: (id: string) => invoke<void>("transactions_remove", { id }),
    bulkRename: (
      ids: string[],
      description: string,
      merchantClean: string | null,
    ) =>
      invoke<number>("transactions_bulk_rename", {
        ids,
        description,
        merchantClean,
      }),
    monthSummary: (yearMonth: string, cardId?: string) =>
      invoke<{ totalCents: number; byCategory: Array<{ categoryId: string | null; totalCents: number }>; byCard: Array<{ cardId: string; totalCents: number }> }>(
        "transactions_month_summary",
        { yearMonth, cardId: cardId ?? null }
      ),
  },
};
