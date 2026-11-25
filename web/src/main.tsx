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

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
