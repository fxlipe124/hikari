import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useLocation, useNavigate } from "react-router-dom";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import {
  Calendar,
  CalendarRange,
  Check,
  Database,
  FileDown,
  FileUp,
  Languages,
  Lock,
  Monitor,
  Moon,
  Plus,
  Search,
  Sun,
  type LucideIcon,
} from "lucide-react";
import { ALL_NAV } from "@/lib/nav";
import { Kbd } from "@/components/ui/Kbd";
import { useTheme } from "@/hooks/useTheme";
import { useVaultStore } from "@/hooks/useVaultStore";
import { useViewMonthStore } from "@/hooks/useViewMonthStore";
import { toast } from "@/lib/toast";
import { backupNowInteractive } from "@/lib/backup";
import { exportCsvInteractive } from "@/lib/csvExport";
import { isSupportedLocale, SUPPORTED_LOCALES } from "@/lib/i18n";
import { setStoredLocale } from "@/lib/config";
import { cn, currentYearMonth } from "@/lib/utils";

interface PaletteAction {
  id: string;
  label: string;
  icon: LucideIcon;
  /** Kbd hint chips, e.g. ["G", "D"]. */
  hint?: string[];
  /** Marks the currently-active choice (theme, language). */
  active?: boolean;
  run: () => void;
}

interface PaletteGroup {
  label: string;
  actions: PaletteAction[];
}

