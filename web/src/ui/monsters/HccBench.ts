/**
 * The Hatchery Control Centre's levels 2 and 3 on the Hatch tab (beta 9; owner,
 * desk cards b9-hcc-r3..r6, 22 Nov 2026; approved design: design/b9-hcc-r3
 * round 6). It sits on the Hatch tab whenever the yard has a finished HCC on
 * the surface (the Inferno's Incubator Control Centre is unchanged) and adds,
 * around the tab's own hatchery row and queue:
 *
 * - **The strip**: the yard switcher `[icon][<- 2/11 ->]`, always in the same
 *   place and size (greyed with a lock below level 3 and in an outpost the
 *   player is in), and the yard's housing (now / room, what the queue adds).
 * - **Monsters | Presets**: the Presets tab lists the yard's presets (2 at
 *   level 1, 4 at 2, 6 at 3), each a numbered, ordered sequence of stacks
 *   with its goo and a Send. A preset is built in the queue's own box grid,
 *   so the empty boxes say what room is left; while one is built the
 *   hatcheries and the queue are hidden.
 * - **Level 3**: the switcher steps through the main yard and every outpost
 *   with an HCC of its own, and a tap on its middle opens the yard page; the
 *   tab then runs that outpost's queue from home (gold frame).
 *
 * The rules are the server's (`server/src/services/yard/hccPresets.ts`);
 * the counts here only show what the server will do.
 */
import { HCC_MAX_STACKS, hccLimits, housedSpace, pendingSpace, priceOf, queuedCount, type HatchYard } from "@/game/monsters/hatchPlan";
import { monsterEntry } from "@/game/monsters/monsterCatalogue";
import { classicLook } from "@/game/classicLook";
import { gameIcon, type GameIconName } from "@/ui/gameIcon";
import { lockArt } from "@/ui/lockArt";
import { resourceIcon } from "@/ui/resourceIcon";
import { monsterPicture } from "@/ui/monsters/LockerTab";
import { ownYardsOf, MAIN_YARD } from "@/game/yard/ownYards";
import { outpostLabels } from "@/game/yard/outpostLabels";
import type { BaseLoadResponse } from "@/api/types";
import type { HccOutpostRow, HccPresetSendReport, HccPresetStack } from "@/api/yardHatchery";
import { boxesOf, presetListOf, presetLimits, type PresetList } from "@/game/monsters/hccPresets";

/** What the bench needs from the Hatch tab. */
export interface HccBenchHost {
  /** The save of the yard the tab shows: the main yard, an outpost, or one run from home. */
  save(): BaseLoadResponse;
  /** The main yard's save (the Monsters screen's own store); the same as `save` there. */
  homeSave(): BaseLoadResponse;
  /** The main yard's hatcheries and queue. */
  homeYard(): HatchYard;
  /** The yard's kind: `main`, or `outpost` (one the player is in, or one run from home). */
  kind(): "main" | "outpost" | "inferno";
  /** The outpost run from home, or null. */
  remote(): string | null;
  /** Runs an outpost from home (level 3), or goes back to the main yard with null. */
  goRemote(baseid: string | null): void;
  /** The outposts as the level 3 HCC lists them; null before the list has come. */
  outposts(): readonly HccOutpostRow[] | null;
  /** Asks the server for that list again. */
  refreshOutposts(): void;
  /** The monster chosen in the grid, or null. */
  chosen(): string | null;
  /** True for a monster that can be hatched now (unlocked). */
  ready(id: string): boolean;
  /** Chooses a monster in the grid. */
  choose(id: string): void;
  /** Saves a preset; false when the server refused (the tab says why). */
  savePreset(slot: number, stacks: readonly HccPresetStack[]): Promise<boolean>;
  /** Sends a preset to the end of the queue; null when the server refused. */
  sendPreset(slot: number): Promise<HccPresetSendReport | null>;
  /** Draws the whole tab again. */
  redraw(): void;
}

/** A preset as the bench edits it: its stacks in order. */
type Preset = [id: string, count: number][];

interface YardRow {
  readonly kind: "main" | "outpost";
  readonly baseid: string;
  readonly title: string;
  readonly pinned: boolean;
  /** The outpost's HCC level, 0 for none; the main yard's is the home HCC. */
  readonly hcc: number;
  readonly queued: number | null;
}

interface Sent {
  readonly list: PresetList;
  readonly slot: number;
  readonly report: HccPresetSendReport;
}

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
  art(`friend${direction === 1 ? "next" : "prev"}${classicLook() ? "classic" : ""}` as GameIconName, 32, "hcc-arrow");

const short = (value: number): string =>
  value >= 1_000_000 ? `${(value / 1_000_000).toFixed(1)}M` : value >= 1_000 ? `${Math.round(value / 1000)}K` : value.toLocaleString("en-US");

const totalOf = (preset: readonly (readonly [string, number])[]): number => preset.reduce((sum, [, count]) => sum + count, 0);

const nameOf = (id: string): string => monsterEntry(id)?.name ?? id;

/** "Outpost (239, 207)" never breaks inside its coordinates. */
const keepTogether = (title: string): string => title.replace(/\((\d+), (\d+)\)/, "($1,\u00a0$2)");

