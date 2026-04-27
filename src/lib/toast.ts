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
   * history store *before* invoking this.
   *
   * Uses a fixed singleton id so each new call replaces the prior undo
   * toast in place: clicking a stale toast for op A after op B has already
   * fired would actually undo B (the top of the stack), not A — replacing
   * the toast keeps the surface honest. The opId param is kept on the
   * signature for future use (e.g. allowing the toast to target the
   * specific op out-of-order) but currently goes unused.
   */
  successWithUndo: (
    message: string,
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    _opId: string,
    description?: string,
    durationMs = 7000,
  ) =>
    sonner.success(message, {
      id: "undo-toast",
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
