import { useMutation, useQueryClient, type QueryClient } from "@tanstack/react-query";
import { ipc, isTauri, type Card, type Category, type Transaction } from "./ipc";
import { useHistoryStore, type HistoryOp } from "./historyStore";
import { toast } from "./toast";
import i18n from "./i18n";

function notInTauri() {
  return new Error("Backend not available — run via `npm run tauri dev`");
}

/**
 * Invalidate every query that depends on transactions or summaries. Called
 * after each undo/redo step so the React Query cache reflects the new state
 * — without this, the UI would still show the pre-undo rows until the user
 * navigated away and back.
 */
function invalidateTxQueries(qc: QueryClient) {
  qc.invalidateQueries({ queryKey: ["transactions"] });
  qc.invalidateQueries({ queryKey: ["monthSummary"] });
}
function invalidateAllAfterCardOrCategoryChange(qc: QueryClient) {
  qc.invalidateQueries({ queryKey: ["cards"] });
  qc.invalidateQueries({ queryKey: ["categories"] });
  qc.invalidateQueries({ queryKey: ["transactions"] });
  qc.invalidateQueries({ queryKey: ["monthSummary"] });
}

function pushAndToast(op: HistoryOp, successMessage: string, description?: string) {
  useHistoryStore.getState().push(op);
  toast.successWithUndo(successMessage, op.id, description);
}

export function useCreateCard() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: Omit<Card, "id">): Promise<Card> => {
      if (!isTauri) throw notInTauri();
      return ipc.cards.create(input);
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["cards"] }),
  });
}

export function useUpdateCard() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({
      id,
      patch,
    }: {
      id: string;
      // `recomputeStatements: true` makes the backend re-stamp every tx of
      // this card with statement_year_month derived from the new
      // closing_day. Out-of-band flag (not part of the persisted Card),
      // hence the union type.
      patch: Partial<Card> & { recomputeStatements?: boolean };
    }): Promise<Card> => {
      if (!isTauri) throw notInTauri();
      return ipc.cards.update(id, patch);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["cards"] });
      // The cascade may have shifted statement_year_month on existing tx,
      // so anything caching them needs to refetch.
      qc.invalidateQueries({ queryKey: ["transactions"] });
      qc.invalidateQueries({ queryKey: ["monthSummary"] });
    },
  });
}

export function useCreateCategory() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: Omit<Category, "id">): Promise<Category> => {
      if (!isTauri) throw notInTauri();
      return ipc.categories.create(input);
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["categories"] }),
  });
}

export function useUpdateCategory() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({
      id,
      patch,
    }: {
      id: string;
      patch: Partial<Category>;
    }): Promise<Category> => {
      if (!isTauri) throw notInTauri();
      return ipc.categories.update(id, patch);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["categories"] });
      qc.invalidateQueries({ queryKey: ["transactions"] });
      qc.invalidateQueries({ queryKey: ["monthSummary"] });
    },
  });
}

export function useCreateTransaction() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: Omit<Transaction, "id">): Promise<Transaction> => {
      if (!isTauri) throw notInTauri();
      return ipc.transactions.create(input);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["transactions"] });
      qc.invalidateQueries({ queryKey: ["monthSummary"] });
    },
  });
}

export function useUpdateTransaction() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({
      id,
      patch,
    }: {
      id: string;
      patch: Partial<Transaction>;
    }): Promise<Transaction> => {
      if (!isTauri) throw notInTauri();
      return ipc.transactions.update(id, patch);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["transactions"] });
      qc.invalidateQueries({ queryKey: ["monthSummary"] });
    },
  });
}

// ---------------------------------------------------------------------------
// Undoable wrappers
//
// Each wrapper runs the destructive mutation, pushes a HistoryOp onto the
// global history store, and emits the success-with-undo toast. Toast click
// and Ctrl+Z both pop the same op via `historyStore.undo()`. New ops clear
// the redo future (linear history). Capture before-state up-front: the
// undo callback closes over it because the SQL row is gone after the
// mutation runs.
// ---------------------------------------------------------------------------

