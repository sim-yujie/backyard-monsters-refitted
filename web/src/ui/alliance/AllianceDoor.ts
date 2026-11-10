import type { AllianceApi } from "@/api/alliance";
import { setAllianceOpener, type AllianceTab } from "@/game/alliance/allianceView";
import { gameIconUrl } from "@/ui/gameIcon";
import { make } from "@/ui/friends/rows";
import { AllianceWindow } from "./AllianceWindow";

/**
 * The own yard's way into alliances (beta 7 phase 1): the Alliance button in
 * the More menu's fan (`data-dock="alliance"`, the painted alliance icon) and
 * the window behind it, made fresh on each open so it always shows the
 * server's latest. The scene shows the button on Map Room 2 only (the join
 * gate's first half; the Observatory is the second, which the window explains).
 *
 * While the door stands it is the alliance opener (`allianceView.ts`), so the
 * Observatory's panel and an accepted mail invite open the same window.
 */

export interface AllianceDoorOptions {
  /** Where the window shows: the overlay's modal layer. */
  readonly container: HTMLElement;
  /** Before the window opens: the scene closes what else docks there. */
  readonly onOpen?: () => void;
  readonly onBuildObservatory?: () => void;
  readonly onOpenMap?: () => void;
  /** The player joined, founded, left or lost an alliance. */
  readonly onChanged?: () => void;
  /** The routes, for a test. */
  readonly api?: AllianceApi;
}

export const ALLIANCE_DOOR_TEXT = {
  label: "Alliance",
  title: "Alliance: join or found one, and lead it",
} as const;

export class AllianceDoor {
  readonly button: HTMLButtonElement;

  private readonly options: AllianceDoorOptions;
  private window: AllianceWindow | null = null;
  private readonly clearOpener: () => void;

  constructor(options: AllianceDoorOptions) {
    this.options = options;
    this.button = make("button", "yard-dock__button yard-dock__button--alliance");
    this.button.type = "button";
    this.button.dataset["dock"] = "alliance";
    this.button.setAttribute("aria-label", ALLIANCE_DOOR_TEXT.label);
    this.button.setAttribute("aria-haspopup", "dialog");
    this.button.title = ALLIANCE_DOOR_TEXT.title;
    const disc = make("span", "yard-dock__disc");
    const picture = make("img", "yard-dock__picture");
    picture.src = gameIconUrl("alliance", 64);
    picture.alt = "";
    picture.decoding = "async";
    picture.draggable = false;
    disc.append(picture);
    this.button.append(disc, make("span", "yard-dock__label", ALLIANCE_DOOR_TEXT.label));
    this.button.addEventListener("click", () => this.toggle());
    this.button.hidden = true;
    this.clearOpener = setAllianceOpener((tab) => this.open(tab));
  }

  get isOpen(): boolean {
    return this.window !== null;
  }

  /** Whether the button shows: a Map Room 2 main yard. The window can still open from the Observatory. */
  setAvailable(available: boolean): void {
    this.button.hidden = !available;
  }

  toggle(): void {
    if (this.window) this.close();
    else this.open();
  }

  open(tab?: AllianceTab): void {
    if (this.window) {
      if (tab) this.window.showTab(tab);
      return;
    }
    this.options.onOpen?.();
    const { onBuildObservatory, onOpenMap, onChanged, api } = this.options;
    this.window = new AllianceWindow({
      ...(api ? { api } : {}),
      ...(tab ? { tab } : {}),
      ...(onBuildObservatory ? { onBuildObservatory } : {}),
      ...(onOpenMap ? { onOpenMap } : {}),
      ...(onChanged ? { onChanged } : {}),
      onClose: () => {
        this.window = null;
        this.button.setAttribute("aria-expanded", "false");
      },
    }).mount(this.options.container);
    this.button.setAttribute("aria-expanded", "true");
  }

  close(): void {
    this.window?.close();
  }

  destroy(): void {
    this.close();
    this.clearOpener();
    this.button.remove();
  }
}
