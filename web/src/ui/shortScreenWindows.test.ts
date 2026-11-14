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
    const at = css.indexOf("@media (width > 620px) and (height > 500px) {\n  .overlay__layer > .panel.panel--centre {");
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

/** Whether a `(width > 620px) and (height > 500px)`-style query, commas for "or", matches a screen. */
const matches = (query: string, width: number, height: number): boolean =>
  query.split(",").some((part) =>
    [...part.matchAll(/\((width|height)\s*(<=|>=|<|>)\s*(\d+)px\)/g)].every(([, side, op, px]) => {
      const value = side === "width" ? width : height;
      const limit = Number(px);
      if (op === "<=") return value <= limit;
      if (op === ">=") return value >= limit;
      if (op === "<") return value < limit;
      return value > limit;
    }),
  );

describe("Screen sizes: middle windows or a phone's sheets", () => {
  const SCREENS = [
    { name: "iPad on its side, Safari's bars", width: 1180, height: 600, centred: true },
    { name: "short laptop or small tablet", width: 1024, height: 560, centred: true },
    { name: "laptop", width: 1366, height: 900, centred: true },
    { name: "phone on its side", width: 844, height: 390, centred: false },
    { name: "phone upright", width: 390, height: 844, centred: false },
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

  const centredScreens = SCREENS.filter((screen) => screen.centred);

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
