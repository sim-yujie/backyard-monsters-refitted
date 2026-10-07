import { CellType, isFogCell, isPlayerCell, isWaterCell, type MapCell, type PlayerCell } from "@/api/types";
import { devDetails } from "@/app/devDetails";
import { avatarOf, avatarUrl } from "@/game/avatars";
import type { OffsetCell } from "@/game/HexGrid";
import { cellsText } from "@/game/maproom/attackRange";
import { TRIBE_COLOURS } from "@/game/maproom/cellVisuals";
import { tribePictureUrl } from "@/game/maproom/tribeAvatars";
import { button, el, icon, type IconName } from "@/ui/maproom1/icons";
import { icon as lineIcon } from "@/ui/icons";

/**
 * The map's cell panel, slimmed to what a player decides with (issue #174,
 * the approved R-MR2-Panel board).
 *
 * A picture, a name and level, what the cell is and where, whether it is in
 * range, and the actions: Attack, then look inside and bookmark. Everything
 * else that used to be a row is either a chip that appears only when it is
 * true (damaged, destroyed, protected, a truce, busy) or sits behind "More
 * about this yard" (empire value, alliance, Flinger and Catapult levels). The
 * axial coordinates, terrain height, base id, the avatar's web address,
 * hatchery data, the four resource lines and the user id are gone.
 *
 * On the player's own yard it shows how far its Flinger reaches, with the
 * switch that draws that range on the map (#177), and Open yard.
 */

export interface CellPanelOptions {
  onClose: () => void;
  onBookmark: (cell: OffsetCell) => void;
  /** Whether "Bookmark" should be offered for this cell. */
  canBookmark: () => boolean;
  /**
   * Opens the yard screen on the shown cell: the player's own yard editable,
   * anyone else's — a wild monster camp included — read-only
   * (`docs/design/attack-flow.md` §F1, Open Question 7).
   */
  onViewYard: () => void;
  /**
   * Why Attack is not offered on this cell, or null when it is
   * (`game/attack/attackEntry.ts`, `attackRefusal`). Asked again on every
   * `show` and `update`, since the answer moves with the zone data and the
   * player's own roster.
   */
  attackRefusal: (payload: MapCell | undefined) => string | null;
  /** Starts an attack on the shown cell. Only called while enabled. */
  onAttack: () => void;
  /**
   * "In range · 4 cells from your yard" or "Out of range · 2 cells too far"
   * for a cell (`attackRange.ts`, `reachText`), or null to show no chip.
   */
  reach: (cell: OffsetCell) => { text: string; inRange: boolean } | null;
  /** The Flinger of one of the player's own cells, for its range line. */
  ownFlinger: (cell: OffsetCell, payload: PlayerCell) => OwnFlinger;
  /** "My range" was switched from the panel (#177). */
  onRangeToggle: (on: boolean) => void;
  /**
   * Which moves between yards an own cell offers (outposts WP7, #186): Move
   * monsters needs an outpost to move them to or from; Move main yard here
   * is an own outpost's alone. Absent: neither.
   */
  ownMoves?: (cell: OffsetCell, payload: PlayerCell) => OwnMoves;
  onMoveMonsters?: (cell: OffsetCell, payload: PlayerCell) => void;
  onRelocate?: (cell: OffsetCell, payload: PlayerCell) => void;
  /** Writes to another player's yard's owner (#193). Absent: no Message button. */
  onMessage?: (payload: PlayerCell) => void;
  /**
   * Proposes a truce to another player's yard's owner (#203). Absent: no
   * Truce button. Not offered while a truce with them runs.
   */
  onTruce?: (payload: PlayerCell) => void;
  /**
   * The player's own outpost: invites a player to move their main yard onto
   * it (#205). Absent: no Invite button. Once an invitation waits there
   * (`payload.pi`), the button withdraws it instead (`onWithdrawInvite`).
   */
  onInvite?: (cell: OffsetCell, payload: PlayerCell) => void;
  onWithdrawInvite?: (cell: OffsetCell, payload: PlayerCell) => void;
  /**
   * Another player's yard: invites its owner to move onto one of the player's
   * outposts (#205). Offered only when `canInviteToOutpost` says so (the
   * player has an outpost, and the owner no alliance).
   */
  onInviteToOutpost?: (payload: PlayerCell) => void;
  canInviteToOutpost?: (payload: PlayerCell) => boolean;
  /**
   * Actions that sit under Attack, each bringing its own line under the
   * actions: Repeat attack (`AutoAttackControl`, issue #221) and Take over
   * (`TakeoverControl`, issue #82), in the order given. Each is told about
   * every show and update and decides for itself what to show.
   */
  extraAction?: CellPanelAction | readonly CellPanelAction[];
  /**
   * Another player's achievements line, last in "More about this yard"
   * (#204, `ui/achievements/AchievementsLine.ts`). Made only once that
   * section is open, so a closed one costs no fetch. Absent: no line.
   */
  achievementsLine?: (payload: PlayerCell) => HTMLElement;
}

