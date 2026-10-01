import {
  centreOn,
  clampScroll,
  layoutPlayers,
  MAP_SIZE,
  tribeSpot,
  type PinSpot,
} from "@/game/maproom1/mr1Layout";
import {
  isPlayingNow,
  isProtected,
  pinTone,
  respawnIn,
  type Mr1Own,
  type Mr1Target,
  type Mr1World,
} from "@/game/maproom1/mr1Model";
import { tribeInfo } from "@/game/maproom1/tribes";
import { avatar, countdown } from "./TargetCard";
import { tutTarget, TutTarget } from "@/game/guide/targets";
import { button, el, icon } from "./icons";

/**
 * The Map view: the painted Map Room 1 map, dragged with the pointer inside
 * its window, with a small overview map in the corner that can be dragged
 * too (`com/monsters/maproom/views/MapView.as`, `MiniMap.as`). No zoom, as in
 * Flash. Pins are plain buttons over the picture, so they are reachable by
 * keyboard and read out by name.
 */

/** The painted map, served by the game server. */
export const MAP_ART = "/assets/ui/map.v1.jpg";

/** Pointer travel before a press on the map becomes a drag. */
const DRAG_THRESHOLD = 5;
/** Arrow-key pan step. */
const KEY_STEP = 80;

export interface MapViewHandlers {
  readonly onSelect: (key: string | null) => void;
}

interface PlacedPin {
  readonly key: string;
  readonly spot: PinSpot;
  readonly element: HTMLElement;
  readonly button: HTMLButtonElement;
  readonly dot: HTMLElement;
}

/**
 * Where the guided start's practice camp is drawn (issue #227): to the right
 * of your own pin and a little below, inside the map; the middle of the map
 * before your pin is placed.
 */
export const practiceSpot = (own: PinSpot | null): PinSpot => {
  const base = own ?? { x: MAP_SIZE / 2, y: MAP_SIZE / 2 };
  const margin = 90;
  const x = base.x + 170 > MAP_SIZE - margin ? base.x - 170 : base.x + 170;
  return { x, y: Math.min(MAP_SIZE - margin, base.y + 60) };
};

export class Mr1MapView {
  readonly element: HTMLElement;

  private readonly viewport: HTMLElement;
  private readonly world: HTMLElement;
  private readonly pinLayer: HTMLElement;
  private readonly mini: HTMLElement;
  private readonly miniFrame: HTMLElement;
  private readonly miniDots: HTMLElement;
  private readonly miniCaption: HTMLElement;
  private readonly resizeObserver: ResizeObserver | null;

  private scroll: PinSpot = { x: 0, y: 0 };
  private size = { width: 0, height: 0 };
  private pins = new Map<string, PlacedPin>();
  private ownSpot: PinSpot | null = null;
  private selected: string | null = null;
  private card: HTMLElement | null = null;
  /** Centre on your pin the first time it and a size are both known. */
  private centred = false;
  private suppressClick = false;

  constructor(private readonly handlers: MapViewHandlers) {
    this.element = el("section", "mr1-map");
    this.element.setAttribute("aria-label", "Map");

    this.viewport = el("div", "mr1-map__viewport");
    this.viewport.tabIndex = 0;
    this.viewport.setAttribute("aria-label", "Map. Drag or use the arrow keys to move around.");
    this.world = el("div", "mr1-map__world");
    const art = el("img", "mr1-map__art");
    art.src = MAP_ART;
    art.alt = "";
    art.draggable = false;
    art.width = MAP_SIZE;
    art.height = MAP_SIZE;
    this.pinLayer = el("div", "mr1-map__pins");
    this.world.append(art, this.pinLayer);
    this.viewport.append(this.world);

    const myYard = button("btn mr1-map__home");
    myYard.append(icon("target", 18), "My yard");
    myYard.addEventListener("click", () => this.centreOnYou());

    this.mini = el("div", "mr1-mini");
    this.mini.setAttribute("aria-hidden", "true");
    const miniMap = el("div", "mr1-mini__map");
    miniMap.style.backgroundImage = `url("${MAP_ART}")`;
    this.miniDots = el("div", "mr1-mini__dots");
    this.miniFrame = el("div", "mr1-mini__frame");
    miniMap.append(this.miniDots, this.miniFrame);
    this.miniCaption = el("span", "mr1-mini__caption");
    this.mini.append(miniMap, this.miniCaption);
    this.mini.title = "The whole map. Drag the box to move around.";

    this.element.append(this.viewport, myYard, this.mini, this.legend());

    this.viewport.addEventListener("pointerdown", this.onPointerDown);
    this.viewport.addEventListener("click", this.onClickCapture, true);
    this.viewport.addEventListener("wheel", this.onWheel, { passive: false });
    this.viewport.addEventListener("keydown", this.onKeyDown);
    miniMap.addEventListener("pointerdown", this.onMiniDown);

    this.resizeObserver =
      typeof ResizeObserver === "undefined" ? null : new ResizeObserver(() => this.measure());
    this.resizeObserver?.observe(this.viewport);
  }

