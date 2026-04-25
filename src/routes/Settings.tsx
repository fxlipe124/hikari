import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ShieldCheck, FileDown, Database, Languages, Coins } from "lucide-react";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { LanguageToggle } from "@/components/LanguageToggle";
import { CurrencyToggle } from "@/components/CurrencyToggle";
import { useTheme } from "@/hooks/useTheme";
import { useVaultStore } from "@/hooks/useVaultStore";
import { loadConfig, setAutolockMinutes } from "@/lib/config";
import { ipc, isTauri } from "@/lib/ipc";
import { toast } from "@/lib/toast";
import { pickCsvToSave } from "@/lib/dialogs";
import { cn, currentYearMonth, monthLabel } from "@/lib/utils";

const AUTOLOCK_OPTIONS: Array<{ minutes: number; key: string }> = [
  { minutes: 1, key: "settings.autolock_1m" },
  { minutes: 5, key: "settings.autolock_5m" },
  { minutes: 10, key: "settings.autolock_10m" },
  { minutes: 30, key: "settings.autolock_30m" },
  { minutes: 60, key: "settings.autolock_1h" },
];

export function Settings() {
  const { t } = useTranslation();
  const { theme, setTheme } = useTheme();
  const lock = useVaultStore((s) => s.lock);
  const path = useVaultStore((s) => s.path);
  const qc = useQueryClient();
  const { data: config } = useQuery({
    queryKey: ["app-config"],
    queryFn: loadConfig,
  });

  const [autolock, setAutolock] = useState(10);
  const [busy, setBusy] = useState<"backup" | "csv-month" | "csv-all" | null>(null);

  useEffect(() => {
    if (config) setAutolock(config.autolockMinutes);
  }, [config]);

  async function changeAutolock(min: number) {
    setAutolock(min);
    await setAutolockMinutes(min);
    qc.invalidateQueries({ queryKey: ["app-config"] });
  }

  async function manualBackup() {
    if (!isTauri) {
      toast.error(t("error.backup_native_only"));
      return;
    }
    setBusy("backup");
    try {
      const path = await ipc.backup.now();
      const fileName = path.split(/[\\/]/).pop() ?? path;
      toast.success(t("toast.backup_created"), fileName);
    } catch (e) {
      toast.fromError(e, t("error.backup_failed"));
    } finally {
      setBusy(null);
    }
  }

  async function exportCsv(scope: "month" | "all") {
    if (!isTauri) {
      toast.error(t("error.export_native_only"));
      return;
    }
    const ym = scope === "month" ? currentYearMonth() : undefined;
    const suggested =
      scope === "month" ? `transactions-${ym}.csv` : "transactions-all.csv";
    const dest = await pickCsvToSave(suggested);
    if (!dest) return;

    setBusy(scope === "month" ? "csv-month" : "csv-all");
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
    } finally {
      setBusy(null);
    }
  }

  return (
    <div>
      <div className="border-b border-border px-6 py-5">
        <h1 className="text-xl font-semibold tracking-tight">{t("route.settings.title")}</h1>
        <p className="mt-0.5 text-sm text-fg-muted">{t("route.settings.subtitle")}</p>
      </div>

      <div className="p-6 max-w-2xl space-y-4">
        <Card>
          <CardHeader>
            <CardTitle>{t("settings.current_vault")}</CardTitle>
            <CardDescription className="truncate selectable">{path}</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-wrap items-center gap-2">
            <Button variant="secondary" size="sm" onClick={lock}>
              <ShieldCheck className="h-3.5 w-3.5" />
              {t("common.lock_now")}
            </Button>
            <Button
              variant="secondary"
              size="sm"
              onClick={manualBackup}
              disabled={busy === "backup"}
            >
              <Database className="h-3.5 w-3.5" />
              {busy === "backup" ? t("common.copying") : t("common.backup_now")}
            </Button>
            <p className="basis-full text-xs text-fg-subtle pt-1">
              {t("settings.backup_description")}
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>{t("settings.export_transactions")}</CardTitle>
            <CardDescription>{t("settings.csv_description")}</CardDescription>
          </CardHeader>
          <CardContent className="space-y-2">
            <Button
              variant="secondary"
              size="sm"
              onClick={() => exportCsv("month")}
              disabled={busy === "csv-month"}
            >
              <FileDown className="h-3.5 w-3.5" />
              {busy === "csv-month" ? t("common.exporting") : t("common.export_month")}
            </Button>
            <Button
              variant="secondary"
              size="sm"
              className="ml-2"
              onClick={() => exportCsv("all")}
              disabled={busy === "csv-all"}
            >
              <FileDown className="h-3.5 w-3.5" />
              {busy === "csv-all" ? t("common.exporting") : t("common.export_all")}
            </Button>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>{t("settings.appearance")}</CardTitle>
            <CardDescription>{t("settings.appearance_description")}</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="flex gap-2">
              {(["light", "dark", "system"] as const).map((variant) => (
                <button
                  key={variant}
                  onClick={() => setTheme(variant)}
                  className={cn(
                    "rounded-[var(--radius)] border px-3 py-1.5 text-sm transition-colors",
                    theme === variant
                      ? "border-accent bg-accent/10 text-accent"
                      : "border-border text-fg-muted hover:bg-surface-hover"
                  )}
                >
                  {variant === "light"
                    ? t("settings.light_theme")
                    : variant === "dark"
                      ? t("settings.dark_theme")
                      : t("settings.system_theme")}
                </button>
              ))}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Languages className="h-3.5 w-3.5" />
              {t("settings.language")}
            </CardTitle>
            <CardDescription>{t("settings.language_description")}</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="max-w-xs">
              <LanguageToggle />
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Coins className="h-3.5 w-3.5" />
              {t("settings.currency")}
            </CardTitle>
            <CardDescription>{t("settings.currency_description")}</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="max-w-xs">
              <CurrencyToggle />
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>{t("settings.autolock")}</CardTitle>
            <CardDescription>{t("settings.autolock_description")}</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="flex flex-wrap gap-2">
              {AUTOLOCK_OPTIONS.map((opt) => (
                <button
                  key={opt.minutes}
                  onClick={() => changeAutolock(opt.minutes)}
                  className={cn(
                    "rounded-[var(--radius)] border px-3 py-1.5 text-sm tabular transition-colors",
                    autolock === opt.minutes
                      ? "border-accent bg-accent/10 text-accent"
                      : "border-border text-fg-muted hover:bg-surface-hover"
                  )}
                >
                  {t(opt.key)}
                </button>
              ))}
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
