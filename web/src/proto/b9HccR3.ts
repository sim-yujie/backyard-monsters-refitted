/**
 * DESIGN PROTOTYPE ONLY (b9 round 3, never merged): the Hatchery Control
 * Centre at levels 2 and 3 on the Hatch tab, with fake data.
 *
 * Owner, 22 Nov 2026: round 2's D "workbench" (hatcheries, the rack of ten
 * stacks, all on the page), plus presets behind a two-tab switch
 * "Monsters | Presets" in the strip between the rack and the monsters.
 *
 * URL: `b9hcc=2|3`, `b9hccopt=r3`, `b9state=` a comma list of
 *   `presets`  the Presets tab is open
 *   `empty`    no preset is filled yet;  `filled`  every slot is filled
 *   `edit`     a preset is being built (slot 1)
 *   `sent`     preset 1 was just sent (with `room`: part of it fitted)
 *   `room`     the queue has two free stacks (it is full without)
 *   `remote`   an outpost run from home (level 3);  `yards`  the yard page
 *   `housing`  the tab's own housing box is open
 *   `live`     round 3's edit view: the hatcheries and the queue stay on show while a preset is built
 *
 * - Presets are numbered, never named. Round 5 (owner, 22 Nov): 2 slots at level 1, 4 at level 2,
 *   6 at level 3. Level 1 is today's HCC (7 stacks of 20) plus its two presets (`b9hcc=1`).
 * - Round 5: a preset is built in the SAME box grid as the queue (one box = one queue stack), so
 *   the empty boxes say how much room is left; Undo takes the last box off.
 * - Round 5: a preset row's stacks scroll sideways (no "+N"); Send and the cost stay put.
 * - Round 5: on a wide screen the free room beside the queue holds a quick-send rail, one small
 *   Send per preset, on either tab; what a Send did is said in the switch's row.
 * - A preset is made only here: tap a slot, pick monsters and counts.
 * - Round 4 (owner, 22 Nov): a preset is a SEQUENCE of stacks, kept in the order they were
 *   added, and the same monster may come back later ("30 Pokey > 40 Octo-ooze > 30 Pokey").
 *   The count works on the LAST stack: the last stack's own monster adds to it, any other
 *   monster starts a new stack at the end. No reordering; the last stack can be taken off.
 * - Round 4: while a preset is built the hatcheries, the queue and the housing are hidden
 *   (they pulled the eye away); only the preset being built shows above the monsters.
 * - A preset holds what the queue holds: at most ten queue stacks.
 * - A monster that is locked when the preset is sent is skipped, with a short note.
 * - Send adds the preset to the END of the queue; when the queue or the goo
 *   runs out it adds what fits and says how many ("Added 82 of 140").
 * - Level 3 keeps two lists: the main yard's, and one shared by every outpost.
 * - Round 6 (owner, 22 Nov): nothing in the Hatch tab moves when the level changes or when an
 *   outpost is shown. The yard switcher is the same control at every level (greyed with a lock
 *   below level 3), there is no extra home button in an outpost, the hatchery row keeps five
 *   places, level 1's queue shows its three missing boxes locked, the Presets tab always wears
 *   its list's icon.
 * - Round 6 (owner, 22 Nov): round 5's quick-send rail is gone from the Hatch row; on a wide
 *   screen its width goes to bigger hatcheries and bigger queue boxes across the whole row.
 *   Presets are sent from the Presets tab only.
 */
import { HCC_STACKS, type HatchYard, type QueueStack, academyLevels, priceOf, spaceOf } from "@/game/monsters/hatchPlan";
import { monsterEntry } from "@/game/monsters/monsterCatalogue";
import { classicLook } from "@/game/classicLook";
import { gameIcon, type GameIconName } from "@/ui/gameIcon";
import { lockArt } from "@/ui/lockArt";
import { resourceIcon } from "@/ui/resourceIcon";
import { monsterPicture } from "@/ui/monsters/LockerTab";
import { ownYardsOf } from "@/game/yard/ownYards";
import { outpostLabels } from "@/game/yard/outpostLabels";
import type { BaseLoadResponse } from "@/api/types";
import { b9, b9HccLevel } from "./b9";
import "./b9-hcc-r2.css";
import "./b9-hcc-r3.css";

const states = (): Set<string> => new Set((b9("b9state") ?? "").split(",").filter(Boolean));

/** The outpost with no HCC of its own in yardtester's copy. */
const NO_HCC = new Set(["22913802238208"]);

/** The stacks in the order they were added; the same monster may come back, never twice in a row. */
type Preset = [id: string, count: number][];
/** Rezghul: locked in yardtester's copy, so preset 5 shows a locked monster being skipped. */
const LOCKED = "C19";
type Scope = "main" | "outposts";

