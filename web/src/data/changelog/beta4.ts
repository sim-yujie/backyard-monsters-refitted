import type { ChangelogRelease } from "./types";

/** v2.0.0-beta.4: pictures in web/public/whats-new/beta4-*.webp (960x540, 16:9). */
export const BETA_4: ChangelogRelease = {
  version: "2.0.0-beta.4",
  title: "Beta 4",
  cards: [
    {
      image: "/whats-new/beta4-halloween.webp",
      title: "Halloween is here!",
      text: "From 28 October your yard goes spooky for two whole weeks. Dark grass, a big moon and pumpkins where the mushrooms used to grow!",
    },
    {
      image: "/whats-new/beta4-pumpkin-hunt.webp",
      title: "Pumpkin hunt",
      text: "Tap a pumpkin to send a worker to pick it. Collect enough for prizes, all the way up to a D.A.V.E. Pumpkin!",
    },
    {
      image: "/whats-new/beta4-events.webp",
      title: "Events and daily treats",
      text: "The new Events button shows what's on now and what's coming next. Log in each day of Halloween for 14 days of treats, free speed-ups included!",
    },
    {
      image: "/whats-new/beta4-champion-eggs.webp",
      title: "Champions hatch from eggs",
      text: "Raising a champion now gives you a special egg. One day later, out pops your new champion!",
    },
    {
      image: "/whats-new/beta4-friends.webp",
      title: "Friends list upgrade",
      text: "Find friends fast with search and filters, and see at a glance who you can help or send a gift to.",
    },
    {
      image: "/whats-new/beta4-phone.webp",
      title: "Tidier on phones",
      text: "One Menu button holds everything, friends tuck away behind their own button, and the battle screen stays clear.",
    },
    {
      image: "/whats-new/beta4-special-moves.webp",
      title: "Special moves tuned",
      text: "Bandito's whirlwind spins through enemy monsters, Teratorn's fireball bounces to walls, and defending Bolts blink too. Fang's venom bites once a second again.",
    },
    {
      image: "/whats-new/beta4-animations.webp",
      title: "Monsters on the move",
      text: "Crabatron scuttles, Fang creeps, Eye-ra slithers, and lots more monsters now walk and attack with brand-new animations.",
    },
  ],
};