/** How far one of the player's own cells flings. */
export interface OwnFlinger {
  /** The Flinger's level. */
  readonly level: number;
  /** Cells it reaches, Declare War included while it runs. */
  readonly reach: number;
  /** Cells of that from Declare War. */
  readonly bonus: number;
}

/** The moves between yards an own cell offers; see `CellPanelOptions.ownMoves`. */
export interface OwnMoves {
  readonly monsters: boolean;
  readonly relocate: boolean;
}

/** An action the panel hosts without knowing what it does. */
export interface CellPanelAction {
  /** Placed under Attack. */
  readonly button: HTMLElement;
  /** Placed under the actions. */
  readonly detail: HTMLElement;
  /** Placed last among the chips, when present: a countdown, say. */
  readonly chip?: HTMLElement;
  setCell(cell: OffsetCell, payload: MapCell | undefined): void;
  tick(nowSeconds: number): void;
}

const ATTACK_READY = "Open this yard and attack it.";

/** What "View yard" does on each kind of cell, or why it cannot. */
const VIEW_OWN = "Open your yard";
const VIEW_OWN_OUTPOST = "Open your outpost";
const VIEW_OTHER = "Look around this yard. Nothing can be changed from here.";
const VIEW_LOADING = "Waiting for this zone to load.";

let panelIds = 0;

export class CellPanel {
  readonly element: HTMLElement;

  private readonly options: CellPanelOptions;
  /** {@link CellPanelOptions.extraAction}, as a list. */
  private readonly extras: readonly CellPanelAction[];
  private readonly picture: HTMLElement;
  private readonly title: HTMLElement;
  private readonly level: HTMLElement;
  private readonly subtitle: HTMLElement;
  private readonly chips: HTMLElement;
  private readonly flinger: HTMLElement;
  private readonly flingerTitle: HTMLElement;
  private readonly flingerDetail: HTMLElement;
  private readonly rangeSwitch: HTMLButtonElement;
  private readonly attackButton: HTMLButtonElement;
  private readonly attackNote: HTMLElement;
  private readonly openButton: HTMLButtonElement;
  /** Move monsters and Move main yard here, under Open yard (#186). */
  private readonly moves: HTMLElement;
  private readonly moveMonstersButton: HTMLButtonElement;
  private readonly relocateButton: HTMLButtonElement;
  private readonly secondary: HTMLElement;
  /** Message and Truce, a row of their own under View yard (#203): four buttons do not fit one. */
  private readonly social: HTMLElement;
  private readonly viewYardButton: HTMLButtonElement;
  private readonly viewYardLabel: HTMLElement;
  private readonly bookmarkButton: HTMLButtonElement;
  /** Message, on another player's yard (#193), in a row with Truce. */
  private readonly messageButton: HTMLButtonElement;
  /** Truce, beside Message, while no truce with the owner runs (#203). */
  private readonly truceButton: HTMLButtonElement;
  /** On the player's own outpost, with the moves: invite a player here, or withdraw the invitation (#205). */
  private readonly inviteButton: HTMLButtonElement;
  private readonly inviteLabel: HTMLElement;
  /** On another player's yard, a row of its own: invite them to one of the player's outposts (#205). */
  private readonly inviteRow: HTMLElement;
  private readonly inviteToOutpostButton: HTMLButtonElement;
  private readonly more: HTMLDetailsElement;
  private readonly facts: HTMLDListElement;
  /** Under the facts: another player's achievements line (#204). */
  private readonly achievementsSlot: HTMLElement;
  /** The other player's cell the slot is for, or null. */
  private achievementsOf: PlayerCell | null = null;

