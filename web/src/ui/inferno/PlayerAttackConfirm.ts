import { PLAYER_ATTACK_COUNTS } from "@/game/inferno/playerMap";
import { Popup } from "@/ui/Popup";
import "@/ui/styles/inferno.css";

/**
 * The question before an attack on another player's Inferno yard (WP 3.5):
 * Flash's own words (`PlayerHandler.onAttack`, `GLOBAL.Message` with
 * "Attack!"), and under them the plain warning that the attack counts once
 * it starts (owner, 27 Oct). Resolves true on Attack!, false on Cancel or a
 * close.
 */

export const PLAYER_ATTACK_CONFIRM = {
  title: (name: string): string => `Attack ${name}?`,
  cancel: "Cancel",
  /** `map_attack_btn2`. */
  go: "Attack!",
} as const;

export const confirmPlayerAttack = (container: HTMLElement, name: string, text: string): Promise<boolean> =>
  new Promise((resolve) => {
    let answered = false;
    const answer = (value: boolean): void => {
      if (answered) return;
      answered = true;
      resolve(value);
    };
    const popup = new Popup({
      title: PLAYER_ATTACK_CONFIRM.title(name),
      className: "takeover-dialog inferno-attack-confirm",
      onClose: () => answer(false),
    });

    const lead = document.createElement("p");
    lead.className = "takeover-dialog__lead";
    lead.textContent = text;
    const counts = document.createElement("p");
    counts.className = "inferno-attack-confirm__counts";
    counts.setAttribute("role", "note");
    counts.textContent = PLAYER_ATTACK_COUNTS;

    const cancel = document.createElement("button");
    cancel.type = "button";
    cancel.className = "btn btn--ghost";
    cancel.textContent = PLAYER_ATTACK_CONFIRM.cancel;
    cancel.addEventListener("click", () => popup.close());
    const go = document.createElement("button");
    go.type = "button";
    go.className = "btn btn--danger";
    go.textContent = PLAYER_ATTACK_CONFIRM.go;
    go.addEventListener("click", () => {
      answer(true);
      popup.close();
    });
    const actions = document.createElement("div");
    actions.className = "takeover-dialog__actions";
    actions.append(cancel, go);

    popup.setContent(lead, counts, actions);
    popup.mount(container);
  });
