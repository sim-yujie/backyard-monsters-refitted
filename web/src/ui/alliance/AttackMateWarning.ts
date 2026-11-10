import { shieldUrl } from "@/game/alliance/allianceRules";
import { Popup } from "@/ui/Popup";

/** The alliance a defender shares with the player, as the warning shows it. */
export interface MateAlliance {
  readonly name: string;
  /** Flash's shield, 1 to 41. */
  readonly image: number;
}

export const ATTACK_MATE_TEXT = {
  title: "Attack an alliance mate?",
  lead: (name: string): string => `${name} is in your alliance. Attack anyway?`,
  cancel: "Cancel",
  go: "Attack anyway",
} as const;

/**
 * Flash's "X is in your alliance, attack anyway?" (kept in beta 7, design v5
 * §14): a confirm, not a block, before an attack on an alliance mate's yard.
 * The alliance's shield and name head it. Resolves true on "Attack anyway",
 * false on Cancel, Escape or the scrim. Same dialog shell as the friend warning.
 */
export const confirmAttackOnMate = (container: HTMLElement, name: string, alliance: MateAlliance): Promise<boolean> =>
  new Promise((resolve) => {
    let answered = false;
    const answer = (value: boolean): void => {
      if (answered) return;
      answered = true;
      resolve(value);
    };
    const popup = new Popup({
      title: ATTACK_MATE_TEXT.title,
      className: "takeover-dialog attack-friend-dialog attack-mate-dialog",
      onClose: () => answer(false),
    });

    const badge = document.createElement("p");
    badge.className = "attack-mate-dialog__alliance";
    const shield = document.createElement("img");
    shield.className = "attack-mate-dialog__shield";
    shield.src = shieldUrl(alliance.image, "medium");
    shield.alt = "";
    shield.width = 40;
    shield.height = 40;
    const allianceName = document.createElement("strong");
    allianceName.textContent = alliance.name;
    badge.append(shield, allianceName);

    const lead = document.createElement("p");
    lead.className = "takeover-dialog__lead";
    lead.textContent = ATTACK_MATE_TEXT.lead(name);

    const cancel = document.createElement("button");
    cancel.type = "button";
    cancel.className = "btn btn--ghost";
    cancel.textContent = ATTACK_MATE_TEXT.cancel;
    cancel.addEventListener("click", () => popup.close());
    const go = document.createElement("button");
    go.type = "button";
    go.className = "btn btn--danger";
    go.textContent = ATTACK_MATE_TEXT.go;
    go.addEventListener("click", () => {
      answer(true);
      popup.close();
    });
    const actions = document.createElement("div");
    actions.className = "takeover-dialog__actions";
    actions.append(cancel, go);

    popup.setContent(badge, lead, actions);
    popup.mount(container);
  });