const MAIN_PRESETS: readonly Preset[] = [
  [["C1", 30], ["C2", 40], ["C1", 30]],
  [["C12", 40], ["C5", 40], ["C12", 20]],
  // A long one (eight queue stacks at either level; `long()` sizes it): its row scrolls sideways.
  [],
  [["C6", 100], ["C9", 40]],
  [["C2", 60], [LOCKED, 30], ["C4", 60]],
  [["C8", 60], ["C7", 30]],
];
const long = (size: number): Preset => [
  ["C14", size],
  ["C13", size],
  ["C3", size],
  ["C6", size],
  ["C1", size],
  ["C2", size],
  ["C12", size],
  ["C5", size / 2],
];
const OUTPOST_PRESETS: readonly Preset[] = [
  [["C7", 60], ["C2", 40]],
  [["C1", 60]],
  [["C8", 30], ["C5", 30]],
  [["C6", 90]],
  [["C3", 60], ["C4", 30], ["C1", 30]],
  [["C2", 90], ["C7", 30]],
];
/** What a first preset looks like half-way through being built. */
const BUILDING: Preset = [["C1", 30], ["C2", 40]];

const busyQueue = (size: number, stacks: number): QueueStack[] =>
  (
    [
      ["C12", size - 1],
      ["C12", size],
      ["C8", size],
      ["C8", size],
      ["C7", size],
      ["C14", size],
      ["C5", size],
      ["C3", size],
      ["C1", size],
      ["C6", Math.round(size / 2)],
    ] as const
  )
    .slice(0, stacks)
    .map(([id, count]) => [id, count, 6] as QueueStack);

const outpostQueue = (size: number): QueueStack[] =>
  (
    [
      ["C7", size],
      ["C7", size],
      ["C2", size],
      ["C2", size],
      ["C1", size - 4],
    ] as const
  ).map(([id, count]) => [id, count, 4] as QueueStack);

const el = <K extends keyof HTMLElementTagNameMap>(tag: K, className: string, text?: string): HTMLElementTagNameMap[K] => {
  const node = document.createElement(tag);
  node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
};

const btn = (className: string, label: string, ...content: (Node | string)[]): HTMLButtonElement => {
  const node = el("button", className);
  node.type = "button";
  node.setAttribute("aria-label", label);
  node.append(...content);
  return node;
};

const portrait = (id: string, className: string): Node => {
  const entry = monsterEntry(id);
  return entry ? monsterPicture(entry, "small", className) : el("span", className);
};

const art = (name: GameIconName, size: number, className = ""): HTMLImageElement =>
  gameIcon(name, { size: size as 16 | 24 | 32, decorative: true, ...(className ? { className } : {}) });

const arrow = (direction: -1 | 1): HTMLImageElement =>
  art(`friend${direction === 1 ? "next" : "prev"}${classicLook() ? "classic" : ""}` as GameIconName, 32, "b9r2h-arrow");

const short = (value: number): string =>
  value >= 1_000_000 ? `${(value / 1_000_000).toFixed(1)}M` : value >= 1_000 ? `${Math.round(value / 1000)}K` : value.toLocaleString("en-US");

const totalOf = (preset: Preset): number => preset.reduce((sum, [, count]) => sum + count, 0);

interface YardRow {
  readonly kind: "main" | "outpost";
  readonly baseid: string;
  readonly title: string;
  readonly hcc: boolean;
  readonly pinned: boolean;
}

interface Sent {
  readonly scope: Scope;
  readonly slot: number;
  readonly added: number;
  readonly of: number;
  readonly why: null | "queue" | "goo";
  /** Locked monsters the Send left out. */
  readonly skipped: readonly string[];
}

export class B9HccR3 {
  readonly level = b9HccLevel();
  /** Presets a list holds: 2 at level 1, 4 at level 2, 6 at level 3 (owner, 22 Nov 2026). */
  readonly slots = this.level >= 3 ? 6 : this.level >= 2 ? 4 : 2;
  /** Stacks (boxes) the queue holds: today's 7 at level 1, 10 from level 2. */
  readonly stacks = this.level >= 2 ? 10 : HCC_STACKS;
  /** Monsters one stack holds. */
  readonly size = this.level >= 3 ? 30 : 20;
  private readonly open = states();
  private remote: YardRow | null = null;
  private yard: HatchYard | null = null;
  private tab: "monsters" | "presets" = "monsters";
  private editing: number | null = null;
  private sent: Sent | null = null;
  private readonly presets: Record<Scope, Preset[]>;
  private readonly queues: Record<Scope, QueueStack[]>;
  private readonly spent: Record<Scope, number> = { main: 0, outposts: 0 };
  private readonly strip = el("div", "b9r2h-strip");
  private readonly bench = el("div", "b9r2h-bench");
  private readonly tabs = el("div", "b9r3h-tabs");
  private readonly list = el("section", "b9r3h-presets");
  private readonly editHead = el("div", "b9r3h-edit");
  private readonly editBox = el("div", "b9r3h-set");
  private readonly yardsPage = el("section", "b9r2h-yards");

