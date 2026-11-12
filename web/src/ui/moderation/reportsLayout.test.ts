import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * jsdom never lays a page out, so the Reports window's widths are worked out
 * here from the numbers in reports.css, at the lead's three test screens in
 * both looks (12 Nov 2026: the first build opened 550 px wide, the player
 * squashed, the chat around one letter a line, the plates' words cut off).
 *
 * Frame edges and plate ends are skin.css's (Modern 24 px, Classic 26 px on a
 * computer; 15 / 16 px on a phone), the HUD's height yard-hud.css's.
 */

const css = readFileSync(new URL("./reports.css", import.meta.url), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");

/** The bodies of every top-level or nested rule whose selector list names `selector`. */
const rulesFor = (selector: string): string => {
  const out: string[] = [];
  const rule = /([^{}]+)\{([^{}]*)\}/g;
  for (let match = rule.exec(css); match; match = rule.exec(css)) {
    if (match[1]!.split(",").map((part) => part.trim()).includes(selector)) out.push(match[2]!);
  }
  return out.join("\n");
};

const px = (pattern: RegExp, text: string): number => {
  const found = pattern.exec(text);
  if (!found) throw new Error(`not in reports.css: ${pattern}`);
  return Number(found[1]);
};

const WINDOW_MAX = px(/width:\s*min\(100%,\s*(\d+)px\)/, rulesFor(".panel.mod-reports-window"));
const WINDOW_HEIGHT = px(/height:\s*min\((\d+)px/, rulesFor(".panel.mod-reports-window"));
const LIST = px(/grid-template-columns:\s*(\d+)px/, rulesFor(".mod-reports__workspace"));
const TWO_COLUMNS = px(/@container mod-reports \(width < (\d+)px\)/, css);
const NARROW_PLAYER = px(/@container mod-reports-detail \(width < (\d+)px\)/, css);

const SCREENS = [
  { name: "1600x1000", width: 1600, height: 1000, phone: false },
  { name: "1280x720", width: 1280, height: 720, phone: false },
  { name: "phone 390x844", width: 390, height: 844, phone: true },
] as const;

const LOOKS = {
  modern: { edge: 24, phoneEdge: 15, lift: 38, phoneLift: 28 },
  classic: { edge: 26, phoneEdge: 16, lift: 44, phoneLift: 28 },
} as const;

/** The display font at 13 px: about 0.62 em a letter (a wide estimate). */
const wordWidth = (word: string): number => Math.ceil(word.length * 13 * 0.62);

const layout = (screen: (typeof SCREENS)[number], look: keyof typeof LOOKS) => {
  const skin = LOOKS[look];
  const edge = screen.phone ? skin.phoneEdge : skin.edge;
  const hud = screen.phone ? 8 + 110 : 16 + 70;
  const overhang = Math.max(screen.phone ? skin.phoneLift : skin.lift, edge + 12);
  const window = Math.min(WINDOW_MAX, screen.width - 2 * 16);
  const room = screen.height - hud - 8 - 16 - overhang;
  const height = screen.phone ? room : Math.min(WINDOW_HEIGHT, room);
  const workspace = window - 2 * edge - 2 * 8;
  const twoColumns = workspace >= TWO_COLUMNS;
  const detail = twoColumns ? workspace - LIST - 12 : workspace;
  const narrow = detail < NARROW_PLAYER;
  // The plates: the action bar's padding, then the "Ban: admins only" note beside them unless narrow.
  const bar = detail - 2 - (narrow ? 20 : 24);
  const banNote = wordWidth("Ban: admins only");
  const row = narrow ? bar : bar - 10 - banNote;
  const plate = (row - 2 * (narrow ? 4 : 5)) / 3;
  const cap = narrow ? 14 : 18;
  const inside = plate - 2 * cap;
  // Cancel / Confirm share the whole bar, 1 : 1.6.
  const cancelInside = (bar - 8) / 2.6 - 2 * (narrow ? 14 : 16);
  // The chat around: evidence padding, the list's padding, the time and name columns.
  const snapText = narrow ? detail - 2 - 28 - 20 - 42 - 8 : detail - 2 - 28 - 20 - 48 - 176 - 16;
  return { window, height, workspace, twoColumns, detail, narrow, inside, cancelInside, snapText };
};

describe("reports.css: the window is wide enough for its two columns", () => {
  it("lifts the 560 px cap every window has and never runs off the screen", () => {
    expect(WINDOW_MAX).toBeGreaterThanOrEqual(1000);
    expect(WINDOW_MAX).toBeLessThanOrEqual(1100);
    expect(rulesFor(".panel.mod-reports-window")).toMatch(/max-width:\s*min\(\d+px,\s*calc\(100vw - 2 \* var\(--space-4\)\)\)/);
  });

  it("keeps names on one line and lays out by the room it has, not the screen", () => {
    expect(rulesFor(".mod-reports__head h2")).not.toMatch(/overflow-wrap:\s*anywhere/);
    expect(rulesFor(".mod-reports-window > .panel__body")).toMatch(/container:\s*mod-reports \/ inline-size/);
    expect(rulesFor(".mod-reports__detail")).toMatch(/container:\s*mod-reports-detail \/ inline-size/);
  });

  it("hangs a plate's picture off its word, so the word keeps the plate's middle", () => {
    expect(rulesFor(".mod-reports-window .mod-reports__btn-word > .game-icon")).toMatch(/position:\s*absolute/);
    expect(rulesFor(".mod-reports__btn-word")).toMatch(/white-space:\s*nowrap/);
  });

  for (const screen of SCREENS) {
    for (const look of Object.keys(LOOKS) as (keyof typeof LOOKS)[]) {
      it(`fits at ${screen.name} in ${look}`, () => {
        const box = layout(screen, look);
        if (screen.phone) {
          expect(box.twoColumns).toBe(false);
          expect(box.narrow).toBe(true);
        } else {
          expect(box.window).toBe(WINDOW_MAX);
          expect(box.twoColumns).toBe(true);
          expect(box.detail).toBeGreaterThanOrEqual(600);
          expect(box.narrow).toBe(false);
          expect(box.height).toBeGreaterThanOrEqual(500);
        }
        // Each plate's word whole inside its ends; on a computer with room for the clock on both sides.
        expect(box.cancelInside).toBeGreaterThanOrEqual(wordWidth("Cancel"));
        for (const word of ["Close", "Warn", "Mute"]) {
          const needs = wordWidth(word) + (box.narrow ? 0 : 2 * (20 + 6));
          expect(box.inside).toBeGreaterThanOrEqual(needs);
        }
        // The chat around keeps whole words a line, never a letter a line.
        expect(box.snapText).toBeGreaterThanOrEqual(200);
      });
    }
  }
});
