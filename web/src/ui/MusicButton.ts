import { onSoundSwitches, setSoundSwitch, soundSwitches, type SoundSwitches } from "@/game/sound/soundSwitches";
import { icon } from "@/ui/icons";

/**
 * The yard's speaker button (beta.5): music on or off with one press, the
 * quick way to the account menu's Music switch, as Flash's top bar had one
 * (`client/scripts/buttonMusic.as`). It shows a speaker while music is on
 * and a crossed-out one while it is off, and waits, greyed, until the
 * account's switches are known.
 */

export const musicButtonLabel = (on: boolean): string => (on ? "Music on: press to turn it off" : "Music off: press to turn it on");

export class MusicButton {
  readonly element: HTMLButtonElement;
  private readonly stop: () => void;

  constructor(className: string) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = className;
    this.element = button;

    const show = (switches: SoundSwitches | null): void => {
      const on = switches?.music === true;
      button.disabled = switches === null;
      button.dataset["music"] = switches === null ? "unknown" : on ? "on" : "off";
      const label = switches === null ? "Music" : musicButtonLabel(on);
      button.title = label;
      button.setAttribute("aria-label", label);
      button.replaceChildren(icon(on || switches === null ? "speaker" : "speakerOff", 20));
    };
    show(soundSwitches());
    this.stop = onSoundSwitches(show);

    button.addEventListener("click", () => {
      const switches = soundSwitches();
      if (!switches) return;
      // A failed save puts the switch back, which redraws the button.
      setSoundSwitch("music", !switches.music).catch(() => {});
    });
  }

  mount(parent: HTMLElement): this {
    parent.append(this.element);
    return this;
  }

  destroy(): void {
    this.stop();
    this.element.remove();
  }
}
