import {
  CreditCard,
  FolderTree,
  LayoutDashboard,
  Layers,
  Receipt,
  Settings,
  type LucideIcon,
} from "lucide-react";

export interface NavItem {
  to: string;
  labelKey: string;
  icon: LucideIcon;
  /** Display hint, e.g. "G D". */
  shortcut: string;
  /** Second key of the vim-style "g <key>" jump. */
  key: string;
}

/**
 * Route list shared by the sidebar, the "g <key>" jump shortcuts, and the
 * command palette — one source of truth so a new route can't show up in
 * one surface and be missing from the others.
 */
export const NAV: readonly NavItem[] = [
  { to: "/dashboard", labelKey: "nav.dashboard", icon: LayoutDashboard, shortcut: "G D", key: "d" },
  { to: "/transactions", labelKey: "nav.transactions", icon: Receipt, shortcut: "G T", key: "t" },
  { to: "/installments", labelKey: "nav.installments", icon: Layers, shortcut: "G P", key: "p" },
  { to: "/cards", labelKey: "nav.cards", icon: CreditCard, shortcut: "G C", key: "c" },
  { to: "/categories", labelKey: "nav.categories", icon: FolderTree, shortcut: "G A", key: "a" },
] as const;

/** Settings lives in its own sidebar slot but shares the jump/palette machinery. */
export const SETTINGS_NAV: NavItem = {
  to: "/settings",
  labelKey: "nav.settings",
  icon: Settings,
  shortcut: "G S",
  key: "s",
};

export const ALL_NAV: readonly NavItem[] = [...NAV, SETTINGS_NAV];
