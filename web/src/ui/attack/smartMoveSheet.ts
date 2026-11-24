import type { SmartMoveResponse } from "@/api/smartMove";
import { classicLook } from "@/game/classicLook";
import { gameIcon } from "@/ui/gameIcon";
import { Popup } from "@/ui/Popup";
import { scrollHint } from "./AttackWindow";
import { campHead, moveCards, roomParts, shortageList, watchMoreRows } from "./repeatPrompt";
import "@/ui/styles/smart-move.css";

/**
 * Smart moving for hand attacks (beta 9, owner's grilling of 24 Nov 2026):
 * the sheet that shows before the Attack window when the yards in range lack
 * the camp's saved Repeat army and the player's other yards hold it.
 *
 * neon's direction A (24 Nov 2026): a compact window the size of the Attack
 * window, so it never reads as Repeat attack's big sheet. The title asks the
 * question; the head is the camp (Repeat attack's camp head); the body is
 * Repeat attack's move cards, scrolling with their "more below" cue; the
 * buttons stay in sight under it:
 *
 * - Skip: the normal Attack window, nothing moves;
 * - Move & attack: the moves and the attack start in one request (the
 *   caller's `onMove`), straight into the battle;
 * - the close disc, Escape or the scrim: back to the map, nothing moves.
 *
 * While "Move & attack" runs nothing closes the sheet; should it fail, the
 * reason shows above the buttons and the player can try again, skip or close.
 *
 * When the army cannot be gathered, {@link smartMoveNote} is what the
 * Attack window shows at its top instead (neon: no extra sheet, no extra tap).
 */

export const SMART_MOVE_TEXT = {
  title: "Bring saved army?",
  skip: "Skip",
  move: "Move & attack",
  moving: "Moving…",
  /** The note's heading when some monsters are short even counting every yard. */
  short: "Saved army: short",
  /** The note's heading when the yards in range have no room for it. */
  room: "No room in range",
  /** The head's count of moves. */
  moves: (count: number): string => (count === 1 ? "1 move" : `${count} moves`),
  /** The room the monsters that would move in need. */
  needed: (space: number): string => `${space.toLocaleString("en-US")} needed`,
} as const;

/** How the sheet ended: Skip, closed (the map), or moved (the caller has gone on into the battle). */
export type SmartMoveChoice = "skip" | "close" | "moved";

export interface SmartMoveSheetOptions {
  /** Where the sheet goes: the overlay's modal layer. */
  readonly container: HTMLElement;
  /** The offer, verdict `moves`. */
  readonly offer: SmartMoveResponse;
  /**
   * "Move & attack": makes the moves and starts the attack, then goes on into
   * the battle. Resolves once it has gone on; rejects with what to say, the
   * sheet staying open (or {@link SmartMoveSheet.update} with a new offer).
   */
  readonly onMove: (movesKey: string) => Promise<void>;
}

const el = <K extends keyof HTMLElementTagNameMap>(tag: K, className: string, text?: string): HTMLElementTagNameMap[K] => {
  const node = document.createElement(tag);
  node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
};

/** A popup that will not close while "Move & attack" runs. */
class HeldPopup extends Popup {
  held = false;

  override close(): void {
    if (this.held) return;
    super.close();
  }
}

/** The open sheet: what it shows can change (yards changed) and it says why a move failed. */
export class SmartMoveSheet {
  readonly done: Promise<SmartMoveChoice>;
  private readonly popup: HeldPopup;
  private readonly options: SmartMoveSheetOptions;
  private readonly error: HTMLElement;
  private readonly skip: HTMLButtonElement;
  private readonly go: HTMLButtonElement;
  private offer: SmartMoveResponse;
  private stops: (() => void)[] = [];
  private choice: SmartMoveChoice = "close";
  private resolve: (choice: SmartMoveChoice) => void = () => {};

  constructor(options: SmartMoveSheetOptions) {
    this.options = options;
    this.offer = options.offer;
    this.done = new Promise((resolve) => (this.resolve = resolve));
    this.popup = new HeldPopup({
      title: SMART_MOVE_TEXT.title,
      className: "attack-window smart-move",
      onClose: () => {
        for (const stop of this.stops) stop();
        this.stops = [];
        this.resolve(this.choice);
      },
    });

    this.error = el("p", "smart-move__error");
    this.error.setAttribute("role", "alert");
    this.error.hidden = true;

    this.skip = el("button", "btn btn--outline smart-move__skip", SMART_MOVE_TEXT.skip);
    this.skip.type = "button";
    this.skip.addEventListener("click", () => this.finish("skip"));
    this.go = el("button", "btn btn--primary smart-move__go", SMART_MOVE_TEXT.move);
    this.go.type = "button";
    this.go.dataset["smartMove"] = "";
    this.go.addEventListener("click", () => void this.move());

    const actions = el("div", "attack-window__actions smart-move__actions");
    actions.append(this.skip, this.go);
    this.render();
    // Under the body, not in it: the buttons stay in sight when the moves scroll.
    this.popup.element.append(this.error, actions);
    this.popup.mount(options.container);
    this.watch();
    this.go.focus();
  }

  /** The sheet's window, for the tests. */
  get element(): HTMLElement {
    return this.popup.element;
  }