export function useUndoableDeleteTransaction() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (tx: Transaction): Promise<void> => {
      if (!isTauri) throw notInTauri();
      await ipc.transactions.remove(tx.id);
      invalidateTxQueries(qc);
      const op: HistoryOp = {
        id: crypto.randomUUID(),
        label: "history.tx_deleted",
        undo: async () => {
          await ipc.transactions.restore([tx]);
          invalidateTxQueries(qc);
        },
        redo: async () => {
          await ipc.transactions.remove(tx.id);
          invalidateTxQueries(qc);
        },
      };
      pushAndToast(op, i18n.t("toast.transaction_deleted"));
    },
  });
}

export function useUndoableBulkRemoveTransactions() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (rows: Transaction[]): Promise<number> => {
      if (!isTauri) throw notInTauri();
      const ids = rows.map((r) => r.id);
      const count = await ipc.transactions.bulkRemove(ids);
      invalidateTxQueries(qc);
      const op: HistoryOp = {
        id: crypto.randomUUID(),
        label: "history.tx_bulk_deleted",
        undo: async () => {
          await ipc.transactions.restore(rows);
          invalidateTxQueries(qc);
        },
        redo: async () => {
          await ipc.transactions.bulkRemove(ids);
          invalidateTxQueries(qc);
        },
      };
      pushAndToast(op, i18n.t("toast.bulk_removed", { count }));
      return count;
    },
  });
}

/**
 * Bulk-update a set of transactions. Captures previous values per id so undo
 * can replay the inverse — handles partial patches (only sets fields that
 * actually changed). Cumulative undoes restore the state at the moment this
 * op ran, not whatever subsequent edits did, so opening the row in the
 * dialog and Ctrl+Z still leaves you with the right "before".
 */
export function useUndoableBulkUpdateTransactions() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (args: {
      rows: Transaction[];
      patch: {
        description?: string;
        merchantClean?: string | null;
        categoryId?: string | null;
      };
    }): Promise<number> => {
      if (!isTauri) throw notInTauri();
      const { rows, patch } = args;
      const ids = rows.map((r) => r.id);
      // Snapshot before-values for every column the patch touches.
      const priors = rows.map((r) => ({
        id: r.id,
        description: r.description,
        merchantClean: r.merchantClean,
        categoryId: r.categoryId,
      }));
      const count = await ipc.transactions.bulkUpdate(ids, patch);
      invalidateTxQueries(qc);
      const op: HistoryOp = {
        id: crypto.randomUUID(),
        label: "history.tx_bulk_updated",
        undo: async () => {
          // Restore each row individually because the priors aren't all
          // identical — bulk_update can only set one value per call.
          for (const p of priors) {
            const inverse: Partial<Transaction> = {};
            if (patch.description !== undefined) inverse.description = p.description;
            if (patch.merchantClean !== undefined) inverse.merchantClean = p.merchantClean;
            if (patch.categoryId !== undefined) inverse.categoryId = p.categoryId;
            await ipc.transactions.update(p.id, inverse);
          }
          invalidateTxQueries(qc);
        },
        redo: async () => {
          await ipc.transactions.bulkUpdate(ids, patch);
          invalidateTxQueries(qc);
        },
      };
      pushAndToast(op, i18n.t("toast.bulk_updated", { count }));
      return count;
    },
  });
}

export function useUndoableUpdateTransaction() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (args: {
      original: Transaction;
      patch: Partial<Transaction>;
    }): Promise<Transaction> => {
      if (!isTauri) throw notInTauri();
      const { original, patch } = args;
      const result = await ipc.transactions.update(original.id, patch);
      invalidateTxQueries(qc);
      // Inverse patch flips every changed field back to its original value.
      const inverse: Partial<Transaction> = {};
      for (const key of Object.keys(patch) as (keyof Transaction)[]) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (inverse as any)[key] = original[key];
      }
      const op: HistoryOp = {
        id: crypto.randomUUID(),
        label: "history.tx_updated",
        undo: async () => {
          await ipc.transactions.update(original.id, inverse);
          invalidateTxQueries(qc);
        },
        redo: async () => {
          await ipc.transactions.update(original.id, patch);
          invalidateTxQueries(qc);
        },
      };
      pushAndToast(op, i18n.t("toast.transaction_updated"));
      return result;
    },
  });
}

