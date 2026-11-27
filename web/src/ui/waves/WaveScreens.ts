import type { RaidResult } from "@/api/raid";
import { waveName, type WaveResult, type WaveStatus } from "@/api/waves";
import { classicLook } from "@/game/classicLook";
import { totemName, WAVE_LOST_LINE, WAVE_SURRENDERED_LINE } from "@/game/waves/waveText";
import { coinAmount, coinWords } from "@/ui/events/coinUi";
import { el } from "@/ui/dom";
import { gameIcon } from "@/ui/gameIcon";
import { Popup } from "@/ui/Popup";
import "@/ui/styles/waves.css";
import { totemImage } from "./waveArt";

/**
 * The wave events' pop-ups (beta 10; neon's direction A): the wave's result,
 * won or lost, with "Next wave" or "Retry" at once and "Later"; the totem's
 * own moment when a wave raised it; and the surrender check.
 */

/** Waves at which the totem goes up (Flash's `isMajorWave`), for the progress track. */
export const TOTEM_WAVES: readonly number[] = [1, 10, 20, 30, 31, 32];

/**
 * The progress track: waves beaten of all of them, with the totem's six
 * marks. Shared by the result pop-up and the Events card.
 */
export const waveTrack = (beaten: number, waves: number, totemType: number | null, firstBonusWave = waves - 1): HTMLElement => {
  const track = el("div", "wave-track");
  track.setAttribute("role", "img");
  track.setAttribute("aria-label", `${beaten} of ${waves} waves beaten`);
  const bar = el("div", "wave-track__bar");
  const fill = el("div", "wave-track__fill");
  // The main waves fill 84% of the bar and each bonus wave its own step, so
  // the marks at 30, 31 and 32 stand apart.
  const main = Math.max(1, firstBonusWave - 1);
  const bonusStep = waves > main ? 16 / (waves - main) : 0;
  const at = (wave: number): number => (waves > main ? (Math.min(wave, main) / main) * 84 + Math.max(0, wave - main) * bonusStep : (wave / main) * 100);
  fill.style.width = `${Math.min(100, at(beaten))}%`;
  bar.append(fill);
  for (const [index, wave] of TOTEM_WAVES.filter((one) => one <= waves).entries()) {
    const mark = el("span", `wave-track__mark${beaten >= wave ? " wave-track__mark--won" : ""}${wave > waves - 2 ? " wave-track__mark--bonus" : ""}`);
    mark.style.left = `${at(wave)}%`;
    mark.title = `Wave ${wave}: totem level ${index + 1}`;
    if (totemType !== null) mark.append(totemImage(totemType, index + 1, "wave-track__totem"));
    mark.append(el("span", "wave-track__wave", wave > main ? `B${wave - main}` : String(wave)));
    bar.append(mark);
  }
  // The same count as the yard's bar: "7/30", then "Bonus 1/2".
  const count = beaten <= main ? `${beaten}/${main} won` : `Bonus ${beaten - main}/${waves - main}`;
  track.append(bar, el("span", "wave-track__count", count));
  return track;
};

export interface WaveResultActions {
  /** Calls the next wave (or retries this one) at once; null hides the button. */
  readonly onNext: (() => void) | null;
}

/** The wave's own result (`RaidResult.wave`); `onClose` runs whichever way it is closed. */
export const waveResultPopup = (result: RaidResult, actions: WaveResultActions, onClose: () => void): Popup => {
  const wave = result.wave as WaveResult;
  const name = waveName(wave.wave, wave.firstBonusWave);
  const won = wave.beaten;
  const popup = new Popup({
    title: won ? `${name} beaten!` : `${name} lost`,
    className: `wave-result wave-result--${won ? "won" : "lost"}`,
    onClose,
  });
  const parts: HTMLElement[] = [];
  if (won) {
    if (wave.glimmers > 0) {
      const reward = el("p", "wave-result__reward");
      const coins = coinAmount(wave.glimmers, { change: "gain", size: 32 });
      coins.setAttribute("aria-label", `${coinWords(wave.glimmers)} gained`);
      reward.append(coins);
      parts.push(reward);
    }
    parts.push(waveTrack(wave.next === null ? wave.waves : wave.next - 1, wave.waves, wave.totemType ?? wave.totem?.type ?? null, wave.firstBonusWave));
    if (result.damaged.length > 0) parts.push(el("p", "wave-result__note", "Damaged buildings are repairing."));
  } else {
    parts.push(el("p", "wave-result__lead", wave.surrendered ? WAVE_SURRENDERED_LINE : WAVE_LOST_LINE));
    if (!wave.surrendered) {
      parts.push(el("p", "wave-result__note", `Yard left: ${Math.round(result.health * 100)}% (need more than 10%, and every monster beaten).`));
    }
  }
  const actionsRow = el("div", "wave-result__actions");
  const later = el("button", "btn wave-result__later", "Later");
  later.type = "button";
  later.addEventListener("click", () => popup.close());
  actionsRow.append(later);
  if (actions.onNext && (won ? wave.next !== null : true)) {
    const next = el("button", "btn btn--primary wave-result__next");
    next.type = "button";
    const target = won ? wave.next! : wave.wave;
    next.append(gameIcon("swords", { size: 24, decorative: true, className: "wave-hud__start-icon" }), ` ${won ? `Start ${waveName(target, wave.firstBonusWave).toLowerCase()}` : "Retry"}`);
    next.addEventListener("click", () => {
      popup.close();
      actions.onNext?.();
    });
    actionsRow.append(next);
  }
  parts.push(actionsRow);
  popup.setContent(...parts);
  return popup;
};

