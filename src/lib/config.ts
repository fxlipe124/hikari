import { LazyStore } from "@tauri-apps/plugin-store";
import { isTauri } from "./ipc";

export interface RecentVault {
  path: string;
  name: string;
  lastOpenedAt: string;
}

export interface AppConfig {
  recentVaults: RecentVault[];
  autolockMinutes: number;
}

const DEFAULT: AppConfig = {
  recentVaults: [],
  autolockMinutes: 10,
};

const KEY_RECENT = "recent_vaults";
const KEY_AUTOLOCK = "autolock_minutes";
const RECENT_LIMIT = 6;

let store: LazyStore | null = null;

function getStore(): LazyStore | null {
  if (!isTauri) return null;
  if (!store) store = new LazyStore("config.json");
  return store;
}

function deriveName(path: string): string {
  const seg = path.split(/[\\/]/).pop() ?? path;
  return seg.replace(/\.vault$/i, "");
}

export async function loadConfig(): Promise<AppConfig> {
  const s = getStore();
  if (!s) return DEFAULT;
  const recents = ((await s.get<RecentVault[]>(KEY_RECENT)) ?? []).slice(0, RECENT_LIMIT);
  const autolock = (await s.get<number>(KEY_AUTOLOCK)) ?? DEFAULT.autolockMinutes;
  return { recentVaults: recents, autolockMinutes: autolock };
}

export async function recordOpenedVault(path: string): Promise<void> {
  const s = getStore();
  if (!s) return;
  const existing = ((await s.get<RecentVault[]>(KEY_RECENT)) ?? []).filter(
    (r) => r.path !== path
  );
  const next: RecentVault[] = [
    { path, name: deriveName(path), lastOpenedAt: new Date().toISOString() },
    ...existing,
  ].slice(0, RECENT_LIMIT);
  await s.set(KEY_RECENT, next);
  await s.save();
}

export async function removeRecentVault(path: string): Promise<void> {
  const s = getStore();
  if (!s) return;
  const existing = ((await s.get<RecentVault[]>(KEY_RECENT)) ?? []).filter(
    (r) => r.path !== path
  );
  await s.set(KEY_RECENT, existing);
  await s.save();
}

export async function setAutolockMinutes(min: number): Promise<void> {
  const s = getStore();
  if (!s) return;
  await s.set(KEY_AUTOLOCK, min);
  await s.save();
}

const KEY_LOCALE = "locale";

export async function getStoredLocale(): Promise<string | null> {
  const s = getStore();
  if (!s) return null;
  return (await s.get<string>(KEY_LOCALE)) ?? null;
}

export async function setStoredLocale(locale: string): Promise<void> {
  const s = getStore();
  if (!s) return;
  await s.set(KEY_LOCALE, locale);
  await s.save();
}

const KEY_CURRENCY = "currency";

export async function getStoredCurrency(): Promise<string | null> {
  const s = getStore();
  if (!s) return null;
  return (await s.get<string>(KEY_CURRENCY)) ?? null;
}

export async function setStoredCurrency(currency: string): Promise<void> {
  const s = getStore();
  if (!s) return;
  await s.set(KEY_CURRENCY, currency);
  await s.save();
}