export class HccBench {
  private yard: HatchYard | null = null;
  private tab: "monsters" | "presets" = "monsters";
  /** The slot being built, and its stacks as edited so far (saved on Done). */
  private editing: { list: PresetList; slot: number; preset: Preset; saved: string } | null = null;
  private sent: Sent | null = null;
  private yardsOpen = false;
  private readonly strip = el("div", "hcc-strip");
  private readonly bench = el("div", "hcc-bench");
  private readonly tabs = el("div", "hcc-tabs");
  private readonly list = el("section", "hcc-presets");
  private readonly editHead = el("div", "hcc-edit");
  private readonly editBox = el("div", "hcc-set");
  /** The stepper's row in the editor: its buttons are drawn again, the row stays. */
  private readonly editControls = el("span", "qty-stepper hatch-add__controls");
  /**
   * Add, as on the hatching panel (owner, 23 Nov 2026): made once and never
   * replaced, so typing a count and pressing Add straight after still adds
   * (the blur redraws the editor between the press and the release, #268).
   */
  private readonly editAdd = btn("btn btn--primary hatch-add__add", "Add", el("span", "hatch-add__words", "Add"));
  /** How many of the chosen monster Add puts at the end of the preset, and which monster they are. */
  private pending = 0;
  private pendingFor: string | null = null;
  private readonly yardsPage = el("section", "hcc-yards");
  private on = false;

  constructor(
    private readonly root: HTMLElement,
    private readonly scroll: HTMLElement,
    private readonly host: HccBenchHost,
  ) {
    this.tabs.setAttribute("role", "tablist");
    this.list.setAttribute("aria-label", "Presets");
    this.yardsPage.hidden = true;
    this.yardsPage.setAttribute("aria-label", "Your yards with a Hatchery Control Centre");
    this.editAdd.addEventListener("click", () => this.addPending());
  }

  /** The HCC in use: the one whose queue the tab shows. */
  private get level(): number {
    return this.yard?.hcc?.level ?? 1;
  }

  /** The main yard's HCC level (0 for none): level 3 runs outposts from home. */
  private homeLevel(): number {
    const save = this.host.homeSave();
    const hcc = Object.values(save.buildingdata ?? {}).find((one) => Number(one?.t) === 16);
    if (!hcc || Number(hcc.cB) > 0) return 0;
    return Math.max(1, Math.min(3, Math.floor(Number(hcc.l)) || 1));
  }

  private listOf(): PresetList {
    return this.host.kind() === "outpost" ? "out" : "home";
  }

  /** How many presets, and how big each may be, here (`presetLimits`, the server's `hccContext`). */
  private limits() {
    return presetLimits(this.listOf(), this.level, this.host.remote() !== null ? this.homeLevel() : 0);
  }

  /** The yard's presets, with the one being built in place of its saved copy. */
  private presets(): Preset[] {
    const list = this.listOf();
    const saved = presetListOf(this.host.save().hccpresets ?? this.host.homeSave().hccpresets, list);
    const presets = Array.from({ length: this.limits().slots }, (_, at) => (saved[at] ?? []).map(([id, count]): [string, number] => [id, count]));
    if (this.editing && this.editing.list === list && this.editing.slot < presets.length) presets[this.editing.slot] = this.editing.preset;
    return presets;
  }

  /** Takes the bench off (no HCC, or the Inferno): the tab as it was. */
  detach(): void {
    if (!this.on) return;
    this.on = false;
    this.root.classList.remove("hcc-on", "hcc-remote", "hcc-on-presets", "hcc-editing", "hcc-show-housing", "hcc-level-1", "hcc-level-2", "hcc-level-3");
    this.root.closest(".monsters-screen, .panel")?.classList.remove("hcc-window");
    const lines = this.bench.firstElementChild;
    if (lines) this.bench.before(lines);
    for (const node of [this.strip, this.bench, this.tabs, this.list, this.editBox, this.yardsPage]) node.remove();
    this.root.style.minHeight = "";
    this.editing = null;
    this.tab = "monsters";
  }

  /** After each draw of the tab: the strip, the switch and the presets take their places. */
  afterDraw(yard: HatchYard): void {
    this.yard = yard;
    if (!this.on) {
      this.on = true;
      this.root.classList.add("hcc-on");
      this.root.append(this.yardsPage);
    }
    // A phone on its side has no height to spare: the strip scrolls away with the bench there.
    const short = typeof matchMedia === "function" && matchMedia("(max-height: 500px)").matches;
    const home = short ? this.scroll : this.root;
    if (this.strip.parentElement !== home) home.prepend(this.strip);
    for (const level of [1, 2, 3]) this.root.classList.toggle(`hcc-level-${level}`, level === this.level);
    this.root.closest(".monsters-screen, .panel")?.classList.add("hcc-window");
    this.root.classList.toggle("hcc-remote", this.host.remote() !== null);
    const lines = this.scroll.querySelector(".hatch-lines");
    const split = this.scroll.querySelector(".hatch__split");
    if (lines && lines.parentElement !== this.bench) {
      lines.before(this.bench);
      this.bench.append(lines);
    }
    if (split && !this.tabs.isConnected) {
      // The switch sits between the queue and the monsters; the tab's own
      // housing box opens right under it, on either tab.
      split.before(this.tabs, this.list);
      const message = split.querySelector(".hatch-message");
      if (message) this.tabs.after(message);
    }
    this.lockMissingBoxes();
    for (const clear of this.bench.querySelectorAll<HTMLButtonElement>("button.hatch-clear")) {
      // One word that fits its box on a phone; the button keeps its own accessible name.
      if (clear.textContent !== "Clear") clear.replaceChildren(el("span", "", "Clear"));
    }
    const info = this.root.querySelector(".hatch-info");
    if (info && this.editBox.parentElement !== info) info.append(this.editBox);
    // Run from home: Add wears the outpost's flag, so the last tap says where it goes.
    const add = this.root.querySelector(".hatch-add:not(.hcc-set) .hatch-add__add");
    add?.querySelector(".hcc-addflag")?.remove();
    if (add && this.host.remote()) add.prepend(art("outpost", 24, "hcc-addflag"));
    this.renderStrip();
    this.renderTabs();
    this.renderPresets();
    this.renderEditor();
    this.renderYards();
  }

