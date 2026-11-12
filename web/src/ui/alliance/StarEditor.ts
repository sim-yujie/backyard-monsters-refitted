import { starFiguresApi, type EditorConstellation, type StarFiguresApi } from "@/api/starFigures";
import { monsterPortrait, showPortrait } from "@/game/portraits";
import {
  ART_TOP,
  BUILT_IN_FIGURES,
  CONSTELLATION_MONSTERS,
  FIGURE_HEIGHT,
  FIGURE_WIDTH,
  figureFor,
  isStarFigure,
  type StarFigure,
  type StarPoint,
} from "@/ui/alliance/starFigures";
import { make } from "@/ui/friends/rows";
import { Popup } from "@/ui/Popup";

/**
 * The owner's star editor (owner, 10 Nov: "can I manually modify how the
 * stars look via an in-game monitor?"). Only an admin sees the button that
 * opens it (`can_edit_stars`), and only an admin may call its routes.
 *
 * Pick a constellation, drag its 10 stars over the monster, click two stars
 * to join or unjoin them, Save. A save goes to the server and from there to
 * every player's Constellation tab (`starFigures.ts`). "Copy" gives every
 * figure as JSON, to paste into `BUILT_IN_FIGURES` when a drawing should ship
 * with the game.
 */

type Line = readonly [number, number];

/** A figure being edited: plain arrays. */
export interface Draft {
  stars: [number, number][];
  lines: [number, number][];
}

export const toDraft = (figure: StarFigure): Draft => ({
  stars: figure.stars.map(([x, y]) => [x, y]),
  lines: figure.lines.map(([a, b]) => [Math.min(a, b), Math.max(a, b)]),
});

const sameLine = (line: Line, a: number, b: number): boolean =>
  (line[0] === a && line[1] === b) || (line[0] === b && line[1] === a);

/** Joins two stars, or unjoins them when they are joined. */
export const toggleLine = (draft: Draft, a: number, b: number): Draft => {
  if (a === b) return draft;
  const joined = draft.lines.some((line) => sameLine(line, a, b));
  return {
    stars: draft.stars,
    lines: joined ? draft.lines.filter((line) => !sameLine(line, a, b)) : [...draft.lines, [Math.min(a, b), Math.max(a, b)]],
  };
};

const round1 = (value: number): number => Math.round(value * 10) / 10;

/** Moves a star, kept inside the box. */
export const moveStar = (draft: Draft, index: number, x: number, y: number): Draft => ({
  stars: draft.stars.map((star, i) =>
    i === index ? [round1(Math.min(Math.max(x, 0), FIGURE_WIDTH)), round1(Math.min(Math.max(y, 0), FIGURE_HEIGHT))] : star,
  ),
  lines: draft.lines,
});

const sameDraft = (a: Draft, b: Draft): boolean => JSON.stringify(a) === JSON.stringify(b);

/** Every constellation's figure as it would show now (drafts included), for pasting into the code. */
export const figuresJson = (ids: readonly string[], figureOf: (id: string) => Draft): string =>
  `{\n${ids
    .map((id) => {
      const { stars, lines } = figureOf(id);
      const s = stars.map(([x, y]) => `[${x}, ${y}]`).join(", ");
      const l = lines.map(([a, b]) => `[${a}, ${b}]`).join(", ");
      return `  ${id}: {\n    stars: [${s}],\n    lines: [${l}],\n  },`;
    })
    .join("\n")}\n}`;

const SVG = "http://www.w3.org/2000/svg";
const svg = <K extends keyof SVGElementTagNameMap>(tag: K, attrs: Record<string, string | number>): SVGElementTagNameMap[K] => {
  const node = document.createElementNS(SVG, tag);
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, String(v));
  return node;
};

const button = (words: string, className: string, run: () => void, title?: string): HTMLButtonElement => {
  const node = make("button", `btn ${className}`, words);
  node.type = "button";
  if (title) node.title = title;
  node.addEventListener("click", () => run());
  return node;
};

const TYPE_WORDS: Readonly<Record<string, string>> = { midas: "Midas", conquest: "Conquest", fortress: "Fortress" };

export interface StarEditorOptions {
  readonly api?: StarFiguresApi;
  /** After closing; `saved` when anything was saved, so the tab can reload. */
  readonly onClose?: (saved: boolean) => void;
}

