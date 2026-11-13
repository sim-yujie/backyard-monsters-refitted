import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * The phone's folded chat strip and the Events button (owner, 13 Nov 2026:
 * "world chat gets cut off by events tab"). jsdom never lays a page out, so
 * the rule is checked in the CSS text: the strip ran the whole width, and the
 * Events button hangs in the top right corner at the strip's height.
 */

const read = (path: string): string =>
  readFileSync(new URL(path, import.meta.url), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");

const chatCss = read("../styles/chat.css");
const eventsCss = read("../events/events.css");

/** The text of the `@media (width <= 620px)` block(s) in `css`. */
const phone = (css: string): string => {
  const out: string[] = [];
  const head = /@media \(width <= 620px\)\s*\{/g;
  for (let match = head.exec(css); match; match = head.exec(css)) {
    let depth = 1;
    let at = head.lastIndex;
    while (depth > 0 && at < css.length) {
      if (css[at] === "{") depth += 1;
      else if (css[at] === "}") depth -= 1;
      at += 1;
    }
    out.push(css.slice(head.lastIndex, at - 1));
  }
  return out.join("\n");
};

const px = (text: string, name: RegExp): number => Number(name.exec(text)?.[1] ?? NaN);

describe("chat.css: the phone strip stops before the Events button", () => {
  const strip = /\.overlay__layer:has\(> \.yard-dock > \.events-door:not\(\[hidden\]\)\) > \.chat-box:not\(\.chat-box--open\)\s*\{([^}]*)\}/.exec(
    phone(chatCss),
  )?.[1] ?? "";

  it("narrows the folded strip while the Events button shows", () => {
    expect(strip).toMatch(/width:\s*calc\(100% - var\(--space-3\) - \d+px\)/);
  });

  it("keeps clear of the button's disc and its sign, wherever events.css puts them", () => {
    const reserve = px(strip, /- (\d+)px\)/);
    const eventsPhone = phone(eventsCss);
    // The button sits var(--space-3) (12px) from the right edge on a phone.
    expect(eventsPhone).toMatch(/\.yard-dock > \.events-door\s*\{[^}]*right:\s*var\(--space-3\)/);
    const disc = px(eventsPhone, /\.events-door \.yard-dock__disc\s*\{[^}]*width:\s*(\d+)px/);
    // 12px edge + the widest part (Classic's sign, about 76px) + a gap.
    expect(reserve).toBeGreaterThanOrEqual(12 + Math.max(disc, 76) + 4);
  });

  it("the strip's line still ends in an ellipsis rather than running on", () => {
    expect(phone(chatCss)).toMatch(/\.chat-box:not\(\.chat-box--open\) \.chat-line\s*\{[^}]*text-overflow:\s*ellipsis/);
  });
});
