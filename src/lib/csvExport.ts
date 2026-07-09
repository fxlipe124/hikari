import i18n from "@/lib/i18n";
import { ipc, isTauri } from "@/lib/ipc";
import { toast } from "@/lib/toast";
import { pickCsvToSave } from "@/lib/dialogs";
import { currentYearMonth, monthLabel } from "@/lib/utils";

/**
 * Interactive CSV export: native save picker → IPC → result toast.
 * Shared by Settings and the command palette so the flow (filenames,
 * toasts, error mapping) can't drift between the two entry points.
 * `onStart` fires only after the user picked a destination — a busy
 * indicator bound to it doesn't spin while the picker sits open or
 * when the user cancels.
 */
export async function exportCsvInteractive(
  scope: "month" | "all",
  opts?: { onStart?: () => void },
): Promise<void> {
  const t = i18n.t.bind(i18n);
  if (!isTauri) {
    toast.error(t("error.export_native_only"));
    return;
  }
  const ym = scope === "month" ? currentYearMonth() : undefined;
  const suggested =
    scope === "month" ? `transactions-${ym}.csv` : "transactions-all.csv";
  const dest = await pickCsvToSave(suggested);
  if (!dest) return;
  opts?.onStart?.();
  try {
    const count = await ipc.export.csv(dest, ym);
    toast.success(
      t("toast.csv_exported", { count }),
      scope === "month"
        ? t("toast.csv_export_month_desc", { month: monthLabel(ym!) })
        : t("toast.csv_export_all_desc")
    );
  } catch (e) {
    toast.fromError(e, t("error.csv_export_failed"));
  }
}
