import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/*
 * Tabs stay fixed at the top of every window (owner, 6 Nov 2026): only the
 * content under a tab row scrolls. Each window's own test checks that its tab
 * row sits outside its scroll box; jsdom lays nothing out, so these pin the
 * rules that make that box the one that scrolls.
 */

const here = dirname(fileURLToPath(import.meta.url));
const css = (path: string): string =>
  readFileSync(resolve(here, path), "utf8")
    .replace(/\r\n/g, "\n")
    .replace(/\/\*[\s\S]*?\*\//g, "");

/** The declarations of the first rule whose selector is exactly `selector`. */
const rule = (source: string, selector: string): string => {
  const at = source.indexOf(`${selector} {`);
  expect(at, selector).toBeGreaterThanOrEqual(0);
  return source.slice(source.indexOf("{", at) + 1, source.indexOf("}", at));
};

/** The `@media (<query>) {` block, braces balanced. */
const media = (source: string, query: string): string => {
  const head = `@media ${query} {`;
  const start = source.indexOf(head);
  expect(start, head).toBeGreaterThanOrEqual(0);
  let depth = 0;
  for (let i = source.indexOf("{", start); i < source.length; i++) {
    if (source[i] === "{") depth++;
    if (source[i] === "}" && --depth === 0) return source.slice(start, i + 1);
  }
  return "";
};

describe("tabs stay fixed at the top", () => {
  it("has the shared pieces: a head over the body, and a scroll box", () => {
    const ui = css("styles/ui.css");
    expect(rule(ui, ".panel__head")).toMatch(/flex: none;/);
    expect(rule(ui, ".panel:has(> .panel__head) > .panel__body")).toMatch(/min-height: 0;/);
    const scroll = rule(ui, ".tab-scroll");
    expect(scroll).toMatch(/min-height: 0;/);
    expect(scroll).toMatch(/overflow-y: auto;/);
  });

  it("sticks the Decorations sub-tabs to the top of the Build menu's scrolling area, on solid ground", () => {
    const kinds = rule(css("styles/build-menu.css"), ".build-menu__kinds");
    expect(kinds).toMatch(/position: sticky;\s*top: 0;/);
    expect(kinds).toMatch(/background: [^;]*var\(--colour-surface-base\);/);
  });

  it("scrolls each Baiter tab under its row on a phone and a short screen, not the whole sheet", () => {
    const small = media(css("styles/baiter.css"), "(width <= 620px), (height <= 500px)");
    expect(small).toMatch(/\.baiter-window \.panel__body:has\(\.baiter\) \{\s*overflow: hidden;/);
    expect(small).toMatch(/\.baiter__view \{[^}]*overflow-y: auto;/);
    expect(css("styles/baiter.css")).not.toMatch(/\.baiter-window \.panel__body:has\(\.baiter\) \{\s*overflow-y: auto;/);
  });

  it("holds the Hatchery's tab row still while its box scrolls", () => {
    const hatch = css("styles/hatch.css");
    expect(rule(hatch, ".hatch")).toMatch(/overflow: hidden;/);
    expect(rule(hatch, ".hatch__tabs-row")).toMatch(/flex: none;/);
  });

  it("scrolls the Friends list alone, under the search and filters", () => {
    const friends = css("friends/friends.css");
    expect(rule(friends, ".friends-body:has(> .friends-tab--friends)")).toMatch(/overflow: hidden;/);
    expect(rule(friends, ".friends-tab--friends")).toMatch(/min-height: 0;/);
  });
});

/*
 * Content stays usable on short screens (patch 6.3): under the fixed rows,
 * never squeezed to under about three rows at 375x667 or 812x375.
 */
describe("room under the fixed rows on a short screen", () => {
  it("lets the Hatchery's add bar scroll with the content below 960 px tall, and shrinks its tabs on a phone on its side", () => {
    const hatch = css("styles/hatch.css");
    const short = media(hatch, "(height <= 960px)");
    expect(short).toMatch(/\.hatch-info \{[^}]*position: relative;/);
    // After the phone's sticky bar, so it wins.
    expect(hatch.indexOf("@media (height <= 960px)")).toBeGreaterThan(hatch.indexOf("position: sticky;"));
    const side = media(hatch, "(height <= 500px)");
    expect(side).toMatch(/\.hatch-tab__art \{[^}]*height: 32px;/);
  });

  it("puts the Friends count, search and filters on one line on a phone on its side", () => {
    const side = media(css("friends/friends.css"), "(width > 620px) and (height <= 500px)");
    expect(side).toMatch(/\.friends-tab--friends \{[^}]*display: grid;[^}]*grid-template-rows: auto auto minmax\(0, 1fr\);/);
    expect(side).toMatch(/\.friends-tab--friends > \.friends-tools \{[^}]*grid-area: 1 \/ 2;[^}]*flex-direction: row;/);
    expect(side).toMatch(/\.friends-tab--friends > \.friends-tab__body \{[^}]*grid-area: 3 \/ 1 \/ 4 \/ -1;/);
  });

  it("puts the Planner help's line beside its tabs, and lets Got it scroll, on a short screen", () => {
    const side = media(css("styles/planner.css"), "(height <= 500px)");
    expect(side).toMatch(/\.planner-help \.panel__head \{[^}]*flex-direction: row;/);
    expect(side).toMatch(/\.planner-help__footer \{[^}]*position: static;/);
  });
});
