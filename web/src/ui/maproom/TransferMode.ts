import { monsterName } from "@/game/combat/rules";
import { monsterPortrait, showPortrait } from "@/game/portraits";
import { classicLook } from "@/game/classicLook";
import {
  canTick,
  countOf,
  currentPlan,
  everySource,
  freeRoom,
  heldBy,
  matchesSearch,
  nearestWithRoom,
  othersByDistance,
  pairsOf,
  rankTypes,
  roomOf,
  trayTypes,
  usedRoom,
  type ArmyYard,
  type DistanceOf,
  type MonsterPick,
  type MovePair,
  type MovePlan,
  type MoveMode,
  type MoveState,
  type SizeOf,
} from "@/game/maproom/transferPlan";
import { formatAmount } from "@/ui/format";
import { gameIcon, type GameIconName } from "@/ui/gameIcon";
import { Panel } from "@/ui/Panel";
import { Popup } from "@/ui/Popup";
import { isPhoneLayout } from "@/ui/phoneLayout";
import "@/ui/styles/transfer.css";

/**
 * Moving monsters from the world map (beta 9 #7, the owner's "B1 steel
 * plates", 22 Nov 2026). It replaces the old Move Monsters dialog.
 *
 * The player taps one of their yards, then "Move monsters from here" or
 * "Bring monsters here" on its card. The map goes into move mode: every one
 * of the player's yards in sight wears a small plate with its two biggest
 * monster groups, a room bar and its free room, and a tray docks at the
 * bottom. Picking a monster type in the tray brings it to the front of every
 * plate; tapping a yard (its plate or its hex) ticks it as a target (or a
 * source when bringing), and the plates preview what each yard will get.
 * Hover (touch: press and hold) a plate to see the yard's whole army. A big
 * empire's outposts (200+) are also in the List window, nearest first, with a
 * search. Go sends one move to the server (free and instant, every pair
 * checked there), shows what happened, and the plates go.
 *
 * The scene owns the map: it says where each yard is on screen (`place`),
 * passes taps and hovers on the map's hexes in (`tapCell`, `hoverCell`), and
 * outlines the yards in play on the map itself (`mark`).
 */

/** Words the tray says, in one place for the tests. */
export const MOVE_TEXT = {
  titleOut: (name: string) => `Move from ${name}`,
  titleIn: (name: string) => `Bring to ${name}`,
  near: "Near 5",
  allHome: "All home",
  every: "All",
  tickAll: "Tick all",
  list: "List",
  even: "Even",
  inOrder: "In order",
  pickFirst: "Pick monsters",
  tickOut: "Tap outposts",
  tickIn: "Tap yards to bring from",
  move: (n: number) => `Move ${formatAmount(n)}`,
  bring: (n: number, home: boolean) => `Bring ${formatAmount(n)} ${home ? "home" : "here"}`,
  from: "From",
  to: "To",
  empty: "Empty",
  full: "Full",
  noHousing: "No room",
  free: "free",
  attack: "Under attack",
  attackLong: "Under attack: no moves until it ends",
  noneHere: "No monsters here",
  noneOut: "Your outposts are empty",
  noRoom: (n: number) => `${formatAmount(n)} don't fit`,
  stayOut: (n: number) => `${formatAmount(n)} stay out`,
  listOut: "Yards with room",
  listIn: "Yards with monsters",
  search: "Find by name or x, y",
  done: "Done",
  hex: (n: number) => `${n} hex`,
  loading: "Reading your yards...",
  failed: "Could not read your yards. Try again.",
  problem: "The move did not go through: ",
  noOutposts: "You need an outpost to move monsters.",
  didNotFit: (n: number) => `${formatAmount(n)} did not fit`,
  fromMany: (n: number) => `from ${n} yards`,
  fromOne: (name: string) => `from ${name}`,
  home: "home",
  moved: (n: number) => `Moved ${formatAmount(n)}`,
  close: "Close move",
  closeList: "Close list",
} as const;

export interface TransferModeOptions {
  /** The overlay's content layer: the plates and the tray go here. */
  readonly layer: HTMLElement;
  /** The overlay's modal layer: the List window opens here. */
  readonly modal: HTMLElement;
  /** Housing one monster of a type takes, at the player's Academy level. */
  readonly sizeOf: SizeOf;
  /** Hex steps between two yards. */
  readonly distance: DistanceOf;
  /** "Main yard", an outpost's name, or its "x, y". */
  readonly nameOf: (yard: ArmyYard) => string;
  /**
   * Where a yard's hex is on screen now (its centre, CSS px) and how wide a
   * hex is drawn there; null when it is out of sight.
   */
  readonly place: (yard: ArmyYard) => { x: number; y: number; hexWidth: number } | null;
  /** Every one of the player's yards with its army (`POST /worldmapv2/ownarmies`). */
  readonly load: () => Promise<ArmyYard[]>;
  /** Sends the move (`POST /worldmapv2/transferbatch`). */
  readonly send: (
    pairs: readonly MovePair[],
  ) => Promise<{ yards: readonly { baseid: string; housed: Record<string, number>; capacity: number }[] }>;
  /** After a move landed: the yards it touched, for the map to read again. */
  readonly onMoved: (baseids: readonly string[]) => void;
  /** Outlines the yard the move started from and the yards ticked, on the map itself. */
  readonly mark: (marks: readonly { col: number; row: number; kind: "anchor" | "on" }[] | null) => void;
  /** Move mode ended (Go, the close button, Escape). */
  readonly onEnd: () => void;
}

/** Below this hex width the plates shrink to one line; below the next, to a dot. */
const FULL_PLATE_HEX = 84;
const SLIM_PLATE_HEX = 44;
/** A full plate's width (transfer.css): it shrinks a little where hexes are drawn narrower than it. */
const PLATE_WIDTH = 98;
/** How long the result stays on the plates before move mode ends. */
const RESULT_MS = 2_600;
/** Press and hold on a touch screen to see a yard's army. */
const HOLD_MS = 420;

const el = <K extends keyof HTMLElementTagNameMap>(tag: K, className = "", text?: string): HTMLElementTagNameMap[K] => {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
};

const button = (className: string, label?: string): HTMLButtonElement => {
  const node = el("button", className);
  node.type = "button";
  if (label !== undefined) node.setAttribute("aria-label", label);
  return node;
};

const icon = (name: GameIconName, size: 16 | 24 | 32 = 24, className = ""): HTMLImageElement =>
  gameIcon(name, { size, decorative: true, className });

/** The game's painted outpost icon, the Classic one in Classic. */
const outpostIcon = (size: 16 | 24 | 32 = 24, className = ""): HTMLImageElement =>
  icon(classicLook() ? "outpostclassic" : "outpost", size, className);

