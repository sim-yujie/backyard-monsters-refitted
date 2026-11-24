import type { ChangelogRelease } from "./types";

/**
 * v2.0.0-beta.9: pictures in web/public/whats-new/beta9-*.webp (960x540,
 * 16:9), all real in-game shots of the account yardtester in the Modern look,
 * except the tower tiers card, which shows the Classic look the plates are
 * for. Shot for these cards in a test copy of the database (its outposts
 * given armies, two pinned and renamed, its HCC raised to level 3, its
 * Inferno given a level 3 Infernal Lab and an outpost the new decorations,
 * only in that copy): moves, HCC, Lab, arrows, tiers, feeding, decorations
 * and the sign-in screen. The Baiter card is a crop of the shot taken when
 * the friend tests were built (review desk b9-baitb-invite, 23 Nov, after
 * the last change to that window), whose test copy had friends to invite.
 * No Patreon post yet: add `moreUrl` and `moreLabel` (both or neither) once
 * the beta 9 post is up.
 */
export const BETA_9: ChangelogRelease = {
  version: "2.0.0-beta.9",
  title: "Beta 9",
  cards: [
    {
      image: "/whats-new/beta9-move.webp",
      title: "Move monsters on the map",
      text: "Tap one of your yards on Map Room 2, then Bring monsters here or Move monsters from here. Plates show each yard's army and room. Free and instant.",
    },
    {
      image: "/whats-new/beta9-hcc.webp",
      title: "Hatchery Control Center 2 and 3",
      text: "Up to 10 stacks of 30 and 6 presets you send with one tap. At level 3, run your outposts' hatcheries from home.",
    },
    {
      image: "/whats-new/beta9-lab.webp",
      title: "Infernal Lab",
      text: "Build it from Under Hall 5 and research an ability for each Inferno monster with Sulfur. Balthazar's 3x and King Wormzer's splash now come from the Lab.",
    },
    {
      image: "/whats-new/beta9-baiter.webp",
      title: "Test your yard with friends",
      text: "Your Baiter invites friends and alliance mates to attack your main yard with a free army for 24 h. Nothing is lost. Watch every test in Results.",
    },
    {
      image: "/whats-new/beta9-arrows.webp",
      title: "Step through your yards",
      text: "The arrows go from your main yard to your pinned outposts, then the rest. Tap the middle for the list.",
    },
    {
      image: "/whats-new/beta9-tiers.webp",
      title: "Tower tiers in Classic",
      text: "Classic towers now wear a I, II or III plate: the tiers Modern shows as plain, gold and black.",
    },
    {
      image: "/whats-new/beta9-feed.webp",
      title: "Feeding your champion",
      text: "Fed monsters walk to the cage and burst, as in Flash. The feed window stays open.",
    },
    {
      image: "/whats-new/beta9-decor.webp",
      title: "26 new decorations",
      text: "9 wonders, 6 yard props, 10 plants and a flag, for Glimmers in the Decorations tab.",
    },
    {
      image: "/whats-new/beta9-speed.webp",
      title: "Faster loading",
      text: "In our slow-phone test the sign-in screen showed in 2.5 s instead of 7. Your yard's buildings now load first.",
    },
  ],
};
