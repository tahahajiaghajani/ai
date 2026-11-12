import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter } from "react-router";
import "./styles.css";
import { ThemeProvider } from "./lib/theme";
import { SessionProvider } from "./lib/session";
import { preloadApp } from "./lib/preload";
import { orgApi } from "./lib/api";
import { App } from "./App";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: { refetchOnWindowFocus: false, retry: (n, e) => n < 1 && (e as { status?: number }).status !== 401 && (e as { status?: number }).status !== 403 },
  },
});

// A page of an organisation opened directly (a link, a bookmark, a refresh): the signed-in app's code and the
// organisation (GET /api/o/:org, the same query as useOrgQuery) start with the session's own requests instead of
// after them — a page load waited for /auth/me, then the chunk, then the organisation. Without a session neither
// answer is used: the app goes to the sign-in page as before.
const opened = /^\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})(?:\/|$)/i.exec(window.location.pathname);
if (opened) {
  preloadApp();
  void queryClient.prefetchQuery({ queryKey: ["org", opened[1]], queryFn: () => orgApi(opened[1]).get(""), staleTime: 60_000 });
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <ThemeProvider>
        <BrowserRouter>
          <SessionProvider>
            <App />
          </SessionProvider>
        </BrowserRouter>
      </ThemeProvider>
    </QueryClientProvider>
  </StrictMode>,
);
