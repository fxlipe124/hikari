import { useMutation, useQueryClient } from "@tanstack/react-query";
import { ipc, isTauri, type Card, type Category, type Transaction } from "./ipc";

function notInTauri() {
  return new Error("Backend not available — run via `npm run tauri dev`");
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

export function useDeleteCard() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string): Promise<void> => {
      if (!isTauri) throw notInTauri();
      await ipc.cards.remove(id);
    },
    onSuccess: () => {
      // Card deletion cascades to transactions in the schema; refresh both
      // the cards list and any view that joins on card_id.
      qc.invalidateQueries({ queryKey: ["cards"] });
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

export function useDeleteCategory() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string): Promise<void> => {
      if (!isTauri) throw notInTauri();
      await ipc.categories.remove(id);
    },
    onSuccess: () => {
      // Deleting a category orphans transactions that pointed to it (the FK
      // is ON DELETE SET NULL), so refresh views that read category_id too.
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

export function useDeleteTransaction() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string): Promise<void> => {
      if (!isTauri) throw notInTauri();
      await ipc.transactions.remove(id);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["transactions"] });
      qc.invalidateQueries({ queryKey: ["monthSummary"] });
    },
  });
}

export function useBulkRenameTransactions() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({
      ids,
      description,
      merchantClean,
    }: {
      ids: string[];
      description: string;
      merchantClean: string | null;
    }): Promise<number> => {
      if (!isTauri) throw notInTauri();
      return ipc.transactions.bulkRename(ids, description, merchantClean);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["transactions"] });
      qc.invalidateQueries({ queryKey: ["monthSummary"] });
    },
  });
}