  destroy(): void {
    this.resizeObserver?.disconnect();
    this.element.remove();
  }

  /** Re-measures the window; the scene calls it on resize too. */
  measure(): void {
    const box = this.viewport.getBoundingClientRect();
    if (!box.width || !box.height) return;
    this.size = { width: box.width, height: box.height };
    if (!this.centred && this.ownSpot) {
      this.centred = true;
      this.scroll = centreOn(this.ownSpot, this.size);
    }
    this.scrollTo(this.scroll);
  }

  /** Draws every pin for this answer; the selection survives a refresh. */
  setData(world: Mr1World, own: Mr1Own | null, now: number): void {
    const placed = layoutPlayers(own ?? { baseid: "0", seed: 0 }, world.neighbours);
    this.ownSpot = own ? placed.own : null;
    this.pinLayer.replaceChildren();
    this.miniDots.replaceChildren();
    this.pins.clear();

    for (const tribe of world.tribes) {
      // The practice camp (#227) sits beside your own pin, where the first screen looks.
      const spot = tribe.practice ? practiceSpot(this.ownSpot) : tribeSpot(tribe);
      this.addPin(tribe, spot, now);
    }
    for (const neighbour of world.neighbours) {
      const spot = placed.neighbours.get(neighbour.key);
      if (spot) this.addPin(neighbour, spot, now);
    }
    if (own && this.ownSpot) this.addYou(world.level ?? own.level, this.ownSpot);

    this.setSelected(this.selected, this.card);
    this.measure();
    this.updateMini();
  }

  /** Marks a pin chosen and puts its card beside it (or none). */
  setSelected(key: string | null, card: HTMLElement | null): void {
    this.selected = key && this.pins.has(key) ? key : null;
    for (const pin of this.pins.values()) {
      const on = pin.key === this.selected;
      pin.element.classList.toggle("mr1-pin--selected", on);
      pin.button.setAttribute("aria-expanded", String(on));
    }
    if (this.card && this.card !== card) this.card.remove();
    this.card = card;
    const pin = this.selected ? this.pins.get(this.selected) : null;
    if (!card || !pin) return;
    this.pinLayer.append(card);
    this.placeCard(card, pin.spot);
  }

  /** Scrolls so a pin is in view, for a pick made in the list. */
  reveal(key: string): void {
    const pin = this.pins.get(key);
    if (pin) this.scrollTo(centreOn(pin.spot, this.size));
  }

  centreOnYou(): void {
    if (this.ownSpot) this.scrollTo(centreOn(this.ownSpot, this.size));
    this.viewport.focus({ preventScroll: true });
  }

  /* ── Pins ───────────────────────────────────────────────────────────── */

