import { icon } from "@/ui/maproom1/icons";

/**
 * The attack's overview map and zoom, folded on a phone (#381): the two sat
 * on a corner of the battlefield the whole fight. There they hide behind one
 * small map button, which opens them and closes them again; pinching still
 * zooms while they are away. The stylesheet shows the button, and does the
 * hiding, only in the phone layout, so a wider screen keeps both in view.
 */
export class ViewToolsFold {
  readonly button: HTMLButtonElement;

  constructor(
    private readonly tools: HTMLElement,
    private readonly onToggle: (open: boolean) => void = () => {},
  ) {
    this.button = document.createElement("button");
    this.button.type = "button";
    this.button.className = "btn attack-viewtools__fold";
    this.button.append(icon("map", 22, "map-icon"));
    this.button.setAttribute("aria-label", "Overview map and zoom");
    this.button.title = "Overview map and zoom";
    this.button.setAttribute("aria-expanded", "false");
    this.button.addEventListener("click", () => this.set(!this.open));
    tools.prepend(this.button);
  }

  get open(): boolean {
    return this.tools.classList.contains("attack-viewtools--open");
  }

  set(open: boolean): void {
    this.tools.classList.toggle("attack-viewtools--open", open);
    this.button.setAttribute("aria-expanded", String(open));
    this.onToggle(open);
  }
}