  constructor(
    private readonly root: HTMLElement,
    private readonly scroll: HTMLElement,
    private readonly save: () => BaseLoadResponse,
    private readonly redraw: () => void,
  ) {
    root.classList.add("b9r2h", "b9r2h-opt-d", "b9r3h", `b9r2h-level-${this.level}`);
    root.closest(".monsters-screen, .panel")?.classList.add("b9r2h-window");
    if (this.open.has("remote") && this.level >= 3) {
      this.remote = this.hccYards().find((one) => one.kind === "outpost") ?? null;
    }
    const fill = (from: readonly Preset[]): Preset[] => {
      const filled = this.open.has("empty") ? 0 : this.open.has("filled") ? this.slots : 2;
      return Array.from({ length: this.slots }, (_, at) =>
        at < filled ? (from[at]?.length ? from[at]! : long(this.size)).map(([id, count]) => [id, count] as [string, number]) : [],
      );
    };
    this.presets = { main: fill(MAIN_PRESETS), outposts: fill(OUTPOST_PRESETS) };
    this.queues = { main: busyQueue(this.size, this.stacks - (this.open.has("room") ? 2 : 0)), outposts: outpostQueue(this.size) };
    if (this.open.has("presets") || this.open.has("edit") || this.open.has("sent")) this.tab = "presets";
    if (this.open.has("edit")) {
      this.editing = 0;
      if (this.open.has("empty")) this.presets[this.scope()][0] = BUILDING.map(([id, count]) => [id, count]);
    }
    root.prepend(this.strip);
    root.append(this.yardsPage);
    this.yardsPage.hidden = !(this.open.has("yards") && this.level >= 3);
    this.tabs.setAttribute("role", "tablist");
    this.list.setAttribute("aria-label", "Presets");
    if (this.open.has("housing")) root.classList.add("b9r2h-show-housing");
    if (this.open.has("sent")) queueMicrotask(() => this.send(0));
  }

  private scope(): Scope {
    return this.remote ? "outposts" : "main";
  }

  /** The yard the tab shows: the fake busiest queue, or the outpost being run from home. */
  fakeYard(yard: HatchYard): HatchYard {
    const scope = this.scope();
    if (this.remote) {
      const endsAt = Math.floor(Date.now() / 1000) + 620;
      const hatcheries = yard.hatcheries
        .slice(0, 2)
        .map((one) => ({ ...one, monster: "C7", stage: 1 as const, countdown: 620, state: "producing" as const, endsAt }));
      return { ...yard, hatcheries, shared: this.queues[scope], capacity: 9_600, housed: { C7: 120, C2: 80 }, goo: 18_400_000 - this.spent[scope] };
    }
    return { ...yard, shared: this.queues[scope], goo: yard.goo - this.spent[scope] };
  }

  /** After each draw of the tab: the strip, the tab switch and the presets take their places. */
  afterDraw(yard?: HatchYard): void {
    if (yard) this.yard = yard;
    this.root.closest(".monsters-screen, .panel")?.classList.add("b9r2h-window");
    this.root.classList.toggle("b9r2h-remote", this.remote !== null);
    const lines = this.scroll.querySelector(".hatch-lines");
    const split = this.scroll.querySelector(".hatch__split");
    if (lines && !this.bench.isConnected) {
      lines.before(this.bench);
      this.bench.append(lines);
    }
    if (split && !this.tabs.isConnected) {
      // The switch sits in the strip between the rack and the monsters; the tab's own
      // housing box opens right under it, on either tab.
      split.before(this.tabs, this.list);
      const message = split.querySelector(".hatch-message");
      if (message) this.tabs.after(message);
    }
    this.lockMissingBoxes();
    const info = this.root.querySelector(".hatch-info");
    if (info && this.editBox.parentElement !== info) info.append(this.editBox);
    // Remote: Add wears the outpost's flag, so the last tap says where it goes.
    const add = this.root.querySelector(".hatch-add__add");
    add?.querySelector(".b9r2h-addflag")?.remove();
    if (add && this.remote) add.prepend(art("outpost", 24, "b9r2h-addflag"));
    for (const clear of this.root.querySelectorAll<HTMLButtonElement>("button.hatch-clear")) {
      // Keep the live control's accessible name and confirmation handler.
      clear.replaceChildren(el("span", "", "Clear"));
    }
    this.renderStrip();
    this.renderTabs();
    this.renderPresets();
    this.renderEditor();
    this.renderYards();
  }

  /** Round 6: level 1's queue holds 7 stacks; the three it lacks show locked, so the box grid is the same at every level. */
  private lockMissingBoxes(): void {
    const slots = this.scroll.querySelector(".hatch-line--hcc > .hatch-line__slots");
    if (!slots || slots.querySelector(".b9r6h-box--locked")) return;
    const totals = slots.querySelector(":scope > .hatch-line__totals");
    for (let at = this.stacks; at < 10; at += 1) {
      const box = el("div", "b9r6h-box--locked");
      box.title = "More queue stacks at HCC level 2";
      box.setAttribute("aria-hidden", "true");
      box.append(lockArt(16, "b9r6h-box__lock"));
      slots.insertBefore(box, totals);
    }
  }

  private yards(): YardRow[] {
    const entries = ownYardsOf(this.save(), { kind: "main" } as never, outpostLabels());
    return entries.map((entry) => {
      const target = entry.target as unknown as { kind: string; baseid?: string };
      const baseid = target.baseid ?? "main";
      const kind = target.kind === "outpost" ? ("outpost" as const) : ("main" as const);
      return { kind, baseid, title: entry.title, hcc: kind === "main" || !NO_HCC.has(baseid), pinned: entry.pinned };
    });
  }

  private hccYards(): YardRow[] {
    return this.yards().filter((one) => one.hcc);
  }

  private place(): { at: number; of: number } {
    const yards = this.hccYards();
    const at = this.remote ? yards.findIndex((one) => one.baseid === this.remote!.baseid) : 0;
    return { at: Math.max(0, at), of: yards.length };
  }

