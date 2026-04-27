import { useEffect } from "react";
import { useTranslation } from "react-i18next";
import { toast as sonner } from "sonner";
import {
  createHashRouter,
  RouterProvider,
  Navigate,
} from "react-router-dom";
import { useTheme } from "@/hooks/useTheme";
import { useVaultStore } from "@/hooks/useVaultStore";
import { useAutolock } from "@/hooks/useAutolock";
import { Unlock } from "@/routes/Unlock";
import { Dashboard } from "@/routes/Dashboard";
import { Transactions } from "@/routes/Transactions";
import { Cards } from "@/routes/Cards";
import { Categories } from "@/routes/Categories";
import { Installments } from "@/routes/Installments";
import { Settings } from "@/routes/Settings";
import { ImportPreview } from "@/routes/ImportPreview";
import { AppShell } from "@/components/AppShell";
import { useQuery } from "@tanstack/react-query";
import { loadConfig } from "@/lib/config";
import { useHistoryStore } from "@/lib/historyStore";
import { toast } from "@/lib/toast";

const router = createHashRouter([
  { path: "/unlock", element: <Unlock /> },
  {
    path: "/",
    element: <AppShell />,
    children: [
      { index: true, element: <Navigate to="/dashboard" replace /> },
      { path: "dashboard", element: <Dashboard /> },
      { path: "transactions", element: <Transactions /> },
      { path: "cards", element: <Cards /> },
      { path: "categories", element: <Categories /> },
      { path: "installments", element: <Installments /> },
      { path: "settings", element: <Settings /> },
      { path: "import-preview", element: <ImportPreview /> },
    ],
  },
]);

function App() {
  useTheme();
  const { t } = useTranslation();
  const status = useVaultStore((s) => s.status);
  const hydrate = useVaultStore((s) => s.hydrate);
  const { data: config } = useQuery({
    queryKey: ["app-config"],
    queryFn: loadConfig,
  });
  useAutolock(config?.autolockMinutes ?? 10);

  useEffect(() => {
    hydrate();
  }, [hydrate]);

  useEffect(() => {
    if (status === "loading") return;
    const isOnUnlock = window.location.hash.startsWith("#/unlock");
    if (status === "locked" && !isOnUnlock) {
      window.location.hash = "#/unlock";
    } else if (status === "unlocked" && isOnUnlock) {
      window.location.hash = "#/dashboard";
    }
  }, [status]);

  // Drop the in-memory undo stack on relock — those callbacks close over
  // vault data the next user shouldn't be able to "undelete".
  useEffect(() => {
    if (status === "locked") {
      useHistoryStore.getState().clear();
    }
  }, [status]);

  // Global Ctrl+Z / Ctrl+Y for the history stack. Skips when focus is in a
  // text field so the browser's native input-undo still works.
  useEffect(() => {
    function inEditableField(target: EventTarget | null): boolean {
      if (!(target instanceof HTMLElement)) return false;
      const tag = target.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA") return true;
      if (target.isContentEditable) return true;
      return false;
    }
    function handler(e: KeyboardEvent) {
      const meta = e.ctrlKey || e.metaKey;
      if (!meta) return;
      if (inEditableField(e.target)) return;
      const key = e.key.toLowerCase();
      const isUndo = key === "z" && !e.shiftKey;
      const isRedo = (key === "z" && e.shiftKey) || key === "y";
      if (!isUndo && !isRedo) return;
      e.preventDefault();
      const store = useHistoryStore.getState();
      if (isUndo) {
        if (store.past.length === 0) {
          sonner(t("toast.nothing_to_undo"));
          return;
        }
        store
          .undo()
          .then((op) => {
            if (op) {
              sonner.success(t("toast.undone", { label: t(op.label) }));
            }
          })
          .catch((err) => toast.fromError(err));
      } else {
        if (store.future.length === 0) {
          sonner(t("toast.nothing_to_redo"));
          return;
        }
        store
          .redo()
          .then((op) => {
            if (op) {
              sonner.success(t("toast.redone", { label: t(op.label) }));
            }
          })
          .catch((err) => toast.fromError(err));
      }
    }
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [t]);

  if (status === "loading") {
    return (
      <div className="flex h-screen w-screen items-center justify-center bg-bg">
        <div className="h-1 w-24 rounded-full bg-muted overflow-hidden">
          <div className="h-full w-1/3 bg-accent animate-pulse" />
        </div>
      </div>
    );
  }

  return <RouterProvider router={router} />;
}

export default App;
