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
 * - Presets are numbered, never named: 3 slots at level 2, 5 at level 3.
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
 */
import { type HatchYard, type QueueStack, academyLevels, priceOf, spaceOf } from "@/game/monsters/hatchPlan";
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
const QUEUE_STACKS = 10;

/** The stacks in the order they were added; the same monster may come back, never twice in a row. */
type Preset = [id: string, count: number][];
/** Rezghul: locked in yardtester's copy, so preset 5 shows a locked monster being skipped. */
const LOCKED = "C19";
type Scope = "main" | "outposts";

const MAIN_PRESETS: readonly Preset[] = [
  [["C1", 30], ["C2", 40], ["C1", 30]],
  [["C12", 40], ["C5", 40], ["C12", 20]],
  [["C14", 40], ["C13", 60], ["C3", 40], ["C6", 20]],
  [["C6", 100], ["C9", 40]],
  [["C2", 60], [LOCKED, 30], ["C4", 60]],
];
const OUTPOST_PRESETS: readonly Preset[] = [
  [["C7", 60], ["C2", 40]],
  [["C1", 60]],
  [["C8", 30], ["C5", 30]],
  [["C6", 90]],
  [["C3", 60], ["C4", 30], ["C1", 30]],
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
  /** Presets a list holds: 3 at level 2, 5 at level 3 (owner, 21 Nov 2026). */
  readonly slots = this.level >= 3 ? 5 : 3;
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
      return Array.from({ length: this.slots }, (_, at) => (at < filled ? (from[at] ?? []).map(([id, count]) => [id, count] as [string, number]) : []));
    };
    this.presets = { main: fill(MAIN_PRESETS), outposts: fill(OUTPOST_PRESETS) };
    this.queues = { main: busyQueue(this.size, this.open.has("room") ? 8 : QUEUE_STACKS), outposts: outpostQueue(this.size) };
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

  private where(): HTMLElement {
    const { at, of } = this.place();
    const where = el("span", "b9r2h-where");
    where.append(art(this.remote ? "outpost" : "townhall", 32, "b9r2h-where__icon"), el("span", "b9r2h-where__count", `${at + 1}/${of}`));
    return where;
  }

  private renderStrip(): void {
    const parts: Node[] = [];
    if (this.level < 3) {
      const locked = btn("b9r2h-yard b9r2h-yard--locked", "Run your outposts from here at HCC level 3");
      locked.disabled = true;
      locked.append(art("outpost", 32, "b9r2h-where__icon"), lockArt(16, "b9r2h-lock"), el("span", "b9r2h-lock__level", "3"));
      parts.push(locked);
    } else {
      if (this.remote) {
        const home = btn("b9r2h-yard b9r2h-yard--home", "Back to the main yard", art("townhall", 32, "b9r2h-where__icon"));
        home.addEventListener("click", () => this.setRemote(null));
        parts.push(home);
      }
      const yards = this.hccYards();
      const { at } = this.place();
      const stepper = el("div", "b9r2h-stepper");
      const prev = btn("b9r2h-stepper__arrow", "Previous yard", arrow(-1));
      prev.disabled = at <= 0;
      prev.addEventListener("click", () => this.setRemote(yards[at - 1] ?? null));
      const next = btn("b9r2h-stepper__arrow", "Next yard", arrow(1));
      next.disabled = at >= yards.length - 1;
      next.addEventListener("click", () => this.setRemote(yards[at + 1] ?? null));
      const middle = btn("b9r2h-stepper__where", "All your yards with an HCC", this.where());
      middle.addEventListener("click", () => this.toggleYards());
      stepper.append(prev, middle, next);
      parts.push(stepper);
    }
    parts.push(this.housing());
    this.strip.replaceChildren(...parts);
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
    const scope = this.level >= 3 ? [art(this.remote ? "outpost" : "townhall", 24, "b9r3h-tab__scope")] : [];
    group.append(tab("monsters", "Monsters"), tab("presets", "Presets", ...scope));
    // While a preset is built, its head takes the switch's place: the tab is no taller than Monsters.
    const parts: Node[] = [this.editing === null ? group : this.editHead];
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
      const body = btn("b9r3h-row__body", `Preset ${at + 1}, ${total} monsters: change it`, this.badge(at));
      const sent = this.sent && this.sent.scope === scope && this.sent.slot === at ? this.sent : null;
      if (sent) {
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
        row.append(said);
      }
      {
        const faces = el("span", "b9r3h-stacks");
        preset.forEach(([id, count], index) => {
          const one = el("span", "b9r3h-stack");
          one.append(portrait(id, "b9r3h-stack__picture"), el("span", "b9r3h-stack__count", `×${count}`));
          if (index >= 3) one.classList.add("b9r3h-stack--extra");
          faces.append(one);
        });
        // A phone row shows three monsters (two beside the wider flagged Send), then how many more.
        if (preset.length > 3) faces.append(el("span", "b9r3h-stacks__more b9r3h-stacks__more--3", `+${preset.length - 3}`));
        if (preset.length > 2) faces.append(el("span", "b9r3h-stacks__more b9r3h-stacks__more--2", `+${preset.length - 2}`));
        const cost = el("span", "b9r3h-row__cost");
        const goo = preset.reduce((sum, [id, count]) => sum + count * this.priceOf(id), 0);
        cost.append(resourceIcon("r4"), el("span", "", short(goo)));
        // The row opens the preset to change it: a small pencil says so.
        body.append(faces, cost, el("span", "b9r3h-row__pencil", "✎"));
      }
      body.addEventListener("click", () => this.edit(at));
      const send = btn("btn btn--primary b9r3h-send", `Send preset ${at + 1} to the end of the queue`);
      if (this.remote) send.append(art("outpost", 24, "b9r2h-addflag"));
      send.append(el("span", "", "Send"));
      send.addEventListener("click", () => this.send(at));
      row.append(body, send);
      rows.push(row);
    });
    this.list.replaceChildren(...rows);
    this.list.dataset.scope = scope;
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
        else if (queue.length < QUEUE_STACKS) queue.push([id, 1, level]);
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
    return Math.max(0, (QUEUE_STACKS - this.stacksOf(others)) * this.size);
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

    // The head: the slot's number (and whose list), its stacks in order, its size, Undo, Clear, Done.
    const which = el("span", "b9r3h-edit__which");
    if (this.level >= 3) which.append(art(this.remote ? "outpost" : "townhall", 24, "b9r3h-edit__scope"));
    which.append(this.badge(at));
    const chips = el("div", "b9r3h-edit__chips");
    chips.setAttribute("role", "list");
    chips.setAttribute("aria-label", `Preset ${at + 1}: its stacks in order`);
    if (!preset.length) chips.append(el("span", "b9r3h-edit__hint", "Pick a monster, set how many"));
    const then = (): HTMLElement => {
      const mark = el("span", "b9r3h-then", "›");
      mark.setAttribute("aria-hidden", "true");
      return mark;
    };
    preset.forEach(([id, count], index) => {
      const name = monsterEntry(id)?.name ?? id;
      if (index > 0) chips.append(then());
      if (index < preset.length - 1) {
        // An earlier stack: set, in its place.
        const chip = el("span", "b9r3h-chip b9r3h-chip--set");
        chip.setAttribute("role", "listitem");
        chip.setAttribute("aria-label", `Stack ${index + 1}: ${name}, ${count}`);
        chip.append(portrait(id, "b9r3h-chip__picture"), el("span", "b9r3h-chip__count", `×${count}`));
        chips.append(chip);
        return;
      }
      // The last stack: the one the count works on. A tap chooses its monster.
      const chip = btn(`b9r3h-chip b9r3h-chip--last${id === chosen ? " b9r3h-chip--on" : ""}`, `Stack ${index + 1}, the last: ${name}, ${count}. Change its count`);
      chip.append(portrait(id, "b9r3h-chip__picture"), el("span", "b9r3h-chip__count", `×${count}`));
      if (id === chosen) chip.append(el("span", "b9r3h-count-mark", "✎"));
      chip.addEventListener("click", () => this.root.querySelector<HTMLElement>(`.hatch-monster[data-monster="${id}"]`)?.click());
      chips.append(chip);
    });
    // Another monster is chosen: its stack would be the next one, shown faint at the end.
    if (preset.length && chosen && ready && !mine && max > 0) {
      const ghost = el("span", "b9r3h-chip b9r3h-chip--next");
      ghost.setAttribute("aria-hidden", "true");
      ghost.append(portrait(chosen, "b9r3h-chip__picture"), el("span", "b9r3h-chip__count", "+"));
      chips.append(then(), ghost);
    }
    const sum = el("span", "b9r3h-edit__sum");
    const goo = preset.reduce((total, [id, count]) => total + count * this.priceOf(id), 0);
    const stacks = el("span", "b9r3h-edit__stacks", `${this.stacksOf(preset)}/${QUEUE_STACKS}`);
    stacks.title = `Queue slots used; each holds up to ${this.size} monsters. A group may fill multiple slots.`;
    stacks.setAttribute("aria-label", `${this.stacksOf(preset)} of ${QUEUE_STACKS} queue slots; up to ${this.size} monsters per slot`);
    const cost = el("span", "b9r3h-edit__goo");
    cost.append(resourceIcon("r4"), el("span", "", short(goo)));
    sum.append(stacks, cost);
    const undo = btn("b9r3h-edit__undo", "Take off the last stack", art("undo", 24));
    undo.disabled = preset.length === 0;
    undo.addEventListener("click", () => {
      preset.pop();
      this.renderEditor();
    });
    const bin = btn("b9r3h-edit__bin", `Clear preset ${at + 1}`, "Clear");
    bin.disabled = preset.length === 0;
    bin.addEventListener("click", () => {
      preset.length = 0;
      this.renderEditor();
    });
    const done = btn("btn btn--primary b9r3h-edit__done", "Done: back to the presets", "Done");
    done.addEventListener("click", () => this.setTab("presets"));
    this.editHead.replaceChildren(which, chips, sum, undo, bin, done);

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
