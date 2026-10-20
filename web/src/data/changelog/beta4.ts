import type { ChangelogRelease } from "./types";

/**
 * v2.0.0-beta.4. PLACEHOLDER words and pictures: the owner rewrites the text
 * and the pictures (web/public/whats-new/beta4-*.png) are stand-ins until the
 * real art is made.
 */
export const BETA_4: ChangelogRelease = {
  version: "2.0.0-beta.4",
  title: "Beta 4",
  cards: [
    {
      image: "/whats-new/beta4-halloween.png",
      title: "Halloween is here",
      text: "A spooky two-week event with treats to claim. Look for the pumpkin button on your yard.",
    },
    {
      image: "/whats-new/beta4-events.png",
      title: "New Events page",
      text: "See what is on now, how long it lasts and what is coming up next, all in one place.",
    },
    {
      image: "/whats-new/beta4-whats-new.png",
      title: "What's new",
      text: "This screen! It shows up once after each update. Open it again any time from your account menu.",
    },
    {
      image: "/whats-new/beta4-friends.png",
      title: "Friends list upgrade",
      text: "Your friends list is easier to use, with more ways to keep in touch.",
    },
    {
      image: "/whats-new/beta4-phone.png",
      title: "Better on phones",
      text: "Buttons and panels no longer get in each other's way on small screens.",
    },
    {
      image: "/whats-new/beta4-special-moves.png",
      title: "Special moves tuned",
      text: "Some monsters' special moves have been tweaked to feel fairer and more fun.",
    },
    {
      image: "/whats-new/beta4-animations.png",
      title: "New monster animations",
      text: "More monsters now walk, attack and celebrate with fresh animations.",
    },
  ],
};
