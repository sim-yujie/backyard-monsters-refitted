// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";

import type { StarFiguresApi } from "@/api/starFigures";
import { StarEditor, figuresJson, moveStar, toDraft, toggleLine } from "@/ui/alliance/StarEditor";
import { BUILT_IN_FIGURES, CONSTELLATION_MONSTERS, figureFor, isStarFigure, type StarFigure } from "@/ui/alliance/starFigures";

const ids = Object.keys(CONSTELLATION_MONSTERS);

describe("star figures", () => {
  it("has a good built-in figure for each of the 12 constellations", () => {
    expect(ids).toHaveLength(12);
    for (const id of ids) {
      const figure = BUILT_IN_FIGURES[id];
      expect(isStarFigure(figure), id).toBe(true);
      // Every star is on a line, so the figure reads as one shape.
      const joined = new Set(figure!.lines.flat());
      expect(joined.size, id).toBe(10);
    }
  });

  it("takes the owner's saved figure first, then the built-in one, then a placeholder", () => {
    const saved: StarFigure = { stars: Array.from({ length: 10 }, (_, i) => [i * 10, i * 10] as const), lines: [[0, 1]] };
    expect(figureFor("pokey", 0, { pokey: saved })).toBe(saved);
    expect(figureFor("pokey", 0, { pokey: { stars: [], lines: [] } })).toBe(BUILT_IN_FIGURES.pokey);
    expect(figureFor("nobody", 0, null).stars).toHaveLength(10);
  });

  it("refuses a figure with a star outside the box or a bad line", () => {
    const stars = Array.from({ length: 10 }, () => [10, 10]);
    expect(isStarFigure({ stars, lines: [[0, 1]] })).toBe(true);
    expect(isStarFigure({ stars: [[300, 10], ...stars.slice(1)], lines: [] })).toBe(false);
    expect(isStarFigure({ stars, lines: [[0, 0]] })).toBe(false);
    expect(isStarFigure({ stars, lines: [[0, 10]] })).toBe(false);
  });
});

describe("star editor steps", () => {
  const draft = toDraft(BUILT_IN_FIGURES.pokey!);

  it("joins two stars, and unjoins them the second time", () => {
    const joined = toggleLine({ ...draft, lines: [] }, 3, 1);
    expect(joined.lines).toEqual([[1, 3]]);
    expect(toggleLine(joined, 1, 3).lines).toEqual([]);
    expect(toggleLine(joined, 2, 2)).toBe(joined);
  });

  it("moves a star and keeps it in the box", () => {
    expect(moveStar(draft, 0, 50.04, 60).stars[0]).toEqual([50, 60]);
    expect(moveStar(draft, 0, -5, 999).stars[0]).toEqual([0, 170]);
    expect(moveStar(draft, 0, 1, 1).stars[1]).toEqual(draft.stars[1]);
  });

  it("copies every figure as JSON the code can take", () => {
    const text = figuresJson(["pokey"], () => draft);
    expect(text).toContain("pokey: {");
    expect(text).toContain("stars: [[103, 20],");
  });
});

describe("StarEditor", () => {
  afterEach(() => {
    document.body.replaceChildren();
  });

  const fakeApi = (): StarFiguresApi & { saves: unknown[] } => {
    const saves: unknown[] = [];
    let figures: Record<string, unknown> = {};
    const constellations = ids.map((id) => ({ id, name: id, type: "midas", kind: "strength" as const }));
    return {
      saves,
      load: async () => ({ ok: true, constellations, figures }),
      save: async (id, figure) => {
        saves.push({ id, figure });
        figures = { ...figures };
        if (figure) figures[id] = figure;
        else delete figures[id];
        return { ok: true, constellations, figures };
      },
    };
  };

  const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

  it("lists the constellations, joins two clicked stars and saves the figure", async () => {
    const api = fakeApi();
    const onClose = vi.fn();
    const editor = new StarEditor({ api, onClose }).mount(document.body);
    await flush();
    expect(document.querySelectorAll(".star-editor__item")).toHaveLength(12);
    expect(document.querySelectorAll(".star-editor__star")).toHaveLength(10);
    const save = [...document.querySelectorAll<HTMLButtonElement>(".star-editor button")].find((b) => b.textContent === "Save")!;
    expect(save.disabled).toBe(true);

    const click = (index: number) => {
      const star = document.querySelector(`.star-editor__star[data-star="${index}"] circle`)!;
      star.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, pointerId: 1, clientX: 0, clientY: 0 }));
      document.querySelector(".star-editor__svg")!.dispatchEvent(new PointerEvent("pointerup", { bubbles: true, pointerId: 1, clientX: 0, clientY: 0 }));
    };
    const first = ids[0]!;
    const before = BUILT_IN_FIGURES[first]!.lines.length;
    click(0);
    click(5);
    expect(document.querySelectorAll(".star-editor__line").length).not.toBe(before);
    const saveNow = [...document.querySelectorAll<HTMLButtonElement>(".star-editor button")].find((b) => b.textContent === "Save")!;
    expect(saveNow.disabled).toBe(false);
    saveNow.click();
    await flush();
    expect(api.saves).toHaveLength(1);
    expect((api.saves[0] as { id: string }).id).toBe(first);
    expect(document.querySelector(".star-editor__status")?.textContent).toContain("Saved");

    editor.close();
    expect(onClose).toHaveBeenCalledWith(true);
  });
});

