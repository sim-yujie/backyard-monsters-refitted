import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * The open chat box and the yard's left dock (24 Nov 2026). On a phone on its
 * side (844x390) the yard switcher, Map and Friends were drawn over the open
 * box's lines and input; on an iPad (1024x768) Main yard covered the input.
 * jsdom lays nothing out, so the rules are checked in the CSS text and the
 * sizes are worked out from their numbers (the after-shots show them working).
 */

const read = (path: string): string =>
  readFileSync(new URL(path, import.meta.url), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");

const chatCss = read("../styles/chat.css");

const escape = (text: string): string => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** The text of every `@media <query> { … }` block in `css`. */
const media = (css: string, query: string): string => {
  const out: string[] = [];
  const head = new RegExp(`@media ${escape(query)}\\s*\\{`, "g");
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

/** Every top-level rule body for exactly `selector` (outside @media). */
const topRule = (css: string, selector: string): string => {
  let flat = css;
  for (let at = flat.indexOf("@media"); at >= 0; at = flat.indexOf("@media")) {
    let depth = 0;
    let end = flat.indexOf("{", at);
    for (let i = end; i < flat.length; i += 1) {
      if (flat[i] === "{") depth += 1;
      else if (flat[i] === "}") depth -= 1;
      if (depth === 0) {
        end = i;
        break;
      }
    }
    flat = flat.slice(0, at) + flat.slice(end + 1);
  }
  // Only a rule that starts its own line: `:root[…] .chat-box--open` is a different selector.
  const found = [...flat.matchAll(new RegExp(`(?:^|\\n)${escape(selector)}\\s*\\{([^}]*)\\}`, "g"))];
  return found.map((match) => match[1]).join("\n");
};

const SHORT =
  "(min-width: 621px) and (max-height: 635px), (pointer: coarse) and (min-width: 621px) and (max-height: 670px)";
const short = media(chatCss, SHORT);

describe("chat.css: the open box never runs under the left dock", () => {
  it("the box itself is capped above the dock and the room is the part that gives way", () => {
    const box = topRule(chatCss, ".chat-box--open");
    expect(box).toMatch(/--chat-bottom-reserve:\s*calc\(229px \+ 13px\)/);
    expect(box).toMatch(/max-height:\s*calc\(100vh - var\(--chat-top\) - var\(--chat-bottom-reserve\)\)/);
    expect(box).toMatch(/max-height:\s*calc\(100dvh - var\(--chat-top\) - var\(--chat-bottom-reserve\)\)/);
    const lines = topRule(chatCss, ".chat-box--open .chat-box__lines");
    // A real basis (never `1 1 0`, the Safari trap in the layout rules) that may shrink.
    expect(lines).toMatch(/flex:\s*0 1 260px/);
    expect(lines).toMatch(/min-height:\s*64px/);
    expect(lines).toMatch(/overflow-y:\s*auto/);
    // No fixed guess at the rest of the box any more (it missed the room tabs and the notice).
    expect(chatCss).not.toMatch(/229px - 150px/);
  });

  it("the corner steps aside where the box's top + rest + a 64px room + the reserve do not fit", () => {
    // Measured 24 Nov: an iPad (1024 wide) top 142px, all but the room 203px (Global, with its
    // notice); a laptop (1366 wide, no touch) top 138px, the rest 191px.
    const ipad = 142 + 203 + 64 + 229 + 13;
    const laptop = 138 + 191 + 64 + 229 + 13;
    expect(ipad).toBeGreaterThan(635);
    expect(ipad).toBeLessThanOrEqual(670);
    expect(laptop).toBeLessThanOrEqual(635);
    // A 1366x768 laptop's browser (about 650px tall) keeps its corner.
    expect(650).toBeGreaterThan(635);
    expect(short).not.toBe("");
  });

  it("on a short screen the switcher, Map, Friends and a friend's Prev/Next hide while the box is open", () => {
    for (const part of ["> .yard-dock .yard-dock__left", "> .friends-button", "> .friend-hop"]) {
      expect(short).toContain(`.overlay__layer:has(> .chat-box--open) ${part}`);
    }
    // Hidden, not removed: Friends keeps measuring Map's box for its place.
    expect(short).toMatch(/\.friend-hop\s*\{\s*visibility:\s*hidden;\s*\}/);
  });

  it("on a short screen the box runs to the bottom edge, clear of the home bar", () => {
    expect(short).toMatch(
      /\.chat-box--open\s*\{\s*--chat-bottom-reserve:\s*calc\(var\(--space-3\) \+ env\(safe-area-inset-bottom, 0px\)\);/,
    );
    expect(short).toMatch(/\.chat-box--open \.chat-box__lines\s*\{\s*min-height:\s*48px;/);
  });

  it("an upright phone keeps its own cap above the dock row (the short band needs 621px or more)", () => {
    const phone = media(chatCss, "(max-width: 620px)");
    expect(phone).toMatch(/max-height:\s*calc\(100dvh - var\(--chat-top\) - 270px\)/);
    expect(phone).not.toContain(".overlay__layer:has(> .chat-box--open)");
  });
});

describe("chat.css: a short screen keeps the folded line and the open room readable", () => {
  const strip = media(chatCss, "(min-width: 621px) and (max-height: 720px)");

  it("folded, only the newest line shows, on one line (four ran under the switcher and Map)", () => {
    expect(short).toMatch(/\.chat-box:not\(\.chat-box--open\) \.chat-line:not\(:last-child\)\s*\{\s*display:\s*none;/);
    // The name keeps its room; only the words end in "…".
    expect(short).toMatch(/\.chat-box:not\(\.chat-box--open\) \.chat-line > \.chat-line__name\s*\{[^}]*max-width:\s*60%;/);
  });

  it("open on a short screen, Global's notice keeps to one line", () => {
    expect(short).toMatch(/\.chat-box--open \.chat-box__rule\s*\{[^}]*white-space:\s*nowrap;/);
  });

  it("up to 720px tall a player's strip is one row of pictures and the room tabs step aside", () => {
    expect(strip).toMatch(/\.chat-box__action--icon \.chat-box__action-label\s*\{[^}]*clip-path:\s*inset\(50%\);/);
    expect(strip).toMatch(/:has\(> \.chat-box__player:not\(\[hidden\]\)\) > :is\(\.chat-box__rooms, \.chat-box__rule\)\s*\{\s*display:\s*none;/);
  });
});

describe("chat.css: only the room gives way, and a strip never spills out of the frame", () => {
  it("the tab (with its ×), notice, status, input and strip keep their height", () => {
    expect(chatCss).toMatch(
      /\.chat-box--open > :is\(\.chat-box__tab, \.chat-box__rule, \.chat-box__status, \.chat-box__form, \.chat-box__player\)\s*\{\s*flex:\s*none;/,
    );
  });

  it("with a player's strip up the box scrolls inside its frame at every size", () => {
    const strip = topRule(chatCss, ":root .chat-box.chat-box--open:has(> .chat-box__player:not([hidden]))");
    expect(strip).toMatch(/overflow-y:\s*auto/);
  });
});