/** Case- and diacritic-insensitive needle for matching "media" ↔ "média". */
function norm(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

export function CommandPalette({
  open,
  onOpenChange,
  onNewTransaction,
  onImport,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onNewTransaction: () => void;
  onImport: () => void;
}) {
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const location = useLocation();
  const { theme, setTheme } = useTheme();
  const lock = useVaultStore((s) => s.lock);
  const mode = useViewMonthStore((s) => s.mode);
  const setMode = useViewMonthStore((s) => s.setMode);
  const setYm = useViewMonthStore((s) => s.setYm);
  const setYear = useViewMonthStore((s) => s.setYear);

  const [query, setQuery] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);
  const listRef = useRef<HTMLDivElement>(null);
  // Chromium re-dispatches a synthetic mousemove (same coordinates) at the
  // element under a stationary cursor after any scroll. Without filtering
  // it, arrowing past the fold scrolls the list, the synthetic event fires
  // on whatever row slid under the pointer, and the selection snaps back —
  // keyboard navigation gets trapped at the cursor. Only pointer events
  // whose coordinates actually changed count as intent.
  const lastPointer = useRef<{ x: number; y: number } | null>(null);

  const groups = useMemo<PaletteGroup[]>(() => {
    const navigation: PaletteAction[] = ALL_NAV.map((item) => ({
      id: `nav-${item.to}`,
      label: t(item.labelKey),
      icon: item.icon,
      hint: item.shortcut.split(" "),
      run: () => navigate(item.to),
    }));

    const actions: PaletteAction[] = [
      {
        id: "new-transaction",
        label: t("common.new_transaction"),
        icon: Plus,
        run: onNewTransaction,
      },
      {
        id: "import-statement",
        label: t("common.import_statement"),
        icon: FileUp,
        run: onImport,
      },
      {
        id: "backup-now",
        label: t("common.backup_now"),
        icon: Database,
        run: () => void backupNowInteractive(),
      },
      {
        id: "export-csv-month",
        label: t("common.export_month"),
        icon: FileDown,
        run: () => void exportCsvInteractive("month"),
      },
      {
        id: "export-csv-all",
        label: t("common.export_all"),
        icon: FileDown,
        run: () => void exportCsvInteractive("all"),
      },
      {
        id: "lock-vault",
        label: t("common.lock_vault"),
        icon: Lock,
        run: lock,
      },
    ];

    const view: PaletteAction[] = [
      {
        id: "go-current-month",
        label: t("palette.go_current_month"),
        icon: Calendar,
        run: () => {
          const ym = currentYearMonth();
          setMode("month");
          setYm(ym);
          setYear(parseInt(ym.slice(0, 4), 10));
          if (!["/dashboard", "/transactions"].includes(location.pathname)) {
            navigate("/dashboard");
          }
        },
      },
      {
        id: "toggle-view-mode",
        label:
          mode === "year"
            ? t("palette.switch_month_view")
            : t("palette.switch_year_view"),
        icon: CalendarRange,
        run: () => setMode(mode === "year" ? "month" : "year"),
      },
    ];

    const themeIcons: Record<string, LucideIcon> = {
      light: Sun,
      dark: Moon,
      system: Monitor,
    };
    const preferences: PaletteAction[] = [
      ...(["light", "dark", "system"] as const).map((variant) => ({
        id: `theme-${variant}`,
        label: t(`settings.${variant}_theme`),
        icon: themeIcons[variant],
        active: theme === variant,
        run: () => setTheme(variant),
      })),
      ...SUPPORTED_LOCALES.map((locale) => ({
        id: `lang-${locale}`,
        label: t(`language.${locale}`),
        icon: Languages,
        active: i18n.language === locale,
        run: async () => {
          if (!isSupportedLocale(locale)) return;
          try {
            await i18n.changeLanguage(locale);
            await setStoredLocale(locale);
          } catch (e) {
            toast.fromError(e, t("error.fallback"));
          }
        },
      })),
    ];

    return [
      { label: t("palette.group_navigation"), actions: navigation },
      { label: t("palette.group_actions"), actions },
      { label: t("palette.group_view"), actions: view },
      { label: t("palette.group_preferences"), actions: preferences },
    ];
  }, [
    t,
    i18n,
    navigate,
    location.pathname,
    onNewTransaction,
    onImport,
    lock,
    mode,
    setMode,
    setYm,
    setYear,
    theme,
    setTheme,
  ]);

  const filtered = useMemo(() => {
    if (!query.trim()) return groups;
    const q = norm(query);
    return groups
      .map((g) => ({
        ...g,
        actions: g.actions.filter((a) => norm(a.label).includes(q)),
      }))
      .filter((g) => g.actions.length > 0);
  }, [groups, query]);

  const flat = useMemo(() => filtered.flatMap((g) => g.actions), [filtered]);

  // Fresh palette on every open; clamp the cursor when filtering shrinks
  // the list.
  useEffect(() => {
    if (open) {
      setQuery("");
      setActiveIndex(0);
    }
  }, [open]);
  useEffect(() => {
    setActiveIndex((i) => Math.min(i, Math.max(0, flat.length - 1)));
  }, [flat.length]);

  // Keep the active row visible while arrowing through a scrolled list.
  useEffect(() => {
    const el = listRef.current?.querySelector('[aria-selected="true"]');
    el?.scrollIntoView({ block: "nearest" });
  }, [activeIndex, flat]);

  function runAction(action: PaletteAction) {
    onOpenChange(false);
    action.run();
  }

  function onInputKeyDown(e: React.KeyboardEvent) {
    // IME composition: Enter commits the composed text and arrows move the
    // candidate selection — neither should drive the palette.
    if (e.nativeEvent.isComposing) return;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActiveIndex((i) => (flat.length === 0 ? 0 : (i + 1) % flat.length));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActiveIndex((i) =>
        flat.length === 0 ? 0 : (i - 1 + flat.length) % flat.length
      );
    } else if (e.key === "Enter") {
      e.preventDefault();
      const action = flat[activeIndex];
      if (action) runAction(action);
    }
  }

  const activeId = flat[activeIndex]?.id;
  let runningIndex = -1;

  return (
    <DialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-black/55 backdrop-blur-[2px] data-[state=open]:animate-fade-in data-[state=closed]:animate-fade-out" />
        <DialogPrimitive.Content
          aria-describedby={undefined}
          className={cn(
            "fixed left-1/2 top-[16vh] z-50 w-full max-w-[560px] -translate-x-1/2",
            "overflow-hidden rounded-[var(--radius-lg)] border border-border bg-surface shadow-lg",
            "data-[state=open]:animate-dialog-in data-[state=closed]:animate-dialog-out"
          )}
        >
          <DialogPrimitive.Title className="sr-only">
            {t("palette.title")}
          </DialogPrimitive.Title>
          <div className="flex items-center gap-2.5 border-b border-border px-3.5">
            <Search className="h-4 w-4 shrink-0 text-fg-subtle" />
            <input
              value={query}
              onChange={(e) => {
                setQuery(e.target.value);
                setActiveIndex(0);
              }}
              onKeyDown={onInputKeyDown}
              placeholder={t("palette.placeholder")}
              className="h-11 w-full bg-transparent text-sm text-fg placeholder:text-fg-subtle focus-visible:outline-none"
              role="combobox"
              aria-expanded="true"
              aria-autocomplete="list"
              aria-controls="palette-list"
              aria-activedescendant={activeId ? `palette-item-${activeId}` : undefined}
              autoCorrect="off"
              autoCapitalize="off"
              spellCheck={false}
            />
          </div>
          <div ref={listRef} className="max-h-[340px] overflow-y-auto p-1.5">
            {flat.length === 0 && (
              <p className="px-2.5 py-8 text-center text-sm text-fg-subtle">
                {t("palette.no_results")}
              </p>
            )}
            {/* The listbox holds only role=group containers of options —
                the no-results paragraph lives outside it so screen readers
                don't enumerate stray text as list entries. */}
            <div id="palette-list" role="listbox">
            {filtered.map((group, gi) => (
              <div
                key={group.label}
                role="group"
                aria-labelledby={`palette-group-${gi}`}
              >
                <div
                  id={`palette-group-${gi}`}
                  role="presentation"
                  className="px-2.5 pb-1 pt-2 text-[10px] font-medium uppercase tracking-wider text-fg-subtle"
                >
                  {group.label}
                </div>
                {group.actions.map((action) => {
                  runningIndex += 1;
                  const index = runningIndex;
                  return (
                    <button
                      key={action.id}
                      id={`palette-item-${action.id}`}
                      role="option"
                      aria-selected={index === activeIndex}
                      tabIndex={-1}
                      onMouseMove={(e) => {
                        const last = lastPointer.current;
                        lastPointer.current = { x: e.clientX, y: e.clientY };
                        // Same coordinates = the post-scroll synthetic event,
                        // not the user's hand.
                        if (last && last.x === e.clientX && last.y === e.clientY) return;
                        if (index !== activeIndex) setActiveIndex(index);
                      }}
                      onClick={() => runAction(action)}
                      className={cn(
                        "flex h-9 w-full items-center gap-2.5 rounded-[var(--radius)] px-2.5 text-left text-sm",
                        index === activeIndex
                          ? "bg-surface-hover text-fg"
                          : "text-fg-muted"
                      )}
                    >
                      <action.icon className="h-4 w-4 shrink-0 text-fg-subtle" />
                      <span className="flex-1 truncate">{action.label}</span>
                      {action.active && (
                        <Check className="h-3.5 w-3.5 shrink-0 text-accent" />
                      )}
                      {action.hint && (
                        <span className="flex gap-1">
                          {action.hint.map((k) => (
                            <Kbd key={k}>{k}</Kbd>
                          ))}
                        </span>
                      )}
                    </button>
                  );
                })}
              </div>
            ))}
            </div>
          </div>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}