/**
 * Card delete cascades through the schema and drops every tx of that card
 * (FK ON DELETE CASCADE). Capture both the Card row and all its
 * transactions before delete so undo can recreate the card with its
 * original id and restore every row byte-for-byte.
 */
export function useUndoableDeleteCard() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (args: {
      card: Card;
      cardTransactions: Transaction[];
    }): Promise<void> => {
      if (!isTauri) throw notInTauri();
      const { card, cardTransactions } = args;
      await ipc.cards.remove(card.id);
      invalidateAllAfterCardOrCategoryChange(qc);
      const op: HistoryOp = {
        id: crypto.randomUUID(),
        label: "history.card_deleted",
        undo: async () => {
          // Card first (FK target), then transactions referencing it.
          await ipc.cards.restore(card);
          if (cardTransactions.length > 0) {
            await ipc.transactions.restore(cardTransactions);
          }
          invalidateAllAfterCardOrCategoryChange(qc);
        },
        redo: async () => {
          await ipc.cards.remove(card.id);
          invalidateAllAfterCardOrCategoryChange(qc);
        },
      };
      pushAndToast(op, i18n.t("toast.card_deleted"));
    },
  });
}

/**
 * Category delete sets categoryId to NULL on every tagged transaction
 * (FK ON DELETE SET NULL). Capture the Category row + the {id, categoryId}
 * mapping for affected rows so undo can recreate the category with its
 * original id and re-attach each tx.
 */
export function useUndoableDeleteCategory() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (args: {
      category: Category;
      affectedTxIds: string[];
    }): Promise<void> => {
      if (!isTauri) throw notInTauri();
      const { category, affectedTxIds } = args;
      await ipc.categories.remove(category.id);
      invalidateAllAfterCardOrCategoryChange(qc);
      const op: HistoryOp = {
        id: crypto.randomUUID(),
        label: "history.category_deleted",
        undo: async () => {
          await ipc.categories.restore(category);
          if (affectedTxIds.length > 0) {
            await ipc.transactions.bulkUpdate(affectedTxIds, {
              categoryId: category.id,
            });
          }
          invalidateAllAfterCardOrCategoryChange(qc);
        },
        redo: async () => {
          await ipc.categories.remove(category.id);
          invalidateAllAfterCardOrCategoryChange(qc);
        },
      };
      pushAndToast(op, i18n.t("toast.category_deleted"));
    },
  });
}

/**
 * Import commit + push a HistoryOp wired to the new import_id. Undo nukes
 * every row tagged with that id; redo replays the same payload. Each
 * import gets its own undo entry so a session of N imports is N Ctrl+Z
 * presses to fully revert.
 */
export function useUndoableImportCommit() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (args: {
      cardId: string;
      rows: Parameters<typeof ipc.import.commit>[1];
    }): Promise<{ inserted: number; skipped: number; total: number; importId: string }> => {
      if (!isTauri) throw notInTauri();
      const { cardId, rows } = args;
      const result = await ipc.import.commit(cardId, rows);
      invalidateTxQueries(qc);
      const op: HistoryOp = {
        id: crypto.randomUUID(),
        label: "history.imported_n",
        undo: async () => {
          await ipc.transactions.removeByImport(result.importId);
          invalidateTxQueries(qc);
        },
        redo: async () => {
          // Re-import the same payload. The new import gets a different
          // import_id; redo→undo→undo would target the original (now
          // defunct) id. Acceptable trade-off — that sequence is rare and
          // the new import rows are still inspectable in the Transactions
          // table either way.
          await ipc.import.commit(cardId, rows);
          invalidateTxQueries(qc);
        },
      };
      pushAndToast(op, i18n.t("toast.import_complete", {
        inserted: result.inserted,
        skipped: result.skipped,
      }));
      return result;
    },
  });
}
