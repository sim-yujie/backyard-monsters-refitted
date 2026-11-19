import { readFileSync, readdirSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { CENTRE_TOP_GAP, CENTRED_LAYOUT_QUERY, fitCentreWindow } from "./centreWindow";
import { PHONE_LAYOUT_QUERY } from "./phoneLayout";

/*
 * The owner's iPad (15 Nov 2026), Modern look, on its side: Build ended right
 * under its four tabs and Goals after one cut-off row. A middle window with no
 * `--centre-height` of its own fits its content (`height: max-content` in
 * ui.css while pinned top and bottom); the suspected cause, not reproduced
 * here (no Safari), is that Safari sized the `flex: 1` (zero-basis) body and
 * list in it to nothing. jsdom lays nothing out, so
 * these read the CSS as text: no middle window that fits its content may
 * leave its scroll box on a zero basis.
 */

const here = dirname(fileURLToPath(import.meta.url));
const read = (path: string): string =>
  readFileSync(resolve(here, path), "utf8")
    .replace(/\r\n/g, "\n")
    .replace(/\/\*[\s\S]*?\*\//g, "");

/** Every middle window (a `centreWindow(` caller) and the stylesheets that size it. */
const WINDOWS: Record<string, readonly string[]> = {
  "monsters/MonstersScreen.ts": ["styles/monsters.css"],
  "siege/SiegeScreen.ts": ["styles/monsters.css", "styles/siege.css"],
  "yard/ShopScreen.ts": ["styles/shop.css"],
  "mail/MailboxScreen.ts": ["styles/mail.css"],
  "friends/FriendsScreen.ts": ["friends/friends.css"],
  "achievements/AchievementsScreen.ts": ["achievements/achievements.css"],
  "defences/DefencesScreen.ts": ["styles/defences.css"],
  "notifications/NotificationPanel.ts": ["styles/notifications.css"],
  "goals/GoalsPanel.ts": ["goals/goals.css"],
  "events/EventsPanel.ts": ["events/events.css"],
  "quests/QuestsPanel.ts": ["quests/quests.css"],
  "yard/BuildMenu.ts": ["styles/build-menu.css"],
};

/** The ones that fit their content: no `--centre-height` in their stylesheets. */
const CONTENT_FIT = Object.entries(WINDOWS).filter(
  ([, sheets]) => !sheets.some((sheet) => /--centre-height:/.test(read(sheet))),
);

const sourcesUnder = (dir: string): string[] =>
  readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return sourcesUnder(path);
    return entry.name.endsWith(".ts") && !entry.name.endsWith(".test.ts") ? [path] : [];
  });

/**
 * Rules that may shrink a box to nothing from a zero flex basis (`flex: 1`,
 * `flex: 1 1 0`): `min-height: 0`, or an `overflow` that is not visible
 * (which also drops a flex item's minimum to 0).
 */
const zeroBasisShrinkers = (source: string): string[] => {
  const found: string[] = [];
  for (const match of source.matchAll(/([^{};]+)\{([^{}]*)\}/g)) {
    const body = match[2] ?? "";
    const zeroBasis = /(?:^|[;\s])flex:\s*1(?:\s+1\s+0(?:%|px)?)?\s*(?:;|$)/.test(body) || /flex-basis:\s*0/.test(body);
    const shrinks = /min-height:\s*0\s*(?:;|$)/.test(body) || /overflow(?:-y)?:\s*(?:auto|hidden|scroll|clip)/.test(body);
    if (zeroBasis && shrinks) found.push((match[1] ?? "").trim());
  }
  return found;
};

