/** Small DOM helpers the quest window's files share (`el` is the game-wide one, `ui/dom.ts`). */

import { el } from "@/ui/dom";

export { el };

/** A refusal under the claim it answers. */
export const refusalNote = (message: string): HTMLElement => {
  const note = el("p", "quests-refusal", message);
  note.setAttribute("role", "alert");
  return note;
};
