/**
 * A strict reader for the object and array literals in the Flash client's
 * ActionScript, for table generators that need more than `props.mjs`'s
 * integer arrays.
 *
 * The same reader `gen-monster-catalogue.mjs` carries inline (tokenizer,
 * folding of `3600 * 23`-style arithmetic, identifiers kept as {@link Ident}),
 * extended to array literals and dotted assignment targets for
 * `gen-champion-catalogue.mjs`. Anything it does not recognise stops the run
 * with the file and line, so a changed source can never quietly emit a zero
 * or a short table.
 *
 * Nothing here runs in the browser and nothing in `src/` imports it.
 */

import { readFileSync } from "node:fs";

/** Thrown for anything the source says that the reader does not expect. */
export class ShapeError extends Error {}

/** Throws a {@link ShapeError} naming `file:line`. */
export const fail = (file, line, message) => {
  throw new ShapeError(`${file.split(/[\\/]/).pop()}:${line}: ${message}`);
};

/** A reference to a class or constant, e.g. `"classType": CLASS_TYPE_BASIC`. */
export class Ident {
  constructor(name) {
    this.name = name;
  }
}

/**
 * Tokens of `text`, each with the 1-based line it starts on: punctuation,
 * double-quoted strings without escapes, decimal numbers, identifiers, and
 * `//` and `/* *\/` comments (skipped).
 */
const tokenize = (text, file, firstLine) => {
  const tokens = [];
  let line = firstLine;
  let i = 0;
  while (i < text.length) {
    const c = text[i];
    if (c === "\n") {
      line++;
      i++;
    } else if (c === " " || c === "\t" || c === "\r") {
      i++;
    } else if (c === "/" && text[i + 1] === "/") {
      while (i < text.length && text[i] !== "\n") i++;
    } else if (c === "/" && text[i + 1] === "*") {
      const end = text.indexOf("*/", i + 2);
      if (end < 0) fail(file, line, "unterminated block comment");
      for (let k = i; k < end; k++) if (text[k] === "\n") line++;
      i = end + 2;
    } else if ("{}[]:,*/+-()".includes(c)) {
      tokens.push({ kind: c, line });
      i++;
    } else if (c === '"') {
      const end = text.indexOf('"', i + 1);
      if (end < 0 || text.slice(i + 1, end).includes("\n")) fail(file, line, "unterminated string");
      if (text.slice(i + 1, end).includes("\\")) fail(file, line, "escaped string not supported");
      tokens.push({ kind: "string", value: text.slice(i + 1, end), line });
      i = end + 1;
    } else if (/[0-9.]/.test(c)) {
      const hit = /^(?:\d+\.?\d*|\.\d+)/.exec(text.slice(i));
      tokens.push({ kind: "number", value: Number(hit[0]), line });
      i += hit[0].length;
    } else if (/[A-Za-z_$]/.test(c)) {
      const hit = /^[A-Za-z_$][A-Za-z0-9_$]*/.exec(text.slice(i));
      tokens.push({ kind: "ident", value: hit[0], line });
      i += hit[0].length;
    } else {
      fail(file, line, `unexpected character ${JSON.stringify(c)}`);
    }
  }
  return tokens;
};

/**
 * Parses one object or array literal and returns `{ value, lines }`, where
 * `lines[key]` is the line each top-level key of an object sits on.
 * Arithmetic is folded; `true`/`false` become booleans, `null` null, and any
 * other identifier an {@link Ident}. A repeated key keeps its last value, as
 * AS3 does.
 */