export class StarEditor {
  readonly popup: Popup;
  private readonly api: StarFiguresApi;
  private readonly status = make("p", "star-editor__status");
  private constellations: readonly EditorConstellation[] = [];
  private saved: Readonly<Record<string, unknown>> = {};
  private readonly drafts = new Map<string, Draft>();
  private readonly undo = new Map<string, Draft[]>();
  private chosen: string | null = null;
  private selected: number | null = null;
  private savedAny = false;
  private copyText: string | null = null;

  constructor(options: StarEditorOptions = {}) {
    this.api = options.api ?? starFiguresApi;
    this.popup = new Popup({
      title: "Star editor",
      className: "star-editor",
      onClose: () => options.onClose?.(this.savedAny),
    });
    this.status.setAttribute("role", "status");
    this.popup.body.classList.add("star-editor__body");
    this.popup.element.addEventListener("keydown", (event) => this.onKey(event));
  }

  mount(container: HTMLElement): this {
    this.render();
    this.popup.mount(container);
    void this.load();
    return this;
  }

  close(): void {
    this.popup.close();
  }

  /** The figure shown for `id`: its draft, else the saved one, else the built-in one. */
  figureOf(id: string): Draft {
    return this.drafts.get(id) ?? toDraft(figureFor(id, 0, this.saved));
  }

  private savedFigure(id: string): Draft {
    return toDraft(figureFor(id, 0, this.saved));
  }

  private dirty(id: string): boolean {
    const draft = this.drafts.get(id);
    return draft !== undefined && !sameDraft(draft, this.savedFigure(id));
  }

  async load(): Promise<void> {
    this.say("Loading…");
    const answer = await this.api.load();
    if (!answer.ok) {
      this.say(answer.message, "bad");
      return;
    }
    this.constellations = answer.constellations;
    this.saved = answer.figures;
    this.chosen ??= answer.constellations[0]?.id ?? null;
    this.say(null);
    this.render();
  }

  private say(text: string | null, tone: "info" | "bad" | "good" = "info"): void {
    this.status.textContent = text ?? "";
    this.status.hidden = !text;
    this.status.className = `star-editor__status star-editor__status--${tone}`;
  }

  /** Changes the chosen figure, keeping the old one for Undo. */
  private change(next: Draft, remember = true): void {
    const id = this.chosen;
    if (!id) return;
    if (remember) {
      const stack = this.undo.get(id) ?? [];
      stack.push(this.figureOf(id));
      if (stack.length > 50) stack.shift();
      this.undo.set(id, stack);
    }
    this.drafts.set(id, next);
    this.render();
  }

  private choose(id: string): void {
    this.chosen = id;
    this.selected = null;
    this.copyText = null;
    this.render();
  }

  private async save(): Promise<void> {
    const id = this.chosen;
    if (!id) return;
    const figure = this.figureOf(id);
    this.say("Saving…");
    const answer = await this.api.save(id, figure);
    if (!answer.ok) {
      this.say(answer.message, "bad");
      return;
    }
    this.saved = answer.figures;
    this.drafts.delete(id);
    this.savedAny = true;
    this.say("Saved: every player sees it next time the tab opens.", "good");
    this.render();
  }

  /** Drops the saved figure: the built-in one shows again for everyone. */
  private async useBuiltIn(): Promise<void> {
    const id = this.chosen;
    if (!id) return;
    this.say("Saving…");
    const answer = await this.api.save(id, null);
    if (!answer.ok) {
      this.say(answer.message, "bad");
      return;
    }
    this.saved = answer.figures;
    this.drafts.delete(id);
    this.undo.delete(id);
    this.savedAny = true;
    this.say("Back to the built-in figure.", "good");
    this.render();
  }

  private undoLast(): void {
    const id = this.chosen;
    const previous = id ? this.undo.get(id)?.pop() : undefined;
    if (!id || !previous) return;
    this.change(previous, false);
  }

  private revert(): void {
    const id = this.chosen;
    if (!id) return;
    this.drafts.delete(id);
    this.undo.delete(id);
    this.selected = null;
    this.render();
  }

  private copy(): void {
    const text = figuresJson(
      this.constellations.map((c) => c.id),
      (id) => this.figureOf(id),
    );
    this.copyText = text;
    void navigator.clipboard?.writeText(text).then(
      () => this.say("Copied every figure as JSON.", "good"),
      () => this.say("Select the text below and copy it."),
    );
    this.render();
  }

