import { SITE } from "../config";

/**
 * The home page's "Questions" section. The same list fills the visible
 * answers and the FAQPage data search engines read, so edit it only here.
 * Keep answers short and plain: the answer first, then one helpful detail.
 * Answers are plain text; an email address or game link in them is turned
 * into a link on the page.
 */
export const faq: { q: string; a: string }[] = [
  {
    q: "Is Backyard Monsters back?",
    a: "Yes, as a fan revamp. Backyard Monsters Revamped is a free, fan-made revamp of the original game that you can play today at play.bymrevamped.com. It is not an official return of the game.",
  },
  {
    q: "Can I still play Backyard Monsters?",
    a: "Yes. Go to play.bymrevamped.com and sign up with a username, email and password to play Backyard Monsters Revamped in your browser.",
  },
  {
    q: "Is it free?",
    a: "Yes. The game is free to play, with nothing to download or install.",
  },
  {
    q: "Do I need Flash or a download?",
    a: "No. The game runs in a modern web browser on your computer. There is no Flash and nothing to download.",
  },
  {
    q: "Is this the official game? Is it made by Kixeye?",
    a: "No. Backyard Monsters Revamped is an unofficial fan project. It is not made by Kixeye, who created the original Backyard Monsters, and is not affiliated with, endorsed by or sponsored by Kixeye.",
  },
  {
    q: "Is my old Backyard Monsters progress still there?",
    a: "No. Accounts and yards from the original game are not carried over, so everyone starts with a fresh yard. Bob's guided start gets you going in a few minutes.",
  },
  {
    q: "Will my progress be saved?",
    a: "The game is in open beta, so it is still being built. Things may break, and your progress may be reset before the full launch.",
  },
  {
    q: "How is it different from the original?",
    a: "The heart of the game is the same: build your yard, hatch monsters, defend and raid. It has been rebuilt from scratch to run in a modern browser, with repainted monsters, fewer clicks (hatch a whole army at once), fog of war in the Map Room and a guided start with Bob for new players.",
  },
  {
    q: "Who makes it?",
    a: "Backyard Monsters Revamped is built and run by one fan. The game server is based on Backyard Monsters Refitted, whose team restored the original game and wrote its server.",
  },
  {
    q: "Where do I report bugs?",
    a: `Email ${SITE.bugEmail} with what happened and, if you can, a screenshot.${
      SITE.discordUrl ? ` You can also tell us on the Discord at ${SITE.discordUrl.replace(/^https?:\/\//, "")}.` : ""
    }`,
  },
];
