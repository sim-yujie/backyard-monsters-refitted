/**
 * DESIGN PROTOTYPE ONLY (b9, never merged): the Hatchery Control Centre at
 * levels 2 and 3 on the Hatch tab, with fake data.
 *
 * URL: `b9hcc=2|3` (the HCC's level), `b9hccopt=a|b|c` (the option),
 * `b9state=` any of `mixes`, `picker`, `remote`, `queue` (comma list) to open
 * a state for a screenshot. Taps work too.
 *
 * - A: queue first; a Mixes drawer; a yard chip over the tab (L3).
 * - B: Build | Queue workspaces; mixes as rows under the queue.
 * - C: a yard rail on the left (L3); mixes in a drop-down beside Save.
 */
import type { HatchYard, QueueStack } from "@/game/monsters/hatchPlan";
import { monsterEntry } from "@/game/monsters/monsterCatalogue";
import { gameIcon } from "@/ui/gameIcon";
import { lockArt } from "@/ui/lockArt";
import { monsterPicture } from "@/ui/monsters/LockerTab";
import { ownYardsOf } from "@/game/yard/ownYards";
import { outpostLabels } from "@/game/yard/outpostLabels";
import type { BaseLoadResponse } from "@/api/types";
import { b9, b9HccLevel, b9HccOption } from "./b9";
import "./b9-hcc.css";

export const b9HccOn = (): boolean => b9HccLevel() >= 2;
export const b9Stacks = (normal: number): number => (b9HccLevel() >= 2 ? 10 : normal);
export const b9StackSize = (normal: number): number => (b9HccLevel() >= 3 ? 30 : normal);

const states = (): Set<string> => new Set((b9("b9state") ?? "").split(",").filter(Boolean));

/** The outpost with no HCC of its own in yardtester's copy. */
const NO_HCC = new Set(["22913802238208"]);

interface Mix {
  readonly name: string;
  readonly stacks: readonly [string, number][];
}

const HOME_MIXES: readonly Mix[] = [
  { name: "Fang rush", stacks: [["C8", 60], ["C7", 40], ["C1", 40]] },
  { name: "Tank wall", stacks: [["C12", 40], ["C5", 40], ["C10", 20]] },
  { name: "Flyers", stacks: [["C14", 40], ["C13", 60], ["C3", 40], ["C6", 20]] },
  { name: "Farm raid", stacks: [["C6", 100], ["C9", 40]] },
];

const OUTPOST_MIXES: readonly Mix[] = [
  { name: "Outpost guard", stacks: [["C7", 60], ["C2", 40]] },
  { name: "Quick top-up", stacks: [["C1", 60]] },
];

const MIX_SLOTS = 5;

/** The busiest queue: ten stacks, mixed. */
const busyQueue = (size: number): QueueStack[] =>
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
  ).map(([id, count]) => [id, count, 6] as QueueStack);

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

const btn = (className: string, ...content: (Node | string)[]): HTMLButtonElement => {
  const node = el("button", className);
  node.type = "button";
  node.append(...content);
  return node;
};

const portrait = (id: string, className: string): Node => {
  const entry = monsterEntry(id);
  return entry ? monsterPicture(entry, "small", className) : el("span", className);
};

export class B9Hcc {
  readonly level = b9HccLevel();
  readonly option = b9HccOption();
  private readonly open = states();
  private remote: { baseid: string; title: string } | null = null;
  private view: "build" | "queue" = "queue";
  private columns = false;
  private readonly bar = el("div", "b9-hcc-bar");
  private readonly drawer = el("section", "b9-mixes");
  private readonly picker = el("section", "b9-yards");
  private readonly rail = el("nav", "b9-rail");
  private readonly mixRows = el("section", "b9-mixrows");

