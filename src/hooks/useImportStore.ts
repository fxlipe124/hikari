import { create } from "zustand";
import type { CardMetadata, Issuer, ParsedTransaction } from "@/lib/ipc";

interface ImportStore {
  cardId: string | null;
  issuer: Issuer | null;
  rows: ParsedTransaction[];
  cardMetadata: CardMetadata | null;
  setPayload: (
    cardId: string,
    issuer: Issuer,
    rows: ParsedTransaction[],
    cardMetadata?: CardMetadata | null,
  ) => void;
  updateRow: (index: number, patch: Partial<ParsedTransaction>) => void;
  clear: () => void;
}

export const useImportStore = create<ImportStore>((set) => ({
  cardId: null,
  issuer: null,
  rows: [],
  cardMetadata: null,
  setPayload: (cardId, issuer, rows, cardMetadata = null) =>
    set({ cardId, issuer, rows, cardMetadata }),
  updateRow: (index, patch) =>
    set((s) => ({
      rows: s.rows.map((r, i) => (i === index ? { ...r, ...patch } : r)),
    })),
  clear: () => set({ cardId: null, issuer: null, rows: [], cardMetadata: null }),
}));
