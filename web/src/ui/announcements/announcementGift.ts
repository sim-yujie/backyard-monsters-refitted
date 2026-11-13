import { claimAnnouncementGift, type GiftClaim } from "@/api/announcements";
import { ApiError } from "@/api/http";
import { noteCoins } from "@/game/eventCoins";
import { coinAmount } from "@/ui/events/coinUi";
import { resourceAmount } from "@/ui/resourceIcon";

/**
 * The gift on an announcement: the coin stack with the Shiny, the Glimmer
 * with the Glimmers (either or both), and "Claim". It is the same in the
 * pop-up and in the Account menu's "News", so a gift closed past in one can
 * still be claimed in the other. A claim tells {@link onGiftClaimed}, and
 * the yard reads its new Shiny from there; the claim's answer carries the
 * Glimmers purse, which goes straight to the top bar and its "+100" notice
 * (`game/eventCoins.ts`).
 */

type Listener = () => void;

const listeners = new Set<Listener>();

/** Calls `listener` after each claim that gave Shiny. Returns the unsubscribe. */
export const onGiftClaimed = (listener: Listener): (() => void) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};

/** What a gift holds. */
export interface GiftAmounts {
  readonly shiny: number;
  readonly glimmers: number;
}

/**
 * The amounts, icon and number each: "[coins] 200 [glimmer] 100", leaving out
 * a zero. The dashboard's preview draws it too.
 */
export const giftAmount = (gift: GiftAmounts): HTMLElement => {
  const amounts = document.createElement("span");
  amounts.className = "announcement-gift__amounts";
  if (gift.shiny > 0) {
    amounts.append(resourceAmount("shiny", gift.shiny, { className: "announcement-gift__amount" }));
  }
  if (gift.glimmers > 0) {
    amounts.append(
      coinAmount(gift.glimmers, {
        size: 32,
        className: "announcement-gift__amount announcement-gift__amount--glimmers",
      }),
    );
  }
  return amounts;
};

export interface AnnouncementGiftOptions extends GiftAmounts {
  readonly id: number;
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

/** Hands the claim's Glimmers purse to the top bar, when the answer has one. */
const notePurse = (answer: unknown): void => {
  if (answer === null || typeof answer !== "object") return;
  const { eventcoins, coinsGained } = answer as Partial<GiftClaim>;
  if (typeof eventcoins === "number") noteCoins(eventcoins, coinsGained ?? null);
};

/** The gift's row, with `button` being its "Claim" (null once claimed). */
export const announcementGift = (
  options: AnnouncementGiftOptions,
): { element: HTMLElement; button: HTMLButtonElement | null } => {
  const claim = options.claim ?? claimAnnouncementGift;
  const element = document.createElement("div");
  element.className = "announcement-gift";
  element.append(giftAmount(options));

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
      (answer) => {
        button.replaceWith(claimedMark());
        notePurse(answer);
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
