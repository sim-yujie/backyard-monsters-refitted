import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * "New to Map Room 2" layout faults (picture tester, 9 Nov): Classic's white
 * accent words on the light orange tint over cream, and the kit picker running
 * 1px past a 375px phone's right edge.
 */

const here = dirname(fileURLToPath(import.meta.url));
const css = (name: string): string => readFileSync(resolve(here, name), "utf8").replace(/\r\n/g, "\n");
const skin = css("skin.css");
const takeover = css("takeover.css");
const kits = css("starter-kits.css");

const rule = (sheet: string, selector: string): string => {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(?:^|\\n)${escaped} \\{([^}]*)\\}`).exec(sheet)?.[1] ?? "";
};

type Rgb = [number, number, number];
const hex = (h: string): Rgb => [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16)) as Rgb;
/** An `rgb(r g b / a%)` layer laid over `under`. */
const over = (under: Rgb, layer: string): Rgb => {
  const m = /rgb\((\d+) (\d+) (\d+) \/ (\d+)%\)/.exec(layer);
  expect(m).not.toBeNull();
  const a = Number(m![4]) / 100;
  return under.map((c, i) => c * (1 - a) + Number(m![i + 1]) * a) as Rgb;
};
const lin = (c: number): number => (c / 255 <= 0.03928 ? c / 255 / 12.92 : ((c / 255 + 0.055) / 1.055) ** 2.4);
const lum = ([r, g, b]: Rgb): number => 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
const contrast = (a: Rgb, b: Rgb): number => {
  const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x) as [number, number];
  return (hi + 0.05) / (lo + 0.05);
};

/** Classic's window tokens: the cream fill, the card shade and the accent tint. */
const classic = rule(skin, ':root[data-skin="flash"] :is(.panel, .stay-protected, .presence-check, .chat-box--open, .mr1)');
const token = (name: string): string => new RegExp(`--${name}: ([^;]+);`).exec(classic)?.[1] ?? "";
const textColour = (sheet: string, selector: string): Rgb => {
  const h = /color: #([0-9a-f]{6});/.exec(rule(sheet, selector))?.[1];
  expect(h).toBeDefined();
  return hex(h!);
};

describe("New to Map Room 2 in Classic: labels readable on the cream", () => {
  const fill = hex(token("skin-fill").replace("#", ""));
  const tint = token("colour-accent-soft");

  it("gives the takeover window's 'New to Map Room 2' label at least 4.5:1 on its tint", () => {
    const text = textColour(takeover, ':root[data-skin="flash"] .takeover-dialog__welcome-tag');
    expect(contrast(text, over(fill, tint))).toBeGreaterThanOrEqual(4.5);
  });

  it("gives the kit card's Free label at least 4.5:1 on its tint over the card's shade", () => {
    const text = textColour(kits, ':root[data-skin="flash"] .kit-card__free-tag');
    const card = over(fill, token("colour-surface-sunken"));
    expect(contrast(text, over(card, tint))).toBeGreaterThanOrEqual(4.5);
  });
});

describe("the kit picker on a phone", () => {
  it("is never wider than the screen less the backdrop's 16px on each side", () => {
    expect(rule(css("ui.css"), ".popup-backdrop")).toMatch(/padding: var\(--space-4\);/);
    const picker = rule(kits, ".kit-picker");
    expect(picker).toMatch(/--kit-picker-width: min\([^;]*calc\(100vw - 2 \* var\(--space-4\)\)[^;]*\);/);
    expect(picker).toMatch(/\n {2}width: var\(--kit-picker-width\);/);
    expect(picker).toMatch(/max-width: var\(--kit-picker-width\);/);
  });
});
