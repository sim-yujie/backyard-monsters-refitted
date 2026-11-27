import type { EventYardLanded, EventYards, EventYardView, YardPrizeView } from "@/api/eventYards";
import { buildPictureUrl, buttonUrl } from "@/game/yard/buildButtonArt";
import { BLACK_SPURTZ_TYPE, SPURTZ_TYPE } from "@/game/yard/spurtzReward";
import { formatCountdown } from "@/ui/format";
import { coinAmount, coinWords } from "@/ui/events/coinUi";
import { el } from "@/ui/dom";
import { gameIcon } from "@/ui/gameIcon";
import { Popup } from "@/ui/Popup";
import "@/ui/styles/eventYards.css";

/**
 * The Brukkarg attack events' screens (beta 10): the Events card's yard
 * track and Attack button, the line under an attack's result, and the prize
 * pop-up at home. Short words, icons over words (owner).
 */

const TOTAL_YARDS = { carnage: 10, brukwar: 5 } as const;

/** "Yard 3 of 10", or "Your yard" for Brukkarg War's copy. */
export const yardName = (yard: Pick<EventYardView, "index" | "copy">, total: number): string =>
  yard.copy ? "Your own yard" : `Yard ${yard.index} of ${total}`;

/** The prize for beating `yards` of the event, as small pictures and numbers. */
export const prizeChips = (prize: YardPrizeView, size: 16 | 24 | 32 = 24): HTMLElement => {
  const chips = el("span", "yard-prize");
  if (prize.glimmers) {
    const coins = coinAmount(`+${prize.glimmers}`, { size });
    coins.setAttribute("aria-label", coinWords(prize.glimmers));
    chips.append(coins);
  }
  if (prize.spurtz) {
    const black = prize.spurtz === 3;
    const img = el("img", "yard-prize__building");
    img.src = buttonUrl(black ? BLACK_SPURTZ_TYPE : SPURTZ_TYPE);
    img.alt = black ? "Black Diamond Spurtz Cannons" : `${prize.spurtz} Spurtz Cannon${prize.spurtz > 1 ? "s" : ""}`;
    chips.append(img, el("span", "yard-prize__count", black ? "Black Diamond" : `×${prize.spurtz}`));
  }
  if (prize.decoration) {
    const img = el("img", "yard-prize__building");
    img.src = buildPictureUrl(prize.decoration);
    img.alt = "Creature Carnage trophy";
    chips.append(img);
  }
  return chips;
};

/** The next prize the player can win, or null when all are won. */
export const nextPrize = (yards: EventYards): YardPrizeView | null =>
  yards.prizes.find((prize) => prize.yards > yards.beaten) ?? null;

/** The yard track: one tile per yard, wrecked, next or still to come. */
const track = (yards: EventYards): HTMLElement => {
  const total = yards.yards.length;
  const list = el("ol", "yard-track");
  list.setAttribute("aria-label", `${yards.beaten} of ${total} yards beaten`);
  for (const yard of yards.yards) {
    const state = yard.destroyed ? "won" : yard.next ? "next" : "ahead";
    const item = el("li", `yard-track__yard yard-track__yard--${state}`);
    item.title = `${yardName(yard, total)}${yard.destroyed ? ": wrecked" : ""}`;
    if (yard.destroyed) item.append(gameIcon("townhall", { size: 24, decorative: true, className: "yard-track__icon" }));
    item.append(el("span", "yard-track__number", yard.copy ? "You" : String(yard.index)));
    const prize = yards.prizes.find((one) => one.yards === yard.index);
    if (prize && !yard.destroyed && (prize.spurtz || prize.decoration)) {
      item.append(gameIcon("gift", { size: 16, decorative: true, className: "yard-track__gift" }));
    }
    list.append(item);
  }
  return list;
};

export interface YardCardOptions {
  readonly yards: EventYards;
  readonly now: number;
  /** Starts the attack; returns why it cannot, or null. */
  readonly onAttack: (yard: EventYardView) => string | null;
}

