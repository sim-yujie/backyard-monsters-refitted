import {
  onSoundSwitches,
  setSoundSwitch,
  setSoundVolume,
  soundSwitches,
  type SoundSwitches,
  type SoundVolume,
} from "@/game/sound/soundSwitches";
import { icon, type IconName } from "@/ui/icons";

/**
 * The Music and Sound effects sliders (owner, 4 Nov 2026: "attacking sound
 * is a lot softer than BGM. Maybe make it a slider"): one row each, a mute
 * button with the row's icon, a 0-100 slider and its number. In the account
 * menu, so it is at hand on every screen, mid-attack too, and in Account
 * settings under Look and sound.
 *
 * The mute button is the old switch (`soundSwitches.ts`), kept as the quick
 * way to silence; the slider keeps its place while muted. Moving a muted
 * row's slider up turns it back on, and unmuting a row left at 0 puts it at
 * {@link UNMUTE_LEVEL}, so the button always makes a sound come back.
 * Everything waits, greyed, until the account's settings are known; a failed
 * save puts the row back and says so on hover.
 */

/** Where an unmuted row at 0 goes, so the press is heard. */
export const UNMUTE_LEVEL = 50;

/** The slider's step: twenty places are plenty, and a phone finger can hit them. */
export const VOLUME_STEP = 5;

export const SOUND_SAVE_FAILED = "Could not save that. Try again.";

interface Row {
  readonly which: "music" | "effects";
  readonly volume: SoundVolume;
  readonly name: string;
  readonly on: IconName;
  readonly off: IconName;
}

const ROWS: readonly Row[] = [
  { which: "music", volume: "musicVolume", name: "Music", on: "note", off: "noteOff" },
  { which: "effects", volume: "effectsVolume", name: "Sound effects", on: "burst", off: "burstOff" },
];

/** The mute button's words for a screen reader and the hover. */
export const muteLabel = (name: string, on: boolean): string => (on ? `${name} on: press to mute` : `${name} muted: press to turn on`);

export class SoundSliders {
  readonly element: HTMLDivElement;
  private readonly stops: (() => void)[] = [];
  /** Whether the rows have been on the page: once taken off, they stop listening. */
  private shown = false;

  constructor(className = "") {
    const element = document.createElement("div");
    element.className = `sound-sliders ${className}`.trim();
    element.setAttribute("role", "group");
    element.setAttribute("aria-label", "Sound");
    this.element = element;
    for (const row of ROWS) element.append(this.row(row));
  }

  destroy(): void {
    for (const stop of this.stops) stop();
    this.element.remove();
  }

  private row(row: Row): HTMLElement {
    const line = document.createElement("div");
    line.className = `sound-sliders__row sound-sliders__row--${row.which}`;

    const mute = document.createElement("button");
    mute.type = "button";
    mute.className = "sound-sliders__mute";

    const slider = document.createElement("input");
    slider.type = "range";
    slider.className = "sound-sliders__slider";
    slider.min = "0";
    slider.max = "100";
    slider.step = String(VOLUME_STEP);
    slider.setAttribute("aria-label", `${row.name} volume`);

    const number = document.createElement("output");
    number.className = "sound-sliders__number";
    number.setAttribute("aria-hidden", "true");

    let failed = false;
    const show = (switches: SoundSwitches | null): void => {
      // A closed dialog drops its rows without a word: they let go here.
      if (this.element.isConnected) this.shown = true;
      else if (this.shown) {
        this.destroy();
        return;
      }
      const known = switches !== null;
      const on = switches?.[row.which] === true;
      const level = switches?.[row.volume] ?? 0;
      const heard = on && level > 0;
      mute.disabled = !known;
      slider.disabled = !known;
      mute.setAttribute("aria-pressed", String(!heard));
      const label = known ? muteLabel(row.name, heard) : row.name;
      mute.setAttribute("aria-label", label);
      mute.title = failed ? SOUND_SAVE_FAILED : label;
      mute.replaceChildren(icon(heard || !known ? row.on : row.off, 20));
      slider.value = String(level);
      slider.setAttribute("aria-valuetext", heard ? `${level}` : `${level}, muted`);
      slider.style.setProperty("--fill", `${level}%`);
      number.textContent = known ? String(level) : "…";
      line.classList.toggle("is-muted", known && !heard);
      line.title = failed ? SOUND_SAVE_FAILED : "";
    };
    show(soundSwitches());
    this.stops.push(onSoundSwitches(show));

    const fail = (): void => {
      failed = true;
      show(soundSwitches());
    };

    mute.addEventListener("click", () => {
      const switches = soundSwitches();
      if (!switches) return;
      failed = false;
      const heard = switches[row.which] && switches[row.volume] > 0;
      if (heard) {
        setSoundSwitch(row.which, false).catch(fail);
        return;
      }
      if (switches[row.volume] <= 0) setSoundVolume(row.volume, UNMUTE_LEVEL).catch(fail);
      if (!switches[row.which]) setSoundSwitch(row.which, true).catch(fail);
    });

    slider.addEventListener("input", () => {
      const switches = soundSwitches();
      if (!switches) return;
      failed = false;
      const level = Number(slider.value);
      setSoundVolume(row.volume, level).catch(fail);
      if (level > 0 && !switches[row.which]) setSoundSwitch(row.which, true).catch(fail);
    });

    line.append(mute, slider, number);
    return line;
  }
}