  private cell: OffsetCell | null = null;
  private payload: MapCell | undefined;
  private rangeOn = false;
  private closed = false;
  /** Countdown chips, refreshed once a second by `tick`. */
  private countdowns: { node: HTMLElement; label: string; expiresAt: number }[] = [];

  constructor(options: CellPanelOptions) {
    this.options = options;
    const extra = options.extraAction;
    this.extras = extra === undefined ? [] : "button" in extra ? [extra] : [...extra];

    const titleId = `cell-panel-${++panelIds}`;
    this.element = el("section", "panel mr2-cell");
    this.element.setAttribute("aria-labelledby", titleId);

    const grip = el("div", "mr2-cell__grip");
    grip.setAttribute("aria-hidden", "true");

    this.picture = el("span", "mr2-cell__picture");
    this.title = el("h2", "mr2-cell__title");
    this.title.id = titleId;
    this.level = el("span", "mr2-cell__level");
    this.subtitle = el("div", "mr2-cell__subtitle");
    const nameLine = el("div", "mr2-cell__nameline");
    nameLine.append(this.title, this.level);
    const titles = el("div", "mr2-cell__titles");
    titles.append(nameLine, this.subtitle);
    const close = button("mr2-cell__close");
    close.setAttribute("aria-label", "Close");
    close.append(icon("close", 18, "map-icon"));
    close.addEventListener("click", () => this.close());
    const head = el("header", "mr2-cell__head");
    head.append(this.picture, titles, close);

    this.chips = el("div", "mr2-cell__chips");

    this.flingerTitle = el("span", "mr2-cell__flinger-title");
    this.flingerDetail = el("span", "mr2-cell__flinger-detail");
    const flingerText = el("div", "mr2-cell__flinger-text");
    flingerText.append(this.flingerTitle, this.flingerDetail);
    this.rangeSwitch = button("mr2-switch");
    this.rangeSwitch.setAttribute("role", "switch");
    this.rangeSwitch.setAttribute("aria-label", "Show my attack range on the map");
    this.rangeSwitch.append(el("span", "mr2-switch__track"), el("span", "mr2-switch__text", "Show"));
    this.rangeSwitch.addEventListener("click", () => {
      this.setRangeOn(!this.rangeOn);
      options.onRangeToggle(this.rangeOn);
    });
    this.flinger = el("div", "mr2-cell__flinger");
    this.flinger.append(icon("range", 22, "map-icon mr2-cell__flinger-icon"), flingerText, this.rangeSwitch);

    this.attackButton = button("btn btn--primary mr2-cell__primary");
    this.attackButton.append(icon("attack", 20, "map-icon"), el("span", "", "Attack"));
    this.attackButton.addEventListener("click", () => {
      if (!this.attackButton.disabled) options.onAttack();
    });
    this.attackNote = el("p", "mr2-cell__note");

    this.openButton = button("btn btn--primary mr2-cell__primary");
    this.openButton.append(icon("home", 20, "map-icon"), el("span", "", "Open yard"));
    this.openButton.addEventListener("click", () => options.onViewYard());

    this.viewYardLabel = el("span", "", "View yard");
    this.viewYardButton = button("btn btn--outline mr2-cell__secondary");
    this.viewYardButton.append(icon("eye", 18, "map-icon"), this.viewYardLabel);
    this.viewYardButton.addEventListener("click", () => options.onViewYard());

    this.bookmarkButton = button("btn btn--outline mr2-cell__bookmark");
    this.bookmarkButton.setAttribute("aria-label", "Bookmark");
    this.bookmarkButton.title = "Bookmark this cell";
    this.bookmarkButton.append(icon("bookmark", 18, "map-icon"));
    this.bookmarkButton.addEventListener("click", () => {
      if (this.cell) options.onBookmark(this.cell);
    });

    this.messageButton = button("btn btn--outline mr2-cell__secondary mr2-cell__message");
    this.messageButton.append(lineIcon("mail", 18, "map-icon"), el("span", "", "Message"));
    this.messageButton.title = "Write to this yard's owner";
    this.messageButton.hidden = true;
    this.messageButton.addEventListener("click", () => {
      if (this.payload && isPlayerCell(this.payload)) options.onMessage?.(this.payload);
    });

    this.truceButton = button("btn btn--outline mr2-cell__secondary mr2-cell__truce");
    this.truceButton.append(icon("truce", 18, "map-icon"), el("span", "", "Truce"));
    this.truceButton.title = "Propose a truce to this yard's owner";
    this.truceButton.hidden = true;
    this.truceButton.addEventListener("click", () => {
      if (this.payload && isPlayerCell(this.payload)) options.onTruce?.(this.payload);
    });

    this.secondary = el("div", "mr2-cell__row");
    this.secondary.append(this.viewYardButton, this.bookmarkButton);
    this.social = el("div", "mr2-cell__row");
    this.social.append(this.messageButton, this.truceButton);

    this.moveMonstersButton = button("btn btn--outline mr2-cell__secondary mr2-cell__move");
    this.moveMonstersButton.append(icon("swap", 18, "map-icon"), el("span", "", "Move monsters"));
    this.moveMonstersButton.title = "Move monsters between this yard and another of yours.";
    this.moveMonstersButton.addEventListener("click", () => {
      if (this.cell && this.payload && isPlayerCell(this.payload)) options.onMoveMonsters?.(this.cell, this.payload);
    });
    this.relocateButton = button("btn btn--outline mr2-cell__secondary mr2-cell__move");
    this.relocateButton.append(icon("home", 18, "map-icon"), el("span", "", "Move main yard here"));
    this.relocateButton.title = "Move your main yard onto this outpost.";
    this.relocateButton.addEventListener("click", () => {
      if (this.cell && this.payload && isPlayerCell(this.payload)) options.onRelocate?.(this.cell, this.payload);
    });
    this.inviteLabel = el("span", "", "Invite to move here");
    this.inviteButton = button("btn btn--outline mr2-cell__secondary mr2-cell__move mr2-cell__invite");
    this.inviteButton.append(lineIcon("mail", 18, "map-icon"), this.inviteLabel);
    this.inviteButton.addEventListener("click", () => {
      if (!this.cell || !this.payload || !isPlayerCell(this.payload)) return;
      if (this.payload.pi > 0) options.onWithdrawInvite?.(this.cell, this.payload);
      else options.onInvite?.(this.cell, this.payload);
    });
    this.moves = el("div", "mr2-cell__row mr2-cell__row--wrap");
    this.moves.append(this.moveMonstersButton, this.relocateButton, this.inviteButton);

    this.inviteToOutpostButton = button("btn btn--outline mr2-cell__secondary mr2-cell__invite-other");
    this.inviteToOutpostButton.append(lineIcon("mail", 18, "map-icon"), el("span", "", "Invite to my outpost"));
    this.inviteToOutpostButton.title = "Invite this player to move their main yard onto one of your outposts";
    this.inviteToOutpostButton.addEventListener("click", () => {
      if (this.payload && isPlayerCell(this.payload)) options.onInviteToOutpost?.(this.payload);
    });
    this.inviteRow = el("div", "mr2-cell__row");
    this.inviteRow.append(this.inviteToOutpostButton);

    const actions = el("div", "mr2-cell__actions");
    actions.append(this.attackButton, this.openButton);
    for (const action of this.extras) actions.append(action.button);
    actions.append(this.secondary, this.social, this.inviteRow, this.moves);

    this.facts = document.createElement("dl");
    this.facts.className = "cell-facts mr2-cell__facts";
    const summary = document.createElement("summary");
    summary.className = "mr2-cell__more-toggle";
    summary.append(icon("chevronRight", 14, "map-icon mr2-cell__more-icon"), "More about this yard");
    this.more = document.createElement("details");
    this.more.className = "mr2-cell__more";
    this.achievementsSlot = el("div", "mr2-cell__achievements");
    this.more.append(summary, this.facts, this.achievementsSlot);
    this.more.addEventListener("toggle", () => this.syncAchievements());

    this.element.append(
      grip,
      head,
      this.chips,
      this.flinger,
      actions,
      this.attackNote,
      ...this.extras.map((action) => action.detail),
      this.more,
    );
    this.element.addEventListener("keydown", (event) => {
      if (event.key !== "Escape") return;
      event.stopPropagation();
      this.close();
    });
  }

