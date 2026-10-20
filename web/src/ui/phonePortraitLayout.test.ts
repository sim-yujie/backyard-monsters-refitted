import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/*
 * Upright-phone overlaps from the phone audit (beta.3). jsdom lays nothing
 * out, so these pin the rules that keep the pieces apart; the screenshots in
 * launch/phone-audit/fixed-portrait show them working at 390 and 360 px.
 */

const here = dirname(fileURLToPath(import.meta.url));
const css = (path: string): string => readFileSync(resolve(here, path), "utf8").replace(/\r\n/g, "\n");

/** Every `@media (<query>)` block in a file, joined, braces balanced. */
const media = (source: string, query: string): string => {
  const head = `@media (${query}) {`;
  const blocks: string[] = [];
  for (let start = source.indexOf(head); start >= 0; start = source.indexOf(head, start + 1)) {
    let depth = 0;
    for (let i = source.indexOf("{", start); i < source.length; i++) {
      if (source[i] === "{") depth++;
      if (source[i] === "}" && --depth === 0) {
        blocks.push(source.slice(start, i + 1));
        break;
      }
    }
  }
  expect(blocks.length, head).toBeGreaterThan(0);
  return blocks.join("\n");
};

describe("upright phone layout", () => {
  it("wraps Map Room 2's tool row instead of pushing Mail off the left edge", () => {
    const phone = media(css("styles/maproom.css"), "width <= 620px");
    expect(phone).toMatch(/\.mr2-tools-dock \.mr2-toolrow \{[^}]*flex-wrap: wrap;/);
    expect(phone).toMatch(/\.mr2-tools-dock \{[^}]*left: 12px;[^}]*right: 12px;/);
    // The "Find a place" bar starts after the floating "?".
    expect(phone).toMatch(/> \.guide-help--float:not\(\[hidden\]\)\) > \.mr2-find-dock \{\s*left: 56px;/);
  });

  it("puts the Friends button away while a panel or sheet is open", () => {
    const phone = media(css("friends/friends-bar.css"), "width <= 620px");
    for (const opener of [
      "> .panel:not([hidden])",
      "> .map-dock--right > *",
      "> .build-menu:not([hidden])",
      "> .monsters-screen:not([hidden])",
    ]) {
      expect(phone).toContain(`.overlay__layer:has(${opener}) > .friends-bar`);
    }
  });

  it("keeps the yard's level strip, notices and Chat clear of the floating \"?\"", () => {
    const phone = media(css("styles/yard-hud.css"), "width <= 620px");
    expect(phone).toMatch(/> \.hud--corner > \.hud-status \{[^}]*left: 48px;/);
    expect(phone).toMatch(/> \.yard-notices \{\s*top: calc\(var\(--notice-top-inset\) \+ 92px\);/);
    expect(phone).toContain(".overlay__layer:has(> .build-menu:not([hidden])) > .chat-box");
    // The friend-request count sits on the critter, not on the name.
    expect(phone).toMatch(/\.account-menu__button-count \{\s*right: auto;\s*left: -6px;/);
  });

  it("tightens Workers and Shiny on a narrow phone so they share their columns", () => {
    const narrow = media(css("styles/yard-hud.css"), "width <= 420px");
    expect(narrow).toMatch(/\.hud__workers-button,[^{]*\.hud__resource--shiny \.hud__resource-button \{[^}]*padding: 0 6px;/);
  });

  it("sizes the Build tabs to the width so Decorations fits", () => {
    const phone = media(css("styles/build-menu.css"), "width <= 620px");
    expect(phone).toMatch(/\.build-menu__tabs \.tabs__tab \{[^}]*font-size: min\(var\(--text-sm\), 3\.1vw\);/);
  });

  it("keeps Map Room 1's corner buttons small over the map (K)", () => {
    const phone = media(css("styles/maproom1.css"), "width <= 620px");
    expect(phone).toMatch(/\.mr1-map__home-label \{\s*display: none;/);
    expect(phone).toMatch(/\.mr1-mini \{[^}]*width: 84px;/);
  });

  it("keeps a tip's Bob small, and drops it to the bottom edge in Map Room 1 (L)", () => {
    const phone = media(css("styles/guide.css"), "width <= 620px");
    expect(phone).toMatch(/\.guide-bob--tip \{\s*--guide-bob-size: 48px;/);
    expect(phone).toMatch(/:root:has\(\.mr1\) \.guide-bob \{\s*bottom: var\(--space-2\);/);
    // The tip's rule comes after the phone's own Bob size, or that one wins.
    expect(phone.indexOf(".guide-bob--tip {")).toBeGreaterThan(phone.indexOf("--guide-bob-size: 80px;"));
  });

  it("shrinks the attack's minimap and zoom (M)", () => {
    const phone = media(css("styles/attack.css"), "width <= 620px");
    expect(phone).toMatch(/\.attack-viewtools \.yard-minimap \{[^}]*width: 120px !important;/);
    expect(phone).toMatch(/\.attack-viewtools \.yard-zoom__slider,\s*\.attack-viewtools \.yard-zoom__readout \{\s*display: none;/);
  });
});
