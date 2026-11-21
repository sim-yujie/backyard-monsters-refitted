/**
 * DESIGN PROTOTYPE ONLY (b9 round 2, never merged): the Hatchery Control
 * Centre at levels 2 and 3 on the Hatch tab, with fake data. The owner
 * rejected round 1's A/B/C (21 Nov 2026).
 *
 * URL: `b9hcc=2|3`, `b9hccopt=d|e`, `b9state=` any of `remote`, `yards`,
 * `mix`, `inspect`, `housing` (comma list) to open a state for a picture.
 *
 * Shared: pictures and numbers, hardly a word. Mixes are five numbered
 * tokens (no names): a tap opens the mix's card with Load. The yard is "the
 * house" or "flag 3/11", never a name; the full names live in the yard page.
 *
 * - D "workbench" (Fable H1 + astra Y): everything on one screen. Hatcheries
 *   in a slim row, the ten stacks as a rack of sockets, the mix tokens, the
 *   monsters, Add. The yard is stepped with the outpost arrows.
 * - E "monster book" (astra X): the monsters own the tab. One production
 *   seal sums up the hatcheries, the queue and the time; a tap turns the tab
 *   over to the queue page. The yard chip opens the yard page.
 */
import type { HatchYard, QueueStack } from "@/game/monsters/hatchPlan";
import { monsterEntry } from "@/game/monsters/monsterCatalogue";
import { classicLook } from "@/game/classicLook";
import { gameIcon, type GameIconName } from "@/ui/gameIcon";
import { lockArt } from "@/ui/lockArt";
import { resourceIcon } from "@/ui/resourceIcon";
import { monsterPicture } from "@/ui/monsters/LockerTab";
import { ownYardsOf } from "@/game/yard/ownYards";
import { outpostLabels } from "@/game/yard/outpostLabels";
import type { BaseLoadResponse } from "@/api/types";
import { b9, b9HccLevel, b9HccOption } from "./b9";
import "./b9-hcc-r2.css";

const states = (): Set<string> => new Set((b9("b9state") ?? "").split(",").filter(Boolean));

/** The outpost with no HCC of its own in yardtester's copy. */
const NO_HCC = new Set(["22913802238208"]);

type Mix = readonly [string, number][];

const HOME_MIXES: readonly Mix[] = [
  [["C8", 60], ["C7", 40], ["C1", 40]],
  [["C12", 40], ["C5", 40], ["C10", 20]],
  [["C14", 40], ["C13", 60], ["C3", 40], ["C6", 20]],
  [["C6", 100], ["C9", 40]],
];
const OUTPOST_MIXES: readonly Mix[] = [
  [["C7", 60], ["C2", 40]],
  [["C1", 60]],
];
const MIX_SLOTS = 5;

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

interface YardRow {
  readonly kind: "main" | "outpost";
  readonly baseid: string;
  readonly title: string;
  readonly hcc: boolean;
  readonly pinned: boolean;
}

export class B9HccR2 {
  readonly level = b9HccLevel();
  readonly option = b9HccOption() === "e" ? "e" : "d";
  private readonly open = states();
  private remote: YardRow | null = null;
  private mixOpen: number | null = null;
  private yard: HatchYard | null = null;
  private readonly strip = el("div", "b9r2h-strip");
  private readonly seal = btn("b9r2h-seal", "The queue and the hatcheries");
  private readonly mixes = el("div", "b9r2h-mixes");
  private readonly bench = el("div", "b9r2h-bench");
  private readonly mixCard = el("section", "b9r2h-mixcard");
  private readonly yardsPage = el("section", "b9r2h-yards");
  private readonly back = btn("b9r2h-back", "Back to the monsters");

  constructor(
    private readonly root: HTMLElement,
    private readonly scroll: HTMLElement,
    private readonly save: () => BaseLoadResponse,
    private readonly redraw: () => void,
    private readonly hatcheryArt: () => string,
  ) {
    root.classList.add("b9r2h", `b9r2h-opt-${this.option}`, `b9r2h-level-${this.level}`);
    root.closest(".monsters-screen, .panel")?.classList.add("b9r2h-window");
    if (this.open.has("remote") && this.level >= 3) {
      this.remote = this.hccYards().find((one) => one.kind === "outpost") ?? null;
    }
    if (this.open.has("mix")) this.mixOpen = 0;
    root.prepend(this.strip);
    root.append(this.mixCard, this.yardsPage);
    this.yardsPage.hidden = !(this.open.has("yards") && this.level >= 3);
    this.mixes.setAttribute("role", "group");
    this.mixes.setAttribute("aria-label", "Saved mixes");
    this.seal.addEventListener("click", () => this.setInspect(true));
    this.back.append(arrow(-1));
    this.back.addEventListener("click", () => this.setInspect(false));
    if (this.option === "e" && this.open.has("inspect")) root.classList.add("b9r2h-inspect");
    if (this.open.has("housing")) root.classList.add("b9r2h-show-housing");
  }

