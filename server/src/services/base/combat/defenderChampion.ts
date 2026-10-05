import type { ChampionData } from "../../../schemas/ChampionSchema.js";

/**
 * The defender's champions once the battle lands (issues #195, #310): each
 * that came out of its Champion Cage keeps the health the server's replay left
 * it, never more than it had, 0 if it died, and heals from there as any hurt
 * champion does. A caged champion is the first stored one of its type. Every
 * other champion, and every other field, stays as stored.
 *
 * @param champions - The defender's stored `champion` list.
 * @param fought - Each caged champion by type and its health after the
 *   battle; empty when none defended.
 */
export const championsAfterDefence = <T extends Pick<ChampionData, "t" | "hp">>(
  champions: readonly T[] | null | undefined,
  fought: readonly { readonly t: number; readonly hp: number }[]
): T[] | null | undefined => {
  if (fought.length === 0 || !Array.isArray(champions)) return champions as T[] | null | undefined;
  const left = [...fought];
  return champions.map((champion) => {
    const at = left.findIndex((caged) => caged.t === Number(champion.t));
    if (at < 0) return champion;
    const hp = Math.max(0, Math.floor((left.splice(at, 1)[0] as { readonly hp: number }).hp));
    const stored = Number(champion.hp);
    return { ...champion, hp: Number.isFinite(stored) ? Math.min(stored, hp) : hp };
  });
};