describe("Middle windows on a short screen (owner's iPad, 15 Nov)", () => {
  it("knows every middle window and its stylesheets", () => {
    const callers = sourcesUnder(here)
      .filter((path) => readFileSync(path, "utf8").includes("centreWindow(this.element"))
      .map((path) => relative(here, path).replace(/\\/g, "/"))
      .sort();
    expect(callers).toEqual(Object.keys(WINDOWS).sort());
  });

  it("finds Build and Goals among the windows that fit their content", () => {
    const names = CONTENT_FIT.map(([name]) => name);
    expect(names).toContain("yard/BuildMenu.ts");
    expect(names).toContain("goals/GoalsPanel.ts");
  });

  it.each(CONTENT_FIT)("%s never sizes its scroll box from a zero flex basis", (_name, sheets) => {
    for (const sheet of sheets) expect(zeroBasisShrinkers(read(sheet)), sheet).toEqual([]);
  });

  it("starts each fitted window's body from its content, shared for every middle window", () => {
    const css = read("styles/ui.css");
    const at = css.indexOf("@media (min-width: 620.02px) and (min-height: 500.02px) {\n  .overlay__layer > .panel.panel--centre {");
    expect(at).toBeGreaterThanOrEqual(0);
    const block = css.slice(at, css.indexOf("\n}\n", at));
    expect(block).toContain("height: var(--centre-height, max-content);");
    expect(block).toMatch(/\.overlay__layer > \.panel\.panel--centre > \.panel__body \{\s*flex-basis: auto;\s*\}/);
  });

  it("keeps the Build list and the Goals body as the boxes that scroll", () => {
    const build = read("styles/build-menu.css");
    expect(build).toMatch(/\.build-menu__main \{\s*flex: 1 1 auto;\s*min-height: 0;[^}]*overflow-y: auto;/);
    expect(build).toMatch(/\.build-menu \.panel__body \{\s*flex: 1 1 auto;\s*min-height: 0;/);
    expect(read("goals/goals.css")).toMatch(/\.goals-panel \.panel__body \{\s*flex: 1 1 auto;\s*min-height: 0;\s*overflow-y: auto;/);
  });
});

/** Whether a `(min-width: 620.02px) and (min-height: 500.02px)`-style query, commas for "or", matches a screen. */
const matches = (query: string, width: number, height: number): boolean =>
  query.split(",").some((part) => {
    const features = [...part.matchAll(/\((min|max)-(width|height):\s*(\d+(?:\.\d+)?)px\)/g)];
    expect(features.length, part).toBe(part.split(" and ").length);
    return features.every(([, end, side, px]) => {
      const value = side === "width" ? width : height;
      return end === "min" ? value >= Number(px) : value <= Number(px);
    });
  });

describe("Screen sizes: middle windows or a phone's sheets", () => {
  const SCREENS = [
    { name: "iPad on its side, Safari's bars", width: 1180, height: 600, centred: true },
    { name: "short laptop or small tablet", width: 1024, height: 560, centred: true },
    { name: "laptop", width: 1366, height: 900, centred: true },
    { name: "phone on its side", width: 844, height: 390, centred: false },
    { name: "phone upright", width: 390, height: 844, centred: false },
    { name: "a zoomed window just over the line", width: 620.5, height: 800, centred: true, edge: true },
    { name: "a window right on the line", width: 620, height: 800, centred: false },
    { name: "a window just over the height line", width: 1024, height: 500.5, centred: true, edge: true },
    { name: "a window right on the height line", width: 1024, height: 500, centred: false },
  ];

  it.each(SCREENS)("$name ($width x $height) gets exactly one layout", ({ width, height, centred }) => {
    expect(matches(CENTRED_LAYOUT_QUERY, width, height)).toBe(centred);
    expect(matches(PHONE_LAYOUT_QUERY, width, height)).toBe(!centred);
  });

  /** The HUD's bottom (56px bar + 8px inset), the painted plate's overhang (Modern 18px), the gap. */
  const TOP = 64 + 18 + CENTRE_TOP_GAP;

  /** The dock as at 1280x720 (centreWindow.test.ts), kept to the screen's corners. */
  const dock = (width: number, height: number) => [
    { left: width - 84, top: 104, right: width - 16, bottom: 190 }, // Events
    { left: width - 236, top: height - 138, right: width - 144, bottom: height - 30 }, // Monsters
    { left: width - 120, top: height - 152, right: width - 28, bottom: height - 26 }, // Build
    { left: 24, top: height - 120, right: 100, bottom: height - 26 }, // Map
  ];

  // The edge cases only check the queries; they are too small for the band checks.
  const centredScreens = SCREENS.filter((screen) => screen.centred && !screen.edge);

  it.each(centredScreens)("$name: Build's band leaves room for its list", ({ width, height }) => {
    const windowWidth = Math.min(1200, width - 32);
    const fit = fitCentreWindow({ width, height }, windowWidth, dock(width, height), {
      top: TOP,
      minWidth: 1200,
      minHeight: 640,
    });
    // The title bar, workers line and tabs take ~170px; the rest is the list.
    expect(height - TOP - fit.bottom - 170).toBeGreaterThanOrEqual(280);
  });

  it.each(centredScreens)("$name: Goals' band leaves room for several rows", ({ width, height }) => {
    const fit = fitCentreWindow({ width, height }, 380, dock(width, height), { top: TOP });
    expect(height - TOP - fit.bottom).toBeGreaterThanOrEqual(400);
  });
});

/*
 * Safari on an iPad or iPhone counts `100vh` as the screen with its toolbars
 * hidden, so a box sized from it runs under the toolbars while they show
 * (owner's patch 7.5, 15 Nov). `dvh` is the height actually visible, from
 * Safari 15.4; older Safari drops a `dvh` line, so each one sits right after
 * the same line in `vh`. Custom properties are left out: a fallback line
 * cannot help them (the last one wins before the browser checks the value).
 */
const webSrc = resolve(here, "..");

const stylesheetsUnder = (dir: string): string[] =>
  readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return stylesheetsUnder(path);
    return entry.name.endsWith(".css") ? [path] : [];
  });