  /** The yard the tab shows: the fake busiest queue, or the outpost being run from home. */
  fakeYard(yard: HatchYard): HatchYard {
    const size = this.level >= 3 ? 30 : 20;
    if (this.remote) {
      const endsAt = Math.floor(Date.now() / 1000) + 620;
      const hatcheries = yard.hatcheries
        .slice(0, 2)
        .map((one) => ({ ...one, monster: "C7", stage: 1 as const, countdown: 620, state: "producing" as const, endsAt }));
      return { ...yard, hatcheries, shared: outpostQueue(size), capacity: 9_600, housed: { C7: 120, C2: 80 }, goo: 18_400_000 };
    }
    return { ...yard, shared: busyQueue(size) };
  }

  /** After each draw of the tab: the strip, the seal and the mix tokens take their places. */
  afterDraw(yard?: HatchYard): void {
    if (yard) this.yard = yard;
    this.root.closest(".monsters-screen, .panel")?.classList.add("b9r2h-window");
    this.root.classList.toggle("b9r2h-remote", this.remote !== null);
    const lines = this.scroll.querySelector(".hatch-lines");
    if (lines && !this.bench.isConnected) {
      // The bench: the production (D: the line itself, E: its seal) with the mix tokens beside or under it.
      lines.before(this.bench);
      if (this.option === "e") {
        this.bench.append(this.seal, this.mixes);
        lines.before(this.back);
      } else {
        this.bench.append(lines, this.mixes);
      }
    }
    // Remote: Add wears the outpost's flag, so the last tap says where it goes.
    const add = this.root.querySelector(".hatch-add__add");
    add?.querySelector(".b9r2h-addflag")?.remove();
    if (add && this.remote) add.prepend(art("outpost", 24, "b9r2h-addflag"));
    for (const clear of this.root.querySelectorAll<HTMLButtonElement>("button.hatch-clear")) {
      // Keep the live control's accessible name and confirmation handler.
      clear.replaceChildren(el("span", "", "Clear"));
    }
    this.renderStrip();
    this.renderSeal();
    this.renderMixes();
    this.renderMixCard();
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
    this.mixOpen = null;
    this.redraw();
  }

  private setInspect(on: boolean): void {
    this.root.classList.toggle("b9r2h-inspect", on);
    this.mixOpen = null;
    this.renderMixCard();
  }

