import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { NavLink, Outlet, useNavigate } from "react-router-dom";
import { Lock, Plus, Search } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/Button";
import { Kbd } from "@/components/ui/Kbd";
import { useVaultStore } from "@/hooks/useVaultStore";
import { NAV, SETTINGS_NAV, ALL_NAV } from "@/lib/nav";
import { ImportDialog } from "@/components/ImportDialog";
import { TransactionDialog } from "@/components/TransactionDialog";
import { CommandPalette } from "@/components/CommandPalette";

const isMac =
  typeof navigator !== "undefined" && /Mac/i.test(navigator.userAgent);

// Vim-style "g <key>" jumps. We arm on a bare "g" and resolve the next key
// within a short window. Bail if the user is typing into an input/textarea
// or the key has a modifier — we don't want to hijack save/copy/etc.
function useGoToShortcuts() {
  const navigate = useNavigate();
  const armedAt = useRef<number | null>(null);
  useEffect(() => {
    const isEditable = (el: EventTarget | null) => {
      if (!(el instanceof HTMLElement)) return false;
      const tag = el.tagName;
      return (
        tag === "INPUT" ||
        tag === "TEXTAREA" ||
        tag === "SELECT" ||
        el.isContentEditable
      );
    };
    function onKeyDown(e: KeyboardEvent) {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (isEditable(e.target)) return;
      const now = Date.now();
      if (e.key === "g" || e.key === "G") {
        armedAt.current = now;
        return;
      }
      if (armedAt.current && now - armedAt.current < 1500) {
        const match = ALL_NAV.find((n) => n.key === e.key.toLowerCase());
        if (match) {
          e.preventDefault();
          navigate(match.to);
        }
        armedAt.current = null;
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [navigate]);
}

function VaultIndicator() {
  const { t } = useTranslation();
  const path = useVaultStore((s) => s.path);
  const lock = useVaultStore((s) => s.lock);
  const label = path?.split(/[/\\]/).pop()?.replace(/\.vault$/, "") ?? t("app.name");

  return (
    <div className="flex items-center gap-2 px-3 py-2 text-xs">
      <div className="flex h-7 w-7 items-center justify-center rounded-[var(--radius)] bg-accent/15 text-accent">
        <Lock className="h-3.5 w-3.5" />
      </div>
      <div className="flex flex-1 flex-col overflow-hidden">
        <span className="truncate font-medium text-fg">{label}</span>
        <span className="truncate text-fg-subtle text-[10px]">{t("vault.status_unlocked")}</span>
      </div>
      <button
        onClick={lock}
        className="text-fg-subtle hover:text-fg transition-colors"
        title={t("common.lock_vault")}
      >
        <Lock className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}

export function AppShell() {
  const { t } = useTranslation();
  const [importOpen, setImportOpen] = useState(false);
  const [txOpen, setTxOpen] = useState(false);
  const [paletteOpen, setPaletteOpen] = useState(false);
  useGoToShortcuts();

  // Ctrl+K / Cmd+K toggles the command palette from anywhere, including
  // text fields — the modifier makes the intent unambiguous.
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if ((e.ctrlKey || e.metaKey) && !e.altKey && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setPaletteOpen((o) => !o);
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);
  return (
    <div className="flex h-screen w-screen overflow-hidden bg-bg text-fg">
      <aside className="flex w-56 flex-col border-r border-border bg-surface">
        <div className="flex h-12 items-center gap-2 border-b border-border px-4">
          <div className="h-5 w-5 rounded bg-accent" />
          <span className="font-semibold tracking-tight">{t("app.name")}</span>
        </div>

        <div className="border-b border-border">
          <VaultIndicator />
        </div>

        <nav className="flex flex-1 flex-col gap-0.5 p-2">
          {NAV.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              className={({ isActive }) =>
                cn(
                  "group flex items-center gap-2.5 rounded-[var(--radius)] px-2.5 py-1.5 text-sm transition-colors",
                  isActive
                    ? "bg-surface-hover text-fg font-medium"
                    : "text-fg-muted hover:bg-surface-hover hover:text-fg"
                )
              }
            >
              <item.icon className="h-4 w-4 shrink-0" />
              <span className="flex-1">{t(item.labelKey)}</span>
              <span className="hidden text-[10px] text-fg-subtle tabular group-hover:inline">
                {item.shortcut}
              </span>
            </NavLink>
          ))}
        </nav>

        <div className="border-t border-border p-2">
          <NavLink
            to={SETTINGS_NAV.to}
            className={({ isActive }) =>
              cn(
                "group flex items-center gap-2.5 rounded-[var(--radius)] px-2.5 py-1.5 text-sm transition-colors",
                isActive
                  ? "bg-surface-hover text-fg font-medium"
                  : "text-fg-muted hover:bg-surface-hover hover:text-fg"
              )
            }
          >
            <SETTINGS_NAV.icon className="h-4 w-4" />
            <span className="flex-1">{t(SETTINGS_NAV.labelKey)}</span>
            <span className="hidden text-[10px] text-fg-subtle tabular group-hover:inline">
              {SETTINGS_NAV.shortcut}
            </span>
          </NavLink>
        </div>
      </aside>

      <div className="flex flex-1 flex-col overflow-hidden">
        <header className="flex h-12 items-center justify-between gap-3 border-b border-border bg-surface px-4">
          <button
            onClick={() => setPaletteOpen(true)}
            className="flex h-7 w-64 items-center gap-2 rounded-[var(--radius)] border border-border bg-bg px-2.5 text-xs text-fg-subtle transition-colors hover:border-border-strong hover:text-fg-muted"
          >
            <Search className="h-3.5 w-3.5 shrink-0" />
            <span className="flex-1 truncate text-left">{t("palette.trigger")}</span>
            <span className="flex gap-1">
              <Kbd>{isMac ? "⌘" : "Ctrl"}</Kbd>
              <Kbd>K</Kbd>
            </span>
          </button>

          <div className="flex items-center gap-2">
            <Button variant="secondary" size="sm" onClick={() => setImportOpen(true)}>
              {t("common.import_statement")}
            </Button>
            <Button size="sm" onClick={() => setTxOpen(true)}>
              <Plus className="h-3.5 w-3.5" />
              {t("common.new_transaction")}
            </Button>
          </div>
        </header>

        <main className="flex-1 overflow-auto selectable">
          <Outlet />
        </main>
      </div>

      <ImportDialog open={importOpen} onOpenChange={setImportOpen} />
      <TransactionDialog open={txOpen} onOpenChange={setTxOpen} />
      <CommandPalette
        open={paletteOpen}
        onOpenChange={setPaletteOpen}
        onNewTransaction={() => setTxOpen(true)}
        onImport={() => setImportOpen(true)}
      />
    </div>
  );
}