const STYLESHEETS = stylesheetsUnder(webSrc).map((path) =>
  relative(webSrc, path).replace(/\\/g, "/"),
);

const readSheet = (path: string): string => read(join("..", path));

const VH = /(?<![a-z])(\d+(?:\.\d+)?)vh\b/g;
const DVH = /(?<![a-z])(\d+(?:\.\d+)?)dvh\b/g;
const uses = (unit: RegExp, value: string): boolean => value.replace(unit, "") !== value;

/** Declarations that size from the screen height without the `vh` then `dvh` pair. */
const unpairedViewportHeights = (css: string): string[] => {
  const decls = [...css.matchAll(/(?<![\w-])(-{0,2}[a-z][a-z-]*)\s*:\s*([^;{}]*?);/g)]
    .filter((match) => !(match[1] ?? "").startsWith("--"))
    .map((match) => ({
      text: match[0].replace(/\s+/g, " "),
      vh: uses(VH, match[2] ?? ""),
      dvh: uses(DVH, match[2] ?? ""),
    }));
  const bad: string[] = [];
  decls.forEach((decl, i) => {
    if (decl.vh && decl.dvh) bad.push(`${decl.text} (vh and dvh in one line)`);
    else if (decl.vh && decls[i + 1]?.text !== decl.text.replace(VH, "$1dvh"))
      bad.push(`${decl.text} (no dvh line after it)`);
    else if (decl.dvh && decls[i - 1]?.text !== decl.text.replace(DVH, "$1vh"))
      bad.push(`${decl.text} (no vh line before it)`);
  });
  return bad;
};