const portrait = (id: string, className: string): HTMLImageElement => {
  const image = el("img", className);
  image.alt = "";
  image.decoding = "async";
  image.draggable = false;
  showPortrait(image, monsterPortrait(id, "icon"));
  return image;
};

/** A count with a monster icon: the plates', the list's and the army card's. */
const monsterCount = (id: string, count: number, className = "xfer-mon"): HTMLElement => {
  const wrap = el("span", className);
  wrap.title = monsterName(id);
  wrap.append(portrait(id, "xfer-mon__pic"), el("b", "xfer-mon__n", formatAmount(count)));
  return wrap;
};

/** More types than shown: a small grey "+2", never the orange of monsters coming in. */
const moreDots = (more: number): HTMLElement => {
  const dots = el("span", "xfer-plate__more", `+${more}`);
  dots.title = `${more} more kinds`;
  return dots;
};

/** The pictures on a "+15" tag: the one kind moving, or the two biggest of several. */
const tagPictures = (moving: Readonly<Record<string, number>>): HTMLElement[] =>
  Object.keys(moving)
    .filter((id) => (moving[id] ?? 0) > 0)
    .sort((a, b) => (moving[b] ?? 0) - (moving[a] ?? 0))
    .slice(0, 2)
    .map((id) => portrait(id, "xfer-tag__pic"));

/** A room bar: used, and the move's preview (stripes in, pale out). */
const roomBar = (yard: ArmyYard, sizeOf: SizeOf, delta: number, className = "xfer-bar"): HTMLElement => {
  const bar = el("span", className);
  const cap = Math.max(1, yard.capacity);
  const used = Math.min(cap, usedRoom(yard, sizeOf));
  const fill = el("i", "xfer-bar__used");
  const free = cap - used;
  if (free / cap < 0.04) fill.classList.add("is-full");
  else if (free / cap < 0.2) fill.classList.add("is-low");
  fill.style.width = `${(used / cap) * 100}%`;
  bar.append(fill);
  if (delta > 0) {
    const add = el("i", "xfer-bar__add");
    add.style.left = `${(used / cap) * 100}%`;
    add.style.width = `${(Math.min(cap - used, delta) / cap) * 100}%`;
    bar.append(add);
  } else if (delta < 0) {
    const gone = Math.min(used, -delta);
    const sub = el("i", "xfer-bar__sub");
    sub.style.left = `${((used - gone) / cap) * 100}%`;
    sub.style.width = `${(gone / cap) * 100}%`;
    bar.append(sub);
  }
  return bar;
};

type Place = { x: number; y: number; hexWidth: number };

/** The tray in three bands: narrow and tall screens (transfer.css, the same query). */
const STACKED_QUERY = "(max-width: 900px) and (min-height: 501px)";
const stackedTray = (): boolean => window.matchMedia?.(STACKED_QUERY).matches ?? false;

export class TransferMode {
  private readonly options: TransferModeOptions;
  private yards: ArmyYard[] = [];
  private byId = new Map<string, ArmyYard>();
  private state: MoveState | null = null;
  /** The monster type whose stepper is open. */
  private stepping: string | null = null;
  /** The yard whose army card is up. */
  private peek: string | null = null;
  private peekTimer: ReturnType<typeof setTimeout> | null = null;
  private holdTimer: ReturnType<typeof setTimeout> | null = null;
  private toastTimer: ReturnType<typeof setTimeout> | null = null;
  private held = false;
  private busy = false;
  /** What the last move did, shown on the plates until move mode ends. */
  private result: { add: MovePlan["add"]; sub: MovePlan["sub"]; total: number } | null = null;
  private resultTimer: ReturnType<typeof setTimeout> | null = null;
  private query = "";

  /** The plates, under the HUD and the tray (first in the layer). */
  private readonly root: HTMLElement;
  private readonly plates: HTMLElement;
  /** The army card and the result, over everything (last in the layer). */
  private readonly over: HTMLElement;
  private readonly peekCard: HTMLElement;
  private readonly toast: HTMLElement;
  private tray: Panel | null = null;
  private list: Popup | null = null;
  private listBody: HTMLElement | null = null;
  /** The plate elements by yard, and the place each was put at. */
  private readonly plateOf = new Map<string, { node: HTMLElement; tag: HTMLElement | null; at: Place | null }>();

  constructor(options: TransferModeOptions) {
    this.options = options;
    this.root = el("div", "xfer");
    this.plates = el("div", "xfer__plates");
    this.over = el("div", "xfer-over");
    this.peekCard = el("div", "xfer-peek");
    this.peekCard.hidden = true;
    this.toast = el("div", "xfer-toast");
    this.toast.hidden = true;
    this.toast.setAttribute("role", "status");
    this.toast.addEventListener("click", () => {
      this.toast.hidden = true;
    });
    this.root.append(this.plates);
    this.over.append(this.peekCard, this.toast);
    this.over.addEventListener("contextmenu", (event) => event.preventDefault());
    this.root.addEventListener("contextmenu", (event) => {
      if ((event.target as HTMLElement).closest(".xfer-plate")) event.preventDefault();
    });
  }

  /** The tray's top edge on screen, or null when it is not up. */
  trayTop(): number | null {
    return this.tray ? this.tray.element.getBoundingClientRect().top : null;
  }

  /** Whether move mode is on. */
  get active(): boolean {
    return this.state !== null;
  }

  /**
   * Starts a move from one of the player's yards: reads every yard's army,
   * then puts the plates and the tray up.
   */
  async start(anchor: string, mode: MoveMode): Promise<void> {
    this.end(false);
    // Split evenly by default, as in the owner's prototype: "Near 5" then fills five outposts alike.
    this.state = { mode, anchor, ticks: [], picks: {}, even: true };
    this.options.layer.classList.add("xfer-on");
    if (!this.root.isConnected) this.options.layer.prepend(this.root);
    this.showToast([el("span", "xfer-toast__line", MOVE_TEXT.loading)], false, 0);
    try {
      this.setYards(await this.options.load());
    } catch {
      if (this.state?.anchor !== anchor) return;
      this.showToast([el("span", "xfer-toast__line", MOVE_TEXT.failed)], true);
      this.end();
      return;
    }
    if (this.state?.anchor !== anchor) return;
    this.toast.hidden = true;
    if (!this.byId.has(anchor) || this.yards.length < 2) {
      this.showToast([el("span", "xfer-toast__line", MOVE_TEXT.noOutposts)], true);
      this.end();
      return;
    }
    // Bringing home: every type on offer starts picked, as a first-time player expects.
    if (mode === "in") this.pickAll();
    this.openTray();
    this.render();
  }

