import type { EventYardLanded, EventYards, EventYardView, YardPrizeView } from "@/api/eventYards";
import { artUrl } from "@/artUrl";
import { classicLook } from "@/game/classicLook";
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
 * track and "next yard" box with Attack, the box under an attack's result,
 * and the prize pop-up at home. Short words, icons over words (owner);
 * layout after neon's direction A (27 Nov 2026): the track on top, then one
 * inset box like the Krallen Hunt's tiers holding the next yard, its prize
 * and Attack.
 */

const TOTAL_YARDS = { carnage: 10, brukwar: 5 } as const;

/** "Yard 3 of 10"; Brukkarg War's last says it is the copy of your yard. */
export const yardName = (yard: Pick<EventYardView, "index" | "copy">, total: number): string =>
  yard.copy ? `Yard ${yard.index} of ${total}: copy of your yard` : `Yard ${yard.index} of ${total}`;

/** A Spurtz Cannon's picture: Flash's button in the Classic look, the Modern tower otherwise. */
const spurtzPicture = (black: boolean): string =>
  classicLook()
    ? buttonUrl(black ? BLACK_SPURTZ_TYPE : SPURTZ_TYPE)
    : artUrl(`/assets/buildings/${black ? "blackspurtztower" : "spurtztower"}/top.t1@2x.webp`);

/** A prize's name in words: "Spurtz Cannon", "2nd Spurtz Cannon", "Black Diamond Spurtz", "Carnage trophy". */
export const prizeName = (prize: YardPrizeView): string | null => {
  if (prize.spurtz === 3) return "Black Diamond Spurtz";
  if (prize.spurtz) return prize.spurtz > 1 ? `${prize.spurtz}nd Spurtz Cannon` : "Spurtz Cannon";
  if (prize.decoration) return "Carnage trophy";
  return null;
};

/** The prize as small pictures and words. */
export const prizeChips = (prize: YardPrizeView, size: 16 | 24 | 32 = 24): HTMLElement => {
  const chips = el("span", "yard-prize");
  if (prize.glimmers) {
    const coins = coinAmount(`+${prize.glimmers}`, { size });
    coins.setAttribute("aria-label", coinWords(prize.glimmers));
    chips.append(coins);
  }
  if (prize.spurtz || prize.decoration) {
    const img = el("img", "yard-prize__building");
    img.src = prize.spurtz ? spurtzPicture(prize.spurtz === 3) : buildPictureUrl(prize.decoration!);
    img.alt = "";
    chips.append(img, el("span", "yard-prize__name", prizeName(prize) ?? ""));
  }
  return chips;
};

/** The next prize the player can win, or null when all are won. */
export const nextPrize = (yards: EventYards): YardPrizeView | null =>
  yards.prizes.find((prize) => prize.yards > yards.beaten) ?? null;