  /** Level 1's queue holds 7 stacks; the three it lacks show locked, so the box grid is the same at every level. */
  private lockMissingBoxes(): void {
    const slots = this.scroll.querySelector(".hatch-line--hcc > .hatch-line__slots");
    if (!slots || slots.querySelector(".hcc-box--locked")) return;
    const totals = slots.querySelector(":scope > .hatch-line__totals");
    // A queue never holds more than its level allows; should an older one, the boxes it fills stay unlocked.
    for (let at = Math.max(hccLimits(this.level).stacks, this.yard?.shared.length ?? 0); at < HCC_MAX_STACKS; at += 1) {
      const box = el("div", "hcc-box--locked");
      box.title = "More queue stacks at HCC level 2";
      box.setAttribute("aria-hidden", "true");
      box.append(lockArt(16, "hcc-box__lock"));
      slots.insertBefore(box, totals);
    }
  }

  /** The main yard, then every outpost in the yard list's order, with what the level 3 list says of it. */
  private yards(): YardRow[] {
    const listed = new Map((this.host.outposts() ?? []).map((one) => [one.baseid, one]));
    return ownYardsOf(this.host.homeSave(), MAIN_YARD, outpostLabels()).map((entry) => {
      if (entry.target.kind !== "outpost") {
        return { kind: "main" as const, baseid: "main", title: entry.title, pinned: false, hcc: this.homeLevel(), queued: this.homeQueued() };
      }
      const row = listed.get(entry.target.baseid);
      return {
        kind: "outpost" as const,
        baseid: entry.target.baseid,
        title: entry.title,
        pinned: entry.pinned,
        hcc: row?.hcc ?? 0,
        queued: row?.queued ?? null,
      };
    });
  }

  /** Monsters the main yard is hatching or has waiting, as its save holds them. */
  private homeQueued(): number {
    const yard = this.host.homeYard();
    return queuedCount(yard.shared) + yard.hatcheries.filter((one) => one.monster !== null).length;
  }

  private hccYards(): YardRow[] {
    return this.yards().filter((one) => one.hcc > 0);
  }

  /** Run from home: level 3 in the main yard, or an outpost run from there. */
  private canRunOutposts(): boolean {
    return this.homeLevel() >= 3 && (this.host.kind() === "main" || this.host.remote() !== null);
  }

  private place(): { at: number; of: number } {
    const yards = this.hccYards();
    const remote = this.host.remote();
    const at = remote ? yards.findIndex((one) => one.baseid === remote) : 0;
    return { at: Math.max(0, at), of: Math.max(1, yards.length) };
  }

  private setRemote(row: YardRow | null): void {
    this.yardsOpen = false;
    this.editing = null;
    this.sent = null;
    this.tab = "monsters";
    this.host.goRemote(row && row.kind === "outpost" ? row.baseid : null);
  }

  /* ── The strip: which yard, and its housing ─────────────────────────── */

  private where(locked: boolean): HTMLElement {
    const { at, of } = this.place();
    const where = el("span", "hcc-where");
    const outpost = this.host.kind() === "outpost";
    where.append(
      art(outpost ? "outpost" : "townhall", 32, "hcc-where__icon"),
      // Locked: the lock stands where the count goes, so the control keeps its width.
      locked ? lockArt(20, "hcc-where__lock") : el("span", "hcc-where__count", `${at + 1}/${of}`),
    );
    return where;
  }

