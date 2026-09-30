/**
 * For tests: whether an in-memory row passes a MikroORM filter. Covers what
 * the routes under test write: plain equality, `$and`, `$or`, `$in`, and the
 * comparisons `$gt`, `$gte`, `$lt`, `$lte` on numbers and dates. Anything
 * else fails loudly rather than matching by accident.
 */

type Row = Record<string, unknown>;

const comparable = (value: unknown) => (value instanceof Date ? value.getTime() : value);

const passes = (value: unknown, condition: unknown): boolean => {
  if (condition === null || typeof condition !== "object" || condition instanceof Date) {
    return comparable(value) === comparable(condition);
  }
  return Object.entries(condition).every(([operator, operand]) => {
    const [left, right] = [comparable(value), comparable(operand)] as [number, number];
    switch (operator) {
      case "$in":
        return (operand as unknown[]).includes(value);
      case "$gt":
        return value !== undefined && value !== null && left > right;
      case "$gte":
        return value !== undefined && value !== null && left >= right;
      case "$lt":
        return value !== undefined && value !== null && left < right;
      case "$lte":
        return value !== undefined && value !== null && left <= right;
      default:
        throw new Error(`matchesWhere: no support for ${operator}`);
    }
  });
};

export const matchesWhere = (row: Row, where: Row): boolean =>
  Object.entries(where).every(([key, value]) => {
    if (key === "$and") return (value as Row[]).every((part) => matchesWhere(row, part));
    if (key === "$or") return (value as Row[]).some((part) => matchesWhere(row, part));
    return passes(row[key], value);
  });
