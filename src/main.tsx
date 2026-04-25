import React from "react";
import ReactDOM from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "sonner";
import App from "./App";
import "./lib/i18n";
import "./styles/globals.css";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: false,
      refetchOnWindowFocus: false,
      staleTime: 5_000,
    },
  },
});

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <QueryClientProvider client={queryClient}>
      <App />
      <Toaster
        position="bottom-right"
        theme="system"
        toastOptions={{
          unstyled: false,
          classNames: {
            toast:
              "bg-surface !border-border text-fg shadow-lg !rounded-[var(--radius)] tabular text-sm",
            description: "text-fg-muted",
            success: "!border-l-2 !border-l-success",
            error: "!border-l-2 !border-l-danger",
            actionButton: "bg-accent text-accent-fg",
          },
        }}
      />
    </QueryClientProvider>
  </React.StrictMode>
);