  private renderStrip(): void {
    // One yard switcher at every level and in every yard, the same size and
    // place, so nothing jumps (owner, round 6). Below level 3, and in an
    // outpost the player is in, it is greyed with a lock.
    const locked = !this.canRunOutposts();
    const yards = this.hccYards();
    const { at } = this.place();
    const stepper = el("div", `hcc-stepper${locked ? " hcc-stepper--locked" : ""}`);
    const prev = btn("hcc-stepper__arrow", "Previous yard", arrow(-1));
    prev.disabled = locked || at <= 0;
    prev.addEventListener("click", () => this.setRemote(yards[at - 1] ?? null));
    const next = btn("hcc-stepper__arrow", "Next yard", arrow(1));
    next.disabled = locked || at >= yards.length - 1;
    next.addEventListener("click", () => {
      const to = yards[at + 1];
      if (to) this.setRemote(to);
    });
    const why =
      this.host.kind() === "outpost" && !this.host.remote()
        ? "Run your outposts from your main yard's Hatchery Control Centre at level 3"
        : "Run your outposts from here at HCC level 3";
    const here = this.host.remote() ? (yards[at]?.title ?? "Outpost") : this.host.kind() === "outpost" ? "This outpost" : "Main yard";
    const middle = btn("hcc-stepper__where", locked ? why : `${here}: all your yards with an HCC`, this.where(locked));
    if (locked) {
      middle.disabled = true;
      middle.title = why;
    } else {
      middle.addEventListener("click", () => this.toggleYards());
    }
    stepper.append(prev, middle, next);
    this.strip.replaceChildren(stepper, this.housing());
  }

  /** The housing: now / room, what the queue will add, and the bar. A tap opens the tab's own housing box. */
  private housing(): HTMLElement {
    const yard = this.yard!;
    const housed = housedSpace(yard);
    const room = Math.max(1, yard.capacity);
    const coming = pendingSpace(yard);
    const over = housed + coming > room;
    const box = btn(
      `hcc-housing${over ? " hcc-housing--over" : ""}`,
      `Housing ${housed.toLocaleString("en-US")} of ${room.toLocaleString("en-US")}; after the queue ${(housed + coming).toLocaleString("en-US")}`,
    );
    const numbers = el("span", "hcc-housing__numbers");
    const remote = this.host.remote();
    const name = remote ? (this.yards().find((one) => one.baseid === remote)?.title ?? "") : "";
    if (name) {
      const yard = el("span", "hcc-housing__yard", name);
      yard.title = `Running ${name} from home`;
      numbers.append(yard);
    }
    numbers.append(
      art("housing", 24, "hcc-housing__icon"),
      el("span", "hcc-housing__now", `${housed.toLocaleString("en-US")}/${room.toLocaleString("en-US")}`),
      el("span", "hcc-housing__compact", `${short(housed)}/${short(room)}`),
      el("span", "hcc-housing__coming", `+${short(coming)}`),
    );
    const bar = el("span", "hcc-housing__bar");
    const fill = el("span", "hcc-housing__fill");
    const now = Math.min(100, (housed / room) * 100);
    fill.style.width = `${now}%`;
    const more = el("span", "hcc-housing__more");
    more.style.width = `${Math.max(0, Math.min(100, ((housed + coming) / room) * 100) - now)}%`;
    bar.append(fill, more);
    box.title = `Housing ${housed.toLocaleString("en-US")} of ${room.toLocaleString("en-US")}; the queue and the hatcheries add ${coming.toLocaleString("en-US")} more`;
    box.append(numbers, bar);
    box.addEventListener("click", () => this.root.classList.toggle("hcc-show-housing"));
    return box;
  }

  /* ── The switch: Monsters | Presets, and the housing warning ──────── */

  private setTab(tab: "monsters" | "presets"): void {
    this.tab = tab;
    this.renderTabs();
    this.renderPresets();
    this.renderEditor();
  }

  /** Done, or leaving the editor: the preset goes to the server if it changed. */
  private finishEditing(): void {
    const editing = this.editing;
    this.editing = null;
    if (!editing) return;
    if (JSON.stringify(editing.preset) === editing.saved) return;
    void this.host.savePreset(editing.slot, editing.preset).then(() => this.host.redraw());
  }

  /**
   * Building a preset hides the hatcheries and the queue; the tab keeps the height it had,
   * so the window does not jump when a slot is opened or Done is pressed.
   */
  private holdHeight(): void {
    if (this.editing === null) {
      this.root.style.minHeight = "";
      return;
    }
    if (this.root.style.minHeight !== "") return;
    // Measured as the Presets tab stands, before anything is hidden.
    const editing = this.editing;
    this.editing = null;
    this.paintTabs();
    this.renderPresets();
    this.root.style.minHeight = `${this.root.offsetHeight}px`;
    this.editing = editing;
  }

  private renderTabs(): void {
    this.holdHeight();
    this.paintTabs();
  }

