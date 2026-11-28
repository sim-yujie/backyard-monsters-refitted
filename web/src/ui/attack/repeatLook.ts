/**
 * Prototype switch for Repeat attack's working window (owner, 28 Nov 2026:
 * "why is there a 'panel' within a panel?"). `?repeatLook=a|b|c` shows one of
 * the three directions on the Review Desk; anything else (or nothing) keeps
 * today's window. `?repeatFreeze=0.55` holds the march at that point, for the
 * desk's pictures only.
 */

export type RepeatLook = "today" | "a" | "b" | "c";

/** The look `?repeatLook=` asks for in `search`, else today's. */
export const repeatLookFrom = (search: string): RepeatLook => {
  const asked = new URLSearchParams(search).get("repeatLook")?.trim().toLowerCase();
  return asked === "a" || asked === "b" || asked === "c" ? asked : "today";
};

/** The point `?repeatFreeze=` holds the march at (0 to 0.97), or null. */
export const repeatFreezeFrom = (search: string): number | null => {
  const raw = new URLSearchParams(search).get("repeatFreeze");
  if (raw === null) return null;
  const value = Number(raw);
  return Number.isFinite(value) ? Math.min(0.97, Math.max(0, value)) : null;
};

const search = (): string => (typeof location === "undefined" ? "" : location.search);

/** This page's look. */
export const repeatLook = (): RepeatLook => repeatLookFrom(search());

/** This page's frozen point, if any; the desk's picture script may move it (`__repeatFreeze`, dev builds). */
export const repeatFreeze = (): number | null => {
  const moved = import.meta.env.DEV ? (globalThis as Record<string, unknown>)["__repeatFreeze"] : undefined;
  return typeof moved === "number" ? moved : repeatFreezeFrom(search());
};