  /** Ends move mode; `notify` false when the scene itself is closing it. */
  end(notify = true): void {
    const was = this.state !== null;
    this.state = null;
    this.stepping = null;
    this.peek = null;
    this.busy = false;
    this.result = null;
    this.query = "";
    for (const timer of [this.peekTimer, this.holdTimer, this.resultTimer]) if (timer) clearTimeout(timer);
    this.peekTimer = this.holdTimer = this.resultTimer = null;
    this.list?.close();
    this.list = null;
    this.listBody = null;
    const tray = this.tray;
    this.tray = null;
    tray?.close();
    this.plates.replaceChildren();
    this.plateOf.clear();
    this.options.mark(null);
    this.peekCard.hidden = true;
    this.options.layer.classList.remove("xfer-on", "xfer-listing");
    this.options.layer.style.removeProperty("--xfer-tray-height");
    this.root.remove();
    if (this.toast.hidden) this.over.remove();
    if (was && notify) this.options.onEnd();
  }

  /** Takes everything down for good (the map is closing). */
  destroy(): void {
    this.end(false);
    if (this.toastTimer) clearTimeout(this.toastTimer);
    this.over.remove();
  }

  /* ── The map's events ─────────────────────────────────────────────── */

  /** A tap on a hex of the map. True while move mode is on (it took the tap). */
  tapCell(col: number, row: number): boolean {
    if (!this.state) return false;
    const yard = this.yardAt(col, row);
    if (yard) this.toggle(yard.baseid);
    // Any other cell does nothing in move mode: the move stays on.
    return true;
  }

  /** The pointer over a hex (or off the map: null). */
  hoverCell(cell: { col: number; row: number } | null): void {
    if (!this.state) return;
    const yard = cell ? this.yardAt(cell.col, cell.row) : undefined;
    this.showPeek(yard?.baseid ?? null);
  }

  /** The camera moved: put every plate back over its yard. */
  place(): void {
    if (!this.state) return;
    this.renderPlates();
  }

  /* ── State ────────────────────────────────────────────────────────── */

  private setYards(yards: readonly ArmyYard[]): void {
    this.yards = [...yards];
    this.byId = new Map(this.yards.map((yard) => [yard.baseid, yard]));
  }

  private yardAt(col: number, row: number): ArmyYard | undefined {
    return this.yards.find((yard) => yard.x === col && yard.y === row);
  }

  private get anchor(): ArmyYard | undefined {
    return this.state ? this.byId.get(this.state.anchor) : undefined;
  }

  /** The smallest monster the move could send, which decides when a yard is full. */
  private smallest(): number {
    const state = this.state;
    if (!state) return 1;
    const sizes = trayTypes(state, this.yards, this.options.sizeOf).map((id) => this.options.sizeOf(id));
    return sizes.length ? Math.min(...sizes) : 1;
  }

  private update(change: Partial<MoveState>): void {
    if (!this.state) return;
    this.state = { ...this.state, ...change };
    this.render();
  }

  private toggle(baseid: string): void {
    const state = this.state;
    const anchor = this.anchor;
    const yard = this.byId.get(baseid);
    if (!state || !anchor || !yard || this.busy || this.result) return;
    this.stepping = null;
    if (state.ticks.includes(baseid)) {
      this.update({ ticks: state.ticks.filter((id) => id !== baseid) });
      return;
    }
    if (!canTick(yard, anchor, state.mode, this.options.sizeOf, this.smallest())) {
      this.flashPlate(baseid);
      return;
    }
    this.update({ ticks: [...state.ticks, baseid] });
  }

  private pickAll(): void {
    const state = this.state;
    if (!state) return;
    const picks: Record<string, MonsterPick> = {};
    for (const id of trayTypes(state, this.yards, this.options.sizeOf)) picks[id] = "all";
    this.state = { ...state, picks };
  }

  private togglePick(id: string): void {
    const state = this.state;
    if (!state) return;
    const picks = { ...state.picks };
    if (picks[id] !== undefined) delete picks[id];
    else picks[id] = "all";
    if (this.stepping === id) this.stepping = null;
    this.update({ picks });
  }

  private plan() {
    const state = this.state;
    if (!state) return null;
    return currentPlan(state, this.byId, this.options.sizeOf, this.options.distance);
  }

  /* ── Rendering ────────────────────────────────────────────────────── */

  private render(): void {
    const state = this.state;
    if (!state) return;
    this.options.mark([
      ...this.yards
        .filter((yard) => yard.baseid === state.anchor)
        .map((yard) => ({ col: yard.x, row: yard.y, kind: "anchor" as const })),
      ...state.ticks
        .map((id) => this.byId.get(id))
        .filter((yard): yard is ArmyYard => yard !== undefined)
        .map((yard) => ({ col: yard.x, row: yard.y, kind: "on" as const })),
    ]);
    this.renderTray();
    this.renderPlates(true);
    if (this.list) this.renderList();
    if (this.peek) this.renderPeek();
  }

  /**
   * The plates over the yards in sight. `rebuild` redraws their insides (the
   * move changed); otherwise only the yards that came into or left sight are
   * made or dropped, and the rest are moved.
   */
  private renderPlates(rebuild = false): void {
    const state = this.state;
    if (!state) return;
    const now = this.plan();
    const seen = new Set<string>();
    for (const yard of this.yards) {
      const at = this.options.place(yard);
      if (!at) continue;
      seen.add(yard.baseid);
      const known = this.plateOf.get(yard.baseid);
      const size = at.hexWidth >= FULL_PLATE_HEX ? "full" : at.hexWidth >= SLIM_PLATE_HEX ? "slim" : "dot";
      if (!known || rebuild || known.node.dataset["size"] !== size) {
        known?.node.remove();
        known?.tag?.remove();
        const made = this.makePlate(yard, size, now?.plan ?? null);
        this.plates.append(made.node);
        if (made.tag) this.plates.append(made.tag);
        this.plateOf.set(yard.baseid, { ...made, at: null });
      }
      const plate = this.plateOf.get(yard.baseid)!;
      if (!plate.at || plate.at.x !== at.x || plate.at.y !== at.y || plate.at.hexWidth !== at.hexWidth) {
        // The plate sits on the lower half of the hex.
        const y = at.y + (size === "dot" ? 0 : at.hexWidth * 0.12);
        // Neighbours never overlap: a full plate is at most 90% of its hex. The
        // scale comes last, so it shrinks the plate and not where it stands.
        const fit = size === "full" ? Math.min(1, (at.hexWidth * 0.9) / PLATE_WIDTH) : 1;
        plate.node.style.transform = `translate(${Math.round(at.x)}px, ${Math.round(y)}px) translate(-50%, -50%) scale(${fit.toFixed(3)})`;
        // The tag sits on the plate's top right corner, over its own yard's
        // building: never on the plates of the row above.
        if (plate.tag) {
          const half = (PLATE_WIDTH * fit) / 2;
          const top = y - 21 * fit;
          plate.tag.style.transform = `translate(${Math.round(at.x + half + 4)}px, ${Math.round(top - 4)}px) translate(-100%, -100%)`;
        }
        plate.at = at;
      }
    }
    for (const [baseid, plate] of this.plateOf) {
      if (seen.has(baseid)) continue;
      plate.node.remove();
      plate.tag?.remove();
      this.plateOf.delete(baseid);
    }
    if (this.peek) this.placePeek();
  }