  private paintTabs(): void {
    this.root.classList.toggle("hcc-on-presets", this.tab === "presets" && this.editing === null);
    this.root.classList.toggle("hcc-editing", this.editing !== null);
    const group = el("div", "hcc-switch");
    const tab = (id: "monsters" | "presets", words: string, ...extra: Node[]): HTMLButtonElement => {
      const one = btn(`hcc-tab${this.tab === id ? " hcc-tab--on" : ""}`, words, ...extra, el("span", "", words));
      one.setAttribute("role", "tab");
      one.setAttribute("aria-selected", String(this.tab === id));
      one.addEventListener("click", () => this.setTab(id));
      return one;
    };
    // The Presets tab wears the list it opens: the house, or the flag shared by every outpost.
    const scope = [art(this.listOf() === "out" ? "outpost" : "townhall", 24, "hcc-tab__scope")];
    group.append(tab("monsters", "Monsters"), tab("presets", "Presets", ...scope));
    // While a preset is built, its head takes the switch's place.
    const parts: Node[] = [this.editing === null ? group : this.editHead];
    // What the last Send did, seen from the Monsters tab: said in this row.
    if (this.sent && this.editing === null && this.tab === "monsters" && this.sent.list === this.listOf()) {
      const note = this.said(this.sent.report);
      note.classList.add("hcc-note");
      note.prepend(this.badge(this.sent.slot));
      parts.push(note);
    }
    // A full queue is said in this row on either tab, where it never pushes the list down.
    if (this.editing === null && this.queueFull() && !parts.some((part) => part instanceof HTMLElement && part.classList.contains("hcc-note"))) {
      const full = el("span", "hcc-note hcc-note--full", "Queue full");
      full.title = this.tab === "presets" ? "Send works again when a box is free" : "Add works again when a box is free";
      parts.push(full);
    }
    const waiting = this.root.querySelectorAll(".hatch-now--stalled").length;
    if (waiting > 0) {
      const warn = btn("hcc-warn", `Housing is full: ${waiting} hatched monsters wait in the Hatcheries for room`);
      warn.append(
        art("housing", 24, "hcc-warn__icon"),
        el("span", "hcc-warn__words", "Housing full"),
        el("span", "hcc-warn__short", "Full"),
        el("span", "hcc-warn__count", `${waiting} waiting`),
        el("span", "hcc-warn__count hcc-warn__count--short", `×${waiting}`),
      );
      warn.addEventListener("click", () => this.root.classList.toggle("hcc-show-housing"));
      parts.push(warn);
    }
    this.tabs.replaceChildren(...parts);
  }

  /* ── The Presets tab: numbered rows, Send on each ─────────────────── */

  /** Every box of the queue taken: Add and Send have no room. */
  private queueFull(): boolean {
    return (this.yard?.shared.length ?? 0) >= hccLimits(this.level).stacks;
  }

  private priceOf(id: string): number {
    const yard = this.yard;
    return priceOf(id, yard?.levels[id] ?? 1, yard?.pricePercent);
  }

  private badge(at: number): HTMLElement {
    return el("span", "hcc-mix__number hcc-number", String(at + 1));
  }

  /** What a Send did: "Added 60 of 140", and why it stopped or what it skipped. */
  private said(report: HccPresetSendReport): HTMLElement {
    const short = report.stoppedBy !== null;
    const said = el("span", `hcc-said${short ? " hcc-said--short" : ""}`);
    said.setAttribute("role", "status");
    const skipped = report.skipped.map(nameOf);
    said.append(
      el("strong", "", short || skipped.length ? `Added ${report.added} of ${report.requested}` : `Added ${report.added}`),
      el(
        "span",
        "",
        report.stoppedBy === "queue"
          ? "The queue is full"
          : report.stoppedBy === "goo"
            ? "Not enough goo"
            : skipped.length
              ? `${skipped.join(", ")} locked: skipped`
              : "At the end of the queue",
      ),
    );
    return said;
  }