  private setRemote(remote: YardRow | null): void {
    this.remote = remote && remote.kind === "outpost" ? remote : null;
    this.yardsPage.hidden = true;
    this.editing = null;
    this.sent = null;
    this.redraw();
  }

  /* ── The top strip: which yard, and its housing (as round 2's D) ──── */

  private where(locked = false): HTMLElement {
    const { at, of } = this.place();
    const where = el("span", "b9r2h-where");
    const icon = art(this.remote ? "outpost" : "townhall", 32, "b9r2h-where__icon");
    // Locked: the lock stands where the count goes, so the control keeps its width.
    where.append(icon, locked ? lockArt(20, "b9r2h-where__lock") : el("span", "b9r2h-where__count", `${at + 1}/${of}`));
    return where;
  }

  private renderStrip(): void {
    // Round 6 (owner, 22 Nov): ONE yard switcher at every level and in every yard, the same size
    // and place, so nothing jumps. Below level 3 it is greyed with a lock; in an outpost there is
    // no extra home button (the left arrow and the yard list lead back to the main yard).
    const locked = this.level < 3;
    const yards = this.hccYards();
    const { at } = this.place();
    const stepper = el("div", `b9r2h-stepper${locked ? " b9r2h-stepper--locked" : ""}`);
    const prev = btn("b9r2h-stepper__arrow", "Previous yard", arrow(-1));
    prev.disabled = locked || at <= 0;
    prev.addEventListener("click", () => this.setRemote(yards[at - 1] ?? null));
    const next = btn("b9r2h-stepper__arrow", "Next yard", arrow(1));
    next.disabled = locked || at >= yards.length - 1;
    next.addEventListener("click", () => this.setRemote(yards[at + 1] ?? null));
    const middle = btn("b9r2h-stepper__where", locked ? "Run your outposts from here at HCC level 3" : "All your yards with an HCC", this.where(locked));
    if (locked) {
      middle.disabled = true;
      middle.title = "Run your outposts from here at HCC level 3";
    } else middle.addEventListener("click", () => this.toggleYards());
    stepper.append(prev, middle, next);
    this.strip.replaceChildren(stepper, this.housing());
  }

  private housingNumbers(): { housed: number; room: number; coming: number } {
    const queue = this.queues[this.scope()];
    const coming = queue.reduce((sum, [id, count, level]) => sum + count * spaceOf(id, level), 0);
    return this.remote ? { housed: 3_200, room: this.yard?.capacity ?? 9_600, coming } : { housed: 2_080, room: 2_160, coming };
  }

  /** The housing: now / room, what it will be after the queue, and the bar. A tap opens the tab's own housing box. */
  private housing(): HTMLElement {
    const { housed, room, coming } = this.housingNumbers();
    const over = housed + coming > room;
    const box = btn(`b9r2h-housing${over ? " b9r2h-housing--over" : ""}`, "Housing");
    box.setAttribute("aria-label", `Housing ${housed} of ${room}; after the queue ${housed + coming}`);
    const numbers = el("span", "b9r2h-housing__numbers");
    numbers.append(
      art("housing", 24, "b9r2h-housing__icon"),
      el("span", "b9r2h-housing__now", `${housed.toLocaleString("en-US")}/${room.toLocaleString("en-US")}`),
      el("span", "b9r2h-housing__compact", `${(housed / 1000).toFixed(1)}K/${(room / 1000).toFixed(1)}K`),
      el("span", "b9r2h-housing__coming", `+${short(coming)}`),
    );
    const bar = el("span", "b9r2h-housing__bar");
    const fill = el("span", "b9r2h-housing__fill");
    fill.style.width = `${Math.min(100, (housed / room) * 100)}%`;
    const more = el("span", "b9r2h-housing__more");
    more.style.width = `${Math.max(0, Math.min(100, ((housed + coming) / room) * 100) - (housed / room) * 100)}%`;
    bar.append(fill, more);
    box.append(numbers, bar);
    box.addEventListener("click", () => this.root.classList.toggle("b9r2h-show-housing"));
    return box;
  }

  /* ── The switch: Monsters | Presets, and the housing warning ──────── */

  private setTab(tab: "monsters" | "presets"): void {
    this.tab = tab;
    this.editing = null;
    this.renderTabs();
    this.renderPresets();
    this.renderEditor();
  }

  /**
   * Building a preset hides the hatcheries and the queue; the tab keeps the height it had,
   * so the window does not jump when a slot is opened or Done is pressed.
   */
  private holdHeight(): void {
    if (this.editing === null || this.open.has("live")) {
      this.root.style.minHeight = "";
      return;
    }
    if (this.root.style.minHeight !== "") return;
    // Measured as the Presets tab stands, before anything is hidden.
    const slot = this.editing;
    this.editing = null;
    this.paintTabs();
    this.renderPresets();
    this.root.style.minHeight = `${this.root.offsetHeight}px`;
    this.editing = slot;
  }

  private renderTabs(): void {
    this.holdHeight();
    this.paintTabs();
  }

