/**
 * Where two JSON values differ in shape (issue #245, the bot leak audit):
 * which fields exist and what kind of value each holds, never the values
 * themselves. Two responses that differ only in their numbers and names
 * give no differences; one with a field the other lacks, or a field that is
 * a list on one side and `null` on the other, does.
 *
 * Two kinds of object are told apart, so that a player's own choices are not
 * read as differences in shape:
 *
 * - **Records keyed by data** (every key free of lower-case letters: building
 *   ids `"12"`, monster ids `"C1"`, store items `"ENL"`): which keys there are
 *   is the player's business. Entries under the same key are compared, and a
 *   record that is empty on one side matches any.
 * - **Everything else** is a fixed shape: the same keys on both sides.
 *
 * A list that is empty on one side matches any list; otherwise the first
 * entries are compared. Keys in `optional` (by name, at any depth) may be on
 * one side only: state a field has only while something runs, as a
 * building's countdowns.
 */

type Json = unknown;

const kindOf = (value: Json): string => {
  if (value === null) return "null";
  if (Array.isArray(value)) return "array";
  return typeof value;
};

const isDataKeyed = (keys: string[]): boolean => keys.length > 0 && keys.every((key) => !/[a-z]/.test(key));

/**
 * Every difference in shape between `a` and `b`, as `path: what` lines; empty
 * when they have the same shape.
 *
 * @param a - One value
 * @param b - The other
 * @param optional - Keys that may be on one side only
 * @param path - Where the values are, for the lines
 */
export const shapeDiff = (a: Json, b: Json, optional: ReadonlySet<string> = new Set(), path = "$"): string[] => {
  const kind = kindOf(a);
  if (kind !== kindOf(b)) return [`${path}: ${kind} vs ${kindOf(b)}`];

  if (kind === "array") {
    const [left, right] = [a as Json[], b as Json[]];
    return left.length && right.length ? shapeDiff(left[0], right[0], optional, `${path}[0]`) : [];
  }
  if (kind !== "object") return [];

  const [left, right] = [a as Record<string, Json>, b as Record<string, Json>];
  const leftKeys = Object.keys(left);
  const rightKeys = Object.keys(right);
  const dataKeyed =
    (isDataKeyed(leftKeys) || leftKeys.length === 0) &&
    (isDataKeyed(rightKeys) || rightKeys.length === 0) &&
    leftKeys.length + rightKeys.length > 0;

  const out: string[] = [];
  if (!dataKeyed) {
    for (const key of leftKeys) if (!(key in right) && !optional.has(key)) out.push(`${path}.${key}: only on the left`);
    for (const key of rightKeys) if (!(key in left) && !optional.has(key)) out.push(`${path}.${key}: only on the right`);
  }
  for (const key of leftKeys) {
    if (key in right) out.push(...shapeDiff(left[key], right[key], optional, `${path}.${key}`));
  }
  return out;
};