  /** Shows a new offer (the yards changed since the first), with a line saying so. */
  update(offer: SmartMoveResponse, message: string): void {
    this.offer = offer;
    this.render();
    this.watch();
    this.say(message);
  }

  /** Says why "Move & attack" did not go, the buttons free again. */
  say(message: string): void {
    this.error.textContent = message;
    this.error.hidden = message === "";
  }

  /** Closes the sheet: the map, nothing moved. */
  close(): void {
    this.popup.held = false;
    this.popup.close();
  }

  /**
   * The camp, with how many moves beside its level and damage (neon, round
   * 1: no heading row of its own, so a phone on its side shows more cards),
   * then the cards.
   */
  private render(): void {
    const camp = this.offer.camp ?? { tribe: "Wild monster", level: 0, damage: 0 };
    const count = el("span", "smart-move__count");
    const words = SMART_MOVE_TEXT.moves(this.offer.moves.length);
    count.title = `${words} first`;
    count.append(
      gameIcon(classicLook() ? "outpostclassic" : "outpost", { size: 24, decorative: true }),
      el("span", "", words),
    );
    // Beside the level and the damage, so it wraps with them on a narrow phone (neon, round 2).
    const head = campHead(camp, camp.damage);
    (head.querySelector(".repeat-prompt__camp-facts") ?? head).append(count);
    this.popup.setHead(head);
    this.popup.setContent(moveCards(this.offer.moves, this.offer.yards));
  }

  private watch(): void {
    for (const stop of this.stops) stop();
    this.stops = [scrollHint(this.popup.body)];
    const list = this.popup.body.querySelector<HTMLElement>(".repeat-prompt__moves");
    if (list) this.stops.push(watchMoreRows(list));
  }

  private finish(choice: SmartMoveChoice): void {
    this.choice = choice;
    this.close();
  }

  private async move(): Promise<void> {
    const key = this.offer.movesKey;
    if (!key || this.popup.held) return;
    this.say("");
    this.popup.held = true;
    this.popup.element.classList.add("smart-move--busy");
    this.skip.disabled = true;
    this.go.disabled = true;
    this.go.textContent = SMART_MOVE_TEXT.moving;
    try {
      await this.options.onMove(key);
      this.popup.held = false;
      this.finish("moved");
    } catch (caught) {
      this.popup.held = false;
      this.popup.element.classList.remove("smart-move--busy");
      this.skip.disabled = false;
      this.go.disabled = false;
      this.go.textContent = SMART_MOVE_TEXT.move;
      if (caught instanceof SmartMoveClosed) {
        this.close();
        return;
      }
      if (!(caught instanceof SmartMoveChanged)) this.say(caught instanceof Error ? caught.message : String(caught));
    }
  }
}

/** Thrown by `onMove` when the sheet should just close (a "New version" card shows instead). */
export class SmartMoveClosed extends Error {}

/** Thrown by `onMove` after it has shown a new offer with {@link SmartMoveSheet.update}. */
export class SmartMoveChanged extends Error {}

/**
 * The note at the top of the Attack window when the saved army cannot be
 * gathered (neon, 24 Nov 2026: inside the window, no extra tap): what is short
 * even counting every yard (a portrait and "12 short" each), or the room the
 * monsters that would move in need and what each yard in range has free.
 * Null for any other offer.
 */
export const smartMoveNote = (offer: SmartMoveResponse | null): HTMLElement | null => {
  if (!offer) return null;
  const short = offer.verdict === "short" && offer.missing.length > 0;
  const room = offer.verdict === "housing" && offer.noRoom !== null;
  if (!short && !room) return null;
  const note = el("section", `smart-move-note smart-move-note--${short ? "short" : "room"}`);
  const words = short ? SMART_MOVE_TEXT.short : SMART_MOVE_TEXT.room;
  note.setAttribute("aria-label", words);
  const heading = el("h3", "smart-move-note__heading");
  heading.append(
    gameIcon(classicLook() ? "outpostclassic" : "outpost", { size: 24, decorative: true }),
    el("span", "smart-move-note__words", words),
  );
  if (short) {
    // Under "Saved army: short" each row says only how many: "−12" (neon, round 2).
    const list = shortageList(offer.missing);
    list.querySelectorAll<HTMLElement>(".repeat-prompt__short--monster .repeat-prompt__short-words").forEach((words, index) => {
      const item = offer.missing.filter((one) => one.kind === "monster")[index];
      if (item?.kind === "monster") words.textContent = `−${(item.need - item.have).toLocaleString("en-US")}`;
    });
    note.append(heading, list);
    return note;
  }
  // neon, round 1: the room needed on the heading's line, then a line per yard in range.
  const noRoom = offer.noRoom!;
  const need = el("span", "smart-move-note__need");
  need.title = `Incoming monsters need ${noRoom.need.toLocaleString("en-US")} housing space`;
  need.append(gameIcon("housing", { size: 24, decorative: true }), el("span", "", SMART_MOVE_TEXT.needed(noRoom.need)));
  heading.append(need);
  const [, list] = roomParts(noRoom, offer.yards);
  note.append(heading, ...(list ? [list] : []));
  return note;
};
