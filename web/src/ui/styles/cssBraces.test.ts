import { readdirSync, readFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * Every stylesheet's braces pair up (bug 73, 27 Nov 2026).
 *
 * The game's build joins the stylesheets into one file. A stray `}` at the
 * end of one sheet (smart-move.css, beta 9) made browsers drop the first
 * rule of the sheet after it: `.yard-card`'s width and height cap, so the
 * "Your outpost" window ran off the bottom of every screen under about
 * 850 px tall. The dev server loads each sheet on its own and hid it; the
 * build only warned (`Unexpected "}" [css-syntax-error]`).
 */

const src = resolve(dirname(fileURLToPath(import.meta.url)), "../..");

const sheets = (dir: string): string[] =>
  readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return sheets(path);
    return entry.name.endsWith(".css") ? [path] : [];
  });

/** The first brace fault in `css` ("line 12: a } with nothing open", "2 left open"), or null. */
const braceFault = (css: string): string | null => {
  let depth = 0;
  let line = 1;
  for (let i = 0; i < css.length; i++) {
    const c = css[i];
    if (c === "\n") line++;
    else if (c === "/" && css[i + 1] === "*") {
      // A comment: skip to its end, counting its lines.
      const end = css.indexOf("*/", i + 2);
      const stop = end < 0 ? css.length : end + 2;
      for (let j = i; j < stop; j++) if (css[j] === "\n") line++;
      i = stop - 1;
    } else if (c === '"' || c === "'") {
      // A string: braces inside it do not count.
      let j = i + 1;
      while (j < css.length && css[j] !== c && css[j] !== "\n") j += css[j] === "\\" ? 2 : 1;
      i = j;
    } else if (c === "{") depth++;
    else if (c === "}") {
      depth--;
      if (depth < 0) return `line ${line}: a } with nothing open`;
    }
  }
  return depth === 0 ? null : `${depth} left open at the end`;
};

describe("stylesheet braces", () => {
  it("finds a stray } and an unclosed {", () => {
    expect(braceFault(".a { color: red; }\n")).toBeNull();
    expect(braceFault("@media (x) {\n  .a { b: c; }}\n}\n")).toBe("line 3: a } with nothing open");
    expect(braceFault(".a { b: c;\n")).toBe("1 left open at the end");
    expect(braceFault('/* } */ .a { content: "}"; }')).toBeNull();
  });

  it("pair up in every stylesheet under web/src", () => {
    const files = sheets(src);
    expect(files.length).toBeGreaterThan(20);
    const faults = files
      .map((file) => [relative(src, file), braceFault(readFileSync(file, "utf8"))] as const)
      .filter(([, fault]) => fault !== null)
      .map(([file, fault]) => `${file}: ${fault}`);
    expect(faults).toEqual([]);
  });
});