  /** Shows a cell. `payload` is undefined while its zone is still loading. */
  show(cell: OffsetCell, payload: MapCell | undefined): void {
    const moved = this.cell?.col !== cell.col || this.cell?.row !== cell.row;
    this.cell = cell;
    if (moved) this.more.open = false;
    this.update(payload);
  }

  /** Re-renders with fresh payload, keeping the panel where it is. */
  update(payload: MapCell | undefined): void {
    const cell = this.cell;
    if (!cell) return;
    this.payload = payload;
    for (const action of this.extras) action.setCell(cell, payload);
    this.render(cell, payload);
    this.syncAchievements();
    for (const action of this.extras) if (action.chip) this.chips.append(action.chip);
  }

  /** Keeps the flinger line's switch in step with "My range" (#177). */
  setRangeOn(on: boolean): void {
    this.rangeOn = on;
    this.rangeSwitch.setAttribute("aria-checked", String(on));
  }

  get shownCell(): OffsetCell | null {
    return this.cell;
  }

  /** Advances the countdowns. Called once a second by the scene. */
  tick(nowSeconds: number): void {
    for (const entry of this.countdowns) {
      entry.node.textContent = `${entry.label} ${formatCountdown(entry.expiresAt - nowSeconds)}`;
    }
    for (const action of this.extras) action.tick(nowSeconds);
  }

