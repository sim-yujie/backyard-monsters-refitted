import type { ChangelogRelease } from "./types";

/**
 * v2.0.0-beta.8: pictures in web/public/whats-new/beta8-*.webp (960x540,
 * 16:9), all real in-game shots in the Modern look (account yardtester in a
 * test copy of the database). The Inferno yard is the beta 8 Patreon post's
 * picture; Repeat attack and the Yard Planner are crops of the shots taken
 * when those were built; Siege and Trade were shot for these cards.
 */
export const BETA_8: ChangelogRelease = {
  version: "2.0.0-beta.8",
  title: "Beta 8",
  moreUrl: "https://www.patreon.com/TheMonsterLab/posts/beta-8-is-live-175786472",
  moreLabel: "Full details on Patreon",
  cards: [
    {
      image: "/whats-new/beta8-inferno.webp",
      title: "The Inferno in 3D",
      text: "In the Modern look, the Coal Extractor, Sulfur Swirler, Magma Pump, Strongbox, Incubator and Academy are now 3D. All 8 Inferno monsters are repainted.",
    },
    {
      image: "/whats-new/beta8-siege.webp",
      title: "Siege buildings in 3D",
      text: "The Siege Factory and Siege Works on your main yard are now 3D.",
    },
    {
      image: "/whats-new/beta8-trade.webp",
      title: "Alliance trading",
      text: "Swap resources with alliance mates; each side gets 90% of what the other sends. A swap is up to 10% of each player's storage for that resource, 1 swap a day.",
    },
    {
      image: "/whats-new/beta8-repeat.webp",
      title: "Repeat attack moves monsters",
      text: "If your yards in Flinger range lack monsters, Repeat attack moves them in from your other yards first. Its window now looks like the Attack window.",
    },
    {
      image: "/whats-new/beta8-planner.webp",
      title: "Yard Planner",
      text: "The full Yard Planner tools now need a Yard Planner built in that yard. Without one, you get 1 layout slot.",
    },
  ],
};