  private addPin(target: Mr1Target, spot: PinSpot, now: number): void {
    const tone = pinTone(target);
    const pin = el("div", `mr1-pin mr1-pin--${target.kind} mr1-tone--${tone}`);
    const practice = target.kind === "tribe" && target.practice === true;
    if (practice) pin.classList.add("mr1-pin--practice");
    pin.style.left = `${spot.x}px`;
    pin.style.top = `${spot.y}px`;

    const control = button("mr1-pin__button");
    control.setAttribute("aria-expanded", "false");
    control.append(avatar(target, "md"));
    const tag = el("span", "mr1-pin__tag");

    if (target.kind === "tribe") {
      const left = respawnIn(target, now);
      if (left !== null && target.respawnAt !== null) {
        control.setAttribute(
          "aria-label",
          `${target.name}, wrecked, back in ${Math.ceil(left / 60)} minutes`,
        );
        tag.append(
          `${tribeInfo(target.tribe).name} · back in `,
          countdown(target.respawnAt, now, "mr1-countdown mr1-countdown--plain"),
        );
      } else {
        control.setAttribute("aria-label", `${target.name}, level ${target.level}`);
        tag.append(target.name, el("span", "mr1-pin__level", `Lv ${target.level}`));
      }
    } else {
      const playing = isPlayingNow(target, now);
      const shielded = isProtected(target);
      control.setAttribute(
        "aria-label",
        `${target.name}, level ${target.level}${playing ? ", playing now" : ""}${shielded ? ", protected" : ""}${
          target.attacksFrom > target.attacksTo ? ", attacked you" : ""
        }`,
      );
      const badge = el("span", "mr1-pin__badge");
      if (shielded) badge.append(icon("shield", 12));
      else badge.textContent = String(target.level);
      control.append(badge);
      if (playing) tag.append(el("span", "mr1-dot mr1-dot--online"));
      tag.append(target.name);
    }

    if (practice) tutTarget(control, TutTarget.MR1_PRACTICE);
    control.addEventListener("click", () =>
      this.handlers.onSelect(this.selected === target.key ? null : target.key),
    );
    pin.append(control, tag);
    this.pinLayer.append(pin);

    const dot = el("span", `mr1-mini__dot mr1-mini__dot--${target.kind} mr1-tone--${tone}`);
    this.placeDot(dot, spot);
    this.miniDots.append(dot);
    this.pins.set(target.key, { key: target.key, spot, element: pin, button: control, dot });
  }

  private addYou(level: number, spot: PinSpot): void {
    const pin = el("div", "mr1-pin mr1-pin--you");
    pin.style.left = `${spot.x}px`;
    pin.style.top = `${spot.y}px`;
    const face = el("span", "mr1-pin__you");
    face.setAttribute("role", "img");
    face.setAttribute("aria-label", `Your yard, level ${level}`);
    face.append(icon("home", 24));
    pin.append(face, el("span", "mr1-pin__tag mr1-pin__tag--you", "YOU"));
    this.pinLayer.append(pin);
    const dot = el("span", "mr1-mini__dot mr1-mini__dot--you");
    this.placeDot(dot, spot);
    this.miniDots.append(dot);
  }

  private placeDot(dot: HTMLElement, spot: PinSpot): void {
    dot.style.left = `${(spot.x / MAP_SIZE) * 100}%`;
    dot.style.top = `${(spot.y / MAP_SIZE) * 100}%`;
  }

  /** Beside the pin, on whichever side has room, kept inside the window. */
  private placeCard(card: HTMLElement, spot: PinSpot): void {
    const width = card.offsetWidth || 320;
    const height = card.offsetHeight || 260;
    const gap = 44;
    const roomRight = this.scroll.x + this.size.width - (spot.x + gap);
    const left = roomRight >= width + 8 ? spot.x + gap : spot.x - gap - width;
    const minTop = this.scroll.y + 8;
    const maxTop = this.scroll.y + this.size.height - height - 8;
    const top = Math.max(minTop, Math.min(spot.y - 60, maxTop));
    card.style.left = `${Math.round(left)}px`;
    card.style.top = `${Math.round(top)}px`;
  }

  /* ── Scrolling ──────────────────────────────────────────────────────── */

  private scrollTo(scroll: PinSpot): void {
    this.scroll = clampScroll(scroll, this.size);
    this.world.style.transform = `translate(${-Math.round(this.scroll.x)}px, ${-Math.round(this.scroll.y)}px)`;
    this.updateMini();
  }

  private updateMini(): void {
    const share = (value: number): string => `${(value / MAP_SIZE) * 100}%`;
    const frame = this.miniFrame.style;
    frame.left = share(Math.max(0, this.scroll.x));
    frame.top = share(Math.max(0, this.scroll.y));
    frame.width = share(Math.min(MAP_SIZE, this.size.width));
    frame.height = share(Math.min(MAP_SIZE, this.size.height));

    let players = 0;
    let off = 0;
    for (const pin of this.pins.values()) {
      if (!pin.key.startsWith("player-")) continue;
      players += 1;
      const { x, y } = pin.spot;
      if (
        x < this.scroll.x ||
        y < this.scroll.y ||
        x > this.scroll.x + this.size.width ||
        y > this.scroll.y + this.size.height
      ) {
        off += 1;
      }
    }
    this.miniCaption.textContent =
      players === 0
        ? "No neighbours yet"
        : `${players} ${players === 1 ? "neighbour" : "neighbours"} · ${off} off screen`;
  }

