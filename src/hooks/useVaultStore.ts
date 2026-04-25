import { create } from "zustand";
import { ipc, isTauri, isIpcError } from "@/lib/ipc";

type Status = "loading" | "locked" | "unlocked";

interface VaultStore {
  status: Status;
  path: string | null;
  openedAt: string | null;
  hydrate: () => Promise<void>;
  setUnlocked: (path: string, openedAt: string) => void;
  lock: () => Promise<void>;
}

export const useVaultStore = create<VaultStore>((set) => ({
  status: "loading",
  path: null,
  openedAt: null,
  hydrate: async () => {
    if (!isTauri) {
      // Browser-only dev: pretend unlocked so route mocks render.
      set({
        status: "unlocked",
        path: "(mock)",
        openedAt: new Date().toISOString(),
      });
      return;
    }
    try {
      const s = await ipc.vault.status();
      if (s.kind === "unlocked") {
        set({ status: "unlocked", path: s.path, openedAt: s.openedAt });
      } else {
        set({ status: "locked", path: null, openedAt: null });
      }
    } catch (e) {
      console.error("vault_status failed", e);
      set({ status: "locked", path: null, openedAt: null });
    }
  },
  setUnlocked: (path, openedAt) =>
    set({ status: "unlocked", path, openedAt }),
  lock: async () => {
    if (isTauri) {
      try {
        await ipc.vault.lock();
      } catch (e) {
        if (!isIpcError(e) || e.code !== "vault_locked") {
          console.error("vault_lock failed", e);
        }
      }
    }
    set({ status: "locked", path: null, openedAt: null });
  },
}));