describe("the Constellation tab's editor button", () => {
  it("shows only when the window passes the editor (an admin)", async () => {
    const { constellationTab } = await import("@/ui/alliance/allianceProgressUi");
    const alliance = {
      type: "midas",
      points: 0,
      points_spent: 0,
      constellations: [{ id: "pokey", name: "Pokey", kind: "weakness", steps: 1, next_price: 5, prices: [], suggest_count: 0, effects: [] }],
    } as unknown as Parameters<typeof constellationTab>[0];
    const host = { run: () => undefined, redraw: () => undefined, now: () => 0 };
    const api = { lightStar: vi.fn(), suggestStar: vi.fn() };
    const plain = constellationTab(alliance, host, api, null, () => undefined);
    expect(plain[0]!.querySelector(".alliance-sky__edit")).toBeNull();
    const open = vi.fn();
    const owner = constellationTab(alliance, host, api, null, () => undefined, open);
    owner[0]!.querySelector<HTMLButtonElement>(".alliance-sky__edit")!.click();
    expect(open).toHaveBeenCalledOnce();
    // The figure is pokey's built-in one: its 9 lines, the first star lit (one a step), the next ringed.
    expect(owner[0]!.querySelectorAll(".alliance-sky__line")).toHaveLength(BUILT_IN_FIGURES.pokey!.lines.length);
    expect(owner[0]!.querySelectorAll(".alliance-sky__star--lit")).toHaveLength(1);
    expect(owner[0]!.querySelectorAll(".alliance-sky__star--next")).toHaveLength(1);
  });

  it("lights one star a step: dots, count, per-star value, Light ★n and Last lit (owner, 12 Nov)", async () => {
    const { constellationTab } = await import("@/ui/alliance/allianceProgressUi");
    const values = [10, 10.5, 11, 11.5, 12, 12.5, 13, 13.5, 14, 14.5, 15];
    const brain = { id: "brain", name: "Brain", kind: "strength", steps: 2, next_price: 40, prices: [20, 20, 40, 40, 60, 60, 80, 80, 100, 100], suggest_count: 0, effects: [{ stat: "loot", values }] };
    const alliance = {
      type: "midas",
      role: "leader",
      permissions: [],
      points: 2400,
      points_spent: 40,
      constellations: [brain],
      last_lit: { id: "brain", step: 2, by: "Ana", at: 0 },
    } as unknown as Parameters<typeof constellationTab>[0];
    const host = { run: () => undefined, redraw: () => undefined, now: () => 60_000 };
    const [sky, bar] = constellationTab(alliance, host, { lightStar: vi.fn(), suggestStar: vi.fn() }, null, () => undefined);
    expect(sky!.querySelector(".alliance-sky__count")!.textContent).toBe("★ 2 / 10");
    expect(sky!.querySelectorAll(".alliance-sky__plate .alliance-dots__dot--on")).toHaveLength(2);
    expect(sky!.querySelectorAll(".alliance-sky__star--lit")).toHaveLength(2);
    expect(sky!.querySelector(".alliance-sky__value")!.textContent).toBe("+11%");
    expect(sky!.textContent).not.toContain("Placeholder");
    expect(bar!.querySelector(".alliance-detail__per")!.textContent).toBe("+0.5% per star");
    expect(bar!.querySelectorAll(".alliance-track__mark")).toHaveLength(11);
    expect(bar!.querySelector(".alliance-detail__gain")!.textContent).toBe("+11% → +11.5%");
    expect(bar!.querySelector(".alliance-detail__last")!.textContent).toMatch(/^Last lit: Brain ★2, by Ana/);
    expect([...bar!.querySelectorAll("button")].map((b) => b.textContent)).toContain("Light ★3");
  });

  it("draws real night-sky stars, not dots: lit (coloured), next and unlit lights centred on each point (owner, 12 Nov)", async () => {
    const { constellationTab, STAR_ART, STAR_TINTS } = await import("@/ui/alliance/allianceProgressUi");
    const values = [10, 10.5, 11, 11.5, 12, 12.5, 13, 13.5, 14, 14.5, 15];
    const pokey = { id: "pokey", name: "Pokey", kind: "strength", steps: 3, next_price: 40, prices: [20, 20, 40, 40, 60, 60, 80, 80, 100, 100], suggest_count: 0, effects: [{ stat: "loot", values }] };
    const alliance = { type: "midas", role: "member", permissions: [], points: 100, points_spent: 0, constellations: [pokey] } as unknown as Parameters<typeof constellationTab>[0];
    const host = { run: () => undefined, redraw: () => undefined, now: () => 0 };
    const [sky, bar] = constellationTab(alliance, host, { lightStar: vi.fn(), suggestStar: vi.fn() }, null, () => undefined);
    const stars = [...sky!.querySelectorAll<SVGImageElement>(".alliance-sky__figure .alliance-sky__star")];
    expect(stars).toHaveLength(10);
    expect(stars.every((s) => s.tagName === "image")).toBe(true);
    expect(sky!.querySelectorAll(".alliance-sky__figure circle")).toHaveLength(0);
    const states = stars.map((s) => ["lit", "next", "dim"].find((k) => s.classList.contains(`alliance-sky__star--${k}`)));
    expect(states).toEqual(["lit", "lit", "lit", "next", "dim", "dim", "dim", "dim", "dim", "dim"]);
    BUILT_IN_FIGURES.pokey!.stars.forEach(([x, y], i) => {
      const s = stars[i]!;
      const state = states[i] as keyof typeof STAR_ART;
      const file = state === "lit" ? `star-lit-${STAR_TINTS[i]}@2x.webp` : STAR_ART[state].file;
      expect(s.getAttribute("href")!.endsWith(`ui/stars/${file}`)).toBe(true);
      expect(Number(s.getAttribute("width"))).toBe(STAR_ART[state].size);
      expect(Number(s.getAttribute("x")) + Number(s.getAttribute("width")) / 2).toBeCloseTo(x);
      expect(Number(s.getAttribute("y")) + Number(s.getAttribute("height")) / 2).toBeCloseTo(y);
    });
    // Lit stars mix colours (blue-white, white, pale gold) and twinkle out of step.
    expect(new Set(STAR_TINTS)).toEqual(new Set(["blue", "white", "gold"]));
    expect(new Set(stars.slice(0, 3).map((s) => s.getAttribute("href"))).size).toBeGreaterThan(1);
    expect(new Set(stars.slice(0, 3).map((s) => s.style.animationDelay)).size).toBe(3);
    // All pictures share one scale (128 px lit/next, 64 px unlit), so their cores match.
    expect(STAR_ART.next.size).toBe(STAR_ART.lit.size);
    expect(STAR_ART.dim.size).toBe(STAR_ART.lit.size / 2);
    // Star-map lines stop short of both stars.
    const [a, b] = BUILT_IN_FIGURES.pokey!.lines[0]!;
    const line = sky!.querySelector(".alliance-sky__line")!;
    const [ax, ay] = BUILT_IN_FIGURES.pokey!.stars[a]!;
    const [bx, by] = BUILT_IN_FIGURES.pokey!.stars[b]!;
    expect(Math.hypot(Number(line.getAttribute("x1")) - ax, Number(line.getAttribute("y1")) - ay)).toBeCloseTo(6);
    expect(Math.hypot(Number(line.getAttribute("x2")) - bx, Number(line.getAttribute("y2")) - by)).toBeCloseTo(6);
    // The track: stars 1-10 are star-light pips, the next one keeps its price.
    expect(bar!.querySelectorAll(".alliance-track__pip--star")).toHaveLength(9);
    expect(bar!.querySelector(".alliance-track__mark--next .alliance-track__pip")!.textContent).toBe("★40");
  });
});