  private makePlate(
    yard: ArmyYard,
    size: "full" | "slim" | "dot",
    plan: MovePlan | null,
  ): { node: HTMLElement; tag: HTMLElement | null } {
    const state = this.state!;
    const anchor = this.anchor!;
    const sizeOf = this.options.sizeOf;
    const isAnchor = yard.baseid === anchor.baseid;
    const ticked = state.ticks.includes(yard.baseid);
    const out = state.mode === "out";
    const shown = this.result ?? plan;
    // What moves to or from this yard: + on a target, − on a source.
    const gets = shown?.add[yard.baseid];
    const gives = shown?.sub[yard.baseid];
    const moving = (isAnchor ? (out ? gives : gets) : out ? gets : gives) ?? {};
    const delta = this.result ? 0 : roomOf(gets, sizeOf) - roomOf(gives, sizeOf);
    // What the yard houses now, as the army card and the List show it; the tag says what comes or goes.
    const now = yard;
    const smallest = this.smallest();
    const tickable = canTick(yard, anchor, state.mode, sizeOf, smallest);

    const node = button("xfer-plate", this.options.nameOf(yard));
    node.dataset["size"] = size;
    node.dataset["baseid"] = yard.baseid;
    if (isAnchor) node.classList.add("is-anchor");
    if (ticked) node.classList.add("is-on");
    if (ticked && countOf(moving) === 0 && !this.result) node.classList.add("is-idle");
    if (yard.attack) node.classList.add("is-attack");
    if (!isAnchor && !ticked && !tickable) node.classList.add("is-dim");
    if (this.result && countOf(moving) > 0) node.classList.add("is-done");
    node.setAttribute("aria-pressed", String(ticked));
    if (isAnchor || !tickable) node.setAttribute("aria-disabled", "true");

    const free = Math.max(0, freeRoom(yard, sizeOf) - delta);
    const full = free < smallest;

    if (size === "dot") {
      node.append(el("i", "xfer-plate__dot"));
    } else {
      const top = el("span", "xfer-plate__top");
      if (yard.attack) {
        top.append(icon("swords", 16, "xfer-plate__ico"), el("span", "xfer-plate__word", MOVE_TEXT.attack));
        node.title = MOVE_TEXT.attackLong;
      } else if (isAnchor) {
        top.append(
          yard.main ? icon("townhall", 16, "xfer-plate__ico") : outpostIcon(16, "xfer-plate__ico"),
          el("span", "xfer-plate__word", out ? MOVE_TEXT.from : MOVE_TEXT.to),
        );
      } else {
        const types = rankTypes(now, sizeOf, state.picks, moving);
        if (types.length === 0) top.append(el("span", "xfer-plate__none", MOVE_TEXT.empty));
        const room = size === "full" ? 2 : 1;
        for (const id of types.slice(0, room)) {
          const count = monsterCount(id, now.housed[id] ?? 0);
          if (state.picks[id] !== undefined) count.classList.add("is-picked");
          top.append(count);
        }
        if (types.length > room) top.append(moreDots(types.length - room));
      }
      node.append(top);
      if (!yard.attack && size === "full") {
        const room = el("span", "xfer-plate__room");
        room.append(roomBar(yard, sizeOf, delta));
        const word = el("b", full && !isAnchor ? "xfer-plate__free is-full" : "xfer-plate__free");
        const words = yard.capacity <= 0 ? MOVE_TEXT.noHousing : full && !isAnchor ? MOVE_TEXT.full : formatAmount(free);
        word.append(icon("housing", 16, "xfer-plate__house"), document.createTextNode(words));
        room.append(word);
        node.append(room);
      } else if (!yard.attack && size === "slim") {
        node.append(roomBar(yard, sizeOf, delta, "xfer-bar xfer-bar--thin"));
      }
    }
    if (ticked) node.append(el("i", "xfer-plate__tick"));

    node.addEventListener("click", (event) => {
      event.stopPropagation();
      if (this.held) {
        this.held = false;
        return;
      }
      if (!isAnchor) this.toggle(yard.baseid);
    });
    node.addEventListener("pointerenter", (event) => {
      if (event.pointerType === "mouse") this.showPeek(yard.baseid);
    });
    node.addEventListener("pointerleave", (event) => {
      if (event.pointerType === "mouse") this.hidePeekSoon();
    });
    node.addEventListener("pointerdown", (event) => {
      if (event.pointerType === "mouse") return;
      this.held = false;
      if (this.holdTimer) clearTimeout(this.holdTimer);
      this.holdTimer = setTimeout(() => {
        this.held = true;
        this.showPeek(yard.baseid, 3_500);
      }, HOLD_MS);
    });
    const cancelHold = (): void => {
      if (this.holdTimer) clearTimeout(this.holdTimer);
      this.holdTimer = null;
    };
    node.addEventListener("pointerup", cancelHold);
    node.addEventListener("pointercancel", cancelHold);

    // The "+11 [Pokey]" a target will get (− on a source), or what the move did.
    const n = countOf(moving);
    let tag: HTMLElement | null = null;
    if (!isAnchor && n > 0 && size !== "dot") {
      const plus = out || (this.result !== null && !!gets);
      tag = el("span", `xfer-tag ${plus ? "xfer-tag--add" : "xfer-tag--sub"}${this.result ? " is-done" : ""}`);
      tag.append(el("b", "", `${plus ? "+" : "−"}${formatAmount(n)}`), ...tagPictures(moving));
    }
    return { node, tag };
  }

  /** A short shake on a yard that cannot be ticked. */
  private flashPlate(baseid: string): void {
    const node = this.plateOf.get(baseid)?.node;
    if (!node) return;
    node.classList.remove("is-nope");
    void node.offsetWidth;
    node.classList.add("is-nope");
  }

  /* ── The army card (hover, or press and hold) ─────────────────────── */

  private showPeek(baseid: string | null, ms = 0): void {
    if (this.peekTimer) clearTimeout(this.peekTimer);
    this.peekTimer = null;
    if (!baseid || !this.byId.has(baseid)) {
      this.hidePeekSoon();
      return;
    }
    this.peek = baseid;
    this.renderPeek();
    if (ms > 0) this.peekTimer = setTimeout(() => this.hidePeek(), ms);
  }

  private hidePeekSoon(): void {
    if (this.peekTimer) clearTimeout(this.peekTimer);
    this.peekTimer = setTimeout(() => this.hidePeek(), 250);
  }

