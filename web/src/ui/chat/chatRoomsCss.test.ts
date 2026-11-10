import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * jsdom never lays a page out, so the rule is checked in the CSS text itself.
 *
 * At phone width the open chat box has a max-height and lays its parts out in
 * a flex column. The room tabs (Global / Alliance / country) are a `.tab-row`,
 * which ui.css makes a sideways scroller (`overflow-y: hidden`); a scroller's
 * automatic flex floor is 0, so the capped box squeezed the row to a sliver
 * and the lines covered the tabs (alliance chat at 390x844, 10 Nov 2026).
 */

/** A stylesheet with its comments taken out. */
const read = (path: string): string =>
  readFileSync(new URL(path, import.meta.url), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");

const chatCss = read("../styles/chat.css");
const uiCss = read("../styles/ui.css");

/** The bodies of every top-level rule whose selector list names exactly `selector`. */
const rulesFor = (selector: string, text: string): string[] => {
  const out: string[] = [];
  const rule = /([^{}]+)\{([^{}]*)\}/g;
  for (let match = rule.exec(text); match; match = rule.exec(text)) {
    const selectors = match[1]!.split(",").map((part) => part.trim());
    if (selectors.includes(selector)) out.push(match[2]!);
  }
  return out;
};

describe("chat.css: the room tabs never shrink under the lines", () => {
  it("the shared tab row is still a scroller, so its flex floor is 0 (why the fix is needed)", () => {
    const tabRow = /\.tab-row:is\([^)]*\)\s*\{([^}]*)\}/.exec(uiCss)?.[1] ?? "";
    expect(tabRow).toMatch(/overflow-y:\s*hidden/);
  });

  it("the rooms row takes no flex shrink", () => {
    const rooms = rulesFor(".chat-box__rooms", chatCss).join("\n");
    expect(rooms).toMatch(/flex:\s*none|flex-shrink:\s*0/);
  });

  it("the phone's open box still caps its height and the lines are the part that gives way", () => {
    expect(chatCss).toMatch(/\.chat-box--open\s*\{[^}]*max-height:/);
    const lines = rulesFor(".chat-box--open .chat-box__lines", chatCss).join("\n");
    expect(lines).toMatch(/flex:\s*1 1 auto/);
  });

  it("no rule lets the rooms row shrink again", () => {
    for (const body of rulesFor(".chat-box__rooms", chatCss)) {
      expect(body).not.toMatch(/flex-shrink:\s*[1-9]/);
      expect(body).not.toMatch(/flex:\s*1/);
    }
  });
});