  private paintTabs(): void {
    this.root.classList.toggle("b9r3h-on-presets", this.tab === "presets" && this.editing === null);
    this.root.classList.toggle("b9r3h-editing", this.editing !== null);
    this.root.classList.toggle("b9r3h-live", this.open.has("live"));
    const group = el("div", "b9r3h-switch");
    const tab = (id: "monsters" | "presets", words: string, ...extra: Node[]): HTMLButtonElement => {
      const one = btn(`b9r3h-tab${this.tab === id ? " b9r3h-tab--on" : ""}`, words, ...extra, el("span", "", words));
      one.setAttribute("role", "tab");
      one.setAttribute("aria-selected", String(this.tab === id));
      one.addEventListener("click", () => this.setTab(id));
      return one;
    };
    // Level 3: the Presets tab wears the list it opens (the house, or the flag shared by all outposts).
    // Round 6: at every level, so the tab's words do not move with the level (below level 3 it is the main yard's list).
    const scope = [art(this.remote ? "outpost" : "townhall", 24, "b9r3h-tab__scope")];
    group.append(tab("monsters", "Monsters"), tab("presets", "Presets", ...scope));
    // While a preset is built, its head takes the switch's place: the tab is no taller than Monsters.
    const parts: Node[] = [this.editing === null ? group : this.editHead];
    // What the last Send did, seen from the Monsters tab (wide screens): said in this row.
    if (this.sent && this.editing === null && this.tab === "monsters" && this.sent.scope === this.scope()) {
      const note = this.said(this.sent);
      note.classList.add("b9r5h-note");
      note.prepend(this.badge(this.sent.slot));
      parts.push(note);
    }
    const waiting = this.root.querySelectorAll(".hatch-now--stalled").length;
    if (waiting > 0) {
      const warn = btn("b9r3h-warn", `Housing is full: ${waiting} hatched monsters wait in the Hatcheries for room`);
      warn.append(
        art("housing", 24, "b9r3h-warn__icon"),
        el("span", "b9r3h-warn__words", "Housing full"),
        el("span", "b9r3h-warn__short", "Full"),
        el("span", "b9r3h-warn__count", `${waiting} waiting`),
        el("span", "b9r3h-warn__count b9r3h-warn__count--short", `×${waiting}`),
      );
      warn.addEventListener("click", () => this.root.classList.toggle("b9r2h-show-housing"));
      parts.push(warn);
    }
    this.tabs.replaceChildren(...parts);
  }

  /* ── The Presets tab: numbered rows, Send on each ─────────────────── */

  private priceOf(id: string): number {
    return priceOf(id, academyLevels(this.save())[id] ?? 1);
  }

  private stacksOf(preset: Preset): number {
    return preset.reduce((sum, [, count]) => sum + Math.ceil(count / this.size), 0);
  }

  private badge(at: number): HTMLElement {
    return el("span", "b9r2h-mix__number b9r3h-number", String(at + 1));
  }

  /** What a Send did: "Added 60 of 140", and why it stopped or what it skipped. */
  private said(sent: Sent): HTMLElement {
    const said = el("span", `b9r3h-said${sent.why ? " b9r3h-said--short" : ""}`);
    said.setAttribute("role", "status");
    said.append(
      el("strong", "", sent.why ? `Added ${sent.added} of ${sent.of}` : `Added ${sent.added}`),
      el(
        "span",
        "",
        sent.skipped.length
          ? `${sent.skipped.join(", ")} locked: skipped`
          : sent.why === "queue"
            ? "The queue is full"
            : sent.why === "goo"
              ? "Not enough goo"
              : "At the end of the queue",
      ),
    );
    return said;
  }

  /** A preset's stacks in order. They scroll sideways when the row is too narrow; a fade says so. */
  private faces(preset: Preset, className: string): HTMLElement {
    const faces = el("span", `b9r3h-stacks ${className}`);
    for (const [id, count] of preset) {
      const one = el("span", "b9r3h-stack");
      one.append(portrait(id, "b9r3h-stack__picture"), el("span", "b9r3h-stack__count", `×${count}`));
      faces.append(one);
    }
    const mark = (): void => {
      faces.classList.toggle("b9r5h-more-left", faces.scrollLeft > 2);
      faces.classList.toggle("b9r5h-more-right", faces.scrollLeft + faces.clientWidth < faces.scrollWidth - 2);
    };
    faces.addEventListener("scroll", mark, { passive: true });
    // A mouse wheel moves the strip sideways (a desktop has no finger to drag it with).
    faces.addEventListener(
      "wheel",
      (event) => {
        if (faces.scrollWidth <= faces.clientWidth || Math.abs(event.deltaY) < Math.abs(event.deltaX)) return;
        const before = faces.scrollLeft;
        faces.scrollLeft += event.deltaY;
        if (faces.scrollLeft !== before) event.preventDefault();
      },
      { passive: false },
    );
    new ResizeObserver(mark).observe(faces);
    return faces;
  }

