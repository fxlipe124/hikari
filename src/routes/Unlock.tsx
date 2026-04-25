import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";
import {
  Lock,
  FilePlus,
  FolderOpen,
  ShieldCheck,
  ArrowLeft,
  X as XIcon,
} from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { useVaultStore } from "@/hooks/useVaultStore";
import { ipc, isTauri, isIpcError } from "@/lib/ipc";
import { toast } from "@/lib/toast";
import { pickVaultToCreate, pickVaultToOpen } from "@/lib/dialogs";
import {
  loadConfig,
  recordOpenedVault,
  removeRecentVault,
  type RecentVault,
} from "@/lib/config";
import { cn, formatDate } from "@/lib/utils";

type Mode =
  | { kind: "choice" }
  | { kind: "open"; path: string }
  | { kind: "create"; path: string };

export function Unlock() {
  const { t, i18n } = useTranslation();
  const [mode, setMode] = useState<Mode>({ kind: "choice" });
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [recents, setRecents] = useState<RecentVault[]>([]);

  const setUnlocked = useVaultStore((s) => s.setUnlocked);
  const navigate = useNavigate();

  useEffect(() => {
    loadConfig().then((c) => setRecents(c.recentVaults));
  }, []);

  function back() {
    setMode({ kind: "choice" });
    setPassword("");
    setConfirm("");
    setError(null);
  }

  async function chooseOpen() {
    setError(null);
    if (!isTauri) {
      // Dev fallback: pretend a vault path was selected.
      setMode({ kind: "open", path: "(mock)" });
      return;
    }
    const p = await pickVaultToOpen();
    if (p) setMode({ kind: "open", path: p });
  }

  async function chooseCreate() {
    setError(null);
    if (!isTauri) {
      setMode({ kind: "create", path: "(mock)" });
      return;
    }
    const p = await pickVaultToCreate();
    if (p) setMode({ kind: "create", path: p });
  }

  function openWithPath(path: string) {
    setMode({ kind: "open", path });
    setPassword("");
    setConfirm("");
    setError(null);
  }

  async function forgetRecent(path: string) {
    await removeRecentVault(path);
    setRecents((r) => r.filter((v) => v.path !== path));
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (mode.kind === "choice") return;

    if (mode.kind === "create" && password !== confirm) {
      setError(t("error.password_mismatch"));
      return;
    }
    if (password.length < 8) {
      setError(t("error.password_too_short"));
      return;
    }

    setBusy(true);
    try {
      if (!isTauri) {
        // Dev fallback in browser
        setUnlocked("(mock)", new Date().toISOString());
        navigate("/dashboard");
        return;
      }

      if (mode.kind === "create") {
        await ipc.vault.create(mode.path, password, i18n.language);
        await ipc.vault.open(mode.path, password);
        toast.success(t("toast.vault_created"));
      } else {
        await ipc.vault.open(mode.path, password);
      }

      await recordOpenedVault(mode.path);
      setUnlocked(mode.path, new Date().toISOString());
      navigate("/dashboard");
    } catch (e) {
      if (isIpcError(e)) {
        if (e.code === "invalid_password") setError(t("error.wrong_password"));
        else if (e.code === "vault_already_exists")
          setError(t("error.vault_exists_dot"));
        else if (e.code === "vault_not_found") setError(t("error.vault_not_found_dot"));
        else setError(e.message);
      } else {
        setError(String(e));
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex h-screen w-screen items-center justify-center bg-bg text-fg overflow-hidden">
      <div className="w-full max-w-[400px] px-6">
        <div className="mb-8 flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-[var(--radius-lg)] bg-accent text-accent-fg">
            <Lock className="h-5 w-5" strokeWidth={2.25} />
          </div>
          <div>
            <h1 className="text-lg font-semibold tracking-tight">{t("app.name")}</h1>
            <p className="text-xs text-fg-muted">{t("app.subtitle")}</p>
          </div>
        </div>

        {mode.kind === "choice" && (
          <div className="space-y-4">
            {recents.length > 0 && (
              <div>
                <h2 className="mb-2 text-xs font-medium uppercase tracking-wider text-fg-subtle">
                  {t("unlock.recents")}
                </h2>
                <div className="space-y-1">
                  {recents.map((r) => (
                    <div
                      key={r.path}
                      className="group flex items-center gap-2 rounded-[var(--radius)] border border-border bg-surface px-3 py-2 hover:bg-surface-hover hover:border-border-strong transition-colors"
                    >
                      <button
                        onClick={() => openWithPath(r.path)}
                        className="flex-1 text-left min-w-0"
                      >
                        <div className="text-sm font-medium truncate">{r.name}</div>
                        <div className="text-[10px] text-fg-subtle truncate">
                          {t("unlock.opened_label", { date: formatDate(r.lastOpenedAt) })}
                        </div>
                      </button>
                      <button
                        onClick={() => forgetRecent(r.path)}
                        className="opacity-0 group-hover:opacity-100 text-fg-subtle hover:text-fg transition-opacity"
                        title={t("common.forget")}
                      >
                        <XIcon className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            )}

            <div className="space-y-2">
              <button
                onClick={chooseOpen}
                className="group flex w-full items-center gap-3 rounded-[var(--radius-lg)] border border-border bg-surface px-4 py-3 text-left transition-colors hover:bg-surface-hover hover:border-border-strong"
              >
                <FolderOpen className="h-4 w-4 text-fg-muted group-hover:text-fg" />
                <div className="flex-1">
                  <div className="text-sm font-medium">{t("unlock.open_vault")}</div>
                  <div className="text-xs text-fg-subtle">{t("unlock.select_vault_file")}</div>
                </div>
              </button>
              <button
                onClick={chooseCreate}
                className="group flex w-full items-center gap-3 rounded-[var(--radius-lg)] border border-border bg-surface px-4 py-3 text-left transition-colors hover:bg-surface-hover hover:border-border-strong"
              >
                <FilePlus className="h-4 w-4 text-fg-muted group-hover:text-fg" />
                <div className="flex-1">
                  <div className="text-sm font-medium">{t("unlock.create_vault")}</div>
                  <div className="text-xs text-fg-subtle">
                    {t("unlock.set_master_password")}
                  </div>
                </div>
              </button>
            </div>

            <p className="pt-2 flex items-start gap-2 text-xs text-fg-subtle">
              <ShieldCheck className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              <span>{t("unlock.security_notice")}</span>
            </p>
          </div>
        )}

        {(mode.kind === "open" || mode.kind === "create") && (
          <form onSubmit={onSubmit} className="space-y-4">
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={back}
                className={cn(
                  "rounded-[var(--radius)] p-1 text-fg-subtle hover:text-fg hover:bg-surface-hover",
                  "transition-colors"
                )}
              >
                <ArrowLeft className="h-3.5 w-3.5" />
              </button>
              <h2 className="text-sm font-medium flex-1">
                {mode.kind === "open"
                  ? t("unlock.master_password_heading")
                  : t("unlock.create_password_heading")}
              </h2>
            </div>

            <div className="rounded-[var(--radius)] border border-border bg-muted px-3 py-2 text-xs text-fg-muted truncate selectable">
              {mode.path}
            </div>

            <Input
              type="password"
              placeholder="••••••••"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoFocus
              invalid={!!error}
            />

            {mode.kind === "create" && (
              <>
                <p className="-mt-2 text-[11px] text-fg-subtle">
                  {t("common.password_min_hint")}
                </p>
                <Input
                  type="password"
                  placeholder="••••••••"
                  value={confirm}
                  onChange={(e) => setConfirm(e.target.value)}
                  invalid={!!error}
                />
                <p className="text-xs text-fg-subtle">
                  {t("unlock.no_recovery_warning")}
                </p>
              </>
            )}

            {error && <p className="text-xs text-danger">{error}</p>}

            <Button type="submit" className="w-full" size="lg" disabled={busy}>
              {busy
                ? t("common.waiting")
                : mode.kind === "open"
                  ? t("common.unlock")
                  : t("common.create_vault")}
            </Button>
          </form>
        )}
      </div>
    </div>
  );
}
