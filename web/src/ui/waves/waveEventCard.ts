import { waveApi, waveName, type WaveApi, type WaveStatus } from "@/api/waves";
import { callNextWave } from "@/game/yard/plugins/waves";
import { coinAmount, coinWords } from "@/ui/events/coinUi";
import { EVENT_EXTRAS } from "@/ui/events/EventsPanel";
import { el } from "@/ui/dom";
import { gameIcon } from "@/ui/gameIcon";
import "@/ui/styles/waves.css";
import { totemImage, waveMonsterImage, waveMonsterName } from "./waveArt";
import { waveTrack } from "./WaveScreens";

/**
 * The wave event's part of its Events card (kind `wave`, beta 10): the
 * waves beaten on the totem track, the next wave's monsters and prize, and
 * "Start wave N", the same as the yard's wave bar. Filled from
 * `GET /bm/events/wave` once the card is drawn.
 */

/** The card's body for a status; `onStart` calls the wave. */
export const waveCardBody = (status: WaveStatus, onStart: () => void): HTMLElement => {
  const body = el("div", "wave-card");
  body.append(waveTrack(status.beaten, status.waves, status.totemType, status.firstBonusWave));
  if (status.next === null) {
    body.append(el("p", "wave-card__next-title", `All ${status.waves} waves beaten!`));
    return body;
  }
  const next = el("div", "wave-card__next");
  const bonus = status.next >= status.firstBonusWave;
  next.append(el("p", "wave-card__next-title", `Next: ${waveName(status.next, status.firstBonusWave)}`));
  const monsters = el("ul", "wave-hud__monsters");
  if (bonus) {
    const secret = el("li", "wave-hud__monster");
    secret.append(el("span", "wave-hud__secret", "?"), el("span", "wave-hud__count", "Secret"));
    monsters.append(secret);
  } else {
    for (const group of status.preview.slice(0, 6)) {
      const item = el("li", "wave-hud__monster");
      item.title = `${group.count} ${waveMonsterName(group.monster)}`;
      item.append(waveMonsterImage(group.monster, "wave-hud__portrait"), el("span", "wave-hud__count", `×${group.count}`));
      monsters.append(item);
    }
  }
  const prize = el("div", "wave-hud__prize");
  prize.title = "Prize for beating it";
  if (status.prize && status.prize.glimmers > 0) {
    const coins = coinAmount(`+${status.prize.glimmers}`, { size: 24 });
    coins.setAttribute("aria-label", coinWords(status.prize.glimmers));
    prize.append(coins);
  }
  if (status.prize?.totemLevel && status.totemType) {
    prize.append(totemImage(status.totemType, status.prize.totemLevel, "wave-hud__prize-totem-art"));
  }
  const start = el("button", "btn btn--primary wave-card__start");
  start.type = "button";
  start.append(gameIcon("swords", { size: 24, decorative: true, className: "wave-hud__start-icon" }), ` ${bonus ? "Start bonus" : `Start wave ${status.next}`}`);
  start.addEventListener("click", () => {
    start.disabled = true;
    onStart();
  });
  next.append(monsters, prize, start);
  body.append(next);
  return body;
};

/** Registers the card's part: drawn empty, filled when the status comes. */
export const registerWaveCard = (api: Pick<WaveApi, "status"> = waveApi, start: () => void = callNextWave): void => {
  EVENT_EXTRAS.set("wave", (event) => {
    const slot = el("div", "wave-card-slot");
    void api
      .status()
      .then((answer) => {
        if (answer.wave && answer.wave.run === event.id) slot.replaceChildren(waveCardBody(answer.wave, start));
      })
      .catch(() => undefined);
    return slot;
  });
};

registerWaveCard();
