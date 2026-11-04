import type { ChangelogRelease } from "./types";

/**
 * v2.0.0-beta.6: pictures in web/public/whats-new/beta6-*.webp (960x540, 16:9).
 *
 * NOT IN `index.ts` YET: the pictures are not taken (pictures.test.ts checks
 * every card's picture exists). Add BETA_6 at the top of CHANGELOG once they
 * are in web/public/whats-new/. Drop the Map Room 2 card if the new map look
 * is not switched on at release.
 */
export const BETA_6: ChangelogRelease = {
  version: "2.0.0-beta.6",
  title: "Beta 6",
  cards: [
    {
      image: "/whats-new/beta6-map.webp",
      title: "A new Map Room 2",
      text: "One painted landscape with hills, forests, beaches and rivers, seen at a tilt. Forests, rocks and marsh change a cell's defence and income!",
    },
    {
      image: "/whats-new/beta6-buildings-3d.webp",
      title: "Your yard in 3D",
      text: "With the Modern look, most buildings are now 3D, with moving parts and their own damaged looks. Classic keeps the Flash art.",
    },
    {
      image: "/whats-new/beta6-quests.webp",
      title: "Quests",
      text: "A 7-day login card, 5 daily quests and 3 weekly quests, all paying Shiny. Find them under the round More button.",
    },
    {
      image: "/whats-new/beta6-lab.webp",
      title: "New Monster Lab abilities",
      text: "Swarming Pokeys attack faster, Octo-ooze weakens its killer, Ichi hits back with Thorns and Crabatron lands critical hits!",
    },
    {
      image: "/whats-new/beta6-decorations.webp",
      title: "Decorations are back",
      text: "The original decorations are on sale again for Shiny, in the Build menu's Decorations tab.",
    },
    {
      image: "/whats-new/beta6-sounds.webp",
      title: "The old sounds are back",
      text: "Tower shots, deaths and bombs sound like the original, and loot pops out of every building you hit. Music and effects have their own volume.",
    },
    {
      image: "/whats-new/beta6-tribes.webp",
      title: "Wild tribes rebuilt",
      text: "Every tribe camp has a new yard at each level. Legionnaire is the weakest, Dreadnaut the strongest, Kozu the richest.",
    },
    {
      image: "/whats-new/beta6-range.webp",
      title: "See your tower's range",
      text: "Hover over one of your defences to see how far it reaches.",
    },
    {
      image: "/whats-new/beta6-font.webp",
      title: "Pick your font",
      text: "Hard to read? Account settings now offers Game font, Clear or Extra readable.",
    },
  ],
};
