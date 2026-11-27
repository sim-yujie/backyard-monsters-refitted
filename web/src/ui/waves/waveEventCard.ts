import type { WaveStatus } from "@/api/waves";
import { waveFeed, type WaveFeedState } from "@/game/waves/waveFeed";
import { startWaveWords } from "@/game/waves/waveText";
import { callNextWave } from "@/game/yard/plugins/waves";
import { coinAmount, coinWords } from "@/ui/events/coinUi";
import { EVENT_EXTRAS } from "@/ui/events/EventsPanel";
import { el } from "@/ui/dom";
import { gameIcon } from "@/ui/gameIcon";
import "@/ui/styles/waves.css";
import { totemImage } from "./waveArt";
import { waveTrack } from "./WaveScreens";

/**
 * The wave event's part of its Events card (kind `wave`, beta 10). There is
 * no wave bar on the yard (owner, 27 Nov 2026: "just have it under the
 * events tab and have them manually start each wave"), so this is where
 * every wave starts. neon's direction A (wave-shots/ux3/neon-design.md):
 * the totem track, then one row with the prize (Glimmers, and the totem's
 * next level on a totem wave) and "Start wave N"; no monster portraits or
 * counts. Drawn from the yard's wave feed (`game/waves/waveFeed.ts`); the
 * Events button redraws the page when the feed changes.
 */

/** The card's body for the feed's state; `onStart` calls the wave. */
export const waveCardBody = (feed: WaveFeedState & { status: WaveStatus }, onStart: () => void): HTMLElement => {
  const { status, busy, blocked } = feed;
  const body = el("div", "wave-card");
  body.append(waveTrack(status.beaten, status.waves, status.totemType, status.firstBonusWave));
  if (status.next === null) {
    const done = el("p", "wave-card__done");
    if (status.totemType !== null) done.append(totemImage(status.totemType, status.totemLevel, "wave-card__done-totem"));
    done.append(el("span", "", `All ${status.waves} waves won`));
    body.append(done);
    return body;
  }
  const row = el("div", "wave-card__go");
  const prize = el("div", "wave-card__prize");
  prize.title = "Prize for winning it";
  if (status.prize && status.prize.glimmers > 0) {
    const coins = coinAmount(`+${status.prize.glimmers}`, { size: 24 });
    coins.classList.add("wave-card__chip");
    coins.setAttribute("aria-label", coinWords(status.prize.glimmers));
    prize.append(coins);
  }
  if (status.prize?.totemLevel && status.totemType !== null) {
    const totem = el("span", "wave-card__chip wave-card__chip--totem");
    totem.setAttribute("aria-label", `Victory Totem level ${status.prize.totemLevel}`);
    totem.append(totemImage(status.totemType, status.prize.totemLevel, "wave-card__chip-totem"), el("span", "", `Lv ${status.prize.totemLevel}`));
    prize.append(totem);
  }
  const words = startWaveWords(status.next, status.firstBonusWave);
  const start = el("button", "btn btn--primary wave-card__start");
  start.type = "button";
  start.disabled = busy || blocked;
  if (busy) {
    start.classList.add("wave-card__start--busy");
    start.append(el("span", "wave-card__spinner"), " Starting…");
  } else {
    start.append(gameIcon("swords", { size: 24, decorative: true, className: "wave-start-icon" }), ` ${words}`);
  }
  start.setAttribute("aria-label", busy ? `${words}: starting` : words);
  if (blocked) start.title = "Finish the wild raid on your yard first";
  start.addEventListener("click", () => {
    if (start.disabled) return;
    start.disabled = true;
    onStart();
  });
  row.append(prize, start);
  body.append(row);
  return body;
};

/** Registers the card's part, drawn from the feed (empty until the yard has read the event). */
export const registerWaveCard = (feed: () => WaveFeedState = waveFeed, start: () => void = callNextWave): void => {
  EVENT_EXTRAS.set("wave", (event) => {
    const slot = el("div", "wave-card-slot");
    const now = feed();
    if (now.status && now.status.run === event.id) slot.append(waveCardBody({ ...now, status: now.status }, start));
    return slot;
  });
};

registerWaveCard();