describe("Heights from the screen use Safari's visible height (iPad toolbars)", () => {
  it("finds the stylesheets", () => {
    expect(STYLESHEETS).toContain("ui/styles/building-panel.css");
    expect(STYLESHEETS).toContain("ui/styles/attack.css");
  });

  it.each(STYLESHEETS)("%s pairs every vh line with a dvh line after it", (sheet) => {
    expect(unpairedViewportHeights(readSheet(sheet))).toEqual([]);
  });

  it("catches a lone vh, a lone dvh and a mixed line", () => {
    expect(unpairedViewportHeights(".a { max-height: calc(100vh - 8px); }")).toHaveLength(1);
    expect(unpairedViewportHeights(".a { max-height: calc(100dvh - 8px); }")).toHaveLength(1);
    expect(
      unpairedViewportHeights(".a { max-height: min(70vh, calc(100dvh - 8px)); }"),
    ).toHaveLength(1);
    expect(
      unpairedViewportHeights(
        ".a { max-height: min(70vh, 640px);\n  max-height: min(70dvh, 640px); top: 2vw; }",
      ),
    ).toEqual([]);
  });

  it("keeps the side panel, the attack panels and popups clear of Safari's toolbars", () => {
    expect(readSheet("ui/styles/building-panel.css")).toContain(
      "max-height: calc(100dvh - var(--hud-height) - var(--space-6));",
    );
    expect(readSheet("ui/styles/building-panel.css")).toContain(
      "max-height: calc(100dvh - 212px);",
    );
    expect(readSheet("ui/styles/ui.css")).toContain("max-height: min(70dvh, 640px);");
    expect(readSheet("ui/styles/attack.css")).toContain(
      "max-height: calc(100dvh - var(--hud-height) - var(--hud-inset) - var(--space-7) - var(--space-6) - var(--attack-dock-shift, 0px));",
    );
  });
});

/*
 * Safari before iPadOS/iOS 16.4 does not read the range form of a media query,
 * `(width <= 620px)`: the whole query never matches there, so an older iPad
 * got neither the phone layout nor the middle windows. The stylesheets and the
 * matchMedia strings use the classic form, `(max-width: 620px)`; a strict `>`
 * or `<` is the limit moved by 0.02px, so a zoomed window at 620.5px still gets
 * one layout. Container queries keep the range form: Safari has both from 16.
 */
const RANGE = /\(\s*(?:width|height)\s*[<>]=?\s*(?:[\d.]+|\$\{[^}]*\})px|\dpx\s*[<>]=?\s*(?:width|height)\b/;

/** Media queries (CSS) or lines (scripts) that use the range form. */
const rangeQueries = (source: string, css: boolean): string[] =>
  css
    ? [...source.matchAll(/@media\b[^{;]*/g)].map((match) => match[0].trim()).filter((query) => RANGE.test(query))
    : source.split("\n").filter((line) => !line.includes("@container") && RANGE.test(line));

const SCRIPTS = (() => {
  const under = (dir: string): string[] =>
    readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) return under(path);
      return entry.name.endsWith(".ts") && !entry.name.endsWith(".test.ts") ? [path] : [];
    });
  return under(webSrc).map((path) => relative(webSrc, path).replace(/\\/g, "/"));
})();

describe("Media queries in the form older iPads read", () => {
  it.each(STYLESHEETS)("%s has no range-form @media query", (sheet) => {
    expect(rangeQueries(readSheet(sheet), true)).toEqual([]);
  });

  it("no script asks matchMedia in the range form", () => {
    const bad = SCRIPTS.flatMap((path) => rangeQueries(read(join("..", path)), false).map((line) => `${path}: ${line}`));
    expect(bad).toEqual([]);
  });

  it("catches the range form and leaves container queries and the classic form alone", () => {
    expect(rangeQueries("@media (width > 620px) and (height <= 500px) {", true)).toHaveLength(1);
    expect(rangeQueries("@media (620px < width <= 820px) {", true)).toHaveLength(1);
    expect(rangeQueries("@container hatch (width < 560px) {", true)).toEqual([]);
    expect(rangeQueries("@media (min-width: 620.02px) and (max-height: 500px) {", true)).toEqual([]);
    expect(rangeQueries('const Q = "(width <= 620px)";', false)).toHaveLength(1);
    expect(rangeQueries("matchMedia(`(width < ${STACK}px)`)", false)).toHaveLength(1);
    expect(rangeQueries("if (width > 0 && width < LIMIT) return;", false)).toEqual([]);
  });
});
