import { create } from "zustand";

export interface HistoryOp {
  id: string;
  /** Display label for the op — i18n key used by toast.undone/redone. */
  label: string;
  undo: () => Promise<void>;
  redo: () => Promise<void>;
}

interface HistoryState {
  past: HistoryOp[];
  future: HistoryOp[];
  push: (op: HistoryOp) => void;
  undo: () => Promise<HistoryOp | null>;
  redo: () => Promise<HistoryOp | null>;
  clear: () => void;
}

const CAP = 50;

/**
 * Single source of truth for the undo/redo stack. Toast "Desfazer" buttons
 * and the global Ctrl+Z handler both read from here; clicking the toast is
 * functionally equivalent to pressing Ctrl+Z immediately. New ops clear
 * the redo future (linear history). Stack is in-memory only — cleared on
 * vault relock so we don't hand the next user a button to "undelete" rows
 * from a vault they don't have access to.
 */
export const useHistoryStore = create<HistoryState>((set, get) => ({
  past: [],
  future: [],
  push: (op) =>
    set((s) => {
      const next = [...s.past, op];
      // Cap from the front so the user keeps recent regret-window coverage
      // even if they've been hammering at the app.
      const trimmed = next.length > CAP ? next.slice(next.length - CAP) : next;
      return { past: trimmed, future: [] };
    }),
  undo: async () => {
    const { past } = get();
    if (past.length === 0) return null;
    const op = past[past.length - 1];
    try {
      await op.undo();
    } catch (e) {
      // Op stays in past — caller surfaces the error. Otherwise a flaky undo
      // would silently consume the most recent stack entry, leaving the user
      // with nothing to retry.
      throw e;
    }
    set((s) => ({
      past: s.past.slice(0, -1),
      future: [...s.future, op],
    }));
    return op;
  },
  redo: async () => {
    const { future } = get();
    if (future.length === 0) return null;
    const op = future[future.length - 1];
    try {
      await op.redo();
    } catch (e) {
      throw e;
    }
    set((s) => ({
      future: s.future.slice(0, -1),
      past: [...s.past, op],
    }));
    return op;
  },
  clear: () => set({ past: [], future: [] }),
}));