  private renderPresets(): void {
    const scope = this.scope();
    const rows: Node[] = [];
    this.presets[scope].forEach((preset, at) => {
      const row = el("div", `b9r3h-row${preset.length ? "" : " b9r3h-row--empty"}`);
      if (!preset.length) {
        const make = btn("b9r3h-row__body", `Make preset ${at + 1}`, this.badge(at), el("span", "b9r3h-row__plus", "+"));
        make.addEventListener("click", () => this.edit(at));
        row.append(make);
        rows.push(row);
        return;
      }
      const total = totalOf(preset);
      // The number (with a small pencil) opens the preset to change it; so does a tap on its stacks.
      const body = btn("b9r3h-row__body", `Preset ${at + 1}, ${total} monsters: change it`, this.badge(at), el("span", "b9r3h-row__pencil", "✎"));
      body.addEventListener("click", () => this.edit(at));
      // The stacks are NOT inside the button: a strip inside a button does not scroll in every browser.
      const faces = this.faces(preset, "b9r3h-row__stacks");
      faces.setAttribute("aria-label", `Preset ${at + 1}: ${preset.length} stacks in order`);
      faces.dataset.slot = String(at);
      faces.addEventListener("click", () => this.edit(at));
      const cost = el("span", "b9r3h-row__cost");
      const goo = preset.reduce((sum, [id, count]) => sum + count * this.priceOf(id), 0);
      cost.append(resourceIcon("r4"), el("span", "", short(goo)));
      cost.addEventListener("click", () => this.edit(at));
      const send = btn("btn btn--primary b9r3h-send", `Send preset ${at + 1} to the end of the queue`);
      if (this.remote) send.append(art("outpost", 24, "b9r2h-addflag"));
      send.append(el("span", "", "Send"));
      send.addEventListener("click", () => this.send(at));
      row.append(body, faces, cost, send);
      const sent = this.sent && this.sent.scope === scope && this.sent.slot === at ? this.sent : null;
      if (sent) row.append(this.said(sent));
      rows.push(row);
    });
    // The tab redraws as the hatcheries tick: a strip the player dragged sideways stays where it was put.
    const kept = new Map<string, number>();
    if (this.list.dataset.scope === scope) {
      for (const strip of this.list.querySelectorAll<HTMLElement>(".b9r3h-row__stacks")) kept.set(strip.dataset.slot ?? "", strip.scrollLeft);
    }
    this.list.replaceChildren(...rows);
    this.list.dataset.scope = scope;
    for (const strip of this.list.querySelectorAll<HTMLElement>(".b9r3h-row__stacks")) strip.scrollLeft = kept.get(strip.dataset.slot ?? "") ?? 0;
  }

  /** Adds the preset to the end of the queue by the HCC's stacking rule, as far as stacks and goo go. */
  private send(at: number): void {
    const scope = this.scope();
    const preset = this.presets[scope][at];
    const yard = this.yard;
    if (!preset?.length || !yard) return;
    const queue = this.queues[scope];
    let goo = yard.goo;
    let added = 0;
    let why: Sent["why"] = null;
    const skipped: string[] = [];
    outer: for (const [id, count] of preset) {
      if (!this.ready(id)) {
        const name = monsterEntry(id)?.name ?? id;
        if (!skipped.includes(name)) skipped.push(name);
        continue;
      }
      const price = this.priceOf(id);
      const level = academyLevels(this.save())[id] ?? 1;
      for (let n = 0; n < count; n += 1) {
        if (goo < price) {
          why = "goo";
          break outer;
        }
        const last = queue.at(-1);
        if (last && last[0] === id && last[1] < this.size) last[1] += 1;
        else if (queue.length < this.stacks) queue.push([id, 1, level]);
        else {
          why = "queue";
          break outer;
        }
        goo -= price;
        added += 1;
      }
    }
    this.spent[scope] += yard.goo - goo;
    this.sent = { scope, slot: at, added, of: totalOf(preset), why, skipped };
    this.redraw();
  }

  /* ── Building a preset: the monsters and the count, for slot N ────── */

  private edit(at: number): void {
    this.tab = "presets";
    this.editing = at;
    this.sent = null;
    this.renderTabs();
    this.renderEditor();
    // The count shows the chosen monster's share of the preset.
    this.scroll.querySelector<HTMLElement>(".hatch-monster[aria-pressed=true]")?.scrollIntoView({ block: "nearest", inline: "nearest" });
  }

  private chosen(): string | null {
    return this.root.querySelector<HTMLElement>(".hatch-monster[aria-pressed=true]")?.dataset.monster ?? null;
  }

  /** True for a monster the yard can hatch now (its tile says so). */
  private ready(id: string): boolean {
    return this.root.querySelector(`.hatch-monster[data-monster="${id}"]`)?.classList.contains("hatch-monster--ready") === true;
  }

  /** The last stack when it is `id`'s, else null: the only stack the count works on. */
  private lastOf(preset: Preset, id: string | null): [string, number] | null {
    const last = preset.at(-1);
    return last && last[0] === id ? last : null;
  }

  /** The most the stack being counted may hold: a preset never outgrows the queue's ten stacks. */
  private roomFor(preset: Preset, id: string | null): number {
    const others = this.lastOf(preset, id) ? preset.slice(0, -1) : preset;
    return Math.max(0, (this.stacks - this.stacksOf(others)) * this.size);
  }

  /**
   * Sets the count of `id` at the END of the preset: the last stack if it is this
   * monster's, else a new stack after it. Earlier stacks are never touched, so the
   * order the stacks were added in is the order they are sent in.
   */
  private setCount(id: string, count: number): void {
    if (this.editing === null) return;
    const preset = this.presets[this.scope()][this.editing]!;
    const mine = this.lastOf(preset, id);
    const next = Math.max(0, Math.min(Math.floor(count) || 0, this.roomFor(preset, id)));
    if (mine) {
      if (next === 0) preset.pop();
      else mine[1] = next;
    } else if (next > 0) preset.push([id, next]);
    this.renderEditor();
  }