/** The yard track: one tile per yard, wrecked, next or still to come; five to a row. */
const track = (yards: EventYards): HTMLElement => {
  const total = yards.yards.length;
  const list = el("ol", "yard-track");
  list.setAttribute("aria-label", `${yards.beaten} of ${total} yards wrecked`);
  for (const yard of yards.yards) {
    const state = yard.destroyed ? "won" : yard.next ? "next" : "ahead";
    const item = el("li", `yard-track__yard yard-track__yard--${state}`);
    item.title = `${yardName(yard, total)}${yard.destroyed ? ": wrecked" : ""}`;
    if (yard.destroyed) item.append(el("span", "yard-track__check", "✓"));
    item.append(el("span", "yard-track__number", yard.copy ? "Copy" : String(yard.index)));
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

  const box = el("div", "yard-next");
  const info = el("div", "yard-next__info");
  info.append(el("p", "yard-next__kicker", `Next · ${yardName(next, total)}`));
  if (next.damage > 0 && next.repairsAt > now) {
    const hurt = el("p", "yard-next__damage");
    const damaged = el("span", "yard-next__part");
    damaged.append(gameIcon("yarddamage", { size: 16, decorative: true }), ` ${next.damage}% damaged`);
    const repairs = el("span", "yard-next__part");
    repairs.append(gameIcon("time", { size: 16, decorative: true }), ` Repairs in ${formatCountdown(next.repairsAt - now)}`);
    hurt.append(damaged, repairs);
    info.append(hurt);
  }
  const prize = nextPrize(yards);
  if (prize) {
    const line = el("div", "yard-next__prize");
    line.append(el("span", "yard-next__label", prize.yards > yards.beaten + 1 ? `At yard ${prize.yards}:` : "Prize:"), prizeChips(prize));
    info.append(line);
  }
  box.append(info);

  const reason = yards.locked ?? (next.wavesNeeded > 0 ? `Beat ${next.wavesNeeded} more wave${next.wavesNeeded > 1 ? "s" : ""} first.` : null);
  if (reason) {
    box.append(el("p", "yard-next__locked", reason));
    body.append(box);
    return body;
  }
  const attack = el("button", "btn btn--primary yard-next__attack");
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
  box.append(attack);
  body.append(box, refusal);
  return body;
};

/** The box under an attack's result: the yard wrecked or not, the event's count and the prize won. */
export const eventYardResult = (landed: EventYardLanded): HTMLElement => {
  const box = el("div", `yard-result yard-result--${landed.won ? "won" : "standing"}`);
  const head = el("p", "yard-result__head");
  if (landed.won) head.append(el("span", "yard-track__check", "✓"), ` ${landed.beaten} of ${landed.total} yards wrecked!`);
  else head.append(gameIcon("townhall", { size: 24, decorative: true }), " Town Hall still standing.");
  box.append(head);
  if (!landed.won) box.append(el("p", "yard-result__hint", "Its damage stays for a day. Attack again!"));
  for (const prize of landed.prizes) {
    const line = el("div", "yard-result__prize");
    line.append(el("span", "yard-next__label", "Prize won:"), prizeChips(prize));
    box.append(line);
  }
  return box;
};

/** The pop-up's headline for a prize, or null for one that needs none (Glimmers alone). */
export const prizeHeadline = (prize: YardPrizeView): string | null => {
  if (prize.spurtz === 3) return "Black Diamond Spurtz!";
  if (prize.spurtz) return prize.spurtz > 1 ? "A second Spurtz Cannon!" : "Spurtz Cannon unlocked!";
  if (prize.decoration) return "Creature Carnage trophy!";
  return null;
};

/** The words under a prize's headline. */
export const prizeWords = (prize: YardPrizeView): string => {
  if (prize.spurtz === 3) return "Your Spurtz Cannons are now Black Diamond. Place up to 2 from Build → Defensive.";
  if (prize.spurtz) return `Place up to ${prize.spurtz} from Build → Defensive.`;
  if (prize.decoration) return "It is in your Decorations: Build → Decorations.";
  return "";
};

/** Whether a landing's prizes earn the pop-up at home (Glimmers alone show on the end panel only). */
export const wantsPrizePopup = (landed: EventYardLanded): boolean => landed.prizes.some((prize) => prizeHeadline(prize));

export interface PrizePopupOptions {
  readonly onClose?: () => void;
  /** Opens the build menu on the prize's building. */
  readonly onBuild?: (type: number) => void;
}

/** The prize pop-up at home after an attack that won a building or the trophy. */
export const openYardPrizePopup = (container: HTMLElement, landed: EventYardLanded, options: PrizePopupOptions = {}): Popup => {
  const popup = new Popup({
    title: landed.event === "carnage" ? "Creature Carnage" : "Brukkarg War",
    className: "yard-prize-popup",
    ...(options.onClose ? { onClose: options.onClose } : {}),
  });
  const body = el("div", "yard-prize-popup__body");
  const shown = landed.prizes.filter((prize) => prizeHeadline(prize));
  let build: number | null = null;
  for (const prize of shown) {
    const item = el("div", "yard-prize-popup__item");
    const img = el("img", "yard-prize-popup__art");
    img.src = prize.spurtz ? spurtzPicture(prize.spurtz === 3) : buildPictureUrl(prize.decoration!);
    img.alt = "";
    const words = el("p", "yard-prize-popup__words");
    // "Build → Defensive." stays on one line (neon r3).
    const [before, path] = prizeWords(prize).split(/(?=Build →)/);
    words.append(before ?? "");
    if (path) words.append(el("span", "yard-prize-popup__path", path));
    item.append(img, el("h3", "yard-prize-popup__headline", prizeHeadline(prize)!), words);
    body.append(item);
    if (prize.spurtz) build = prize.spurtz === 3 ? BLACK_SPURTZ_TYPE : SPURTZ_TYPE;
  }
  body.append(el("p", "yard-prize-popup__count", `${landed.beaten} of ${landed.total} yards wrecked`));
  const row = el("div", "yard-prize-popup__buttons");
  if (build !== null && options.onBuild) {
    const type = build;
    const now = el("button", "btn btn--primary yard-prize-popup__button", "Build now");
    now.type = "button";
    now.addEventListener("click", () => {
      popup.close();
      options.onBuild!(type);
    });
    row.append(now);
  }
  const ok = el("button", `btn ${row.childElementCount > 0 ? "" : "btn--primary "}yard-prize-popup__button`, "OK");
  ok.type = "button";
  ok.addEventListener("click", () => popup.close());
  row.append(ok);
  body.append(row);
  popup.setContent(body).mount(container);
  return popup;
};