  constructor(
    private readonly root: HTMLElement,
    private readonly scroll: HTMLElement,
    private readonly save: () => BaseLoadResponse,
    private readonly redraw: () => void,
  ) {
    root.classList.add("b9-hcc", `b9-opt-${this.option}`, `b9-level-${this.level}`);
    if (this.open.has("build")) this.view = "build";
    if (this.open.has("rail")) root.classList.add("b9-show-rail");
    if (this.open.has("remote")) {
      const first = this.yards().find((one) => one.kind === "outpost" && one.hcc);
      if (first) this.remote = { baseid: first.baseid, title: first.title };
    }
    root.prepend(this.bar);
    if (this.option === "c" && this.level >= 3) root.prepend(this.rail);
    root.append(this.drawer, this.picker);
    this.drawer.hidden = !this.open.has("mixes");
    this.picker.hidden = !this.open.has("picker");
    this.render();
  }

  /** The yard the tab shows: the fake busiest queue, or the outpost being run from home. */
  fakeYard(yard: HatchYard): HatchYard {
    const size = b9StackSize(20);
    if (this.remote) {
      const endsAt = Math.floor(Date.now() / 1000) + 620;
      const hatcheries = yard.hatcheries
        .slice(0, 2)
        .map((one) => ({ ...one, monster: "C7", stage: 1 as const, countdown: 620, state: "producing" as const, endsAt }));
      return { ...yard, hatcheries, shared: outpostQueue(size), capacity: 9_600, housed: { C7: 120, C2: 80 }, goo: 18_400_000 };
    }
    return { ...yard, shared: busyQueue(size) };
  }

  /** After each draw of the tab: the mix rows of B go under the queue. */
  afterDraw(): void {
    this.root.classList.toggle("b9-remote", this.remote !== null);
    // The window's housing line names the yard it counts while an outpost is run from home.
    const value = this.root.closest(".monsters-screen, .panel")?.querySelector<HTMLElement>(".monsters-header__value");
    const label = this.root.closest(".monsters-screen, .panel")?.querySelector<HTMLElement>(".monsters-header__label");
    if (value && label) {
      if (!label.dataset["b9"]) label.dataset["b9"] = label.textContent ?? "";
      if (!value.dataset["b9"]) value.dataset["b9"] = value.textContent ?? "";
      label.textContent = this.remote ? `Housing · ${this.remote.title}` : label.dataset["b9"];
      value.textContent = this.remote ? "3,200 / 9,600" : value.dataset["b9"];
    }
    this.root.classList.toggle("b9-view-build", this.view === "build");
    this.root.classList.toggle("b9-view-queue", this.view === "queue");
    {
      const totals = this.scroll.querySelector(".hatch-line--hcc .hatch-line__totals");
      const spacer = this.bar.querySelector(".b9-hcc-bar__spacer");
      if (totals && spacer) spacer.replaceWith(totals);
      else if (totals) this.bar.querySelector(".hatch-line__totals")?.replaceWith(totals);
    }
    if (this.option === "b" && !this.columns) {
      // B: the monsters in one column, the queue workspace in the other.
      const left = el("div", "b9-col b9-col--build");
      const right = el("div", "b9-col b9-col--queue");
      const pick = this.scroll.querySelector(".hatch-pick");
      const info = this.scroll.querySelector(".hatch-info");
      const lines = this.scroll.querySelector(".hatch-lines");
      const boosts = this.scroll.querySelector(".hatch-boosts");
      const message = this.scroll.querySelector(".hatch-message");
      const split = this.scroll.querySelector(".hatch__split");
      if (pick && info && lines && boosts && message && split) {
        left.append(pick, info);
        right.append(lines, boosts, this.mixRows, message);
        split.append(left, right);
        this.columns = true;
      }
    }
  }

