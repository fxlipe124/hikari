import { useState, useCallback, useRef, type DragEvent } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";
import { ClipboardPaste, FileUp, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/Button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/Dialog";
import { Input } from "@/components/ui/Input";
import { MonthPicker } from "@/components/ui/MonthPicker";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/Tabs";
import { useCards } from "@/lib/queries";
import { ipc, isTauri, isIpcError } from "@/lib/ipc";
import { pickPdfToImport } from "@/lib/dialogs";
import { useImportStore } from "@/hooks/useImportStore";
import { cn, currentYearMonth, statementPeriod } from "@/lib/utils";

type Mode = "paste" | "pdf";

export function ImportDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { t } = useTranslation();
  const [mode, setMode] = useState<Mode>("paste");
  const [pasted, setPasted] = useState("");
  const [pdfFile, setPdfFile] = useState<{ name: string; size?: number } | null>(null);
  const [pdfPath, setPdfPath] = useState<string | null>(null);
  const [pdfPassword, setPdfPassword] = useState("");
  const [needsPassword, setNeedsPassword] = useState(false);
  const [cardId, setCardId] = useState<string | null>(null);
  // Statement period (year-month) the imported PDF closes in. Sofisa-style
  // statements only print "DD/MM" per row, so the parser needs both the
  // closing-month *and* the card's closing_day to figure out which calendar
  // year/month each row actually belongs to (handles Dec→Jan rollover).
  const [referenceYearMonth, setReferenceYearMonth] = useState<string>(() => currentYearMonth());
  const [isDragging, setIsDragging] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const navigate = useNavigate();
  const setPayload = useImportStore((s) => s.setPayload);
  const { data: cards } = useCards();

  const onFiles = useCallback(async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    const f = files[0];
    if (!f.name.toLowerCase().endsWith(".pdf")) return;
    // In Tauri, the dropped File object exposes a synthetic path attribute.
    const path = (f as unknown as { path?: string }).path ?? null;
    setPdfFile({ name: f.name, size: f.size });
    setPdfPath(path);
    setNeedsPassword(false);
    setError(null);
  }, []);

  const onDrop = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setIsDragging(false);
    onFiles(e.dataTransfer.files);
  };

  // Click-to-pick: in Tauri, the HTML <input type="file"> picker doesn't
  // expose the absolute path that the Rust side needs to read the PDF.
  // Route through the native dialog to get a real filesystem path.
  const onPickClick = async () => {
    if (!isTauri) {
      fileRef.current?.click();
      return;
    }
    const path = await pickPdfToImport();
    if (!path) return;
    const name = path.split(/[\\/]/).pop() ?? "statement.pdf";
    setPdfFile({ name });
    setPdfPath(path);
    setNeedsPassword(false);
    setError(null);
  };

  const reset = () => {
    setPasted("");
    setPdfFile(null);
    setPdfPath(null);
    setPdfPassword("");
    setNeedsPassword(false);
    setCardId(null);
    setReferenceYearMonth(currentYearMonth());
    setError(null);
    setMode("paste");
  };

  // Picking a card snaps the default statement period to *that card's*
  // current open statement (today + closing_day). Without this, the user
  // would have to manually adjust the picker every time they switch cards.
  const onCardPick = (id: string) => {
    setCardId(id);
    const card = (cards ?? []).find((c) => c.id === id);
    if (card) {
      const today = new Date();
      const todayIso = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;
      setReferenceYearMonth(statementPeriod(todayIso, card.closingDay));
    }
  };

  const canSubmit =
    !!cardId && (mode === "paste" ? pasted.trim().length > 20 : !!pdfFile);

  async function onContinue() {
    if (!cardId) return;
    setError(null);
    setBusy(true);
    try {
      let text: string;
      if (mode === "paste") {
        text = pasted;
      } else {
        if (!isTauri) {
          setError(t("error.pdf_drop_requires_tauri"));
          setBusy(false);
          return;
        }
        if (!pdfPath) {
          setError(t("error.file_path_read_failed"));
          setBusy(false);
          return;
        }
        try {
          text = await ipc.import.extractPdf(
            pdfPath,
            needsPassword ? pdfPassword : undefined
          );
        } catch (e) {
          if (isIpcError(e) && e.code === "invalid_password") {
            setNeedsPassword(true);
            setError(needsPassword ? t("error.wrong_password") : t("error.pdf_protected"));
            setBusy(false);
            return;
          }
          throw e;
        }
      }

      if (!isTauri) {
        setError(t("error.tauri_backend_required"));
        setBusy(false);
        return;
      }
      const preview = await ipc.import.parse(
        text,
        undefined,
        referenceYearMonth,
        cardId,
      );
      if (preview.transactions.length === 0) {
        setError(t("error.no_transactions_recognized"));
        setBusy(false);
        return;
      }
      setPayload(
        cardId,
        preview.issuer,
        preview.transactions,
        preview.cardMetadata ?? null,
      );
      onOpenChange(false);
      reset();
      navigate("/import-preview");
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        // Reset before propagating so a parent that re-opens the dialog
        // synchronously in the same handler doesn't see stale draft state.
        if (!v) reset();
        onOpenChange(v);
      }}
    >
      <DialogContent className="max-w-[540px]">
        <DialogHeader>
          <DialogTitle>{t("dialog.import.title")}</DialogTitle>
          <DialogDescription>
            {t("dialog.import.description")}
          </DialogDescription>
        </DialogHeader>

        <div className="px-5 py-4 space-y-4 overflow-auto flex-1">
          <div className="space-y-3">
            <div>
              <label className="mb-1.5 block text-xs font-medium text-fg-muted">
                {t("form.label.card")}
              </label>
              <div className="flex flex-wrap gap-1.5">
                {(cards ?? []).map((c) => (
                  <button
                    key={c.id}
                    onClick={() => onCardPick(c.id)}
                    className={cn(
                      "flex items-center gap-1.5 rounded-[var(--radius)] border px-2.5 py-1 text-xs transition-colors",
                      cardId === c.id
                        ? "border-accent bg-accent/10 text-accent"
                        : "border-border text-fg-muted hover:bg-surface-hover"
                    )}
                  >
                    <span className="h-2 w-3 rounded-sm" style={{ backgroundColor: c.color }} />
                    {c.name}
                  </button>
                ))}
                {(!cards || cards.length === 0) && (
                  <p className="text-xs text-fg-subtle">
                    {t("import.no_cards_hint")}
                  </p>
                )}
              </div>
            </div>
            <div>
              <label className="mb-1.5 block text-xs font-medium text-fg-muted">
                {t("import.statement_period")}
              </label>
              <MonthPicker
                value={referenceYearMonth}
                onChange={setReferenceYearMonth}
                showTodayButton={false}
              />
              <p className="mt-1 text-[10px] text-fg-subtle">
                {t("import.statement_period_hint")}
              </p>
            </div>
          </div>

          <Tabs value={mode} onValueChange={(v) => setMode(v as Mode)}>
            <TabsList>
              <TabsTrigger value="paste">
                <ClipboardPaste className="h-3 w-3 mr-1.5" />
                {t("import.tab.paste")}
              </TabsTrigger>
              <TabsTrigger value="pdf">
                <FileUp className="h-3 w-3 mr-1.5" />
                {t("import.tab.pdf")}
              </TabsTrigger>
            </TabsList>

            <TabsContent value="paste">
              <textarea
                value={pasted}
                onChange={(e) => setPasted(e.target.value)}
                placeholder={t("import.paste_placeholder")}
                className={cn(
                  "selectable min-h-[220px] w-full resize-none rounded-[var(--radius)] border border-border bg-bg",
                  "px-3 py-2 text-xs font-mono text-fg",
                  "placeholder:text-fg-subtle",
                  "focus:outline-none focus:border-accent focus:ring-2 focus:ring-accent/20"
                )}
                spellCheck={false}
              />
              {pasted.trim().length > 0 && (
                <p className="mt-1.5 text-[10px] text-fg-subtle">
                  {t("import.text_info", {
                    lines: pasted.split("\n").filter((l) => l.trim()).length,
                    chars: pasted.length,
                  })}
                </p>
              )}
            </TabsContent>

            <TabsContent value="pdf">
              <div
                onDragOver={(e) => {
                  e.preventDefault();
                  setIsDragging(true);
                }}
                onDragLeave={() => setIsDragging(false)}
                onDrop={onDrop}
                onClick={onPickClick}
                className={cn(
                  "flex flex-col items-center justify-center gap-2 rounded-[var(--radius)] border-2 border-dashed cursor-pointer transition-colors min-h-[160px]",
                  isDragging
                    ? "border-accent bg-accent/5"
                    : pdfFile
                    ? "border-accent/40 bg-accent/5"
                    : "border-border bg-bg hover:border-border-strong"
                )}
              >
                <input
                  ref={fileRef}
                  type="file"
                  accept="application/pdf"
                  className="hidden"
                  onChange={(e) => onFiles(e.target.files)}
                />
                {pdfFile ? (
                  <>
                    <FileUp className="h-6 w-6 text-accent" />
                    <div className="text-sm font-medium">{pdfFile.name}</div>
                    {pdfFile.size != null && (
                      <div className="text-xs text-fg-subtle tabular">
                        {(pdfFile.size / 1024).toFixed(1)} KB
                      </div>
                    )}
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        setPdfFile(null);
                        setPdfPath(null);
                        setNeedsPassword(false);
                      }}
                      className="mt-1 text-xs text-fg-muted hover:text-fg"
                    >
                      {t("common.change_file")}
                    </button>
                  </>
                ) : (
                  <>
                    <FileUp className="h-6 w-6 text-fg-subtle" />
                    <div className="text-sm">{t("import.pdf_instruction")}</div>
                    <div className="text-xs text-fg-subtle">
                      {t("import.pdf_password_hint")}
                    </div>
                  </>
                )}
              </div>
              {needsPassword && (
                <div className="mt-3">
                  <label className="mb-1 block text-xs font-medium text-fg-muted">
                    {t("form.label.pdf_password")}
                  </label>
                  <Input
                    type="password"
                    value={pdfPassword}
                    onChange={(e) => setPdfPassword(e.target.value)}
                    placeholder="••••••••"
                    autoFocus
                  />
                </div>
              )}
            </TabsContent>
          </Tabs>

          <p className="flex items-start gap-2 text-xs text-fg-subtle">
            <Sparkles className="mt-0.5 h-3 w-3 shrink-0 text-accent" />
            <span>{t("import.auto_categorization_hint")}</span>
          </p>

          {error && <p className="text-xs text-danger">{error}</p>}
        </div>

        <DialogFooter>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => onOpenChange(false)}
            disabled={busy}
          >
            {t("common.cancel")}
          </Button>
          <Button size="sm" disabled={!canSubmit || busy} onClick={onContinue}>
            {busy ? t("common.processing") : t("common.continue")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
