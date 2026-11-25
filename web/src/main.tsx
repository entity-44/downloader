import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import "./index.css";

// Earlier versions kept a saved library in IndexedDB; this version keeps nothing.
try {
  indexedDB.deleteDatabase("keepsake");
} catch {
  /* unavailable */
}

// Shortcut links arrive as ?paste=<data>: hand them to the paste page.
try {
  const paste = new URLSearchParams(location.search).get("paste");
  if (paste) history.replaceState(null, "", location.pathname + "#/paste/" + encodeURIComponent(paste));
} catch {
  /* ignore */
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