  private hidePeek(): void {
    this.peek = null;
    this.peekCard.hidden = true;
    for (const plate of this.plateOf.values()) plate.node.classList.remove("is-peeked");
  }

  private renderPeek(): void {
    const state = this.state;
    const yard = this.peek ? this.byId.get(this.peek) : undefined;
    const anchor = this.anchor;
    if (!state || !yard || !anchor) {
      this.hidePeek();
      return;
    }
    if (!this.over.isConnected) this.options.layer.append(this.over);
    const sizeOf = this.options.sizeOf;
    const plan = this.result ? null : (this.plan()?.plan ?? null);
    const gets = plan?.add[yard.baseid];
    const gives = plan?.sub[yard.baseid];
    const delta = roomOf(gets, sizeOf) - roomOf(gives, sizeOf);
    const card = this.peekCard;
    card.replaceChildren();

    const head = el("div", "xfer-peek__head");
    head.append(yard.main ? icon("townhall", 24, "xfer-peek__ico") : outpostIcon(24, "xfer-peek__ico"));
    head.append(el("b", "xfer-peek__name", this.options.nameOf(yard)));
    if (yard.attack) head.append(icon("swords", 24, "xfer-peek__ico"));
    if (yard.baseid !== anchor.baseid)
      head.append(el("small", "xfer-peek__far", MOVE_TEXT.hex(this.options.distance(anchor, yard))));
    card.append(head);

    const grid = el("div", "xfer-peek__grid");
    const types = rankTypes(yard, sizeOf, state.picks, { ...(gets ?? {}), ...(gives ?? {}) });
    if (types.length === 0 && !gets) grid.append(el("span", "xfer-peek__none", MOVE_TEXT.noneHere));
    for (const id of types) {
      const cell = monsterCount(id, yard.housed[id] ?? 0, "xfer-mon xfer-mon--big");
      if (state.picks[id] !== undefined) cell.classList.add("is-picked");
      const change = (gets?.[id] ?? 0) - (gives?.[id] ?? 0);
      if (change !== 0)
        cell.append(
          el("em", change > 0 ? "xfer-mon__add" : "xfer-mon__sub", `${change > 0 ? "+" : "−"}${formatAmount(Math.abs(change))}`),
        );
      grid.append(cell);
    }
    // Types moving in that the yard does not house yet.
    for (const [id, n] of Object.entries(gets ?? {})) {
      if (types.includes(id)) continue;
      const cell = monsterCount(id, 0, "xfer-mon xfer-mon--big is-new");
      cell.append(el("em", "xfer-mon__add", `+${formatAmount(n)}`));
      grid.append(cell);
    }
    card.append(grid);

    const room = el("div", "xfer-peek__room");
    room.append(roomBar(yard, sizeOf, delta));
    // Housed / room, as the yard card says it, then what is left.
    const free = Math.max(0, freeRoom(yard, sizeOf) - delta);
    const used = Math.max(0, yard.capacity - free);
    const words = el("span", "xfer-peek__free");
    words.append(icon("housing", 16), el("b", "", `${formatAmount(used)} / ${formatAmount(yard.capacity)}`));
    room.append(words);
    card.append(room, el("small", "xfer-peek__left", `${formatAmount(free)} ${MOVE_TEXT.free}`));
    card.append(el("i", "xfer-peek__caret"));

    card.hidden = false;
    this.placePeek();
  }

  private placePeek(): void {
    const yard = this.peek ? this.byId.get(this.peek) : undefined;
    const at = yard ? this.options.place(yard) : null;
    if (!yard || !at) {
      this.peekCard.hidden = true;
      return;
    }
    const card = this.peekCard;
    const width = card.offsetWidth || 240;
    const height = card.offsetHeight || 120;
    const view = this.options.layer.getBoundingClientRect();
    const half = at.hexWidth / 2;
    // Above the yard when there is room under the top bar, else below it.
    const above = at.y - half - height - 8 > 70;
    const top = above ? at.y - half * 0.6 - height - 6 : at.y + half * 0.9 + 6;
    const left = Math.min(Math.max(at.x - width / 2, 8), view.width - width - 8);
    card.style.transform = `translate(${Math.round(left)}px, ${Math.round(Math.max(8, top))}px)`;
    // The caret points at the yard.
    card.style.setProperty("--xfer-caret", `${Math.round(Math.min(Math.max(at.x - left, 16), width - 16))}px`);
    for (const [baseid, plate] of this.plateOf) plate.node.classList.toggle("is-peeked", baseid === yard.baseid);
    card.classList.toggle("is-below", !above);
  }

  /* ── The tray ─────────────────────────────────────────────────────── */

  private openTray(): void {
    const state = this.state;
    const anchor = this.anchor;
    if (!state || !anchor) return;
    const name = this.options.nameOf(anchor);
    this.tray = new Panel({
      title: state.mode === "out" ? MOVE_TEXT.titleOut(name) : MOVE_TEXT.titleIn(name),
      className: "xfer-tray",
      closeOnEscape: true,
      onClose: () => {
        if (this.tray) {
          this.tray = null;
          this.end();
        }
      },
    });
    this.tray.element.setAttribute("role", "region");
    this.tray.titlebar.querySelector("button")?.setAttribute("aria-label", MOVE_TEXT.close);
    this.tray.mount(this.options.layer);
  }

