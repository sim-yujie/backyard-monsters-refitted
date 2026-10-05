import { worldChat } from "@/game/chat/chatSession";
import { Panel } from "@/ui/Panel";
import type { Scene, SceneContext } from "../SceneManager";

/**
 * The idle disconnect's screen (#271, `game/presence/idleWatch.ts`), Flash's
 * `POPUPS.Timeout`.
 *
 * Opening it closes the game screen behind it, which stops that screen's
 * timers and polls; it holds neither the presence ping nor the idle watch, so
 * nothing is sent while it is up and the player reads as offline, as the
 * owner wants. The game's frame clock stops too (Flash's `GLOBAL.Halt`), as
 * nothing is left to draw. Reconnect reloads the page: the stored session signs the player
 * back in and opens their yard (`BootScene`), with nothing left over from
 * before.
 */
export class AwayScene implements Scene {
  private panel: Panel | null = null;

  constructor(
    /** How long without input disconnects, in words: "10 minutes". */
    private readonly after: string,
    /** Stops the frame clock once the screen is up. */
    private readonly halt: () => void = () => {},
    private readonly reload: () => void = () => window.location.reload(),
  ) {}

  enter(context: SceneContext): void {
    // Offline means out of world chat too (#282); the reload starts it again.
    worldChat.stop();
    const text = document.createElement("p");
    text.textContent =
      `You were disconnected after ${this.after} without any input. ` +
      "Reconnect to load your yard again.";

    const reconnect = document.createElement("button");
    reconnect.type = "button";
    reconnect.className = "btn btn--primary";
    reconnect.textContent = "Reconnect";
    reconnect.addEventListener("click", () => {
      reconnect.disabled = true;
      this.reload();
    });
    const actions = document.createElement("div");
    actions.className = "away-screen__actions";
    actions.append(reconnect);

    this.panel = new Panel({
      title: "You were away too long",
      closable: false,
      className: "away-screen",
    });
    this.panel.setContent(text, actions);
    const wrapper = document.createElement("div");
    wrapper.className = "scene-centre";
    wrapper.append(this.panel.element);
    context.overlay.content.append(wrapper);
    reconnect.focus();
    this.halt();
  }

  exit(): void {
    this.panel?.close();
    this.panel = null;
  }
}