  private renderEditor(): void {
    const at = this.editing;
    this.editHead.hidden = at === null;
    this.editBox.hidden = at === null;
    for (const mark of this.root.querySelectorAll(".b9r3h-inpreset")) mark.remove();
    if (at === null) return;
    const scope = this.scope();
    const preset = this.presets[scope][at]!;
    const chosen = this.chosen();
    const ready = chosen !== null && this.ready(chosen);
    const mine = this.lastOf(preset, chosen);
    const now = mine ? mine[1] : 0;
    const max = this.roomFor(preset, chosen);

    // The head: the slot's number (and whose list), then the preset as the queue's own box grid:
    // one box per queue stack, so the empty boxes are the room that is left.
    const which = el("span", "b9r3h-edit__which");
    if (this.level >= 3) which.append(art(this.remote ? "outpost" : "townhall", 24, "b9r3h-edit__scope"));
    which.append(this.badge(at));
    const used = this.stacksOf(preset);
    const left = this.stacks - used;
    const boxes = el("div", "b9r5h-boxes");
    boxes.setAttribute("role", "list");
    boxes.setAttribute("aria-label", `Preset ${at + 1}: ${used} of ${this.stacks} boxes filled, ${left} left`);
    let box = 0;
    preset.forEach(([id, count], index) => {
      const name = monsterEntry(id)?.name ?? id;
      const last = index === preset.length - 1;
      for (let rest = count; rest > 0; rest -= this.size) {
        const holds = Math.min(rest, this.size);
        box += 1;
        // The last stack's boxes are the ones the count works on; a tap chooses its monster.
        const one = last
          ? btn(`hatch-slot b9r5h-box b9r5h-box--last${id === chosen ? " b9r5h-box--on" : ""}`, `Box ${box}, the last stack: ${name}, ${holds}. Change its count`)
          : el("div", "hatch-slot b9r5h-box");
        if (!last) one.setAttribute("aria-label", `Box ${box}: ${name}, ${holds}`);
        one.setAttribute("role", "listitem");
        one.append(el("span", "hatch-slot__count", `×${holds}`), portrait(id, "hatch-slot__picture"));
        if (last && id === chosen && rest <= this.size) one.append(el("span", "b9r3h-count-mark", "✎"));
        if (last) one.addEventListener("click", () => this.root.querySelector<HTMLElement>(`.hatch-monster[data-monster="${id}"]`)?.click());
        boxes.append(one);
      }
    });
    // Another monster is chosen: its stack would start in the next box, shown faint.
    let ghost = false;
    if (preset.length && chosen && ready && !mine && max > 0) {
      const next = el("div", "hatch-slot b9r5h-box b9r5h-box--next");
      next.setAttribute("aria-hidden", "true");
      next.append(el("span", "hatch-slot__count", "+"), portrait(chosen, "hatch-slot__picture"));
      boxes.append(next);
      ghost = true;
    }
    for (let at = used + (ghost ? 1 : 0); at < this.stacks; at += 1) {
      const empty = el("div", "hatch-slot hatch-slot--empty b9r5h-box");
      empty.setAttribute("role", "listitem");
      empty.setAttribute("aria-label", "Empty box");
      boxes.append(empty);
    }
    const sum = el("span", "b9r3h-edit__sum");
    const goo = preset.reduce((total, [id, count]) => total + count * this.priceOf(id), 0);
    const stacks = el("span", `b9r3h-edit__stacks${left === 0 ? " b9r3h-edit__stacks--full" : ""}`);
    stacks.append(el("strong", "", String(left)), el("span", "", " left"));
    stacks.title = `Boxes left of ${this.stacks}; each holds up to ${this.size} monsters.`;
    stacks.setAttribute("aria-label", `${left} of ${this.stacks} boxes left; up to ${this.size} monsters per box`);
    const monsters = el("span", "b9r3h-edit__total", `×${totalOf(preset)}`);
    monsters.setAttribute("aria-label", `${totalOf(preset)} monsters`);
    const cost = el("span", "b9r3h-edit__goo");
    cost.append(resourceIcon("r4"), el("span", "", short(goo)));
    sum.append(stacks, monsters, cost);
    const undo = btn("b9r3h-edit__undo", "Take off the last box", art("undo", 24));
    undo.disabled = preset.length === 0;
    undo.addEventListener("click", () => {
      // The last box goes: a stack over several boxes loses its last one.
      const last = preset.at(-1);
      if (last) {
        last[1] -= last[1] % this.size || this.size;
        if (last[1] <= 0) preset.pop();
      }
      this.renderEditor();
    });
    const bin = btn("b9r3h-edit__bin", `Clear preset ${at + 1}`, "Clear");
    bin.disabled = preset.length === 0;
    bin.addEventListener("click", () => {
      preset.length = 0;
      this.renderEditor();
    });
    const side = el("span", "b9r3h-edit__side");
    side.append(undo, bin);
    const done = btn("btn btn--primary b9r3h-edit__done", "Done: back to the presets", "Done");
    done.addEventListener("click", () => this.setTab("presets"));
    // A wide screen has room to say the order in words too (a stack over several boxes is one line).
    const words = el("ol", "b9r3h-edit__words");
    words.setAttribute("aria-label", "The stacks in the order they are sent");
    for (const [id, count] of preset) {
      const line = el("li", "");
      line.append(el("span", "", monsterEntry(id)?.name ?? id), el("strong", "", ` ×${count}`));
      words.append(line);
    }
    this.editHead.replaceChildren(which, boxes, side, sum, words, done);

    // The monsters wear how many of them the preset holds, over all its stacks.
    const totals = new Map<string, number>();
    for (const [id, count] of preset) totals.set(id, (totals.get(id) ?? 0) + count);
    for (const [id, count] of totals) {
      const card = this.root.querySelector(`.hatch-monster[data-monster="${id}"]`);
      const total = el("span", "b9r3h-inpreset", `Σ ${count}`);
      total.title = "Total across all stacks in this preset";
      total.setAttribute("aria-label", `${count} total across all preset stacks`);
      card?.append(total);
    }

    // The count: the last stack's number when the chosen monster is its own, else 0 (a new stack).
    const controls = el("span", "qty-stepper hatch-add__controls");
    const step = (className: string, label: string, words: string, to: number, off: boolean): HTMLButtonElement => {
      const one = btn(`btn qty-stepper__step ${className}`, label, words);
      one.disabled = !ready || off;
      one.addEventListener("click", () => chosen && this.setCount(chosen, to));
      return one;
    };
    const input = el("input", "field__input qty-stepper__count hatch-add__count");
    input.type = "number";
    input.min = "0";
    input.max = String(max);
    input.inputMode = "numeric";
    input.value = String(now);
    input.disabled = !ready;
    input.setAttribute("aria-label", mine ? `How many in the last stack of preset ${at + 1}` : `How many in a new stack at the end of preset ${at + 1}`);
    input.addEventListener("change", () => chosen && this.setCount(chosen, Number(input.value)));
    const stack = step("btn--outline qty-stepper__fill hatch-add__fill", "One more full stack", `+${this.size}`, now + this.size, now >= max);
    stack.classList.remove("qty-stepper__step");
    const countField = el("label", "b9r3h-count-field");
    const marker = el("span", "b9r3h-count-mark", mine ? "✎" : "+");
    marker.setAttribute("aria-hidden", "true");
    countField.append(marker, input);
    controls.append(
      step("hatch-add__step hatch-add__step--minus", "One fewer", "−", now - 1, now <= 0),
      countField,
      step("hatch-add__step hatch-add__step--plus", "One more", "+", now + 1, now >= max),
      step("qty-stepper__jump hatch-add__jump", "5 more", "+5", now + 5, now >= max),
      step("qty-stepper__jump hatch-add__jump", "10 more", "+10", now + 10, now >= max),
      stack,
    );
    this.editBox.className = "b9r3h-set hatch-add";
    this.editBox.replaceChildren(controls);
  }

