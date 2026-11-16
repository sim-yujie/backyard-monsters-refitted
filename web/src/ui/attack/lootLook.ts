/**
 * TEMPORARY (7.7.1 design round): which way the battle bar shows the loot on
 * a phone, chosen by `?blp=A`, `?blp=B` or `?blp=C` in the page address, so
 * the owner can compare the options in the real game. Without it, the current
 * look. Removed once the owner picks one.
 */
export type LootLook = "A" | "B" | "C";

export const lootLook = (search: string = typeof location === "undefined" ? "" : location.search): LootLook | null => {
  const value = new URLSearchParams(search).get("blp")?.toUpperCase();
  return value === "A" || value === "B" || value === "C" ? value : null;
};
