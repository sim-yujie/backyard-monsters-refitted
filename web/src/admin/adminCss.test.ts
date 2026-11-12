import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * jsdom never applies a stylesheet, so these layout rules are checked in the
 * CSS text itself: the confirm step's buttons must stay in sight, and the
 * phone's stacked activity rows must fit their box.
 */

/** admin.css with its comments taken out. */
const css = readFileSync(new URL("./admin.css", import.meta.url), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");

/** Each top-level block: its media query (or "" outside one) and its rules. */
const blocks = (): { media: string; body: string }[] => {
  const out: { media: string; body: string }[] = [];
  let i = 0;
  let plain = "";
  while (i < css.length) {
    const at = css.indexOf("@media", i);
    if (at < 0) {
      plain += css.slice(i);
      break;
    }
    plain += css.slice(i, at);
    const open = css.indexOf("{", at);
    let depth = 1;
    let j = open + 1;
    while (depth > 0 && j < css.length) {
      if (css[j] === "{") depth++;
      else if (css[j] === "}") depth--;
      j++;
    }
    out.push({ media: css.slice(at + 6, open).trim(), body: css.slice(open + 1, j - 1) });
    i = j;
  }
  out.push({ media: "", body: plain });
  return out;
};

/** Declarations (property -> value, later wins) of rules naming `selector` in a media block. */
const decls = (media: string, selector: string): Record<string, string> => {
  const found: Record<string, string> = {};
  for (const block of blocks().filter((b) => b.media === media)) {
    for (const match of block.body.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
      const selectors = match[1]!.split(",").map((one) => one.trim());
      if (!selectors.includes(selector)) continue;
      for (const line of match[2]!.split(";")) {
        const colon = line.indexOf(":");
        if (colon > 0) found[line.slice(0, colon).trim()] = line.slice(colon + 1).trim();
      }
    }
  }
  return found;
};

describe("admin.css: confirm step", () => {
  it("pins Cancel and Confirm to the foot of whatever scrolls", () => {
    const buttons = decls("", ".confirm-pane .buttons");
    expect(buttons.position).toBe("sticky");
    expect(buttons.bottom).toBe("0");
    expect(buttons.background).toBeTruthy();
  });

  it("lets the phone's action bar go back into the flow while the step is open", () => {
    const bar = decls("(max-width: 1023px)", ".detail:has(> .review-body.has-confirm) > .action-bar");
    expect(bar.position).toBe("static");
  });

  it("scrolls only the fields in the wide side column, never the buttons", () => {
    const wide = "(min-width: 1200px)";
    expect(decls(wide, ".confirm-pane").overflow).toBe("hidden");
    const fields = decls(wide, ".confirm-fields");
    expect(fields.overflow).toBe("auto");
    expect(fields["min-height"]).toBe("0");
    expect(decls(wide, ".confirm-pane .buttons").flex).toBe("none");
  });
});

describe("admin.css: phone activity table", () => {
  const phone = "(max-width: 559px)";

  it("stacks the table itself as a block, so it never sizes to its widest line", () => {
    for (const part of [".data-table", ".data-table tr", ".data-table td", ".data-table tbody th"]) {
      expect(decls(phone, part).display, part).toBe("block");
    }
  });

  it("wraps every cell, including the two number columns", () => {
    for (const cell of [".data-table tbody th", ".data-table td", ".data-table td:nth-child(2)", ".data-table td:nth-child(3)"]) {
      const d = decls(phone, cell);
      expect(d["white-space"], cell).toBe("normal");
      expect(d["overflow-wrap"], cell).toBe("anywhere");
    }
  });

  it("forces no width on a phone", () => {
    for (const part of [".data-table", ".data-table tr", ".data-table td"]) {
      const d = decls(phone, part);
      expect(d["min-width"] ?? "0", part).toBe("0");
      expect(d.width ?? "auto", part).toBe("auto");
    }
  });
});

describe("the Shiny gift log", () => {
  it("leaves the amount in its own column: only the give form's input box is 110px wide", () => {
    // A bare `.award-amount { width: 110px }` also widened the log's amount span past its
    // 4.25rem column, so "+50" was drawn over the player's name (Player Support, 11 Nov).
    expect(css).not.toMatch(/(^|\})\s*\.award-amount\s*\{[^}]*width:/);
    expect(css).toMatch(/\.input\.award-amount\s*\{[^}]*width: 110px;/);
  });
});