  mount(container: HTMLElement): this {
    container.append(this.element);
    return this;
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    this.element.remove();
    this.options.onClose();
  }

  private render(cell: OffsetCell, payload: MapCell | undefined): void {
    const where = `${cell.col}, ${cell.row}`;
    this.chips.replaceChildren();
    this.facts.replaceChildren();
    this.countdowns = [];
    this.flinger.hidden = true;
    this.more.hidden = true;
    this.attackNote.hidden = true;
    this.achievementsOf = null;

    if (!payload) {
      this.setHead({ kind: "loading" }, "Loading…", "", where);
      this.setActions("none");
      return;
    }

    if (isWaterCell(payload)) {
      this.setHead({ kind: "water" }, "Water", "", `No yard on water · ${where}`);
      this.setActions("bookmark");
      return;
    }

    // Fog of war (issue #330, `docs/design/fog-of-war.md` §8): nothing was
    // sent about this cell, so nothing here but where it is and that it can
    // still be bookmarked. The clouds and sight-edge feather are #331.
    if (isFogCell(payload)) {
      this.setHead({ kind: "fog" }, "Covered in fog", "", `Outside your flingers' reach · ${where}`);
      this.setActions("bookmark");
      return;
    }

    if (isPlayerCell(payload)) {
      this.renderPlayer(cell, payload, where);
      return;
    }

    const tribe = payload.n;
    this.setHead(
      { kind: "tribe", tribe, faded: payload.d === 1 },
      `${tribe} camp`,
      `Level ${payload.l}`,
      `Wild monsters · ${where}`,
    );
    this.addReach(cell);
    this.addDamage(payload.dm, payload.d === 1);
    this.setActions("attack", "Look inside");
  }