  private yards(): { kind: "main" | "outpost"; baseid: string; title: string; coords: string; hcc: boolean; pinned: boolean }[] {
    const save = this.save();
    const entries = ownYardsOf(save, { kind: "main" } as never, outpostLabels());
    return entries.map((entry) => {
      const target = entry.target as unknown as { kind: string; baseid?: string };
      const baseid = target.baseid ?? "main";
      const coords = entry.name ? "" : "";
      return {
        kind: target.kind === "outpost" ? ("outpost" as const) : ("main" as const),
        baseid,
        title: entry.title,
        coords,
        hcc: target.kind !== "outpost" || !NO_HCC.has(baseid),
        pinned: entry.pinned,
      };
    });
  }

  private mixes(): readonly Mix[] {
    return this.remote ? OUTPOST_MIXES : HOME_MIXES;
  }

  private render(): void {
    this.renderBar();
    this.renderDrawer();
    this.renderPicker();
    this.renderRail();
    this.renderMixRows();
  }

  /* ── The bar over the tab ─────────────────────────────────────────── */

  private renderBar(): void {
    const parts: Node[] = [];
    if (this.option !== "c" || this.level < 3) parts.push(this.yardChip());
    else {
      // C on a phone: the editor's way back to the yard list.
      if (this.remote) {
        const home = btn("b9-chip b9-chip--home");
        home.append(gameIcon("townhall", { size: 24, decorative: true }), el("span", "b9-chip__words", "Home"));
        home.addEventListener("click", () => this.setRemote(null));
        parts.push(home);
      }
      const back = btn(`b9-chip${this.remote ? " b9-chip--remote" : " b9-only-phone"}`);
      back.append("‹ ", gameIcon("outpost", { size: 24, decorative: true }), el("span", "b9-chip__words", this.remote?.title ?? "Main yard"));
      back.addEventListener("click", () => {
        this.root.classList.add("b9-show-rail");
      });
      parts.push(back);
    }
    if (this.option === "b") parts.push(this.viewSwitch());
    const kept = this.bar.querySelector(".hatch-line__totals");
    parts.push(kept ?? el("span", "b9-hcc-bar__spacer"));
    if (this.option === "a") parts.push(this.mixesButton());
    if (this.option === "c") parts.push(...this.mixDropdown());
    this.bar.replaceChildren(...parts);
  }

  private yardChip(): HTMLElement {
    if (this.level < 3) {
      const locked = btn("b9-chip b9-chip--locked");
      locked.disabled = true;
      locked.title = "Run your outposts' HCCs from here at HCC level 3";
      const lock = el("span", "b9-lock");
      lock.append(lockArt(14), " HCC 3");
      locked.append(gameIcon("outpost", { size: 24, decorative: true }), el("span", "b9-chip__words", "Outposts"), lock);
      return locked;
    }
    if (this.remote) {
      const box = el("div", "b9-remote-chip");
      const home = btn("b9-chip b9-chip--home");
      home.append(gameIcon("townhall", { size: 24, decorative: true }), el("span", "b9-chip__words", "Home"));
      home.addEventListener("click", () => this.setRemote(null));
      const where = btn("b9-chip b9-chip--remote");
      where.append(
        gameIcon("outpost", { size: 24, decorative: true }),
        el("span", "b9-chip__words", this.remote.title),
        el("span", "b9-caret", "▾"),
      );
      where.addEventListener("click", () => this.toggle(this.picker));
      box.append(home, where);
      return box;
    }
    const chip = btn("b9-chip");
    chip.append(gameIcon("townhall", { size: 24, decorative: true }), el("span", "b9-chip__words", "Main yard"), el("span", "b9-caret", "▾"));
    chip.title = "Run another yard's HCC from here";
    chip.addEventListener("click", () => this.toggle(this.picker));
    return chip;
  }

  private viewSwitch(): HTMLElement {
    const box = el("div", "b9-switch");
    box.setAttribute("role", "tablist");
    const make = (id: "build" | "queue", words: string, count?: number): HTMLButtonElement => {
      const tab = btn(`b9-switch__tab${this.view === id ? " b9-switch__tab--on" : ""}`, words);
      if (count !== undefined) tab.append(el("span", "b9-switch__count", String(count)));
      tab.setAttribute("role", "tab");
      tab.setAttribute("aria-selected", String(this.view === id));
      tab.addEventListener("click", () => {
        this.view = id;
        this.render();
        this.afterDraw();
      });
      return tab;
    };
    box.append(make("build", "Build"), make("queue", "Queue", 10));
    return box;
  }