  private renderTray(): void {
    const tray = this.tray;
    const state = this.state;
    const anchor = this.anchor;
    const current = this.plan();
    if (!tray || !state || !anchor || !current) return;
    const { src, dst, plan } = current;
    const out = state.mode === "out";
    // Narrow and tall (a phone or an iPad upright): three bands, Go on its own
    // line. A phone on its side: two, as on a desktop (transfer.css).
    const phone = stackedTray();
    const sizeOf = this.options.sizeOf;

    // Keep the chips' scroll where it was.
    const oldStrip = tray.body.querySelector<HTMLElement>(".xfer-chips");
    const scrollLeft = oldStrip?.scrollLeft ?? 0;

    const types = trayTypes(state, this.yards, sizeOf);
    const pool = out ? [anchor] : this.yards.filter((yard) => canTick(yard, anchor, "in", sizeOf, 1));

    const chips = el("div", "xfer-chips");
    chips.setAttribute("role", "group");
    if (types.length === 0) chips.append(el("span", "xfer-tray__none", out ? MOVE_TEXT.noneHere : MOVE_TEXT.noneOut));
    for (const id of types) chips.append(this.chip(id, src, pool, plan, state));

    const all = button("btn btn--outline xfer-all", "Pick every monster");
    all.append(el("span", "", MOVE_TEXT.every));
    all.disabled = types.length === 0;
    all.addEventListener("click", () => {
      this.stepping = null;
      this.pickAll();
      this.render();
    });

    const rowA = el("div", "xfer-tray__row xfer-tray__row--chips");
    rowA.append(chips, all);

    // Quick picks.
    const quick = button("btn btn--outline xfer-quick");
    if (out || !anchor.main) {
      quick.append(outpostIcon(24), el("span", "", MOVE_TEXT.near));
      quick.setAttribute("aria-label", out ? "Tick the 5 nearest outposts with room" : "Tick the 5 nearest yards with monsters");
      quick.addEventListener("click", () => {
        this.stepping = null;
        const ticks = out
          ? nearestWithRoom(this.yards, anchor, sizeOf, this.smallest(), this.options.distance)
          : everySource(this.yards, anchor, sizeOf, this.options.distance).slice(0, 5);
        this.update({ ticks });
      });
    } else {
      quick.append(icon("townhall", 24), el("span", "", MOVE_TEXT.allHome));
      quick.setAttribute("aria-label", "Bring every outpost's monsters home");
      quick.addEventListener("click", () => {
        this.stepping = null;
        this.pickAll();
        this.update({ ticks: everySource(this.yards, anchor, sizeOf, this.options.distance) });
      });
    }

    const listButton = button("btn btn--outline xfer-listb", "List every yard you can pick");
    const smallestNow = this.smallest();
    const others = this.yards.filter(
      (yard) => (out ? !(yard.main && anchor.main) : true) && (state.ticks.includes(yard.baseid) || canTick(yard, anchor, state.mode, sizeOf, smallestNow)),
    ).length;
    listButton.append(icon("find", 24), el("span", "", MOVE_TEXT.list), el("small", "xfer-listb__n", formatAmount(others)));
    listButton.addEventListener("click", () => this.openList());

    const controls = el("div", "xfer-tray__tools");
    if (out) {
      const split = button(
        "btn btn--outline xfer-split",
        state.even ? "Split evenly (tap for in order)" : "Fill in order (tap to split evenly)",
      );
      split.append(el("i", "xfer-split__ico"), el("span", "", state.even ? MOVE_TEXT.even : MOVE_TEXT.inOrder));
      split.setAttribute("aria-pressed", String(state.even));
      split.addEventListener("click", () => this.update({ even: !state.even }));
      controls.append(split);
    }
    controls.append(quick, listButton);

    // Status: yards ticked, and the room left on the side that takes.
    // (How many yards is on Go itself.)
    const status = el("div", "xfer-status");
    const roomLeft = out
      ? dst.reduce((sum, yard) => sum + freeRoom(yard, sizeOf), 0) - roomOf(plan.moved, sizeOf)
      : freeRoom(anchor, sizeOf) - roomOf(plan.moved, sizeOf);
    const room = el("span", "xfer-status__item");
    room.title = out ? "Room left in the yards ticked" : `Room left at ${this.options.nameOf(anchor)}`;
    room.append(icon("housing", 24), el("b", "", formatAmount(Math.max(0, roomLeft))), el("small", "", MOVE_TEXT.free));
    status.append(room);
    if (plan.leftTotal > 0)
      status.append(el("span", "xfer-status__warn", out ? MOVE_TEXT.noRoom(plan.leftTotal) : MOVE_TEXT.stayOut(plan.leftTotal)));

    // Go says the next step until there is something to move.
    const go = button("btn btn--primary xfer-go");
    const picked = Object.keys(state.picks).length > 0;
    if (this.result) {
      // Done: what moved, until move mode ends a moment later.
      go.classList.add("is-done");
      go.append(el("i", "xfer-chip__check"), el("span", "", MOVE_TEXT.moved(this.result.total)));
    } else if (plan.total > 0) {
      if (out) {
        go.append(
          el("span", "", MOVE_TEXT.move(plan.total)),
          el("i", "xfer-go__arrow"),
          el("b", "", formatAmount(Object.keys(plan.add).length)),
          outpostIcon(24),
        );
      } else {
        go.append(el("span", "", MOVE_TEXT.bring(plan.total, anchor.main)));
      }
    } else {
      go.classList.add("is-waiting");
      go.append(el("span", "", !picked ? MOVE_TEXT.pickFirst : out ? MOVE_TEXT.tickOut : MOVE_TEXT.tickIn));
    }
    go.disabled = plan.total <= 0 || this.busy || this.result !== null;
    go.addEventListener("click", () => void this.go());

    const rowB = el("div", "xfer-tray__row xfer-tray__row--act");
    if (phone) {
      rowB.append(controls, status);
      const rowC = el("div", "xfer-tray__row xfer-tray__row--go");
      rowC.append(go);
      tray.setContent(rowA, rowB, rowC);
    } else {
      rowB.append(controls, status, go);
      tray.setContent(rowA, rowB);
    }
    chips.scrollLeft = scrollLeft;
    // More chips than fit: the strip fades at its right edge until scrolled to the end.
    const fade = (): void => {
      chips.classList.toggle("is-more-right", chips.scrollLeft + chips.clientWidth < chips.scrollWidth - 4);
    };
    chips.addEventListener("scroll", fade, { passive: true });
    requestAnimationFrame(fade);
    tray.element.classList.toggle("is-busy", this.busy);
    // The map's tools sit above the tray while it is up.
    requestAnimationFrame(() => {
      if (this.tray !== tray) return;
      this.options.layer.style.setProperty("--xfer-tray-height", `${Math.round(tray.element.offsetHeight)}px`);
    });
  }

