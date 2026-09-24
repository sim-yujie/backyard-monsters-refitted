/**
 * Reading `client/scripts/YARD_PROPS.as`, shared by the table generators.
 *
 * Three generators parse the Flash client's props table — `gen-building-costs.mjs`
 * for prices, `gen-building-art.mjs` for sprites and `gen-combat-stats.mjs` for
 * combat numbers — and each needs the same three primitives: a comment-stripped
 * read of the file, a bracket matcher that survives nesting, and an integer
 * array reader. They lived in `gen-building-costs.mjs` until the combat table
 * needed them too (`docs/design/server-combat.md` §3.3).
 *
 * Nothing here runs in the browser and nothing in `src/` imports it.
 */

import { readFileSync } from "node:fs";

/**
 * The props file, with `//` line comments stripped.
 *
 * Several entries keep dead lines commented out, and reading those as live
 * would price a building from a step the game never charges. No string literal
 * in this file contains `//`, so stripping to end of line is safe. Line numbers
 * are taken from the original text, so citations still point at the right place.
 *
 * Returns both texts: `source` is what to parse, `original` is what to cite.
 */
export const readPropsSource = (path) => {
  const original = readFileSync(path, "utf8");
  return { original, source: original.replace(/\/\/[^\n]*/g, "") };
};

/**
 * Index of the bracket matching the one at `open`, which may be `{` or `[`.
 *
 * `gen-building-art.mjs:49-63` does the same for braces only; the cost table
 * needs it for arrays as well, because `costs` and `re` are both arrays with
 * objects and arrays nested inside them.
 */
export const matchBrace = (text, open) => {
  const opener = text[open];
  const closer = opener === "[" ? "]" : "}";
  let depth = 0;
  for (let i = open; i < text.length; i++) {
    const c = text[i];
    if (c === '"') {
      // Skip a string literal; AS3 has no escapes worth worrying about here.
      i = text.indexOf('"', i + 1);
      if (i < 0) break;
      continue;
    }
    if (c === opener) depth++;
    else if (c === closer && --depth === 0) return i;
  }
  throw new Error(`Unbalanced brackets from ${open}`);
};

/** `[0, 0, 8, 15]` -> the same as numbers; `[]` when the entry has none. */
export const readIntArray = (text, key) => {
  const hit = new RegExp(`"${key}"\\s*:\\s*\\[([^\\]]*)\\]`).exec(text);
  if (!hit) return [];
  return hit[1]
    .split(",")
    .map((one) => Number(one.trim()))
    .filter((one) => Number.isFinite(one));
};

/**
 * A `lineOf(index)` closed over one text: the 1-based line an index falls on.
 *
 * Built per source rather than exported as a free function so a caller cannot
 * accidentally count lines in the stripped text against the original's offsets.
 */
export const lineCounter = (text) => (index) => text.slice(0, index).split("\n").length;