/** The totem's moment: its new picture and where it is. */
export const totemPopup = (totem: NonNullable<WaveResult["totem"]>, onClose: () => void): Popup => {
  const popup = new Popup({ title: totem.level === 1 ? "Totem won!" : "Totem upgraded!", className: "wave-totem", onClose });
  const stage = el("div", "wave-totem__stage");
  stage.append(totemImage(totem.type, totem.level, "wave-totem__art"));
  const ok = el("button", "btn btn--primary wave-totem__ok", "OK");
  ok.type = "button";
  ok.addEventListener("click", () => popup.close());
  popup.setContent(
    stage,
    el("p", "wave-totem__name", totemName(totem.level)),
    el("p", "wave-totem__where", totem.placed ? "Upgraded on your yard." : "Stored in Build ▸ Decorations."),
    ok,
  );
  return popup;
};

/** The surrender check: resolves true to surrender, false to fight on. */
export const confirmSurrender = (host: HTMLElement, wave: string): Promise<boolean> =>
  new Promise((resolve) => {
    let answered = false;
    const popup = new Popup({
      title: "Surrender?",
      className: "wave-surrender",
      onClose: () => {
        if (!answered) resolve(false);
      },
    });
    const keep = el("button", "btn wave-surrender__keep", "Keep fighting");
    keep.type = "button";
    keep.addEventListener("click", () => popup.close());
    const give = el("button", "btn btn--danger wave-surrender__give", "Surrender");
    give.type = "button";
    give.addEventListener("click", () => {
      answered = true;
      resolve(true);
      popup.close();
    });
    const row = el("div", "wave-result__actions");
    row.append(keep, give);
    popup.setContent(el("p", "wave-result__lead", `${wave} counts as lost. The monsters leave and your yard repairs.`), row);
    popup.mount(host);
  });

/** The result, then the totem when it went up; resolves once both are closed. */
export const showWaveResult = async (host: HTMLElement, result: RaidResult, actions: WaveResultActions): Promise<void> => {
  let next = false;
  await new Promise<void>((resolve) => {
    waveResultPopup(result, { onNext: actions.onNext ? () => (next = true) : null }, resolve).mount(host);
  });
  const totem = result.wave?.totem;
  if (totem && result.wave?.beaten) {
    await new Promise<void>((resolve) => totemPopup(totem, resolve).mount(host));
  }
  if (next) actions.onNext?.();
};

/**
 * The event's arrival on the yard, once per run on this device (the in-game
 * announcement hook): its banner in the player's look, its sentence, the
 * first prize, and "Start wave 1" or "Later".
 */
export const waveIntroPopup = (status: WaveStatus, onStart: () => void, onClose: () => void): Popup => {
  const popup = new Popup({ title: status.title, className: "wave-intro", onClose });
  const band = el("div", "wave-intro__banner");
  const picture = el("img", "wave-intro__banner-image");
  picture.alt = "";
  picture.src = classicLook() ? status.banner.classic : status.banner.modern;
  picture.addEventListener("error", () => band.remove(), { once: true });
  band.append(picture);
  const parts: HTMLElement[] = [band];
  if (status.text) parts.push(el("p", "wave-intro__text", status.text));
  parts.push(el("p", "wave-result__note", "No loot lost · Auto-repairs · Glimmers every wave"));
  if (status.totemType !== null) parts.push(waveTrack(status.beaten, status.waves, status.totemType, status.firstBonusWave));
  const row = el("div", "wave-result__actions");
  const later = el("button", "btn wave-result__later", "Later");
  later.type = "button";
  later.addEventListener("click", () => popup.close());
  row.append(later);
  if (status.next !== null) {
    const start = el("button", "btn btn--primary wave-result__next");
    start.type = "button";
    start.append(gameIcon("swords", { size: 24, decorative: true, className: "wave-hud__start-icon" }), ` Start ${waveName(status.next, status.firstBonusWave).toLowerCase()}`);
    start.addEventListener("click", () => {
      popup.close();
      onStart();
    });
    row.append(start);
  }
  parts.push(row);
  popup.setContent(...parts);
  return popup;
};