  /** One monster type in the tray: its picture and count, and the stepper behind the count. */
  private chip(id: string, src: readonly ArmyYard[], pool: readonly ArmyYard[], plan: MovePlan, state: MoveState): HTMLElement {
    const sizeOf = this.options.sizeOf;
    const pick = state.picks[id];
    const picked = pick !== undefined;
    const available = heldBy(state.mode === "out" ? src : state.ticks.length ? src : pool, id);
    const chip = el("div", "xfer-chip");
    chip.dataset["id"] = id;
    if (picked) chip.classList.add("is-on");

    const face = button("xfer-chip__face", `${monsterName(id)}: ${picked ? "picked, tap to drop" : "tap to pick all"}`);
    face.setAttribute("aria-pressed", String(picked));
    face.append(portrait(id, "xfer-chip__pic"));
    if (picked) face.append(el("i", "xfer-chip__check"));
    face.addEventListener("click", () => this.togglePick(id));

    if (this.stepping === id) {
      chip.classList.add("is-stepping");
      const now = pick === "all" ? available : Math.min(Number(pick ?? 0), available);
      const set = (n: number): void => {
        const latest = this.state;
        if (!latest) return;
        this.update({ picks: { ...latest.picks, [id]: Math.max(0, Math.min(n, available)) } });
      };
      const less = button("xfer-step", `Fewer ${monsterName(id)}`);
      less.textContent = "−";
      less.disabled = now <= 0;
      less.addEventListener("click", () => set(now - 1));
      const value = el("output", "xfer-step__n");
      value.append(el("b", "", formatAmount(now)), el("small", "", `/${formatAmount(available)}`));
      const more = button("xfer-step", `More ${monsterName(id)}`);
      more.textContent = "+";
      more.disabled = now >= available;
      more.addEventListener("click", () => set(now + 1));
      const ok = button("xfer-step xfer-step--ok", "Done");
      ok.append(el("i", "xfer-chip__check"));
      ok.addEventListener("click", () => {
        this.stepping = null;
        this.render();
      });
      chip.append(face, less, value, more, ok);
      return chip;
    }

    const count = button("xfer-chip__count", `How many ${monsterName(id)}`);
    if (picked) {
      // With yards ticked, the chip says how many really move (room can stop some).
      const moving = state.ticks.length ? (plan.moved[id] ?? 0) : pick === "all" ? available : Math.min(Number(pick), available);
      const n = el("b", moving === 0 && state.ticks.length ? "is-zero" : "", formatAmount(moving));
      count.append(n, el("small", "", `/${formatAmount(available)}`));
    } else {
      count.append(el("b", "", formatAmount(available)));
      const size = el("small", "xfer-chip__size");
      size.append(icon("housing", 16), document.createTextNode(String(sizeOf(id))));
      count.append(size);
    }
    count.addEventListener("click", () => {
      const latest = this.state;
      if (!latest) return;
      if (latest.picks[id] === undefined) this.state = { ...latest, picks: { ...latest.picks, [id]: "all" } };
      this.stepping = this.stepping === id ? null : id;
      this.render();
    });
    chip.append(face, count);
    return chip;
  }

  /* ── Go ───────────────────────────────────────────────────────────── */

  private async go(): Promise<void> {
    const state = this.state;
    const anchor = this.anchor;
    const current = this.plan();
    if (!state || !anchor || !current || current.plan.total <= 0 || this.busy) return;
    const { plan, src, dst } = current;
    const pairs = pairsOf(plan, state.mode, state.anchor);
    this.busy = true;
    this.stepping = null;
    this.list?.close();
    this.render();
    try {
      const answer = await this.options.send(pairs);
      if (this.state !== state) return;
      // The server's rosters, as it wrote them.
      for (const written of answer.yards) {
        const yard = this.byId.get(written.baseid);
        if (yard) this.byId.set(written.baseid, { ...yard, housed: written.housed, capacity: written.capacity });
      }
      this.yards = this.yards.map((yard) => this.byId.get(yard.baseid) ?? yard);
      this.options.onMoved(pairs.flatMap((pair) => [pair.from, pair.to]));
      this.busy = false;
      this.result = { add: plan.add, sub: plan.sub, total: plan.total };
      this.showResult(plan, src, dst, state.mode);
      this.render();
      this.resultTimer = setTimeout(() => this.end(), RESULT_MS);
    } catch (caught) {
      if (this.state !== state) return;
      this.busy = false;
      this.showToast([el("span", "xfer-toast__line", MOVE_TEXT.problem + messageOf(caught))], true, 6_000);
      // Read the yards again: something changed under the move.
      try {
        this.setYards(await this.options.load());
      } catch {
        // Keep what we had.
      }
      this.render();
    }
  }

  private showResult(plan: MovePlan, src: readonly ArmyYard[], dst: readonly ArmyYard[], mode: MoveMode): void {
    const line = el("span", "xfer-toast__line");
    const types = Object.keys(plan.moved)
      .sort((a, b) => (plan.moved[b] ?? 0) - (plan.moved[a] ?? 0))
      .slice(0, 4);
    for (const id of types) line.append(portrait(id, "xfer-toast__pic"));
    line.append(el("b", "", formatAmount(plan.total)), el("i", "xfer-go__arrow"));
    const targets = Object.keys(plan.add);
    if (mode === "out" && targets.length > 1) line.append(el("b", "", formatAmount(targets.length)), outpostIcon(24));
    else {
      const to = this.byId.get(targets[0] ?? "") ?? dst[0];
      line.append(el("span", "", to?.main ? MOVE_TEXT.home : to ? this.options.nameOf(to) : ""));
    }
    const sources = Object.keys(plan.sub);
    let sub: string =
      sources.length > 1 ? MOVE_TEXT.fromMany(sources.length) : MOVE_TEXT.fromOne(src[0] ? this.options.nameOf(src[0]) : "");
    if (plan.leftTotal > 0) sub += ` · ${MOVE_TEXT.didNotFit(plan.leftTotal)}`;
    this.showToast([line, el("small", "xfer-toast__sub", sub)], false, 4_500);
  }

  private showToast(lines: HTMLElement[], bad: boolean, ms = 4_000): void {
    if (!this.over.isConnected) this.options.layer.append(this.over);
    const toast = this.toast;
    toast.replaceChildren();
    const mark = el("i", bad ? "xfer-toast__mark is-bad" : "xfer-toast__mark");
    const body = el("span", "xfer-toast__body");
    body.append(...lines);
    toast.append(mark, body);
    toast.classList.toggle("is-bad", bad);
    toast.hidden = false;
    if (this.toastTimer) clearTimeout(this.toastTimer);
    this.toastTimer = null;
    if (ms > 0)
      this.toastTimer = setTimeout(() => {
        toast.hidden = true;
        if (!this.state) this.over.remove();
      }, ms);
  }

  /* ── The List window (200+ outposts) ──────────────────────────────── */