  private onKey(event: KeyboardEvent): void {
    if (this.selected === null || !this.chosen) return;
    const step = event.shiftKey ? 5 : 1;
    const moves: Record<string, [number, number]> = {
      ArrowLeft: [-step, 0],
      ArrowRight: [step, 0],
      ArrowUp: [0, -step],
      ArrowDown: [0, step],
    };
    const move = moves[event.key];
    if (!move) return;
    event.preventDefault();
    const [x, y] = this.figureOf(this.chosen).stars[this.selected]!;
    this.change(moveStar(this.figureOf(this.chosen), this.selected, x + move[0], y + move[1]));
  }

  render(): void {
    const body = this.popup.body;
    body.replaceChildren();
    const list = make("nav", "star-editor__list");
    for (const type of Object.keys(TYPE_WORDS)) {
      const group = this.constellations.filter((c) => c.type === type);
      if (group.length === 0) continue;
      list.append(make("span", "star-editor__type", TYPE_WORDS[type]!));
      for (const c of group) {
        const item = make(
          "button",
          `star-editor__item${c.id === this.chosen ? " star-editor__item--chosen" : ""}`,
        );
        item.type = "button";
        item.setAttribute("aria-pressed", String(c.id === this.chosen));
        const monster = CONSTELLATION_MONSTERS[c.id];
        if (monster) {
          const icon = document.createElement("img");
          icon.className = "star-editor__icon";
          icon.alt = "";
          showPortrait(icon, monsterPortrait(monster, "icon"));
          item.append(icon);
        }
        const mark = this.dirty(c.id) ? "●" : isStarFigure(this.saved[c.id]) ? "★" : "";
        item.append(make("span", "star-editor__name", c.name), make("span", "star-editor__mark", mark));
        item.title = mark === "●" ? "Not saved yet" : mark === "★" ? "Saved drawing" : "Built-in drawing";
        item.addEventListener("click", () => this.choose(c.id));
        list.append(item);
      }
    }

    const main = make("div", "star-editor__main");
    const id = this.chosen;
    if (id) {
      main.append(this.canvas(id), this.tools(id));
      if (this.copyText !== null) {
        const area = document.createElement("textarea");
        area.className = "star-editor__json";
        area.readOnly = true;
        area.value = this.copyText;
        area.rows = 8;
        main.append(area);
      }
    }
    main.append(this.status);
    body.append(list, main);
  }

  private tools(id: string): HTMLElement {
    const tools = make("div", "star-editor__tools");
    const help = make(
      "p",
      "star-editor__help",
      "Drag a star. Click two stars to join or unjoin. Arrows nudge the picked star. Numbers: the order stars light.",
    );
    const undo = button("↶ Undo", "btn--outline", () => this.undoLast());
    undo.disabled = (this.undo.get(id)?.length ?? 0) === 0;
    const revert = button("Revert", "btn--outline", () => this.revert(), "Back to the last saved drawing");
    revert.disabled = !this.drafts.has(id);
    const builtIn = button("Built-in", "btn--outline", () => void this.useBuiltIn(), "Drop the saved drawing: the game's own one shows again");
    builtIn.disabled = !isStarFigure(this.saved[id]) || BUILT_IN_FIGURES[id] === undefined;
    const save = button("Save", "btn--primary", () => void this.save());
    save.disabled = !this.dirty(id);
    const copy = button("Copy JSON", "btn--outline", () => this.copy(), "Every figure as JSON, to paste into the game's code");
    tools.append(help, undo, revert, builtIn, copy, save);
    return tools;
  }

