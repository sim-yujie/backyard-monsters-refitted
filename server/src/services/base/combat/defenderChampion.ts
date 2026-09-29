import type { ChampionData } from "../../../schemas/ChampionSchema.js";

/**
 * The defender's champions once the battle lands (issue #195): the one that
 * came out of its Champion Cage keeps the health the server's replay left it,
 * never more than it had, 0 if it died, and heals from there as any hurt
 * champion does. Every other champion, and every other field, stays as stored.
 *
 * @param champions - The defender's stored `champion` list.
 * @param fought - The caged champion by type and its health after the battle,
 *   or null when none defended.
 */
export const championsAfterDefence = <T extends Pick<ChampionData, "t" | "hp">>(
  champions: readonly T[] | null | undefined,
  fought: { readonly t: number; readonly hp: number } | null
): T[] | null | undefined => {
  if (!fought || !Array.isArray(champions)) return champions as T[] | null | undefined;
  let done = false;
  return champions.map((champion) => {
    if (done || Number(champion.t) !== fought.t) return champion;
    done = true;
    const stored = Number(champion.hp);
    const hp = Math.max(0, Math.floor(fought.hp));
    return { ...champion, hp: Number.isFinite(stored) ? Math.min(stored, hp) : hp };
  });
};