/** The Events card's body for a Brukkarg attack event. */
export const yardCardBody = ({ yards, now, onAttack }: YardCardOptions): HTMLElement => {
  const body = el("div", "yard-card");
  body.dataset["event"] = yards.event;
  body.append(track(yards));
  const total = yards.yards.length || TOTAL_YARDS[yards.event];
  const next = yards.yards.find((yard) => yard.next) ?? null;

  if (!next) {
    body.append(el("p", "yard-card__done", `All ${total} yards wrecked!`));
    return body;
  }

  const row = el("div", "yard-card__next");
  const info = el("div", "yard-card__info");
  info.append(el("p", "yard-card__title", `Next: ${yardName(next, total)}`));
  if (next.damage > 0 && next.repairsAt > now) {
    const hurt = el("p", "yard-card__damage");
    hurt.append(
      gameIcon("yarddamage", { size: 16, decorative: true }),
      ` ${next.damage}% · `,
      gameIcon("time", { size: 16, decorative: true }),
      ` Repairs in ${formatCountdown(next.repairsAt - now)}`,
    );
    info.append(hurt);
  }
  const prize = nextPrize(yards);
  if (prize) {
    const line = el("div", "yard-card__prize");
    line.title = prize.yards > yards.beaten + 1 ? `Prize at ${prize.yards} yards` : "Prize for this yard";
    line.append(gameIcon("gift", { size: 24, decorative: true, className: "yard-card__gift" }), prizeChips(prize));
    if (prize.yards > yards.beaten + 1) line.append(el("span", "yard-card__at", `at ${prize.yards}`));
    info.append(line);
  }
  row.append(info);

  const reason = yards.locked ?? (next.wavesNeeded > 0 ? `Beat ${next.wavesNeeded} more wave${next.wavesNeeded > 1 ? "s" : ""} first.` : null);
  if (reason) {
    body.append(row, el("p", "yard-card__locked", reason));
    return body;
  }
  const attack = el("button", "btn btn--primary yard-card__attack");
  attack.type = "button";
  attack.append(gameIcon("swords", { size: 24, decorative: true }), " Attack");
  const refusal = el("p", "yard-card__refusal");
  refusal.hidden = true;
  attack.addEventListener("click", () => {
    const why = onAttack(next);
    if (why) {
      refusal.textContent = why;
      refusal.hidden = false;
    } else attack.disabled = true;
  });
  row.append(attack);
  body.append(row, refusal);
  return body;
};

/** The line under an attack's result: the Town Hall down or not, and the event's count. */
export const eventYardResult = (landed: EventYardLanded): HTMLElement => {
  const box = el("div", `yard-result yard-result--${landed.won ? "won" : "standing"}`);
  const head = el("p", "yard-result__head");
  head.append(
    gameIcon("townhall", { size: 24, decorative: true }),
    landed.won ? " Town Hall down!" : " Town Hall still standing.",
  );
  box.append(head, el("p", "yard-result__count", `${landed.beaten} of ${landed.total} yards wrecked`));
  if (!landed.won) box.append(el("p", "yard-result__hint", "Its damage stays for a day. Attack again!"));
  for (const prize of landed.prizes) box.append(prizeChips(prize));
  return box;
};

/** Words for one prize, for the pop-up. */
export const prizeWords = (prize: YardPrizeView): string => {
  if (prize.spurtz === 3) return "Your Spurtz Cannons are now Black Diamond! Build up to 2.";
  if (prize.spurtz) return `You can build ${prize.spurtz} Spurtz Cannon${prize.spurtz > 1 ? "s" : ""}. Find it under Defensive.`;
  if (prize.decoration) return "The Creature Carnage trophy is in your Decorations.";
  return `${prize.glimmers ?? 0} Glimmers`;
};

/** The prize pop-up at home after an attack that won prizes. */
export const openYardPrizePopup = (container: HTMLElement, landed: EventYardLanded, onClose?: () => void): Popup => {
  const popup = new Popup({
    title: landed.event === "carnage" ? "Creature Carnage" : "Brukkarg War",
    className: "yard-prize-popup",
    ...(onClose ? { onClose } : {}),
  });
  const body = el("div", "yard-prize-popup__body");
  body.append(el("p", "yard-prize-popup__count", `${landed.beaten} of ${landed.total} yards wrecked`));
  const list = el("ul", "yard-prize-popup__list");
  for (const prize of landed.prizes) {
    const item = el("li", "yard-prize-popup__item");
    item.append(prizeChips(prize, 32));
    if (!prize.glimmers || prize.spurtz || prize.decoration) item.append(el("p", "yard-prize-popup__words", prizeWords(prize)));
    list.append(item);
  }
  const ok = el("button", "btn btn--primary yard-prize-popup__ok", "OK");
  ok.type = "button";
  ok.addEventListener("click", () => popup.close());
  body.append(list, ok);
  popup.setContent(body).mount(container);
  return popup;
};
