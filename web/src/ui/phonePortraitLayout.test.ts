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
  it("puts Map Room 2's Mail, My range and Filter beside the search bar, on screen (#381)", () => {
    const phone = media(css("styles/maproom.css"), "width <= 620px");
    // One row under the HUD: the tools at the right, the search bar up to them.
    expect(phone).toMatch(/\.mr2-tools-dock \{\s*top: calc\(var\(--hud-height\) \+ var\(--space-2\)\);\s*left: auto;/);
    expect(phone).toMatch(/\.mr2-tools-dock \.mr2-toolrow \{\s*flex-wrap: nowrap;/);
    expect(phone).toMatch(/\.mr2-find-dock \{\s*right: calc\(12px \+ 3 \* var\(--control-height\) \+ 3 \* var\(--space-2\)\);/);
    expect(phone).toMatch(/\.mr2-tools-dock \.mr2-tool,[^{]*\{[^}]*width: var\(--control-height\);/);
    // The "Find a place" bar starts after the floating "?".
    expect(phone).toMatch(/> \.guide-help--float:not\(\[hidden\]\)\) > \.mr2-find-dock \{\s*left: 56px;/);
  });

  it("folds Map Room 2's kit row into the Filter button on a phone, upright or sideways (#381)", () => {
    const source = css("styles/maproom.css");
    expect(source).toMatch(/^\.mr2-kit-filter__toggle \{\s*display: none;/m);
    const phone = media(source, "width <= 620px), (height <= 500px");
    expect(phone).toMatch(/\.mr2-kit-filter__toggle \{\s*display: flex;/);
    expect(phone).toMatch(/\.mr2-kit-filter:not\(\.mr2-kit-filter--open\) \{\s*display: none;/);
    expect(media(source, "width <= 620px")).toMatch(/\.mr2-kit-filter \{\s*top: calc\(100% \+ var\(--space-2\)\);/);
    expect(media(source, "width > 620px) and (height <= 500px")).toMatch(
      /\.mr2-kit-filter \{\s*bottom: calc\(100% \+ var\(--space-2\)\);/,
    );
  });

  it("puts the Friends button away while a panel or sheet is open", () => {
    // Upright and sideways alike (#381).
    const phone = media(css("friends/friends-bar.css"), "width <= 620px), (height <= 500px");
    for (const opener of [
      "> .panel:not([hidden])",
      "> .map-dock--right > *",
      "> .build-menu:not([hidden])",
      "> .monsters-screen:not([hidden])",
      "> .yard-dock > .yard-menu:not([hidden])",
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

  it("folds the attack's minimap and zoom behind one button on a phone (#381)", () => {
    const source = css("styles/attack.css");
    expect(source).toMatch(/^\.attack-viewtools__fold \{\s*display: none;/m);
    const phone = media(source, "width <= 620px), (height <= 500px");
    expect(phone).toMatch(/\.attack-viewtools__fold \{\s*display: grid;/);
    expect(phone).toMatch(/\.attack-viewtools:not\(\.attack-viewtools--open\) > :not\(\.attack-viewtools__fold\) \{\s*display: none;/);
    // On its side the status line gives the button its corner, as upright.
    expect(media(source, "width > 620px) and (height <= 500px")).toMatch(/\.attack-status \{\s*display: none;/);
  });

  it("keeps the attack strip to one row with the menu first (#381)", () => {
    const phone = media(css("styles/attack.css"), "width <= 620px");
    expect(phone).toMatch(/\.attack-strip \{\s*top: 0;\s*gap: var\(--space-1\);/);
    expect(phone).toMatch(/\.attack-menu \{\s*display: flex;\s*order: -1;/);
    expect(phone).toMatch(/\.attack-menu__list \{\s*left: 0;\s*right: auto;/);
    expect(media(css("styles/attack.css"), "width <= 380px")).toMatch(/\.attack-strip__word \{\s*display: none;/);
  });

  it("shrinks the attack's minimap and zoom (M)", () => {
    const phone = media(css("styles/attack.css"), "width <= 620px");
    expect(phone).toMatch(/\.attack-viewtools \.yard-minimap \{[^}]*width: 120px !important;/);
    expect(phone).toMatch(/\.attack-viewtools \.yard-zoom__slider,\s*\.attack-viewtools \.yard-zoom__readout \{\s*display: none;/);
  });
});
