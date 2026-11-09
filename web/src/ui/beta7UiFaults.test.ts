import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/*
 * The 6 Nov UI check's layout faults (beta 7) and the two a tester saw on a
 * phone. jsdom lays nothing out, so these pin the rules that fix each one;
 * the screenshots at 390x844 / 375x667 / 812x375 show them working.
 */

const here = dirname(fileURLToPath(import.meta.url));
const css = (path: string): string => readFileSync(resolve(here, path), "utf8").replace(/\r\n/g, "\n");

/** Every `@media (<query>)` / `@container <query>` block in a file, joined, braces balanced. */
const block = (source: string, head: string): string => {
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

const phone = (path: string): string => block(css(path), "@media (width <= 620px) {");

describe("6 Nov UI check: phone faults", () => {
  it("Move Monsters: a long outpost name cannot widen the dialog past the screen", () => {
    const source = css("styles/moveyards.css");
    expect(source).toMatch(/\.transfer-dialog \.panel__body \{[^}]*grid-template-columns: minmax\(0, 1fr\);/);
    expect(source).toMatch(/\.transfer-dialog__select \{[^}]*width: 100%;[^}]*min-width: 0;/);
    expect(source).toMatch(/\.transfer-dialog__field \{\s*min-width: 0;/);
    // The phone's one column is minmax(0, 1fr), never a bare 1fr (which grows to the select's text).
    expect(phone("styles/moveyards.css")).toMatch(/\.transfer-dialog__ends \{\s*grid-template-columns: minmax\(0, 1fr\);/);
  });

  it("Hatchery: Max wraps rather than running past the edge; a card shows its hatchery's number", () => {
    const phoneHatch = block(css("styles/hatch.css"), "@container hatch (width < 560px) {");
    expect(phoneHatch).toMatch(/\.hatch-add__controls \{\s*flex-wrap: wrap;/);
    expect(phoneHatch).toMatch(/\.hatch-add__controls \.qty-stepper__step \{\s*flex: 1 1 34px;\s*min-width: 34px;/);
    expect(phoneHatch).toMatch(/\.hatch-add__fill \{\s*flex: 1 0 auto;/);
    expect(phoneHatch).toMatch(/\.hatch-line--hcc \.hatch-now__label-word \{\s*display: none;/);
    expect(phoneHatch).toMatch(/\.hatch-line--hcc \.hatch-now__label-number::before \{\s*content: "#";/);
  });

  it("Baiter: Fill takes its own line in a narrow card instead of the next column or past the edge", () => {
    const source = css("styles/baiter.css");
    expect(source).toMatch(/\.baiter__controls \{\s*flex-wrap: wrap;/);
    expect(source).toMatch(/\.baiter__controls \.qty-stepper__fill \{\s*flex: 1 0 auto;/);
  });

  it("Chat: the open box ends above the dock and sits over it, so More never covers Report", () => {
    const chat = phone("styles/chat.css");
    expect(chat).toMatch(/\.chat-box--open \{\s*z-index: 2;\s*max-height: calc\(100dvh - var\(--chat-top\) - 270px\);/);
    expect(chat).toMatch(/\.chat-box--open \.chat-box__lines \{\s*flex: 1 1 auto;[^}]*min-height: 80px;[^}]*max-height: none;/);
    // The dock's More bubble stays under it.
    expect(css("styles/bubble-menu.css")).toMatch(/\.bubble-menu \{[^}]*z-index: 1;/);
  });

  it("Chat: with a player picked, Mute / View yard / Report stay inside the capped box at 375x667", () => {
    const chat = phone("styles/chat.css");
    const strip = String.raw`\.chat-box\.chat-box--open:has\(> \.chat-box__player:not\(\[hidden\]\)\)`;
    // The room may shrink to one line (not the usual 80px) and drops the profiles branch's fixed reserve.
    expect(chat).toMatch(new RegExp(String.raw`${strip} > \.chat-box__lines \{\s*min-height: 32px;\s*max-height: none;\s*\}`));
    // Room tabs and the English line step aside while the strip shows.
    expect(chat).toMatch(
      new RegExp(String.raw`${strip} > :is\(\.chat-box__rooms, \.chat-box__rule\) \{\s*display: none;\s*\}`),
    );
    // Last resort: it scrolls inside its frame, over the dock.
    expect(chat).toMatch(
      new RegExp(String.raw`:root ${strip} \{\s*z-index: 2;\s*overflow-x: hidden;\s*overflow-y: auto;`),
    );
    // These must outrank feat/profiles' `.chat-box--open:has(...) > .chat-box__lines` (0,4,0) and the
    // looks' `:root[data-skin] :is(..., .chat-box--open)` overflow: visible (0,3,0) in any order.
    expect(css("styles/skin.css")).toMatch(/:root\[data-skin\] :is\([^)]*\.chat-box--open[^)]*\) \{[^}]*overflow: visible;/);
  });

  it("Attack over: the phone sheet is the screen's size and scrolls; the sign stays on the screen", () => {
    const attack = phone("styles/attack.css");
    expect(attack).toMatch(
      /\.attack-end__backdrop \{[^}]*grid-template-rows: minmax\(0, 1fr\);\s*grid-template-columns: minmax\(0, 1fr\);/,
    );
    expect(attack).toMatch(/\.attack-end \{[^}]*height: 100%;\s*max-height: 100%;\s*min-height: 0;/);
    expect(attack).toMatch(/\.attack-end \.panel__body \{[^}]*min-height: 0;[^}]*overflow-y: auto;/);
    expect(attack).toMatch(/:root\[data-skin\] \.attack-end__backdrop \{\s*padding-top: 32px;/);
    // 32px clears both looks' phone signs (Modern lifts 28px, Classic 30px).
    const skin = block(css("styles/skin.css"), "@media (width <= 620px), (height <= 500px) {");
    for (const lift of [...skin.matchAll(/--skin-title-lift: (\d+)px;/g)]) {
      expect(Number(lift[1])).toBeLessThanOrEqual(32);
    }
  });

  it("Tribe editor: the edit bar's width leaves the zoom rail and a margin, so its left is on screen", () => {
    const source = css("styles/tribe-editor.css");
    expect(source).toMatch(/\.tribe-edit-bar \{[^}]*right: calc\(var\(--space-4\) \+ 58px \+ var\(--space-3\)\);/);
    // left = 100vw - right - width = var(--space-4), never below 0.
    expect(source).toMatch(
      /\.tribe-edit-bar \{[^}]*width: min\(380px, calc\(100vw - 2 \* var\(--space-4\) - 58px - var\(--space-3\)\)\);/,
    );
  });
});

describe("tester, 6 Nov: Classic on a phone", () => {
  it("Settings: the tab words keep off Classic's painted ends", () => {
    const skin = block(css("styles/skin.css"), "@media (width <= 620px), (height <= 500px) {");
    expect(skin).toMatch(/:root\[data-skin="flash"\] \.panel \.tab-row > \.account-settings__tab \{\s*padding-inline: 10px;/);
    expect(skin).toMatch(/:root\[data-skin\] \.panel \.account-settings__tabs \{\s*margin-inline: var\(--space-2\);/);
    // After the shared 6px rule, so it wins at the same specificity.
    expect(skin.indexOf("account-settings__tab {")).toBeGreaterThan(
      skin.indexOf(".tab-row > :is(.tabs__tab, .test-report__tab) {"),
    );
  });
});

describe("live attack clean-up (grill item 35)", () => {
  it("the strip takes the top edge and the Army panel follows it up; hidden pieces stay hidden", () => {
    const source = css("styles/attack.css");
    expect(source).toMatch(/\.attack-strip--live \{\s*top: var\(--hud-inset\);/);
    expect(source).toMatch(/\.attack-dock--live \{\s*--hud-height: 0px;/);
    expect(source).toMatch(/\.attack-strip--live \[hidden\],\s*\.attack-status--live\[hidden\] \{\s*display: none;/);
  });
});

describe("Glimmers picture tester, 9 Nov", () => {
  it("a claim's notice shows over an open window (Events, Quests, Build), under popups", () => {
    const hud = css("styles/yard-hud.css");
    // Over the middle windows, which sit one step over --z-hud (ui.css `.panel--centre`).
    expect(hud).toMatch(/\n\.yard-notices \{\s*z-index: calc\(var\(--z-hud\) \+ 2\);/);
    // One rule for every window, not one per window.
    expect(css("quests/quests.css")).not.toMatch(/> \.yard-notices \{/);
  });

  it("Build: the painted title bar keeps the body's inset; on a phone the line shares the '?' row", () => {
    const build = css("styles/build-menu.css");
    expect(build).toMatch(/\n:root\[data-skin\] \.build-menu \.panel__titlebar \{\s*padding-inline: var\(--space-5\);/);
    const phone = block(build, "@media (width <= 620px)");
    expect(phone).toMatch(/:root\[data-skin\] \.build-menu \.panel__titlebar \{\s*padding-inline: var\(--space-3\);/);
    expect(phone).toMatch(/:root\[data-skin\] \.build-menu__meta \{\s*order: 0;\s*flex: 1 1 0;/);
    const skinPhone = block(css("styles/skin.css"), "@media (width <= 620px)");
    expect(skinPhone).toMatch(/\.build-menu__tabs \.tabs__tab \{\s*padding-inline: 4px;\s*font-size: min\(var\(--text-sm\), 2\.6vw\);/);
  });
});

