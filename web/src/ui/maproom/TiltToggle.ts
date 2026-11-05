import { gameIcon } from "@/ui/gameIcon";
import { button } from "@/ui/maproom1/icons";

/**
 * The map's "Tilted map" button beside the zoom buttons (MR2 look plan step 4,
 * owner 3 Nov 2026: the tilt is on by default in Modern, opt-out). Pressed
 * while the map is tilted; a press switches the map flat or back, and the
 * scene stores the choice on the account.
 *
 * Hidden when the map cannot tilt at all: in Classic, which is always flat,
 * and while the server's MR2_TILT switch is off.
 *
 * A view only: the scene decides whether the map is tilted and calls `set`.
 */

export const TILT_TOGGLE_TEXT = {
  tilted: "Tilted map: on. Press for a flat map.",
  flat: "Tilted map: off. Press to tilt the map.",
} as const;

/**
 * The painted icon (owner: icons are painted, not line drawings): the map's
 * ground seen at an angle while tilted, from straight above while flat. The
 * button's own label says what it does, so the picture is decorative.
 */
const ICON_SIZE = 32;

const drawIcon = (tilted: boolean): HTMLImageElement =>
  gameIcon(tilted ? "maptilt" : "mapflat", { size: ICON_SIZE, decorative: true });

export class TiltToggle {
  readonly element: HTMLButtonElement;
  private tilted = false;

  constructor(onToggle: (tilted: boolean) => void) {
    this.element = button("mr2-tool mr2-tilt-toggle");
    this.element.hidden = true;
    this.element.addEventListener("click", () => onToggle(!this.tilted));
    this.render();
  }

  get isTilted(): boolean {
    return this.tilted;
  }

  /** Shows the map's state: whether the button is there at all, and whether it is pressed. */
  set(state: { available: boolean; tilted: boolean }): void {
    this.element.hidden = !state.available;
    if (state.tilted === this.tilted && this.element.childElementCount > 0) return;
    this.tilted = state.tilted;
    this.render();
  }

  private render(): void {
    const text = this.tilted ? TILT_TOGGLE_TEXT.tilted : TILT_TOGGLE_TEXT.flat;
    this.element.setAttribute("aria-pressed", String(this.tilted));
    this.element.setAttribute("aria-label", text);
    this.element.title = text;
    this.element.replaceChildren(drawIcon(this.tilted));
  }
}
