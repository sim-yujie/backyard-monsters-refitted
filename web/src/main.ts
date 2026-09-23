import "@/ui/styles/tokens.css";
import "@/ui/styles/ui.css";
import "@/ui/styles/maproom.css";
import "@/ui/styles/planner.css";

import { App } from "@/app/App";

const host = document.querySelector<HTMLElement>("#game-root");

if (!host) {
  throw new Error("Missing #game-root in index.html");
}

const app = new App(host);

void app.start().catch((error: unknown) => {
  console.error("Failed to start:", error);
  host.textContent = "The game could not start. Check the console for details.";
});

// A handle for measuring in the browser: frame cost, renderer state, forced
// redraws. Development only, so nothing ships with a global back door.
if (import.meta.env.DEV) {
  (globalThis as Record<string, unknown>)["bymr"] = app;
}

// Vite replaces the module on save; tear the old app down so the canvas, the
// overlay and the ticker do not accumulate.
if (import.meta.hot) {
  import.meta.hot.dispose(() => app.destroy());
}
