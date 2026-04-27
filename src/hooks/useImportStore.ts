import { create } from "zustand";
import type { CardMetadata, Issuer, ParsedTransaction } from "@/lib/ipc";

interface ImportStore {
  cardId: string | null;
  issuer: Issuer | null;
  rows: ParsedTransaction[];
  /**
   * Best-effort metadata for the import as a whole. Set only when every
   * imported file's metadata agreed (typically: single file, or batch
   * import of statements from the same card cycle). Drives the
   * "Update card?" banner in ImportPreview.
   */
  cardMetadata: CardMetadata | null;
  /**
   * Per-row metadata, parallel to `rows`. Each entry is the cardMetadata
   * extracted from the row's source PDF (or null when none). Used by the
   * ImportPreview commit to compute each row's statement_year_month with
   * the *file-specific* closing day — necessary for batch imports where
   * statements have different closing dates (e.g. Sofisa shifting between
   * 19 and 20 month-to-month).
   */
  rowMetadata: Array<CardMetadata | null>;
  setPayload: (
    cardId: string,
    issuer: Issuer,
    rows: ParsedTransaction[],
    cardMetadata?: CardMetadata | null,
    rowMetadata?: Array<CardMetadata | null>,
  ) => void;
  updateRow: (index: number, patch: Partial<ParsedTransaction>) => void;
  clear: () => void;
}

export const useImportStore = create<ImportStore>((set) => ({
  cardId: null,
  issuer: null,
  rows: [],
  cardMetadata: null,
  rowMetadata: [],
  setPayload: (cardId, issuer, rows, cardMetadata = null, rowMetadata) =>
    set({
      cardId,
      issuer,
      rows,
      cardMetadata,
      rowMetadata: rowMetadata ?? rows.map(() => cardMetadata),
    }),
  updateRow: (index, patch) =>
    set((s) => ({
      rows: s.rows.map((r, i) => (i === index ? { ...r, ...patch } : r)),
    })),
  clear: () =>
    set({ cardId: null, issuer: null, rows: [], cardMetadata: null, rowMetadata: [] }),
}));
