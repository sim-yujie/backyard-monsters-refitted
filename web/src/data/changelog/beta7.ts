import type { ChangelogRelease } from "./types";

/**
 * v2.0.0-beta.7: pictures in web/public/whats-new/beta7-*.webp (960x540,
 * 16:9), cut from the real in-game shots taken for the beta 7 Patreon post.
 * The weekend card reuses a closer crop of the yard (no banner shot exists);
 * the "Back from the original" card shows the original attack window.
 */
export const BETA_7: ChangelogRelease = {
  version: "2.0.0-beta.7",
  title: "Beta 7",
  moreUrl: "https://www.patreon.com/posts/175126446",
  moreLabel: "Full details on Patreon",
  cards: [
    {
      image: "/whats-new/beta7-alliances.webp",
      title: "Alliances are back",
      text: "Build an Observatory to start or join one. Pick one of 3 kinds, then light constellation stars with points from 5 weekly goals.",
    },
    {
      image: "/whats-new/beta7-map.webp",
      title: "Shields on Map Room 2",
      text: "Your alliance's shield sits under every member's yard. Friends are green, alliance mates dark blue, hostile players red.",
    },
    {
      image: "/whats-new/beta7-thanksgiving.webp",
      title: "Thanksgiving, from 19 Nov",
      text: "A treat every day for 14 days and turkeys to catch, golden ones full of Shiny. Earn Glimmers for 6 new autumn decorations!",
    },
    {
      image: "/whats-new/beta7-weekend.webp",
      title: "A boost every weekend",
      text: "Every weekend brings a 30% boost and Glimmers to earn. The first Builder's Weekend starts Saturday 14 Nov: upgrades cost less.",
    },
    {
      image: "/whats-new/beta7-shiny.webp",
      title: "Buy resources with Shiny",
      text: "Tap Twigs, Pebbles, Putty or Goo in the top bar for +10%, +50% or Fill. Just short for an upgrade? Top up fills the gap.",
    },
    {
      image: "/whats-new/beta7-original.webp",
      title: "Back from the original",
      text: "Map Room 1's old rules, the attack window on Map Room 2, Slimeattikus's Split, and Rezghul raises the dead again.",
    },
    {
      image: "/whats-new/beta7-yard.webp",
      title: "Your yard",
      text: "Draw a whole line of walls in one go, pick your yard's ground in Settings, and take a picture of your whole yard.",
    },
  ],
};