const parseLiteral = (tokens, file) => {
  let at = 0;
  const lines = {};
  const peek = () => tokens[at];
  const next = () => {
    const token = tokens[at++];
    if (!token) fail(file, tokens[tokens.length - 1]?.line ?? 0, "unexpected end of literal");
    return token;
  };
  const expect = (kind) => {
    const token = next();
    if (token.kind !== kind) fail(file, token.line, `expected ${kind}, found ${token.kind}`);
    return token;
  };

  const object = (depth) => {
    expect("{");
    const out = {};
    while (peek()?.kind !== "}") {
      const key = next();
      if (key.kind !== "string" && key.kind !== "ident") fail(file, key.line, "expected a key");
      expect(":");
      out[key.value] = value(depth + 1);
      if (depth === 0) lines[key.value] = key.line;
      if (peek()?.kind === ",") next();
      else if (peek()?.kind !== "}") fail(file, peek()?.line ?? key.line, "expected , or }");
    }
    next();
    return out;
  };

  const array = (depth) => {
    expect("[");
    const out = [];
    while (peek()?.kind !== "]") {
      out.push(value(depth + 1));
      if (peek()?.kind === ",") next();
      else if (peek()?.kind !== "]") fail(file, peek()?.line ?? 0, "expected , or ]");
    }
    next();
    return out;
  };

  const number = (operand, token) => {
    if (typeof operand !== "number") fail(file, token.line, "arithmetic on a non-number");
    return operand;
  };

  const factor = () => {
    const token = next();
    if (token.kind === "number") return token.value;
    if (token.kind === "-") return -number(factor(), token);
    if (token.kind === "(") {
      const inner = sum();
      expect(")");
      return inner;
    }
    if (token.kind === "ident") {
      if (token.value === "true") return true;
      if (token.value === "false") return false;
      if (token.value === "null") return null;
      return new Ident(token.value);
    }
    return fail(file, token.line, `unexpected ${token.kind}`);
  };

  const product = () => {
    let left = factor();
    while (peek()?.kind === "*" || peek()?.kind === "/") {
      const op = next();
      const right = number(factor(), op);
      left = op.kind === "*" ? number(left, op) * right : number(left, op) / right;
    }
    return left;
  };

  const sum = () => {
    let left = product();
    while (peek()?.kind === "+" || peek()?.kind === "-") {
      const op = next();
      const right = number(product(), op);
      left = op.kind === "+" ? number(left, op) + right : number(left, op) - right;
    }
    return left;
  };

  const value = (depth) => {
    const kind = peek()?.kind;
    if (kind === "{") return object(depth);
    if (kind === "[") return array(depth);
    if (kind === "string") return next().value;
    return sum();
  };

  const result = value(0);
  if (at !== tokens.length) fail(file, tokens[at].line, "trailing tokens after the literal");
  return { value: result, lines };
};

/**
 * Every literal assigned to `target` in `path` (`target = { ... }` or
 * `target = [ ... ]`, a `:Type` annotation allowed), in file order, each as
 * `{ value, lines, declaredAt }`. `target` is matched literally, dots
 * included, and must not be the tail of a longer name. The bracket walk skips string literals and comments, so a
 * closer inside either cannot end the literal early.
 */
export const readAssignments = (path, target) => {
  const text = readFileSync(path, "utf8");
  const escaped = target.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const hits = [
    ...text.matchAll(new RegExp(`(?<![\\w.])${escaped}(?:\\s*:\\s*\\w+)?\\s*=\\s*[{[]`, "g")),
  ];
  return hits.map((hit) => {
    const open = hit.index + hit[0].length - 1;
    const opener = text[open];
    const closer = opener === "{" ? "}" : "]";
    const declaredAt = text.slice(0, hit.index).split("\n").length;
    let depth = 0;
    let close = -1;
    for (let i = open; i < text.length && close < 0; i++) {
      const c = text[i];
      let skipTo = i;
      if (c === '"') skipTo = text.indexOf('"', i + 1);
      else if (c === "/" && text[i + 1] === "/") skipTo = text.indexOf("\n", i);
      else if (c === "/" && text[i + 1] === "*") skipTo = text.indexOf("*/", i + 2);
      else if (c === opener) depth++;
      else if (c === closer && --depth === 0) close = i;
      if (skipTo < 0) break;
      i = skipTo;
    }
    if (close < 0) fail(path, declaredAt, `unbalanced brackets in \`${target}\``);
    const firstLine = text.slice(0, open).split("\n").length;
    const tokens = tokenize(text.slice(open, close + 1), path, firstLine);
    return { ...parseLiteral(tokens, path), declaredAt };
  });
};

/** The one literal assigned to `target` in `path`; more or fewer is an error. */
export const readAssignment = (path, target) => {
  const found = readAssignments(path, target);
  if (found.length !== 1) {
    fail(path, 0, `expected one \`${target} = …\` assignment, found ${found.length}`);
  }
  return found[0];
};