  private openList(): void {
    const state = this.state;
    const anchor = this.anchor;
    if (!state || !anchor || this.list) return;
    this.stepping = null;
    this.query = "";
    const popup = new Popup({
      title: state.mode === "out" ? MOVE_TEXT.listOut : MOVE_TEXT.listIn,
      className: "xfer-list",
      onClose: () => {
        this.list = null;
        this.listBody = null;
        this.options.layer.classList.remove("xfer-listing");
        this.render();
      },
    });
    popup.titlebar.querySelector("button")?.setAttribute("aria-label", MOVE_TEXT.closeList);

    const head = el("div", "xfer-list__head");
    const out = state.mode === "out";
    const near = button("btn btn--outline xfer-quick");
    if (out || !anchor.main) near.append(outpostIcon(24), el("span", "", MOVE_TEXT.near));
    else near.append(icon("townhall", 24), el("span", "", MOVE_TEXT.allHome));
    near.addEventListener("click", () => {
      const sizeOf = this.options.sizeOf;
      if (out) this.update({ ticks: nearestWithRoom(this.yards, anchor, sizeOf, this.smallest(), this.options.distance) });
      else if (anchor.main) {
        this.pickAll();
        this.update({ ticks: everySource(this.yards, anchor, sizeOf, this.options.distance) });
      } else this.update({ ticks: everySource(this.yards, anchor, sizeOf, this.options.distance).slice(0, 5) });
    });
    const all = button("btn btn--outline xfer-quick", out ? "Tick every yard with room" : "Tick every yard with monsters");
    all.append(el("i", "xfer-chip__check"), el("span", "", MOVE_TEXT.tickAll));
    all.addEventListener("click", () => {
      const sizeOf = this.options.sizeOf;
      const smallest = this.smallest();
      const ticks = othersByDistance(this.yards, anchor, this.options.distance)
        .filter((yard) => (out ? !yard.main : true) && canTick(yard, anchor, state.mode, sizeOf, smallest))
        .map((yard) => yard.baseid);
      this.update({ ticks });
    });
    const searchWrap = el("label", "xfer-list__search");
    searchWrap.append(icon("find", 24));
    const search = el("input", "xfer-list__input");
    search.type = "search";
    search.placeholder = MOVE_TEXT.search;
    search.autocomplete = "off";
    search.setAttribute("aria-label", MOVE_TEXT.search);
    search.addEventListener("input", () => {
      this.query = search.value;
      this.renderList();
    });
    searchWrap.append(search);
    head.append(near, all, searchWrap);
    popup.setHead(head);

    this.listBody = el("div", "xfer-list__rows");
    const foot = el("div", "xfer-list__foot");
    popup.setContent(this.listBody);
    popup.element.append(foot);
    this.list = popup;
    // One window at a time: the tray steps out of sight behind the List.
    this.options.layer.classList.add("xfer-listing");
    popup.mount(this.options.modal);
    this.renderList();
  }

  private renderList(): void {
    const state = this.state;
    const anchor = this.anchor;
    const popup = this.list;
    const body = this.listBody;
    const current = this.plan();
    if (!state || !anchor || !popup || !body || !current) return;
    const { plan } = current;
    const sizeOf = this.options.sizeOf;
    const out = state.mode === "out";
    const smallest = this.smallest();
    const phone = isPhoneLayout() && window.innerWidth <= 620;
    const keep = popup.body.scrollTop;

    const rows = othersByDistance(this.yards, anchor, this.options.distance).filter((yard) => {
      if (out && yard.main && anchor.main) return false;
      if (!matchesSearch(this.options.nameOf(yard), yard, this.query)) return false;
      return state.ticks.includes(yard.baseid) || canTick(yard, anchor, state.mode, sizeOf, smallest);
    });
    popup.setTitle(`${out ? MOVE_TEXT.listOut : MOVE_TEXT.listIn} · ${formatAmount(rows.length)}`);

    body.replaceChildren();
    for (const yard of rows) {
      const on = state.ticks.includes(yard.baseid);
      const gets = plan.add[yard.baseid];
      const gives = plan.sub[yard.baseid];
      const moving = (out ? gets : gives) ?? {};
      const delta = roomOf(gets, sizeOf) - roomOf(gives, sizeOf);
      const row = button("xfer-row", `${this.options.nameOf(yard)}${on ? ", ticked" : ""}`);
      row.setAttribute("aria-pressed", String(on));
      if (on) row.classList.add("is-on");
      if (on && countOf(moving) === 0) row.classList.add("is-idle");

      const box = el("span", "xfer-row__box");
      if (on) box.append(el("i", "xfer-chip__check"));
      const name = el("span", "xfer-row__name");
      name.append(el("b", "", this.options.nameOf(yard)));
      const far = el("small", "", MOVE_TEXT.hex(this.options.distance(anchor, yard)));
      if (yard.attack) far.append(icon("swords", 16));
      name.append(far);

      const mons = el("span", "xfer-row__mons");
      const types = rankTypes(yard, sizeOf, state.picks, moving);
      const shown = phone ? 2 : 3;
      if (types.length === 0) mons.append(el("span", "xfer-row__empty", MOVE_TEXT.empty));
      for (const id of types.slice(0, shown)) {
        const count = monsterCount(id, yard.housed[id] ?? 0);
        if (state.picks[id] !== undefined) count.classList.add("is-picked");
        mons.append(count);
      }
      if (types.length > shown) mons.append(moreDots(types.length - shown));

      const room = el("span", "xfer-row__room");
      room.append(roomBar(yard, sizeOf, delta));
      const free = Math.max(0, freeRoom(yard, sizeOf) - delta);
      const word = el("b", free < smallest ? "is-full" : "");
      word.append(icon("housing", 16), document.createTextNode(free < smallest ? MOVE_TEXT.full : formatAmount(free)));
      room.append(word);

      const preview = el("span", "xfer-row__tag");
      const n = countOf(moving);
      if (n > 0) {
        const tag = el("span", `xfer-tag xfer-tag--inline ${out ? "xfer-tag--add" : "xfer-tag--sub"}`);
        tag.append(el("b", "", `${out ? "+" : "−"}${formatAmount(n)}`), ...tagPictures(moving));
        preview.append(tag);
      }
      // A phone has no room for a tag column: it rides on the name's line.
      if (phone) name.querySelector("small")?.append(...preview.childNodes);
      row.append(box, name, mons, room, preview);
      row.addEventListener("click", () => this.toggle(yard.baseid));
      body.append(row);
    }
    if (rows.length === 0)
      body.append(el("p", "xfer-list__none", this.query ? "No yard matches." : out ? "No yard has room." : "No yard has monsters."));
    popup.body.scrollTop = keep;

    const foot = popup.element.querySelector<HTMLElement>(".xfer-list__foot");
    if (foot) {
      foot.replaceChildren();
      const status = el("span", "xfer-status__item");
      status.append(el("b", "", formatAmount(state.ticks.length)), outpostIcon(24));
      const total = el("span", "xfer-status__item");
      if (plan.total > 0) total.append(...tagPictures(plan.moved), el("b", "", formatAmount(plan.total)));
      const done = button("btn btn--primary xfer-done");
      done.append(el("span", "", MOVE_TEXT.done));
      done.addEventListener("click", () => popup.close());
      foot.append(status, total, done);
      // A phone on its side: the rows get the height; Done joins the search line.
      const short = window.innerHeight <= 500;
      foot.hidden = short;
      const head = popup.element.querySelector<HTMLElement>(".xfer-list__head");
      head?.querySelector(".xfer-done")?.remove();
      if (short && head) {
        const headDone = button("btn btn--primary xfer-done");
        headDone.append(el("span", "", MOVE_TEXT.done));
        headDone.addEventListener("click", () => popup.close());
        head.append(headDone);
      }
    }
  }
}

const messageOf = (caught: unknown): string => {
  if ((caught as { name?: unknown } | null)?.name === "NetworkError") return "the server could not be reached.";
  return caught instanceof Error && caught.message ? caught.message : "something went wrong.";
};
