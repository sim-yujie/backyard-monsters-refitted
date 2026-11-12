import { shieldUrl } from "@/game/alliance/allianceRules";
import { Popup } from "@/ui/Popup";

/** The alliance a player would leave with their Map Room 2 world, as the warning shows it. */
export interface LeavingAlliance {
  readonly name: string;
  /** Flash's shield, 1 to 41. */
  readonly image: number;
}

export const LEAVE_WORLD_TEXT = {
  title: "Leave this world?",
  lead: (alliance: string): string => `You will leave ${alliance}. Your points stay with the alliance.`,
  /** A leader alone: the server closes the alliance as they go. */
  lastLead: (alliance: string): string => `You will leave ${alliance}. You are its last member, so it closes.`,
  cancel: "Cancel",
  go: "Leave",
  handOverTitle: "Hand over first",
  handOverLead: (alliance: string): string => `You lead ${alliance}. Make another member leader before you leave this world.`,
  ok: "OK",
} as const;

/** The alliance's shield and name, heading both pop-ups. */
const allianceBadge = (alliance: LeavingAlliance): HTMLElement => {
  const badge = document.createElement("p");
  badge.className = "attack-mate-dialog__alliance";
  const shield = document.createElement("img");
  shield.className = "attack-mate-dialog__shield";
  shield.src = shieldUrl(alliance.image, "medium");
  shield.alt = "";
  shield.width = 40;
  shield.height = 40;
  const name = document.createElement("strong");
  name.textContent = alliance.name;
  badge.append(shield, name);
  return badge;
};

const textButton = (className: string, words: string, onClick: () => void): HTMLButtonElement => {
  const button = document.createElement("button");
  button.type = "button";
  button.className = className;
  button.textContent = words;
  button.addEventListener("click", onClick);
  return button;
};

/**
 * Before a member leaves their Map Room 2 world (design v5 §2, decided):
 * "You will leave Golden Acorns. Your points stay with the alliance."
 * `last` is a leader alone, whose alliance closes as they go. Resolves true
 * on Leave, false on Cancel, Escape or the scrim.
 */
export const confirmLeaveWorld = (container: HTMLElement, alliance: LeavingAlliance, last = false): Promise<boolean> =>
  new Promise((resolve) => {
    let answered = false;
    const answer = (value: boolean): void => {
      if (answered) return;
      answered = true;
      resolve(value);
    };
    const popup = new Popup({
      title: LEAVE_WORLD_TEXT.title,
      className: "takeover-dialog leave-world-dialog",
      onClose: () => answer(false),
    });
    const lead = document.createElement("p");
    lead.className = "takeover-dialog__lead";
    lead.textContent = last ? LEAVE_WORLD_TEXT.lastLead(alliance.name) : LEAVE_WORLD_TEXT.lead(alliance.name);
    const actions = document.createElement("div");
    actions.className = "takeover-dialog__actions";
    actions.append(
      textButton("btn btn--ghost", LEAVE_WORLD_TEXT.cancel, () => popup.close()),
      textButton("btn btn--danger", LEAVE_WORLD_TEXT.go, () => {
        answer(true);
        popup.close();
      }),
    );
    popup.setContent(allianceBadge(alliance), lead, actions);
    popup.mount(container);
  });

/**
 * A leader with other members cannot leave the world yet (the server refuses
 * it too): says to hand over leadership first. Resolves once closed.
 */
export const showHandOverFirst = (container: HTMLElement, alliance: LeavingAlliance): Promise<void> =>
  new Promise((resolve) => {
    const popup = new Popup({
      title: LEAVE_WORLD_TEXT.handOverTitle,
      className: "takeover-dialog leave-world-dialog",
      onClose: () => resolve(),
    });
    const lead = document.createElement("p");
    lead.className = "takeover-dialog__lead";
    lead.textContent = LEAVE_WORLD_TEXT.handOverLead(alliance.name);
    const actions = document.createElement("div");
    actions.className = "takeover-dialog__actions";
    actions.append(textButton("btn btn--primary", LEAVE_WORLD_TEXT.ok, () => popup.close()));
    popup.setContent(allianceBadge(alliance), lead, actions);
    popup.mount(container);
  });
