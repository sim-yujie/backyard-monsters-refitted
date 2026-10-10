import { loginWithToken, logout, restoreStoredSession } from "@/api/auth";
import { Panel } from "@/ui/Panel";
import type { Scene, SceneContext } from "../SceneManager";
import { SceneName } from "../App";
import { resetTokenFromLocation } from "./passwordReset";

/**
 * The first screen.
 *
 * Restores a stored session if there is one and revalidates it against the
 * server, then sends the player either to their yard or to the login form.
 * The yard is where every session starts (issue #172); the Map button goes
 * on from there through `MapGateScene`. The
 * token has to go back through the login route to be checked: the server keeps
 * one valid token per account and session type in Redis, so a JWT that still
 * parses may already have been superseded.
 */
export class BootScene implements Scene {
  private panel: Panel | null = null;

  async enter(context: SceneContext): Promise<void> {
    const status = document.createElement("div");
    status.className = "boot-status";
    status.textContent = "Starting…";

    const wrapper = document.createElement("div");
    wrapper.className = "scene-centre";

    this.panel = new Panel({ title: "Backyard Monsters", closable: false });
    this.panel.setContent(status);
    wrapper.append(this.panel.element);
    context.overlay.content.append(wrapper);

    // An emailed reset link goes to the form for it, signed in or not.
    if (resetTokenFromLocation(window.location)) {
      context.goTo(SceneName.LOGIN);
      return;
    }

    const stored = restoreStoredSession();
    if (!stored) {
      context.goTo(SceneName.LOGIN);
      return;
    }

    status.textContent = "Resuming your session…";

    try {
      await loginWithToken(stored.token, stored.sessionType);
      context.goTo(SceneName.YARD);
    } catch {
      // Expired, superseded or the server is down. Either way the player needs
      // the form; the specific reason is surfaced there when they retry.
      logout();
      context.goTo(SceneName.LOGIN);
    }
  }

  exit(): void {
    this.panel?.close();
    this.panel = null;
  }
}
