/**
 * Newer browser features the game uses, added for older browsers that lack
 * them (Chrome before 98, e.g. phone makers' own browsers such as Vivo's on
 * Chrome 87: "s.at is not a function" broke the chat box, 4 Nov 2026). The
 * build targets es2022 syntax but does not add missing functions, so each one
 * is added here, only where the browser has none. `main.ts` imports this
 * first, before any game module runs.
 */

/** `list.at(i)`: the entry at `i`, counting from the end when negative. */
function at<T>(this: ArrayLike<T>, index: number): T | undefined {
  const length = this.length;
  let i = Math.trunc(index) || 0;
  if (i < 0) i += length;
  return i < 0 || i >= length ? undefined : this[i];
}

const typedArrays = [
  Int8Array,
  Uint8Array,
  Uint8ClampedArray,
  Int16Array,
  Uint16Array,
  Int32Array,
  Uint32Array,
  Float32Array,
  Float64Array,
];

for (const type of [Array, String, ...typedArrays]) {
  if (typeof type.prototype.at !== "function") {
    Object.defineProperty(type.prototype, "at", {
      value: at,
      writable: true,
      configurable: true,
    });
  }
}

if (typeof Object.hasOwn !== "function") {
  Object.defineProperty(Object, "hasOwn", {
    value: (object: object, key: PropertyKey) =>
      Object.prototype.hasOwnProperty.call(object, key),
    writable: true,
    configurable: true,
  });
}

/**
 * A deep copy of the game's own data (saves, yard parts, test records): plain
 * objects, arrays, dates, maps and sets. Shared parts and loops are copied
 * once, as the browser's own `structuredClone` does.
 */
const deepCopy = (value: unknown, seen = new Map<unknown, unknown>()): unknown => {
  if (value === null || typeof value !== "object") return value;
  if (seen.has(value)) return seen.get(value);
  if (value instanceof Date) return new Date(value.getTime());
  if (value instanceof Map) {
    const copy = new Map();
    seen.set(value, copy);
    for (const [key, entry] of value) copy.set(deepCopy(key, seen), deepCopy(entry, seen));
    return copy;
  }
  if (value instanceof Set) {
    const copy = new Set();
    seen.set(value, copy);
    for (const entry of value) copy.add(deepCopy(entry, seen));
    return copy;
  }
  const copy = (Array.isArray(value) ? [] : {}) as Record<string, unknown>;
  seen.set(value, copy);
  for (const key of Object.keys(value))
    copy[key] = deepCopy((value as Record<string, unknown>)[key], seen);
  return copy;
};

if (typeof globalThis.structuredClone !== "function") {
  Object.defineProperty(globalThis, "structuredClone", {
    value: <T>(value: T): T => deepCopy(value) as T,
    writable: true,
    configurable: true,
  });
}

export { at as polyfillAt, deepCopy as polyfillDeepCopy };
