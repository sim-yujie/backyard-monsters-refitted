import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * jsdom never applies a stylesheet, so the Quick Join layout is checked in the
 * CSS text itself: the type chips must fit inside the window at any width,
 * never run off the right edge and never scroll sideways (owner, 10 Nov 2026).
 */

/** alliance.css with its comments taken out. */
const css = readFileSync(new URL("./alliance.css", import.meta.url), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");

/** The text of the phone block, `@media (width <= 480px) { ... }`. */
const phoneCss = ((): string => {
  const at = css.indexOf("@media (width <= 480px)");
  const open = css.indexOf("{", at);
  let depth = 1;
  let i = open + 1;
  for (; depth > 0 && i < css.length; i++) {
    if (css[i] === "{") depth++;
    else if (css[i] === "}") depth--;
  }
  return css.slice(open + 1, i - 1);
})();

/** The bodies of every rule whose selector list names exactly `selector`. */
const rulesFor = (selector: string, text: string = css): string[] => {
  const out: string[] = [];
  const rule = /([^{}]+)\{([^{}]*)\}/g;
  for (let match = rule.exec(text); match; match = rule.exec(text)) {
    const selectors = match[1]!.split(",").map((part) => part.trim());
    if (selectors.includes(selector)) out.push(match[2]!);
  }
  return out;
};

describe("alliance.css: Quick Join chips fit the window", () => {
  it("lays the four chips out in a two-column grid that shares the width", () => {
    const types = rulesFor(".alliance__quick-types").join("\n");
    expect(types).toMatch(/display:\s*grid/);
    expect(types).toMatch(/grid-template-columns:\s*repeat\(2,\s*minmax\(0,\s*1fr\)\)/);
  });

  it("never scrolls the chips sideways", () => {
    for (const body of rulesFor(".alliance__quick-types")) {
      expect(body).not.toMatch(/overflow(-x)?:\s*(auto|scroll)/);
      expect(body).not.toMatch(/flex-wrap:\s*nowrap/);
    }
  });

  it("lets a chip shrink to its cell, its name breaking onto a second line", () => {
    const chip = rulesFor(".alliance__chip").join("\n");
    expect(chip).toMatch(/min-width:\s*0/);
    expect(chip).not.toMatch(/flex:\s*none/);
    expect(chip).toMatch(/flex-wrap:\s*wrap/);
    expect(rulesFor(".alliance__chip-word").join("\n")).toMatch(/overflow-wrap:\s*anywhere/);
  });

  it("puts Join beside the Quick Join heading, so the chips get the full width", () => {
    const quick = rulesFor(".alliance__quick").find((body) => body.includes("grid-template-areas"));
    expect(quick).toBeDefined();
    expect(quick).toMatch(/"label join"\s*"types types"/);
    expect(rulesFor(".alliance__quick-join").join("\n")).toMatch(/grid-area:\s*join/);
  });
});

describe("alliance.css: an invite row on a phone", () => {
  it("keeps Accept / Decline beside the name on desktop", () => {
    const answer = rulesFor(".alliance__invite-answer").join("\n");
    expect(answer).toMatch(/flex:\s*none/);
    expect(rulesFor(".alliance__invite").join("\n")).not.toMatch(/flex-wrap:\s*wrap/);
  });

  it("puts Accept / Decline on a line of their own under the shield and name", () => {
    expect(phoneCss).not.toBe("");
    expect(rulesFor(".alliance__invite--answer", phoneCss).join("\n")).toMatch(/flex-wrap:\s*wrap/);
    expect(rulesFor(".alliance__invite--answer > .alliance__invite-answer", phoneCss).join("\n")).toMatch(/flex:\s*1 1 100%/);
  });

  it("cuts the name and sender with an ellipsis only, never a hard stub", () => {
    const words = rulesFor(".alliance__invite-words > *").join("\n");
    expect(words).toMatch(/text-overflow:\s*ellipsis/);
    expect(rulesFor(".alliance__invite-words").join("\n")).toMatch(/min-width:\s*0/);
  });
});

describe("alliance.css: the member window's tabs and the Territory board", () => {
  it("widens a member's window past the 560 px every panel stops at (ui.css), so four tabs fit", () => {
    const wide = rulesFor(".alliance-window:has(.alliance__tabs)").join("\n");
    expect(wide).toMatch(/width:\s*min\(100%,\s*840px\)/);
    expect(wide).toMatch(/max-width:\s*min\(100%,\s*840px\)/);
  });

  it("marks the chosen board with the held-down plate and white words in both painted looks", () => {
    const chosen = rulesFor(':root[data-skin] .alliance-window .alliance-board__type[aria-pressed="true"]').join("\n");
    expect(chosen).toMatch(/border-image-source:\s*var\(--skin-button-pressed\)/);
    expect(chosen).toMatch(/color:\s*#fff/);
    expect(chosen).toMatch(/text-shadow:[^;]*var\(--skin-button-stroke\)/);
  });
});

describe("alliance.css: a constellation's monster behind its stars", () => {
  it("draws the picture faint, fitted whole, and never in the way of a click", () => {
    const art = rulesFor(".alliance-sky__monster").join(" ");
    const opacity = Number(/opacity:\s*([\d.]+)/.exec(art)?.[1]);
    expect(opacity).toBeGreaterThanOrEqual(0.2);
    expect(opacity).toBeLessThanOrEqual(0.35);
    expect(art).toMatch(/object-fit:\s*contain/);
    expect(art).toMatch(/pointer-events:\s*none/);
    expect(art).toMatch(/position:\s*absolute/);
  });

  it("lays the stars over the picture", () => {
    expect(rulesFor(".alliance-sky__art").join(" ")).toMatch(/position:\s*relative/);
    expect(rulesFor(".alliance-sky__figure").join(" ")).toMatch(/position:\s*relative/);
  });
});

describe("alliance.css: trade tiles", () => {
  it("set the resource tiles (buttons) in the window's own font, not the browser's", () => {
    expect(rulesFor(".trade-tile").join(" ")).toMatch(/font:\s*inherit/);
  });

  it("lights the chosen \"For\" tile in the accent, and Classic's in the orange plate with dark writing", () => {
    expect(rulesFor(".trade-for-pick__item.is-on").join(" ")).toMatch(/border-color:\s*var\(--colour-accent\)/);
    expect(rulesFor(".trade-for-pick__item.is-on .trade-for-pick__name").join(" ")).toMatch(/background:\s*var\(--colour-accent\)/);
    const classic = rulesFor(':root[data-skin="flash"] .trade-for-pick__item.is-on').join(" ");
    expect(classic).toMatch(/linear-gradient\(#ffc457/);
    expect(rulesFor(':root[data-skin="flash"] .trade-for-pick__item.is-on .trade-for-pick__name').join(" ")).toMatch(/color:\s*#2a1606/);
  });

  it("gives each \"For\" tile a one-line name in the game's font", () => {
    expect(rulesFor(".trade-for-pick__item").join(" ")).toMatch(/font:\s*inherit/);
    const name = rulesFor(".trade-for-pick__name").join(" ");
    expect(name).toMatch(/white-space:\s*nowrap/);
    expect(name).toMatch(/text-overflow:\s*ellipsis/);
  });
});

describe("alliance.css: a member's window keeps one height", () => {
  it("fixes the height (capped by the room under the top bar), so the tab row never moves", () => {
    const member = rulesFor(".alliance-window:has(.alliance__tabs)").join(" ");
    expect(member).toMatch(/(^|[;\s])height:\s*min\(760px,\s*var\(--alliance-window-room\)\)/);
    expect(rulesFor(".alliance-window").join(" ")).toMatch(/max-height:\s*var\(--alliance-window-room\)/);
    expect(rulesFor(".alliance-window > .panel__body").join(" ")).toMatch(/overflow-y:\s*auto/);
  });

  it("no phone or other rule sets the member window's height back to its content", () => {
    expect(css).not.toMatch(/\.alliance-window[^{]*\{[^}]*(^|[;\s])height:\s*(auto|max-content|fit-content)/m);
  });
});

describe("alliance.css: the marketplace keeps one height", () => {
  it("fixes the marketplace's height like a member's window, so filters never move the title", () => {
    expect(rulesFor(".alliance-window:has(.alliance__head--market)").join(" ")).toMatch(
      /(^|[;\s])height:\s*min\(760px,\s*var\(--alliance-window-room\)\)/,
    );
  });

  it("gives a message in the head its own space and a line under it", () => {
    const head = rulesFor(".alliance-window > .panel__head:has(> .alliance__status:not([hidden]))").join(" ");
    expect(head).toMatch(/padding-bottom:/);
    expect(head).toMatch(/border-bottom:/);
  });
});
