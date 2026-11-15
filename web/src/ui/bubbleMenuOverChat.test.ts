import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/*
 * The layout check (15 Nov 2026) on an upright phone: with World chat open,
 * More's fan opened under the chat box, which took the press meant for Goals.
 * The chat now steps aside while the fan is out. jsdom lays nothing out, so
 * this reads the CSS as text.
 */

const here = dirname(fileURLToPath(import.meta.url));
const css = readFileSync(resolve(here, "styles/bubble-menu.css"), "utf8")
  .replace(/\r\n/g, "\n")
  .replace(/\/\*[\s\S]*?\*\//g, "");

describe("More's fan and an open World chat on a phone", () => {
  it("hides the chat while the fan is out, on a phone held upright only", () => {
    const at = css.lastIndexOf("@media (max-width: 620px) {");
    expect(at).toBeGreaterThanOrEqual(0);
    const block = css.slice(at, css.indexOf("\n}\n", at) + 2);
    expect(block).toMatch(
      /\.overlay__layer:has\(> \.yard-dock \.bubble-menu--open\) > \.chat-box \{\s*display: none;\s*\}/,
    );
  });

  it("names the open class the menu sets", () => {
    const source = readFileSync(resolve(here, "yard/BubbleMenu.ts"), "utf8");
    expect(source).toContain('classList.add("bubble-menu--open")');
  });
});
