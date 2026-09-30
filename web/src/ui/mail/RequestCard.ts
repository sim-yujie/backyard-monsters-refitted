/**
 * A request inside a message bubble that the player answers there: what it
 * asks, where it stands, and its buttons (#203). The truce request is its
 * first use; an invitation to move (#205) is meant to be the second, with its
 * own title, words and buttons. It knows nothing of either.
 *
 * Pressing a button runs its action with every button held down. An action
 * answers null when it went through, and the screen redraws the thread with
 * the request's new state; or the reason it did not, which shows under the
 * buttons and lets them be pressed again.
 */

/** How the state reads: blue while it waits, green when it holds, red when refused, grey once over. */
export type RequestTone = "info" | "good" | "bad" | "muted";

export interface RequestAction {
  readonly label: string;
  readonly style: "primary" | "danger" | "outline";
  /** Null once done, or why it could not be. */
  readonly run: () => Promise<string | null>;
}

export interface RequestCardOptions {
  /** What it is: "Truce request". */
  readonly title: string;
  /** Where it stands: "Waiting", "Active". */
  readonly state: string;
  readonly tone: RequestTone;
  /** What that means for the player, in a sentence or two. */
  readonly detail: string;
  /** The answers the player may give. None: the card only reports. */
  readonly actions?: readonly RequestAction[];
}

const make = <K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className: string,
  text?: string,
): HTMLElementTagNameMap[K] => {
  const node = document.createElement(tag);
  node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
};

export const requestCard = (options: RequestCardOptions): HTMLElement => {
  const card = make("div", `mail-request mail-request--${options.tone}`);
  card.setAttribute("role", "group");
  card.setAttribute("aria-label", `${options.title}: ${options.state}`);

  const head = make("div", "mail-request__head");
  head.append(make("strong", "mail-request__title", options.title), make("span", "mail-request__state", options.state));
  card.append(head, make("p", "mail-request__detail", options.detail));

  const actions = options.actions ?? [];
  if (actions.length === 0) return card;

  const refusal = make("p", "mail-request__refusal");
  refusal.setAttribute("role", "alert");
  refusal.hidden = true;

  const buttons = actions.map((action) => {
    const node = make("button", `btn btn--${action.style} mail-request__action`, action.label);
    node.type = "button";
    node.addEventListener("click", () => void press(action));
    return node;
  });

  const press = async (action: RequestAction): Promise<void> => {
    if (buttons.some((one) => one.disabled)) return;
    for (const one of buttons) one.disabled = true;
    card.setAttribute("aria-busy", "true");
    refusal.hidden = true;
    const reason = await action.run();
    card.removeAttribute("aria-busy");
    if (reason === null) return;
    refusal.textContent = reason;
    refusal.hidden = false;
    for (const one of buttons) one.disabled = false;
  };

  const row = make("div", "mail-request__actions");
  row.append(...buttons);
  card.append(row, refusal);
  return card;
};