  /** A preset's stacks in order. They scroll sideways when the row is too narrow; a fade says so. */
  private faces(preset: Preset, className: string): HTMLElement {
    const faces = el("span", `hcc-stacks ${className}`);
    for (const [id, count] of preset) {
      const one = el("span", "hcc-stack");
      one.append(portrait(id, "hcc-stack__picture"), el("span", "hcc-stack__count", `×${count}`));
      faces.append(one);
    }
    const mark = (): void => {
      faces.classList.toggle("hcc-more-left", faces.scrollLeft > 2);
      faces.classList.toggle("hcc-more-right", faces.scrollLeft + faces.clientWidth < faces.scrollWidth - 2);
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
    if (typeof ResizeObserver === "function") new ResizeObserver(mark).observe(faces);
    return faces;
  }

  private renderPresets(): void {
    const list = this.listOf();
    const rows: Node[] = [];
    const full = this.queueFull();
    this.presets().forEach((preset, at) => {
      const row = el("div", `hcc-row${preset.length ? "" : " hcc-row--empty"}`);
      if (!preset.length) {
        const make = btn("hcc-row__body", `Make preset ${at + 1}`, this.badge(at), el("span", "hcc-row__plus", "+"));
        make.addEventListener("click", () => this.edit(at));
        row.append(make);
        rows.push(row);
        return;
      }
      const total = totalOf(preset);
      // The number (with a small pencil) opens the preset to change it; so does a tap on its stacks.
      const body = btn("hcc-row__body", `Preset ${at + 1}, ${total} monsters: change it`, this.badge(at), el("span", "hcc-row__pencil", "✎"));
      body.addEventListener("click", () => this.edit(at));
      // The stacks are NOT inside the button: a strip inside a button does not scroll in every browser.
      const faces = this.faces(preset, "hcc-row__stacks");
      faces.setAttribute("aria-label", `Preset ${at + 1}: ${preset.length} stacks in order`);
      faces.dataset["slot"] = String(at);
      faces.addEventListener("click", () => this.edit(at));
      const cost = el("span", "hcc-row__cost");
      const goo = preset.reduce((sum, [id, count]) => sum + count * this.priceOf(id), 0);
      cost.append(resourceIcon("r4"), el("span", "", short(goo)));
      cost.addEventListener("click", () => this.edit(at));
      const send = btn("btn btn--primary hcc-send", `Send preset ${at + 1} to the end of the queue`);
      if (this.host.remote()) send.append(art("outpost", 24, "hcc-addflag"));
      send.append(el("span", "", "Send"));
      send.addEventListener("click", () => void this.send(at, send));
      if (full) {
        send.disabled = true;
        send.title = "The queue is full: Send works again when a box is free";
      }
      row.append(body, faces, cost, send);
      const sent = this.sent && this.sent.list === list && this.sent.slot === at ? this.sent : null;
      if (sent) row.append(this.said(sent.report));
      rows.push(row);
    });
    // The tab redraws as the hatcheries tick: a strip the player dragged sideways stays where it was put.
    const kept = new Map<string, number>();
    if (this.list.dataset["scope"] === list) {
      for (const strip of this.list.querySelectorAll<HTMLElement>(".hcc-row__stacks")) kept.set(strip.dataset["slot"] ?? "", strip.scrollLeft);
    }
    this.list.replaceChildren(...rows);
    this.list.dataset["scope"] = list;
    for (const strip of this.list.querySelectorAll<HTMLElement>(".hcc-row__stacks")) strip.scrollLeft = kept.get(strip.dataset["slot"] ?? "") ?? 0;
  }

  /** Adds the preset to the end of the queue (the server's `preset/send`), and says what it did. */
  private async send(at: number, button: HTMLButtonElement): Promise<void> {
    button.disabled = true;
    const report = await this.host.sendPreset(at);
    button.disabled = false;
    if (!report) return;
    this.sent = { list: report.list, slot: at, report };
    this.host.redraw();
  }

  /* ── Building a preset: the monsters and the count, for slot N ────── */

  private edit(at: number): void {
    const list = this.listOf();
    const preset = (this.presets()[at] ?? []).map(([id, count]): [string, number] => [id, count]);
    this.tab = "presets";
    this.editing = { list, slot: at, preset, saved: JSON.stringify(preset) };
    this.pending = 0;
    this.sent = null;
    // The last stack's monster is the one the count works on.
    const last = preset.at(-1);
    if (last && this.host.chosen() !== last[0]) this.host.choose(last[0]);
    this.renderTabs();
    this.renderEditor();
    // The preset being built stands at the top of the tab: start there.
    this.scroll.scrollTop = 0;
  }

  /** The last stack when it is `id`'s, else null: the only stack the count works on. */
  private lastOf(preset: Preset, id: string | null): [string, number] | null {
    const last = preset.at(-1);
    return last && last[0] === id ? last : null;
  }

  /** The most the stack being counted may hold: a preset never outgrows the queue's boxes. */
  private roomFor(preset: Preset, id: string | null): number {
    const { boxes, size } = this.limits();
    const others = this.lastOf(preset, id) ? preset.slice(0, -1) : preset;
    return Math.max(0, (boxes - boxesOf(others, size)) * size);
  }

  /** How many more of `id` fit at the end of the preset (topping up its last stack, or a new one). */
  private addableFor(preset: Preset, id: string | null): number {
    return Math.max(0, this.roomFor(preset, id) - (this.lastOf(preset, id)?.[1] ?? 0));
  }

  /** The count Add will put in; nothing changes in the preset until Add. */
  private setPending(id: string, count: number): void {
    if (this.editing === null) return;
    this.pendingFor = id;
    this.pending = Math.max(0, Math.min(Math.floor(count) || 0, this.addableFor(this.editing.preset, id)));
    this.renderEditor();
  }

  /**
   * Add: the count goes at the END of the preset, as on the hatching panel: it tops up
   * the last stack if that is this monster's, else starts a new stack after it. Earlier
   * stacks are never touched, so the order the stacks were added in is the order they
   * are sent in (30 Pokey > 40 Octo > 30 Pokey stays three stacks). The count stays for
   * another Add, as hatching's does, cut to the room that is left.
   */
  private addPending(): void {
    const editing = this.editing;
    const chosen = this.host.chosen();
    if (editing === null || chosen === null || !this.host.ready(chosen)) return;
    const preset = editing.preset;
    const count = Math.min(this.pendingFor === chosen ? this.pending : 0, this.addableFor(preset, chosen));
    if (count < 1) return;
    const mine = this.lastOf(preset, chosen);
    if (mine) mine[1] += count;
    else preset.push([chosen, count]);
    this.renderEditor();
    this.renderPresets();
  }

  private renderEditor(): void {
    const editing = this.editing;
    this.editHead.hidden = editing === null;
    this.editBox.hidden = editing === null;
    for (const mark of this.root.querySelectorAll(".hcc-inpreset")) mark.remove();
    if (editing === null) {
      // `.hatch-add` would show it whatever `hidden` says: off the page until the next preset.
      this.editBox.className = "hcc-set";
      this.editBox.replaceChildren();
      return;
    }
    const { boxes: most, size } = this.limits();
    const preset = editing.preset;
    const chosen = this.host.chosen();
    const ready = chosen !== null && this.host.ready(chosen);
    const mine = this.lastOf(preset, chosen);
    // The count is how many Add puts in: 0 for a newly chosen monster, as on the hatching panel.
    if (this.pendingFor !== chosen) {
      this.pendingFor = chosen;
      this.pending = 0;
    }
    const max = this.addableFor(preset, chosen);
    if (this.pending > max) this.pending = max;
    const now = this.pending;
    const at = editing.slot;

    // The head: the slot's number (and whose list), then the preset as the queue's own box grid:
    // one box per queue stack, so the empty boxes are the room that is left.
    const which = el("span", "hcc-edit__which");
    which.append(art(editing.list === "out" ? "outpost" : "townhall", 24, "hcc-edit__scope"), this.badge(at));
    const used = boxesOf(preset, size);
    const left = Math.max(0, most - used);
    const boxes = el("div", "hcc-boxes");
    boxes.setAttribute("role", "list");
    boxes.setAttribute("aria-label", `Preset ${at + 1}: ${used} of ${most} boxes filled, ${left} left`);
    let box = 0;
    preset.forEach(([id, count], index) => {
      const name = nameOf(id);
      const last = index === preset.length - 1;
      for (let rest = count; rest > 0; rest -= size) {
        const holds = Math.min(rest, size);
        box += 1;
        // The last stack's boxes are the ones the count works on; a tap chooses its monster.
        const one = last
          ? btn(`hatch-slot hcc-box hcc-box--last${id === chosen ? " hcc-box--on" : ""}`, `Box ${box}, the last stack: ${name}, ${holds}. Choose it to add more`)
          : el("div", "hatch-slot hcc-box");
        if (!last) one.setAttribute("aria-label", `Box ${box}: ${name}, ${holds}`);
        one.setAttribute("role", "listitem");
        one.append(el("span", "hatch-slot__count", `×${holds}`), portrait(id, "hatch-slot__picture"));
        if (last) one.addEventListener("click", () => this.host.choose(id));
        boxes.append(one);
      }
    });
    // Another monster is chosen: its stack would start in the next box, shown faint.
    let ghost = false;
    if (preset.length && chosen && ready && !mine && max > 0) {
      const next = el("div", "hatch-slot hcc-box hcc-box--next");
      next.setAttribute("aria-hidden", "true");
      next.append(el("span", "hatch-slot__count", "+"), portrait(chosen, "hatch-slot__picture"));
      boxes.append(next);
      ghost = true;
    }
    for (let n = used + (ghost ? 1 : 0); n < most; n += 1) {
      const empty = el("div", "hatch-slot hatch-slot--empty hcc-box");
      empty.setAttribute("role", "listitem");
      empty.setAttribute("aria-label", "Empty box");
      boxes.append(empty);
    }
    const sum = el("span", "hcc-edit__sum");
    const goo = preset.reduce((total, [id, count]) => total + count * this.priceOf(id), 0);
    const stacks = el("span", `hcc-edit__stacks${left === 0 ? " hcc-edit__stacks--full" : ""}`);
    stacks.append(el("strong", "", String(left)), el("span", "", " boxes left"));
    stacks.title = `Boxes left of ${most}; each holds up to ${size} monsters.`;
    stacks.setAttribute("aria-label", `${left} of ${most} boxes left; up to ${size} monsters per box`);
    const monsters = el("span", "hcc-edit__total", `×${totalOf(preset)}`);
    monsters.setAttribute("aria-label", `${totalOf(preset)} monsters`);
    const cost = el("span", "hcc-edit__goo");
    cost.append(resourceIcon("r4"), el("span", "", short(goo)));
    sum.append(stacks, monsters, cost);
    const undo = btn("hcc-edit__undo", "Take off the last box", art("undo", 24));
    undo.disabled = preset.length === 0;
    undo.addEventListener("click", () => {
      // The last box goes: a stack over several boxes loses its last one.
      const last = preset.at(-1);
      if (last) {
        last[1] -= last[1] % size || size;
        if (last[1] <= 0) preset.pop();
      }
      this.renderEditor();
    });
    const bin = btn("hcc-edit__bin", `Clear preset ${at + 1}`, "Clear");
    bin.disabled = preset.length === 0;
    bin.addEventListener("click", () => {
      preset.length = 0;
      this.renderEditor();
    });
    const side = el("span", "hcc-edit__side");
    side.append(undo, bin);
    const done = btn("btn btn--primary hcc-edit__done", "Done: save the preset and go back to the presets", "Done");
    done.addEventListener("click", () => {
      this.finishEditing();
      this.setTab("presets");
    });
    // A wide screen has room to say the order in words too (a stack over several boxes is one line).
    const words = el("ol", "hcc-edit__words");
    words.setAttribute("aria-label", "The stacks in the order they are sent");
    for (const [id, count] of preset) {
      const line = el("li", "");
      line.append(el("span", "", nameOf(id)), el("strong", "", ` ×${count}`));
      words.append(line);
    }
    this.editHead.replaceChildren(which, boxes, side, sum, words, done);

    // The monsters wear how many of them the preset holds, over all its stacks.
    const totals = new Map<string, number>();
    for (const [id, count] of preset) totals.set(id, (totals.get(id) ?? 0) + count);
    for (const [id, count] of totals) {
      const card = this.root.querySelector(`.hatch-monster[data-monster="${id}"]`);
      const total = el("span", "hcc-inpreset", `Σ ${count}`);
      total.title = "Total across all stacks in this preset";
      total.setAttribute("aria-label", `${count} total across all preset stacks`);
      card?.append(total);
    }

    // The count Add puts at the end: topping up the last stack when the chosen monster is its own, else a new stack.
    const controls = this.editControls;
    const step = (className: string, label: string, words: string, to: number, off: boolean): HTMLButtonElement => {
      const one = btn(`btn qty-stepper__step ${className}`, label, words);
      one.disabled = !ready || off;
      one.addEventListener("click", () => chosen && this.setPending(chosen, to));
      return one;
    };
    const input = el("input", "field__input qty-stepper__count hatch-add__count");
    input.type = "number";
    input.min = "0";
    input.max = String(max);
    input.inputMode = "numeric";
    input.value = String(now);
    input.disabled = !ready;
    input.setAttribute("aria-label", `How many to add to preset ${at + 1}`);
    input.addEventListener("change", () => chosen && this.setPending(chosen, Number(input.value)));
    const stack = step("btn--outline qty-stepper__fill hatch-add__fill", `${size} more`, `+${size}`, now + size, now >= max);
    stack.classList.remove("qty-stepper__step");
    const countField = el("label", "hcc-count-field");
    // A plain count, as on the hatching panel: no badge or ring tying it to the last stack (neon, 23 Nov).
    countField.append(input);
    controls.replaceChildren(
      step("hatch-add__step hatch-add__step--minus", "One fewer", "−", now - 1, now <= 0),
      countField,
      step("hatch-add__step hatch-add__step--plus", "One more", "+", now + 1, now >= max),
      step("qty-stepper__jump hatch-add__jump", "5 more", "+5", now + 5, now >= max),
      step("qty-stepper__jump hatch-add__jump", "10 more", "+10", now + 10, now >= max),
      stack,
    );
    this.editAdd.disabled = !ready || now < 1;
    this.editAdd.setAttribute(
      "aria-label",
      chosen && now > 0
        ? `Add ${now} ${nameOf(chosen)} to ${mine ? "the last stack of" : "the end of"} preset ${at + 1}`
        : `Add to preset ${at + 1}`,
    );
    this.editBox.className = "hcc-set hatch-add";
    // Only put in place once: a moved Add under the pointer would lose its click.
    if (controls.parentElement !== this.editBox || this.editAdd.parentElement !== this.editBox) {
      this.editBox.replaceChildren(controls, this.editAdd);
    }
  }

  /** True while a preset is being built: the tab's Add belongs to the editor then. */
  get isEditing(): boolean {
    return this.editing !== null;
  }

  /** The tab is going away: a preset being built is saved. */
  destroy(): void {
    this.finishEditing();
    this.detach();
  }

  /* ── The yard page (level 3): every yard with an HCC, as cards ─────── */

  private toggleYards(): void {
    this.yardsOpen = !this.yardsOpen;
    if (this.yardsOpen) this.host.refreshOutposts();
    this.renderYards();
  }

  private renderYards(): void {
    this.yardsPage.hidden = !this.yardsOpen || !this.canRunOutposts();
    if (this.yardsPage.hidden) return;
    const head = el("header", "hcc-yards__head");
    const back = btn("hcc-yards__back", "Back", arrow(-1));
    back.addEventListener("click", () => this.toggleYards());
    head.append(back, el("strong", "", "Your yards"));
    const grid = el("div", "hcc-yards__grid");
    const yards = this.yards();
    const remote = this.host.remote();
    yards
      .filter((one) => one.hcc > 0)
      .forEach((yard, at) => {
        const current = remote ? yard.baseid === remote : yard.kind === "main";
        const card = btn(`hcc-yardcard${current ? " hcc-yardcard--on" : ""}`, yard.title);
        const top = el("span", "hcc-yardcard__top");
        top.append(art(yard.kind === "main" ? "townhall" : "outpost", 32, "hcc-where__icon"), el("span", "hcc-yardcard__number", String(at + 1)));
        if (yard.pinned) top.append(art("pin", 16, "hcc-yardcard__pin"));
        card.append(top, el("span", "hcc-yardcard__name", keepTogether(yard.title)));
        if (yard.queued !== null) {
          const queue = el("span", "hcc-yardcard__queue");
          queue.title = yard.queued ? `${yard.queued} monsters hatching or waiting` : "Nothing hatching";
          queue.append(el("span", "", yard.queued ? `${yard.queued.toLocaleString("en-US")} queued` : "Idle"));
          if (!yard.queued) card.classList.add("hcc-yardcard--idle");
          card.append(queue);
        }
        card.addEventListener("click", () => this.setRemote(yard));
        grid.append(card);
      });
    for (const yard of yards.filter((one) => one.hcc === 0)) {
      const card = btn("hcc-yardcard hcc-yardcard--off", `${yard.title}: no Hatchery Control Centre`);
      card.disabled = true;
      const top = el("span", "hcc-yardcard__top");
      top.append(art("outpost", 32, "hcc-where__icon"), lockArt(16, "hcc-lock"));
      card.append(top, el("span", "hcc-yardcard__name", keepTogether(yard.title)), el("span", "hcc-yardcard__why", "No HCC"));
      grid.append(card);
    }
    this.yardsPage.replaceChildren(head, grid);
  }
}
