import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * Bob's kit hides its parts with the `hidden` attribute (issue #227), and the
 * app has no global `[hidden] { display: none }`. So any of those parts whose
 * own rule sets `display` needs a `[hidden]` rule beside it, or it stays on
 * screen when hidden. The guided start's live check found Bob's bubble doing
 * exactly that, over the Goals panel and after Skip. jsdom never applies a
 * stylesheet, so the rule is checked in the CSS text itself.
 */

/** Every element the kit (and the guided start's own pieces) toggles with `hidden`, by class. */
const TOGGLED: Record<string, readonly string[]> = {
  "../styles/guide.css": [
    // BobBubble: the bubble and its row of buttons.
    "guide-bob",
    "guide-bob__controls",
    // GuideArrow: the hand.
    "guide-arrow",
    // Spotlight: the blocker, its panes and the ring round the hole.
    "guide-spotlight",
    "guide-spotlight__pane",
    "guide-spotlight__ring",
  ],
  // AccountMenu's Help item (`account-menu__help`), shown only while the tour is on offer.
  "../styles/guide-start.css": ["account-menu__help"],
  // The screen tips' "?" (HelpButton), hidden while the guided start runs.
  "../styles/tips.css": ["guide-help", "guide-help--float"],
};

/** A stylesheet's text with its comments taken out, so a comment never reads as part of a selector. */
const css = (file: string): string =>
  readFileSync(new URL(file, import.meta.url), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");

/** The declarations of every rule whose selector list names exactly `.<name>` (no state, no child). */
const plainRules = (text: string, name: string): string[] => {
  const rules: string[] = [];
  for (const match of text.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const selectors = match[1]!.split(",").map((one) => one.trim());
    if (selectors.includes(`.${name}`)) rules.push(match[2]!);
  }
  return rules;
};

/** Whether a rule `.<name>[hidden]` sets `display: none`. */
const hasHiddenRule = (text: string, name: string): boolean => {
  for (const match of text.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const selectors = match[1]!.split(",").map((one) => one.trim());
    if (selectors.includes(`.${name}[hidden]`) && /display\s*:\s*none/.test(match[2]!)) return true;
  }
  return false;
};

describe("the guide's CSS and the hidden attribute", () => {
  for (const [file, names] of Object.entries(TOGGLED)) {
    const text = css(file);
    for (const name of names) {
      it(`.${name} (${file.split("/").pop()}) is gone when hidden`, () => {
        const ownDisplay = plainRules(text, name).some((body) => /(^|;|\s)display\s*:/.test(body));
        // Only a part that sets its own display can beat `hidden`; that one must say so.
        if (ownDisplay) expect(hasHiddenRule(text, name)).toBe(true);
      });
    }
  }

  it("covers Bob's bubble and its buttons, which set display: flex", () => {
    const text = css("../styles/guide.css");
    expect(hasHiddenRule(text, "guide-bob")).toBe(true);
    expect(hasHiddenRule(text, "guide-bob__controls")).toBe(true);
  });

  it("the tips' \"?\" has its own guard", () => {
    expect(hasHiddenRule(css("../styles/tips.css"), "guide-help")).toBe(true);
  });

  it("the floating \"?\" steps aside while a panel shows its own (one \"?\" at a time)", () => {
    const text = css("../styles/tips.css");
    const rule = [...text.matchAll(/([^{}]+)\{([^{}]*)\}/g)].find(([, selector]) =>
      selector!.trim().endsWith(".guide-help--float") && selector!.includes(":has("),
    );
    expect(rule).toBeDefined();
    const selector = rule![1]!.trim();
    // Only a shown "?" in a panel's title row counts: not a hidden one, nor one inside a hidden panel.
    expect(selector).toBe(
      ".overlay:has(.panel__titlebar > .guide-help:not([hidden]):not([hidden] *)) .guide-help--float",
    );
    expect(rule![2]).toMatch(/display\s*:\s*none/);
  });

  it("adds no global [hidden] rule", () => {
    for (const file of Object.keys(TOGGLED)) expect(css(file)).not.toMatch(/(^|[\s,}])\[hidden\]\s*[,{]/);
  });
});