  private mixesButton(): HTMLButtonElement {
    const button = btn("btn btn--secondary b9-mixes-button");
    button.append(gameIcon("lastarmy", { size: 24, decorative: true }), el("span", "", "Mixes"), el("span", "b9-badge", String(this.mixes().length)));
    button.setAttribute("aria-expanded", String(!this.drawer.hidden));
    button.addEventListener("click", () => this.toggle(this.drawer));
    return button;
  }

  private mixDropdown(): Node[] {
    const select = el("select", "b9-select");
    select.setAttribute("aria-label", "Load a mix");
    const first = el("option", "", `Load a mix (${this.mixes().length}/${MIX_SLOTS})`);
    select.append(first, ...this.mixes().map((mix) => el("option", "", mix.name)));
    const save = btn("btn btn--secondary b9-save");
    save.append(gameIcon("lastarmy", { size: 24, decorative: true }), "Save mix");
    return [select, save];
  }

  private toggle(panel: HTMLElement): void {
    const opening = panel.hidden;
    this.drawer.hidden = true;
    this.picker.hidden = true;
    panel.hidden = !opening;
    this.renderBar();
  }

  private setRemote(remote: { baseid: string; title: string } | null): void {
    this.remote = remote;
    this.root.classList.remove("b9-show-rail");
    this.picker.hidden = true;
    this.render();
    this.redraw();
  }

  /* ── Mixes ───────────────────────────────────────────────────────── */

  private mixRow(mix: Mix): HTMLElement {
    const row = el("li", "b9-mix");
    const name = el("span", "b9-mix__name", mix.name);
    const faces = el("span", "b9-mix__faces");
    for (const [id, count] of mix.stacks.slice(0, 4)) {
      const face = el("span", "b9-mix__face");
      face.append(portrait(id, "b9-mix__picture"), el("span", "b9-mix__count", `×${count}`));
      faces.append(face);
    }
    const total = mix.stacks.reduce((sum, [, count]) => sum + count, 0);
    const meta = el("span", "b9-mix__meta");
    meta.append(gameIcon("housing", { size: 16, decorative: true }), `${total * 8} space`);
    const load = btn("btn btn--primary b9-mix__load", "Load");
    load.title = `Fill the queue with ${mix.name}`;
    const edit = btn("btn btn--ghost b9-mix__edit", "✎");
    edit.setAttribute("aria-label", `Rename or replace ${mix.name}`);
    const words = el("span", "b9-mix__words");
    words.append(name, meta);
    row.append(words, faces, load, edit);
    return row;
  }

  private emptyRow(): HTMLElement {
    const row = el("li", "b9-mix b9-mix--empty");
    const save = btn("btn btn--secondary b9-mix__saveslot");
    save.append(gameIcon("lastarmy", { size: 24, decorative: true }), "Save queue here");
    row.append(save);
    return row;
  }

  private mixList(): HTMLElement {
    const list = el("ul", "b9-mix-list");
    const mixes = this.mixes();
    list.append(...mixes.map((mix) => this.mixRow(mix)));
    for (let free = MIX_SLOTS - mixes.length; free > 0; free -= 1) list.append(this.emptyRow());
    return list;
  }

  private renderDrawer(): void {
    if (this.option !== "a") {
      this.drawer.hidden = true;
      return;
    }
    const head = el("header", "b9-panel__head");
    const title = el("h3", "b9-panel__title");
    title.append(gameIcon("lastarmy", { size: 24, decorative: true }), "Mixes");
    const close = btn("b9-panel__close", "✕");
    close.setAttribute("aria-label", "Close mixes");
    close.addEventListener("click", () => this.toggle(this.drawer));
    const save = btn("btn btn--secondary b9-save");
    save.append(gameIcon("lastarmy", { size: 24, decorative: true }), "Save queue");
    head.append(title, el("span", "b9-panel__slots", `${this.mixes().length}/${MIX_SLOTS}`), save, close);
    this.drawer.replaceChildren(head, this.mixList());
  }

