import { claimAnnouncementGift } from "@/api/announcements";
import { ApiError } from "@/api/http";
import { resourceAmount } from "@/ui/resourceIcon";

/**
 * The Shiny gift on an announcement: the coin stack, the amount and "Claim".
 * It is the same in the pop-up and in the Account menu's "News", so a gift
 * closed past in one can still be claimed in the other. A claim tells
 * {@link onGiftClaimed}, and the yard reads its new balance from there.
 */

type Listener = () => void;

const listeners = new Set<Listener>();

/** Calls `listener` after each claim that gave Shiny. Returns the unsubscribe. */
export const onGiftClaimed = (listener: Listener): (() => void) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};

/** The coin stack and the amount. The dashboard's preview draws it too. */
export const giftAmount = (shiny: number): HTMLElement =>
  resourceAmount("shiny", shiny, { className: "announcement-gift__amount" });

export interface AnnouncementGiftOptions {
  readonly id: number;
  readonly shiny: number;
  /** Whether this player has it already. */
  readonly claimed: boolean;
  /** Asks the server for it; the game's route by default. */
  readonly claim?: (id: number) => Promise<unknown>;
  /** Called once the gift is the player's. */
  readonly onClaimed?: () => void;
}

const CLAIM_FAILED = "Could not claim it. Check your connection and try again.";

/** The words for a claim that did not land. */
const failureWords = (err: unknown): string =>
  err instanceof ApiError && err.status >= 400 && err.status < 500 ? err.message : CLAIM_FAILED;

/** The gift's row, with `button` being its "Claim" (null once claimed). */
export const announcementGift = (
  options: AnnouncementGiftOptions,
): { element: HTMLElement; button: HTMLButtonElement | null } => {
  const claim = options.claim ?? claimAnnouncementGift;
  const element = document.createElement("div");
  element.className = "announcement-gift";
  element.append(giftAmount(options.shiny));

  const claimedMark = (): HTMLElement => {
    const mark = document.createElement("span");
    mark.className = "announcement-gift__claimed";
    mark.textContent = "Claimed";
    return mark;
  };
  if (options.claimed) {
    element.append(claimedMark());
    return { element, button: null };
  }

  const button = document.createElement("button");
  button.type = "button";
  button.className = "btn btn--primary announcement-gift__claim";
  button.textContent = "Claim";
  const problem = document.createElement("p");
  problem.className = "announcement-gift__problem";
  problem.setAttribute("role", "alert");
  problem.hidden = true;

  button.addEventListener("click", () => {
    button.disabled = true;
    problem.hidden = true;
    void claim(options.id).then(
      () => {
        button.replaceWith(claimedMark());
        for (const listener of [...listeners]) listener();
        options.onClaimed?.();
      },
      (err: unknown) => {
        button.disabled = false;
        problem.textContent = failureWords(err);
        problem.hidden = false;
      },
    );
  });
  element.append(button, problem);
  return { element, button };
};