  /** The big picture: the monster, its lines and its numbered stars. */
  private canvas(id: string): HTMLElement {
    const figure = this.figureOf(id);
    const holder = make("div", "star-editor__canvas");
    const monster = CONSTELLATION_MONSTERS[id];
    if (monster) {
      const image = document.createElement("img");
      image.className = "star-editor__monster";
      image.alt = "";
      image.draggable = false;
      showPortrait(image, monsterPortrait(monster, "card"));
      image.style.top = `${(ART_TOP / FIGURE_HEIGHT) * 100}%`;
      holder.append(image);
    }
    const box = svg("svg", { viewBox: `0 0 ${FIGURE_WIDTH} ${FIGURE_HEIGHT}`, class: "star-editor__svg" });
    box.setAttribute("role", "application");
    box.setAttribute("aria-label", "Stars");
    box.setAttribute("tabindex", "0");
    for (const [a, b] of figure.lines) {
      const [x1, y1] = figure.stars[a]!;
      const [x2, y2] = figure.stars[b]!;
      box.append(svg("line", { x1, y1, x2, y2, class: "star-editor__line" }));
    }
    figure.stars.forEach(([x, y], i) => {
      const star = svg("g", { class: `star-editor__star${i === this.selected ? " star-editor__star--picked" : ""}` });
      star.dataset.star = String(i);
      star.append(svg("circle", { cx: x, cy: y, r: 7, class: "star-editor__hit" }), svg("circle", { cx: x, cy: y, r: 3.6, class: "star-editor__dot" }));
      const label = svg("text", { x: x + 5, y: y - 5, class: "star-editor__num" });
      label.textContent = String(i + 1);
      star.append(label);
      box.append(star);
    });
    this.wire(box, id);
    holder.append(box);
    // Keep the arrows working on the picked star after a redraw.
    if (this.selected !== null) queueMicrotask(() => box.focus({ preventScroll: true }));
    return holder;
  }

  /** Dragging and clicking stars. */
  private wire(box: SVGSVGElement, id: string): void {
    const toBox = (event: PointerEvent): StarPoint => {
      const rect = box.getBoundingClientRect();
      return [
        ((event.clientX - rect.left) / Math.max(rect.width, 1)) * FIGURE_WIDTH,
        ((event.clientY - rect.top) / Math.max(rect.height, 1)) * FIGURE_HEIGHT,
      ];
    };
    let drag: { index: number; start: StarPoint; before: Draft; moved: boolean; pointer: number } | null = null;

    box.addEventListener("pointerdown", (event) => {
      const target = (event.target as Element).closest<SVGGElement>(".star-editor__star");
      if (!target) {
        this.selected = null;
        this.render();
        return;
      }
      event.preventDefault();
      const index = Number(target.dataset.star);
      drag = { index, start: toBox(event), before: this.figureOf(id), moved: false, pointer: event.pointerId };
      box.setPointerCapture?.(event.pointerId);
    });

    box.addEventListener("pointermove", (event) => {
      if (!drag || event.pointerId !== drag.pointer) return;
      const [x, y] = toBox(event);
      if (!drag.moved && Math.hypot(x - drag.start[0], y - drag.start[1]) < 2) return;
      drag.moved = true;
      // Live move without a render per pixel: move this star's nodes and its lines.
      const next = moveStar(this.figureOf(id), drag.index, x, y);
      this.drafts.set(id, next);
      this.moveNodes(box, next, drag.index);
    });

    const finish = (event: PointerEvent) => {
      if (!drag || event.pointerId !== drag.pointer) return;
      const { index, before, moved } = drag;
      drag = null;
      if (moved) {
        const after = this.figureOf(id);
        this.drafts.set(id, before);
        this.change(after);
        return;
      }
      // A click: pick it, or join it to the picked one.
      if (this.selected === null) this.selected = index;
      else if (this.selected === index) this.selected = null;
      else {
        const picked = this.selected;
        this.selected = null;
        this.change(toggleLine(this.figureOf(id), picked, index));
        return;
      }
      this.render();
    };
    box.addEventListener("pointerup", finish);
    box.addEventListener("pointercancel", finish);
  }

  /** Puts one star's circles, number and lines where the draft has it. */
  private moveNodes(box: SVGSVGElement, draft: Draft, index: number): void {
    const [x, y] = draft.stars[index]!;
    const star = box.querySelector<SVGGElement>(`.star-editor__star[data-star="${index}"]`);
    star?.querySelectorAll("circle").forEach((circle) => {
      circle.setAttribute("cx", String(x));
      circle.setAttribute("cy", String(y));
    });
    const label = star?.querySelector("text");
    label?.setAttribute("x", String(x + 5));
    label?.setAttribute("y", String(y - 5));
    const lines = box.querySelectorAll<SVGLineElement>(".star-editor__line");
    draft.lines.forEach(([a, b], i) => {
      const line = lines[i];
      if (!line) return;
      const [x1, y1] = draft.stars[a]!;
      const [x2, y2] = draft.stars[b]!;
      line.setAttribute("x1", String(x1));
      line.setAttribute("y1", String(y1));
      line.setAttribute("x2", String(x2));
      line.setAttribute("y2", String(y2));
    });
  }
}