  private renderMixRows(): void {
    if (this.option !== "b") return;
    const head = el("header", "b9-mixrows__head");
    const title = el("h3", "b9-panel__title");
    title.append(gameIcon("lastarmy", { size: 24, decorative: true }), "Mixes");
    head.append(title, el("span", "b9-panel__slots", `${this.mixes().length}/${MIX_SLOTS}`));
    this.mixRows.replaceChildren(head, this.mixList());
  }

  /* ── Yards (L3) ──────────────────────────────────────────────────── */

  private yardRow(yard: ReturnType<B9Hcc["yards"]>[number], current: boolean): HTMLElement {
    const row = btn(`b9-yard${current ? " b9-yard--on" : ""}${yard.hcc ? "" : " b9-yard--off"}`);
    row.disabled = !yard.hcc;
    row.append(gameIcon(yard.kind === "main" ? "townhall" : "outpost", { size: 32, decorative: true }));
    const words = el("span", "b9-yard__words");
    words.append(el("span", "b9-yard__name", yard.title));
    if (yard.coords && yard.coords !== yard.title) words.append(el("span", "b9-yard__coords", yard.coords));
    row.append(words);
    if (yard.pinned) row.append(gameIcon("pin", { size: 16, label: "Pinned" }));
    if (!yard.hcc) row.append(el("span", "b9-yard__tag", "No HCC"));
    else if (yard.kind === "outpost") row.append(el("span", "b9-yard__queue", `×${yard.baseid.endsWith("9") ? 140 : 60}`));
    row.addEventListener("click", () => this.setRemote(yard.kind === "main" ? null : { baseid: yard.baseid, title: yard.title }));
    return row;
  }

  private yardList(): HTMLElement {
    const list = el("div", "b9-yard-list");
    const yards = this.yards();
    const withHcc = yards.filter((one) => one.hcc);
    const without = yards.filter((one) => !one.hcc);
    for (const yard of [...withHcc, ...without]) {
      const current = this.remote ? yard.baseid === this.remote.baseid : yard.kind === "main";
      list.append(this.yardRow(yard, current));
    }
    return list;
  }

  private search(): HTMLElement {
    const box = el("label", "b9-search");
    box.append(gameIcon("find", { size: 24, decorative: true }));
    const input = el("input", "b9-search__input");
    input.placeholder = "Find a yard";
    input.setAttribute("aria-label", "Find a yard");
    box.append(input);
    return box;
  }

  private renderPicker(): void {
    if (this.level < 3 || this.option === "c") {
      this.picker.hidden = true;
      return;
    }
    const head = el("header", "b9-panel__head");
    const count = this.yards().filter((one) => one.kind === "outpost" && one.hcc).length;
    const title = el("h3", "b9-panel__title");
    title.append(gameIcon("outpost", { size: 24, decorative: true }), "Run an HCC");
    const close = btn("b9-panel__close", "✕");
    close.setAttribute("aria-label", "Close the yard list");
    close.addEventListener("click", () => this.toggle(this.picker));
    head.append(title, el("span", "b9-panel__slots", `${count} outposts`), close);
    this.picker.replaceChildren(head, this.search(), this.yardList());
  }

  private renderRail(): void {
    if (this.option !== "c" || this.level < 3) return;
    const head = el("header", "b9-panel__head");
    const title = el("h3", "b9-panel__title");
    title.append(gameIcon("outpost", { size: 24, decorative: true }), "Yards");
    head.append(title);
    this.rail.replaceChildren(head, this.search(), this.yardList());
  }
}