  /* ── The strip: which yard, and its housing ───────────────────────── */

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
      if (this.option === "d") {
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
      } else {
        const chip = btn("b9r2h-yard b9r2h-yard--chip", "Choose a yard", this.where(), el("span", "b9r2h-caret", "▾"));
        chip.addEventListener("click", () => this.toggleYards());
        parts.push(chip);
      }
    }
    parts.push(this.housing());
    this.strip.replaceChildren(...parts);
  }

  /** The housing: now / room, what the queue adds, and the bar. A tap shows the tab's own housing box. */
  private housing(): HTMLElement {
    const yard = this.yard;
    const housed = this.remote ? 3_200 : 2_080;
    const room = yard && this.remote ? yard.capacity : 2_160;
    const coming = this.remote ? 2_022 : this.level >= 3 ? 17_500 : 11_880;
    const over = housed + coming > room;
    const box = btn(`b9r2h-housing${over ? " b9r2h-housing--over" : ""}`, "Housing");
    box.setAttribute("aria-label", `Housing ${housed} of ${room}; queue adds ${coming}`);
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

  /* ── E: the production seal ───────────────────────────────────────── */

  private renderSeal(): void {
    if (this.option !== "e") return;
    const yard = this.yard;
    if (!yard) return;
    const busy = yard.hatcheries.filter((one) => one.monster !== null).length;
    const stalled = this.root.querySelector(".hatch-now--stalled") !== null;
    const hatchery = el("span", `b9r2h-seal__part${stalled ? " b9r2h-seal__part--stalled" : ""}`);
    const picture = el("img", "b9r2h-seal__hatchery");
    picture.src = this.hatcheryArt();
    picture.alt = "";
    hatchery.append(picture, el("span", "b9r2h-seal__number", `${busy}/${yard.hatcheries.length}`));
    if (stalled) hatchery.append(art("housing", 24, "b9r2h-seal__blocked"));
    if (stalled) hatchery.querySelector(".b9r2h-seal__number")?.append(el("span", "b9r2h-seal__state", "Full"));
    this.seal.setAttribute("aria-label", stalled ? "Housing full: inspect the queue and waiting hatcheries" : "The queue and the hatcheries");
    const queue = el("span", "b9r2h-seal__part b9r2h-seal__part--queue");
    const faces = el("span", "b9r2h-faces");
    const seen = new Set<string>();
    for (const [id] of yard.shared) {
      if (seen.has(id) || seen.size >= 4) continue;
      seen.add(id);
      faces.append(portrait(id, "b9r2h-face"));
    }
    queue.append(faces, el("span", "b9r2h-seal__number", `${yard.shared.length}/10`));
    const time = el("span", "b9r2h-seal__part");
    const done = this.root.querySelector(".hatch-line__done")?.textContent ?? "";
    time.append(art("time", 24, "b9r2h-seal__clock"), el("span", "b9r2h-seal__number", done));
    this.seal.replaceChildren(hatchery, queue, time, el("span", "b9r2h-seal__go", "›"));
  }

  /* ── Mixes: five numbered tokens ──────────────────────────────────── */

  private mixList(): readonly Mix[] {
    return this.remote ? OUTPOST_MIXES : HOME_MIXES;
  }

  private renderMixes(): void {
    const mixes = this.mixList();
    const tokens: Node[] = [];
    for (let at = 0; at < MIX_SLOTS; at += 1) {
      const mix = mixes[at];
      if (!mix) {
        const empty = btn("b9r2h-mix b9r2h-mix--empty", `Save the queue as mix ${at + 1}`, el("span", "b9r2h-mix__number", String(at + 1)), el("span", "b9r2h-mix__plus", "+"));
        tokens.push(empty);
        continue;
      }
      const total = mix.reduce((sum, [, count]) => sum + count, 0);
      const token = btn(`b9r2h-mix${this.mixOpen === at ? " b9r2h-mix--on" : ""}`, `Mix ${at + 1}, ${total} monsters`);
      const faces = el("span", "b9r2h-faces");
      for (const [id] of mix.slice(0, 3)) faces.append(portrait(id, "b9r2h-face"));
      token.append(el("span", "b9r2h-mix__number", String(at + 1)), faces, el("span", "b9r2h-mix__total", `×${total}`));
      token.addEventListener("click", () => {
        this.mixOpen = this.mixOpen === at ? null : at;
        this.renderMixes();
        this.renderMixCard();
      });
      tokens.push(token);
    }
    this.mixes.replaceChildren(...tokens);
  }

  /** A token's card: every stack of the mix, what it costs, Load; replace and bin as pictures. */
  private renderMixCard(): void {
    const mix = this.mixOpen === null ? undefined : this.mixList()[this.mixOpen];
    this.mixCard.hidden = !mix;
    if (!mix) return;
    const head = el("header", "b9r2h-mixcard__head");
    const stacks = el("div", "b9r2h-mixcard__stacks");
    let goo = 0;
    let space = 0;
    for (const [id, count] of mix) {
      const stack = el("span", "b9r2h-socket");
      stack.append(portrait(id, "b9r2h-socket__picture"), el("span", "b9r2h-socket__count", `×${count}`));
      stacks.append(stack);
      goo += count * 21_000;
      space += count * 8;
    }
    const cost = el("span", "b9r2h-mixcard__cost");
    const gooIcon = resourceIcon("r4");
    cost.append(gooIcon, el("span", "", short(goo)), art("housing", 24, "b9r2h-housing__icon"), el("span", "", short(space)));
    const close = btn("b9r2h-mixcard__close", "Close", "✕");
    close.addEventListener("click", () => {
      this.mixOpen = null;
      this.renderMixes();
      this.renderMixCard();
    });
    head.append(el("span", "b9r2h-mix__number b9r2h-mixcard__number", String((this.mixOpen ?? 0) + 1)), cost, close);
    const actions = el("div", "b9r2h-mixcard__actions");
    const load = btn("btn btn--primary b9r2h-mixcard__load", "Load this mix into the queue", "Load");
    // Load stays enabled on a full queue: whether it replaces or adds is the owner's call (report).
    const replace = btn("btn btn--secondary b9r2h-mixcard__tool", "Save the queue over this mix", art("lastarmy", 24), "Save over");
    const bin = btn("btn btn--ghost b9r2h-mixcard__tool b9r2h-mixcard__bin", "Empty this mix", "Empty");
    actions.append(load, replace, bin);
    this.mixCard.replaceChildren(head, stacks, actions);
    // Under the tokens, wherever the option put them.
    const tokens = this.mixes.getBoundingClientRect();
    const box = this.root.getBoundingClientRect();
    this.mixCard.style.top = `${Math.round(tokens.bottom - box.top + 6)}px`;
    // Wide: under its own tokens, kept inside the tab.
    this.mixCard.style.left = box.width > 620 ? `${Math.round(Math.max(12, Math.min(tokens.left - box.left, box.width - 420)))}px` : "";
  }

  /* ── The yard page (L3): every yard with an HCC, as cards ─────────── */

  private toggleYards(): void {
    this.yardsPage.hidden = !this.yardsPage.hidden;
    this.mixOpen = null;
    this.renderMixCard();
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
