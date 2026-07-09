import i18n from "@/lib/i18n";
import { ipc, isTauri } from "@/lib/ipc";
import { toast } from "@/lib/toast";

/**
 * Interactive on-demand backup: IPC → result toast. Shared by Settings and
 * the command palette so the flow (toasts, error mapping) can't drift
 * between the two entry points. `onStart` fires right before the IPC call
 * — the moment a busy indicator becomes truthful.
 */
export async function backupNowInteractive(opts?: {
  onStart?: () => void;
}): Promise<void> {
  const t = i18n.t.bind(i18n);
  if (!isTauri) {
    toast.error(t("error.backup_native_only"));
    return;
  }
  opts?.onStart?.();
  try {
    const path = await ipc.backup.now();
    const fileName = path.split(/[\\/]/).pop() ?? path;
    toast.success(t("toast.backup_created"), fileName);
  } catch (e) {
    toast.fromError(e, t("error.backup_failed"));
  }
}
