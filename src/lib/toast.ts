import { toast as sonner } from "sonner";
import i18n from "./i18n";
import { isIpcError } from "./ipc";
import { useHistoryStore } from "./historyStore";

/**
 * Centralized toast helpers. Wraps `sonner` so call sites don't need to know
 * about its API and to keep the messaging tone consistent.
 */
export const toast = {
  success: (message: string, description?: string) =>
    sonner.success(message, { description }),

  error: (message: string, description?: string) =>
    sonner.error(message, { description }),

  info: (message: string, description?: string) =>
    sonner(message, { description }),

  /**
   * Success toast with a "Desfazer" action button. Action runs the most
   * recent op on the global history stack — same machinery as Ctrl+Z, so the
   * two surfaces stay consistent. Caller is expected to push the op to the
   * history store *before* invoking this. The toast id matches the op id so
   * a follow-up push for a new op can dismiss this one.
   */
  successWithUndo: (
    message: string,
    opId: string,
    description?: string,
    durationMs = 7000,
  ) =>
    sonner.success(message, {
      id: opId,
      description,
      duration: durationMs,
      action: {
        label: i18n.t("common.undo"),
        onClick: async () => {
          try {
            const op = await useHistoryStore.getState().undo();
            if (op) {
              sonner.success(i18n.t("toast.undone", { label: i18n.t(op.label) }));
            }
          } catch (e) {
            toast.fromError(e);
          }
        },
      },
    }),

  /** Best-effort error display from anything thrown by an IPC call. */
  fromError: (e: unknown, fallback?: string) => {
    const fallbackMessage = fallback ?? i18n.t("error.fallback");
    if (isIpcError(e)) {
      sonner.error(mapIpcCode(e.code), { description: e.message });
    } else if (e instanceof Error) {
      sonner.error(fallbackMessage, { description: e.message });
    } else {
      sonner.error(fallbackMessage, { description: String(e) });
    }
  },
};

function mapIpcCode(code: string): string {
  const key = `error.${code}`;
  const translated = i18n.t(key);
  return translated !== key ? translated : i18n.t("error.generic");
}
