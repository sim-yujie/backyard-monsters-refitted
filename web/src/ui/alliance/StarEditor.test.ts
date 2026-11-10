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
    // The figure is pokey's built-in one: its 9 lines, the first 2 stars lit.
    expect(owner[0]!.querySelectorAll(".alliance-sky__line")).toHaveLength(BUILT_IN_FIGURES.pokey!.lines.length);
    expect(owner[0]!.querySelectorAll(".alliance-sky__star--lit")).toHaveLength(2);
  });
});
