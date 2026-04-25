import { toast as sonner } from "sonner";
import i18n from "./i18n";
import { isIpcError } from "./ipc";

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
