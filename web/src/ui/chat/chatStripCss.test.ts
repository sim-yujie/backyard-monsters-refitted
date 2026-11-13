import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * The phone's folded chat line and the Events button (owner, 13 Nov 2026:
 * "world chat gets cut off by events tab"). jsdom never lays a page out, so
 * the rules are checked in the CSS text and the 390px phone is worked out
 * from their numbers.
 *
 * Beside the "Chat" tab the line ran under the Events button; stopped short
 * of it (200px), the line showed only the picture, the GM badge and "…"
 * (lead's check at 390x844). Now the line has its own row under the tab, past
 * the button's bottom, the whole width, and only the words end in "…".
 */

const read = (path: string): string =>
  readFileSync(new URL(path, import.meta.url), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");

const chatCss = read("../styles/chat.css");
const eventsCss = read("../events/events.css");
const hudCss = read("../styles/yard-hud.css");

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

const escape = (text: string): string => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** The body of the rule whose selector is exactly `selector` in `css`. */
const rule = (css: string, selector: string): string =>
  new RegExp(`(?:^|[}\\s])${escape(selector)}\\s*\\{([^}]*)\\}`).exec(css)?.[1] ?? "";

const px = (text: string, pattern: RegExp): number => Number(pattern.exec(text)?.[1] ?? NaN);

const chatPhone = phone(chatCss);
const folded = ".chat-box:not(.chat-box--open)";

describe("chat.css: the phone's folded line has its own row, clear of the Events button", () => {
  it("the folded box is no longer a row: the tab, then the line under it", () => {
    expect(rule(chatPhone, folded)).not.toMatch(/flex-direction:\s*row/);
    expect(chatPhone).not.toMatch(/96px/);
    // The box keeps the whole width on a phone.
    expect(rule(chatPhone, ".chat-box")).toMatch(/width:\s*calc\(100% - 2 \* var\(--space-3\)\)/);
  });

  it("the line starts below the Events button's bottom", () => {
    // Under the HUD: the chat box's top (chat.css --chat-top: + 8px + 32px + 12px).
    expect(chatCss).toMatch(/--chat-top:\s*calc\(var\(--hud-height\) \+ var\(--space-2\) \+ 32px \+ var\(--space-3\)\)/);
    const boxTop = 8 + 32 + 12;
    const tab = px(rule(chatCss, ".chat-box__tab"), /min-height:\s*(\d+)px/);
    expect(rule(chatCss, ".chat-box")).toMatch(/gap:\s*var\(--space-1\)/);
    const gap = 4;
    const margin = px(rule(chatPhone, `${folded} .chat-box__lines`), /margin-top:\s*(\d+)px/);
    const lineTop = boxTop + tab + gap + margin;

    // The button: HUD + 8px, its 48px disc, a 6px gap and its sign (13px
    // words at 1.35 with 2px padding, Classic's 3px more); the lead measured
    // 126-200 at 390x844, under a 118px HUD.
    const events = phone(eventsCss);
    expect(events).toMatch(/\.yard-dock > \.events-door\s*\{[^}]*top:\s*calc\(var\(--hud-height\) \+ var\(--space-2\)\)/);
    const disc = px(events, /\.events-door \.yard-dock__disc\s*\{[^}]*height:\s*(\d+)px/);
    const buttonBottom = 8 + disc + 6 + Math.ceil(13 * 1.35) + 4 + 3;
    expect(buttonBottom).toBeGreaterThanOrEqual(200 - 118);
    expect(lineTop).toBeGreaterThan(buttonBottom);
  });

  it("the notices hang under the line, not on it", () => {
    const top = px(phone(hudCss), /> \.yard-notices \{\s*top: calc\(var\(--notice-top-inset\) \+ (\d+)px\)/);
    const lineBottom = 8 + 32 + 12 + 28 + 4 + 6 + 20;
    expect(top).toBeGreaterThanOrEqual(lineBottom + 8);
  });
});

describe("chat.css: at 390px the folded line shows the name and the start of the words", () => {
  const line = rule(chatPhone, `${folded} .chat-line:last-child:not(.chat-line--notice)`);
  const name = rule(chatPhone, `${folded} .chat-line > .chat-line__name`);
  const body = rule(chatPhone, `${folded} .chat-line > .chat-line__body`);

  it("lays the line out in a row where the words, not the name, give way", () => {
    expect(line).toMatch(/display:\s*flex/);
    expect(rule(chatPhone, `${folded} .chat-line > :is(.chat-line__pic, .chat-line__gm, .chat-line__mod)`)).toMatch(
      /flex:\s*none/,
    );
    expect(body).toMatch(/flex:\s*1 1 0/);
    expect(body).toMatch(/min-width:\s*0/);
    expect(body).toMatch(/text-overflow:\s*ellipsis/);
    expect(name).toMatch(/flex:\s*0 1 auto/);
    expect(name).toMatch(/max-width:\s*60%/);
  });

  it("leaves room for the name and the words at 390px", () => {
    const width = 390 - 2 * 12;
    const picture = 18 + 5;
    const badge = 30; // "GM" at 0.75em with its padding: the lead measured 22px
    const typicalName = 113 + 5; // "[35] uwupeasant:" at 13px bold: measured 113px
    expect(width - picture - badge - typicalName).toBeGreaterThanOrEqual(150);
    // Even a name at its 60% cap leaves the words a start.
    const cap = px(name, /max-width:\s*(\d+)%/) / 100;
    expect(width - picture - badge - width * cap).toBeGreaterThanOrEqual(80);
  });
});

describe("chat.css: folded on a phone, only the newest line shows (7.2 hotfix, owner 13 Nov)", () => {
  it("hides every older line, and no later folded-line rule shows them again", () => {
    expect(rule(chatPhone, `${folded} .chat-line:not(:last-child)`)).toMatch(/display:\s*none/);
    // A rule with the same weight that sets display on every line (not only the last)
    // came later and showed the whole history over the yard in 7.2.
    const shown = [...chatPhone.matchAll(/([^{}]+)\{([^}]*)\}/g)]
      .map((match) => ({ selector: (match[1] ?? "").trim(), body: match[2] ?? "" }))
      .filter(({ selector, body }) => selector.includes(folded) && /\.chat-line(?![-_])/.test(selector) && /display:\s*(?!none\b)[a-z]/.test(body))
      .map(({ selector }) => selector);
    for (const selector of shown) expect(selector).toMatch(/:last-child/);
  });
});
