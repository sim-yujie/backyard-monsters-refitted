/**
 * The Patreon tiers, shown on the home page and the Support page. Keep this
 * in step with the tiers on Patreon itself. Nothing here may ever be an
 * in-game advantage: the game stays free and fair for everyone.
 */
export const tiers = [
  {
    name: "Lab Assistant",
    price: "$5",
    blurb: "Lend a hand in the lab and help pay the server bills.",
    perks: ["One vote in the monthly feature poll", "Your name on the Support page"],
  },
  {
    name: "Lab Partner",
    price: "$10",
    blurb: "Back the game a bit more and get a first look at what's coming.",
    perks: [
      "Two votes in the monthly feature poll",
      'Your name listed first, under "Lab Partners"',
      "Members-only early-look posts about planned features",
    ],
  },
] as const;