  private renderPlayer(cell: OffsetCell, payload: PlayerCell, where: string): void {
    const outpost = payload.b === CellType.OUTPOST;
    const mine = payload.mine === 1;
    const kind = outpost ? "Outpost" : "Main yard";
    this.setHead(
      { kind: "player", picture: payload.pic_square, uid: payload.uid, mine },
      mine ? (outpost ? "Your outpost" : "Your yard") : payload.n,
      `Level ${payload.l}`,
      `${kind} · ${where}`,
    );

    if (mine) {
      this.renderFlinger(this.options.ownFlinger(cell, payload));
      this.openButton.lastElementChild!.textContent = outpost ? "Open outpost" : "Open yard";
      this.openButton.title = outpost ? VIEW_OWN_OUTPOST : VIEW_OWN;
      this.setActions("open");
      const moves = this.options.ownMoves?.(cell, payload) ?? { monsters: false, relocate: false };
      this.moveMonstersButton.hidden = !moves.monsters;
      this.relocateButton.hidden = !moves.relocate;
      // Invite is an own outpost's, as Flash's `bInviteMigrate` was (`PopupInfoMine.as:171`).
      const pending = outpost && payload.pi > 0;
      this.inviteButton.hidden = !outpost || this.options.onInvite === undefined;
      this.inviteLabel.textContent = pending ? "Withdraw invite" : "Invite to move here";
      this.inviteButton.title = pending
        ? "Withdraw the invitation waiting on this outpost."
        : "Invite a player to move their main yard here. It replaces this outpost.";
      this.moves.hidden = !moves.monsters && !moves.relocate && this.inviteButton.hidden;
      if (pending) {
        this.addChip("clock", "Invite pending", "info", "A player is invited to move their main yard here.");
      }
    } else {
      this.addReach(cell);
      this.setActions("attack", "View yard");
      this.messageButton.hidden = this.options.onMessage === undefined;
      this.truceButton.hidden =
        this.options.onTruce === undefined || (payload.t !== undefined && payload.t > Date.now() / 1000);
      this.social.hidden = this.messageButton.hidden && this.truceButton.hidden;
      this.inviteRow.hidden =
        this.options.onInviteToOutpost === undefined || !(this.options.canInviteToOutpost?.(payload) ?? true);
      this.achievementsOf = payload;
    }

    this.addDamage(payload.dm, payload.d === 1);
    if (payload.p === 1) {
      // The end, when the server sends it (#187); a bare "Protected" otherwise.
      if (payload.pe !== undefined && payload.pe > Date.now() / 1000) {
        this.addCountdown("shield", "Protected", payload.pe, "Under damage protection until it runs out.");
      } else {
        this.addChip("shield", "Protected", "info", "Under damage protection.");
      }
    }
    if (payload.t !== undefined && payload.t > Date.now() / 1000) {
      this.addCountdown("truce", "Truce", payload.t);
    }
    if (payload.lo !== 0) {
      this.addChip(
        "clock",
        "Busy",
        "info",
        "Its owner is online, or someone is attacking it right now.",
      );
    }

    this.more.hidden = false;
    this.addFact("Empire value", payload.v.toLocaleString());
    // The cell names no alliance, only its id, which says nothing to a player (#150).
    if (payload.aid !== null && devDetails()) this.addFact("Alliance", `#${payload.aid}`);
    this.addFact("Flinger", `Level ${payload.f}`);
    this.addFact("Catapult", `Level ${payload.c}`);
  }

  /**
   * Puts the shown player's achievements line under the facts once "More
   * about this yard" is open, and keeps it while the same player stays shown.
   */
  private syncAchievements(): void {
    const payload = this.achievementsOf;
    const make = this.options.achievementsLine;
    this.achievementsSlot.hidden = !payload || !make;
    if (!payload || !make) {
      this.achievementsSlot.replaceChildren();
      delete this.achievementsSlot.dataset["uid"];
      return;
    }
    if (!this.more.open) return;
    const uid = String(payload.uid);
    if (this.achievementsSlot.dataset["uid"] === uid && this.achievementsSlot.firstChild) return;
    this.achievementsSlot.dataset["uid"] = uid;
    this.achievementsSlot.replaceChildren(make(payload));
  }

  /** The own-yard line: how far the Flinger reaches, and the range switch. */
  private renderFlinger(flinger: OwnFlinger): void {
    this.flinger.hidden = false;
    if (flinger.reach === 0) {
      this.flingerTitle.textContent = "Your Flinger reaches nothing yet";
      this.flingerDetail.textContent =
        flinger.level > 0 ? `Flinger level ${flinger.level}` : "Build a Flinger here to attack from it";
    } else {
      this.flingerTitle.textContent = `Your Flinger reaches ${cellsText(flinger.reach)}`;
      this.flingerDetail.textContent =
        flinger.bonus > 0
          ? `Flinger level ${flinger.level} (${flinger.reach - flinger.bonus}) + ${flinger.bonus} Declare War bonus`
          : `Flinger level ${flinger.level}`;
    }
  }

  private setHead(
    picture:
      | { kind: "loading" | "water" | "fog" }
      | { kind: "tribe"; tribe: string; faded: boolean }
      | { kind: "player"; picture: string | null; uid: number; mine: boolean },
    title: string,
    level: string,
    subtitle: string,
  ): void {
    this.title.textContent = title;
    this.level.textContent = level;
    this.level.hidden = level === "";
    this.subtitle.textContent = subtitle;

    this.picture.className = `mr2-cell__picture mr2-cell__picture--${picture.kind}`;
    this.picture.style.removeProperty("--ring");
    this.picture.replaceChildren();
    if (picture.kind === "tribe") {
      const colour = TRIBE_COLOURS[picture.tribe];
      if (colour !== undefined) this.picture.style.setProperty("--ring", hexToCss(colour));
      this.picture.classList.toggle("mr2-cell__picture--faded", picture.faded);
      const url = tribePictureUrl(picture.tribe);
      if (url) this.picture.append(image(url));
    } else if (picture.kind === "player") {
      this.picture.classList.toggle("mr2-cell__picture--mine", picture.mine);
      this.picture.append(image(avatarUrl(avatarOf(picture.picture, picture.uid))));
    }
  }

