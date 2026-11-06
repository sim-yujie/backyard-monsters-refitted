/** Small DOM helpers the quest window's files share. */

export const el = <K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className: string,
  text?: string,
): HTMLElementTagNameMap[K] => {
  const element = document.createElement(tag);
  element.className = className;
  if (text !== undefined) element.textContent = text;
  return element;
};

/** A refusal under the claim it answers. */
export const refusalNote = (message: string): HTMLElement => {
  const note = el("p", "quests-refusal", message);
  note.setAttribute("role", "alert");
  return note;
};