  /* ── The yard page (L3): every yard with an HCC, as cards (as round 2) ── */

  private toggleYards(): void {
    this.yardsPage.hidden = !this.yardsPage.hidden;
  }

  private renderYards(): void {
    if (this.level < 3) {
      this.yardsPage.hidden = true;
      return;
    }
    const head = el("header", "b9r2h-yards__head");
    const back = btn("b9r2h-yards__back", "Back", arrow(-1));
    back.addEventListener("click", () => this.toggleYards());
    const search = el("label", "b9r2h-search");
    const input = el("input", "b9r2h-search__input");
    input.setAttribute("aria-label", "Find a yard");
    search.append(art("find", 24), input);
    head.append(back, search);
    const grid = el("div", "b9r2h-yards__grid");
    const yards = this.yards();
    const withHcc = yards.filter((one) => one.hcc);
    withHcc.forEach((yard, at) => {
      const current = this.remote ? yard.baseid === this.remote.baseid : yard.kind === "main";
      const card = btn(`b9r2h-yardcard${current ? " b9r2h-yardcard--on" : ""}`, yard.title);
      const top = el("span", "b9r2h-yardcard__top");
      top.append(art(yard.kind === "main" ? "townhall" : "outpost", 32, "b9r2h-where__icon"), el("span", "b9r2h-yardcard__number", String(at + 1)));
      if (yard.pinned) top.append(art("pin", 16, "b9r2h-yardcard__pin"));
      const queue = el("span", "b9r2h-yardcard__queue");
      const count = yard.kind === "main" ? (this.level >= 3 ? 284 : 190) : yard.baseid.endsWith("9") ? 140 : at % 3 === 0 ? 0 : 60;
      queue.append(art("time", 16), el("span", "", count ? `×${count}` : "0"));
      if (!count) card.classList.add("b9r2h-yardcard--idle");
      card.append(top, el("span", "b9r2h-yardcard__name", yard.title), queue);
      card.addEventListener("click", () => this.setRemote(yard));
      grid.append(card);
    });
    for (const yard of yards.filter((one) => !one.hcc)) {
      const card = btn("b9r2h-yardcard b9r2h-yardcard--off", `${yard.title}: no HCC`);
      card.disabled = true;
      const top = el("span", "b9r2h-yardcard__top");
      top.append(art("outpost", 32, "b9r2h-where__icon"), lockArt(16, "b9r2h-lock"));
      card.append(top, el("span", "b9r2h-yardcard__name", yard.title));
      grid.append(card);
    }
    this.yardsPage.replaceChildren(head, grid);
  }
}
