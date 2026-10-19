import { Popup } from "@/ui/Popup";

export const ATTACK_FRIEND_TEXT = {
  title: "Attack a friend?",
  lead: (name: string): string => `${name} is your friend. Are you sure you want to attack their yard?`,
  note: "They will see that you attacked them.",
  cancel: "Cancel",
  go: "Attack anyway",
} as const;

/**
 * The "are you sure? this is your friend" confirm shown before an attack on a
 * friend's yard (#377). Resolves true on "Attack anyway", false on Cancel,
 * Escape or the scrim. Built on the same dialog shell as the takeover confirm.
 */
export const confirmAttackOnFriend = (container: HTMLElement, name: string): Promise<boolean> =>
  new Promise((resolve) => {
    let answered = false;
    const answer = (value: boolean): void => {
      if (answered) return;
      answered = true;
      resolve(value);
    };
    const popup = new Popup({
      title: ATTACK_FRIEND_TEXT.title,
      className: "takeover-dialog attack-friend-dialog",
      onClose: () => answer(false),
    });

    const lead = document.createElement("p");
    lead.className = "takeover-dialog__lead";
    lead.textContent = ATTACK_FRIEND_TEXT.lead(name);
    const note = document.createElement("p");
    note.className = "u-muted";
    note.textContent = ATTACK_FRIEND_TEXT.note;

    const cancel = document.createElement("button");
    cancel.type = "button";
    cancel.className = "btn btn--ghost";
    cancel.textContent = ATTACK_FRIEND_TEXT.cancel;
    cancel.addEventListener("click", () => popup.close());
    const go = document.createElement("button");
    go.type = "button";
    go.className = "btn btn--danger";
    go.textContent = ATTACK_FRIEND_TEXT.go;
    go.addEventListener("click", () => {
      answer(true);
      popup.close();
    });
    const actions = document.createElement("div");
    actions.className = "takeover-dialog__actions";
    actions.append(cancel, go);

    popup.setContent(lead, note, actions);
    popup.mount(container);
  });