  private readonly onPointerDown = (event: PointerEvent): void => {
    if (event.button !== 0) return;
    if ((event.target as HTMLElement).closest(".mr1-card")) return;
    const start = { x: event.clientX, y: event.clientY };
    const from = this.scroll;
    let dragging = false;
    const move = (moved: PointerEvent): void => {
      const dx = moved.clientX - start.x;
      const dy = moved.clientY - start.y;
      if (!dragging && Math.hypot(dx, dy) < DRAG_THRESHOLD) return;
      if (!dragging) {
        dragging = true;
        this.viewport.classList.add("mr1-map__viewport--dragging");
        this.viewport.setPointerCapture?.(event.pointerId);
      }
      this.scrollTo({ x: from.x - dx, y: from.y - dy });
    };
    const up = (): void => {
      this.viewport.removeEventListener("pointermove", move);
      this.viewport.removeEventListener("pointerup", up);
      this.viewport.removeEventListener("pointercancel", up);
      this.viewport.classList.remove("mr1-map__viewport--dragging");
      if (dragging) this.suppressClick = true;
    };
    this.viewport.addEventListener("pointermove", move);
    this.viewport.addEventListener("pointerup", up);
    this.viewport.addEventListener("pointercancel", up);
  };

  /** A drag ends with a click on whatever is under it; that click is not a pick. */
  private readonly onClickCapture = (event: MouseEvent): void => {
    if (this.suppressClick) {
      this.suppressClick = false;
      event.stopPropagation();
      event.preventDefault();
      return;
    }
    const target = event.target as HTMLElement;
    if (!target.closest(".mr1-pin__button") && !target.closest(".mr1-card") && this.selected) {
      this.handlers.onSelect(null);
    }
  };

  private readonly onWheel = (event: WheelEvent): void => {
    if ((event.target as HTMLElement).closest(".mr1-card")) return;
    event.preventDefault();
    this.scrollTo({ x: this.scroll.x + event.deltaX, y: this.scroll.y + event.deltaY });
  };

  private readonly onKeyDown = (event: KeyboardEvent): void => {
    if (event.target !== this.viewport) return;
    const step: Record<string, [number, number]> = {
      ArrowLeft: [-KEY_STEP, 0],
      ArrowRight: [KEY_STEP, 0],
      ArrowUp: [0, -KEY_STEP],
      ArrowDown: [0, KEY_STEP],
    };
    const delta = step[event.key];
    if (!delta) return;
    event.preventDefault();
    this.scrollTo({ x: this.scroll.x + delta[0], y: this.scroll.y + delta[1] });
  };

  /** Press or drag on the overview map: that point moves to the middle. */
  private readonly onMiniDown = (event: PointerEvent): void => {
    if (event.button !== 0) return;
    const map = event.currentTarget as HTMLElement;
    const follow = (moved: PointerEvent): void => {
      const box = map.getBoundingClientRect();
      const scale = MAP_SIZE / box.width;
      this.scrollTo(
        centreOn(
          { x: (moved.clientX - box.left) * scale, y: (moved.clientY - box.top) * scale },
          this.size,
        ),
      );
    };
    map.setPointerCapture?.(event.pointerId);
    follow(event);
    const up = (): void => {
      map.removeEventListener("pointermove", follow);
      map.removeEventListener("pointerup", up);
      map.removeEventListener("pointercancel", up);
    };
    map.addEventListener("pointermove", follow);
    map.addEventListener("pointerup", up);
    map.addEventListener("pointercancel", up);
    event.preventDefault();
  };

  /** What the pin colours mean (new: Flash never said). */
  private legend(): HTMLElement {
    const legend = el("div", "mr1-legend");
    legend.setAttribute("aria-label", "What the pins mean");
    const entry = (swatch: string, text: string): HTMLElement => {
      const item = el("span", "mr1-legend__item");
      item.append(el("span", `mr1-legend__swatch ${swatch}`), text);
      return item;
    };
    legend.append(
      entry("mr1-legend__swatch--you", "You"),
      entry("mr1-tone--neighbour", "Neighbour"),
      entry("mr1-tone--attacked", "Attacked you"),
      entry("mr1-tone--protected", "Protected"),
      entry("mr1-legend__swatch--tribe mr1-tone--tribe", "Wild monster tribe"),
      entry("mr1-legend__swatch--online", "Playing now"),
    );
    return legend;
  }
}
