import { open, save } from "@tauri-apps/plugin-dialog";
import i18n from "./i18n";
import { isTauri } from "./ipc";

export async function pickVaultToOpen(): Promise<string | null> {
  if (!isTauri) return null;
  const path = await open({
    multiple: false,
    filters: [{ name: "Hikari Vault", extensions: ["vault"] }],
    title: i18n.t("dialog.file.select_vault"),
  });
  if (typeof path === "string") return path;
  return null;
}

export async function pickVaultToCreate(suggestedName = "hikari.vault"): Promise<string | null> {
  if (!isTauri) return null;
  const path = await save({
    defaultPath: suggestedName,
    filters: [{ name: "Hikari Vault", extensions: ["vault"] }],
    title: i18n.t("dialog.file.create_vault"),
  });
  if (typeof path === "string") return path.endsWith(".vault") ? path : `${path}.vault`;
  return null;
}

export async function pickPdfToImport(): Promise<string | null> {
  if (!isTauri) return null;
  const path = await open({
    multiple: false,
    filters: [{ name: "PDF", extensions: ["pdf"] }],
    title: i18n.t("dialog.file.select_pdf"),
  });
  if (typeof path === "string") return path;
  return null;
}

/**
 * Multi-PDF picker — returns the absolute paths of every PDF the user
 * selected. Used by ImportDialog's batch-import mode where each PDF is
 * parsed independently (its own Sofisa header → its own closing day),
 * then all rows are merged into a single ImportPreview.
 */
export async function pickPdfsToImport(): Promise<string[]> {
  if (!isTauri) return [];
  const path = await open({
    multiple: true,
    filters: [{ name: "PDF", extensions: ["pdf"] }],
    title: i18n.t("dialog.file.select_pdfs"),
  });
  if (Array.isArray(path)) return path;
  if (typeof path === "string") return [path];
  return [];
}

export async function pickCsvToSave(suggestedName = "transactions.csv"): Promise<string | null> {
  if (!isTauri) return null;
  const path = await save({
    defaultPath: suggestedName,
    filters: [{ name: "CSV", extensions: ["csv"] }],
    title: i18n.t("dialog.file.save_csv"),
  });
  if (typeof path === "string") return path.endsWith(".csv") ? path : `${path}.csv`;
  return null;
}
