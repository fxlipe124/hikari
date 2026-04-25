import { useEffect } from "react";
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