  /**
   * Which buttons show: Attack with a way to look inside and a bookmark, the
   * player's own Open yard, a bookmark alone (water) or nothing (loading).
   */
  private setActions(kind: "attack" | "open" | "bookmark" | "none", viewLabel = "View yard"): void {
    const attack = kind === "attack";
    this.attackButton.hidden = !attack;
    this.openButton.hidden = kind !== "open";
    this.moves.hidden = true;
    this.secondary.hidden = !(attack || kind === "bookmark");
    this.viewYardButton.hidden = !attack;
    this.messageButton.hidden = true;
    this.truceButton.hidden = true;
    this.social.hidden = true;
    this.inviteRow.hidden = true;
    this.viewYardLabel.textContent = viewLabel;
    this.viewYardButton.title = kind === "none" ? VIEW_LOADING : VIEW_OTHER;
    this.bookmarkButton.disabled = !this.options.canBookmark();

    if (attack) {
      const refusal = this.options.attackRefusal(this.payload);
      this.attackButton.disabled = refusal !== null;
      this.attackButton.title = refusal ?? ATTACK_READY;
      // `title` alone is not exposed on a disabled control in every browser.
      this.attackButton.setAttribute("aria-label", `Attack. ${refusal ?? ATTACK_READY}`);
      // Out of range already has its chip; anything else is said once, here.
      const saidByChip = this.chips.querySelector(".mr2-chip--warning") !== null;
      this.attackNote.hidden = refusal === null || saidByChip;
      this.attackNote.textContent = refusal ?? "";
    }
  }

  private addReach(cell: OffsetCell): void {
    const reach = this.options.reach(cell);
    if (!reach) return;
    this.addChip("range", reach.text, reach.inRange ? "accent" : "warning");
  }

  private addDamage(damage: number, destroyed: boolean): void {
    if (destroyed) this.addChip("alert", "Destroyed", "danger");
    else if (damage > 0) this.addChip("alert", `Damaged ${damage}%`, "danger");
  }

  private addChip(
    name: IconName,
    text: string,
    tone: "accent" | "warning" | "danger" | "info",
    title?: string,
  ): HTMLElement {
    const chip = el("span", `mr2-chip mr2-chip--${tone}`);
    const label = el("span", "", text);
    chip.append(icon(name, 16, "map-icon"), label);
    if (title) chip.title = title;
    this.chips.append(chip);
    return label;
  }

  private addCountdown(
    name: IconName,
    label: string,
    expiresAt: number,
    title = "No attacks either way until it runs out.",
  ): void {
    const node = this.addChip(name, "", "info", title);
    this.countdowns.push({ node, label, expiresAt });
    node.textContent = `${label} ${formatCountdown(expiresAt - Date.now() / 1000)}`;
  }

  private addFact(label: string, value: string): void {
    const term = document.createElement("dt");
    term.textContent = label;
    const definition = document.createElement("dd");
    definition.textContent = value;
    this.facts.append(term, definition);
  }
}

const image = (url: string): HTMLImageElement => {
  const picture = document.createElement("img");
  picture.src = url;
  picture.alt = "";
  picture.decoding = "async";
  return picture;
};

/** Seconds remaining as a compact duration, or "Expired". */
const formatCountdown = (seconds: number): string => {
  if (seconds <= 0) return "expired";
  const days = Math.floor(seconds / 86_400);
  const hours = Math.floor((seconds % 86_400) / 3_600);
  const minutes = Math.floor((seconds % 3_600) / 60);
  const rest = Math.floor(seconds % 60);
  if (days > 0) return `${days}d ${hours}h`;
  if (hours > 0) return `${hours}h ${minutes}m`;
  if (minutes > 0) return `${minutes}m ${rest}s`;
  return `${rest}s`;
};

const hexToCss = (colour: number): string => `#${colour.toString(16).padStart(6, "0")}`;
