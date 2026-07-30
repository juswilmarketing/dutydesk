import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { registerSW } from "virtual:pwa-register";
import { App } from "./app/App";
import "./styles/globals.css";

registerSW({
  immediate: true,
  onOfflineReady() {
    console.info("DutyDesk is ready to work offline.");
  },
  onRegisteredSW(_url, registration) {
    if (!registration) return;
    const checkForUpdates = () => registration.update().catch(() => null);
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "visible") checkForUpdates();
    });
    window.setInterval(checkForUpdates, 60 * 60 * 1000);
  },
  onNeedRefresh() {
    // Stale cached bundles are a common cause of blank/frozen pages on Windows after deploy.
    window.location.reload();
  },
  onRegisterError(error) {
    console.warn("DutyDesk service worker registration failed:", error);
  },
});

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
