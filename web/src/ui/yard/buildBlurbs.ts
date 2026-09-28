/**
 * One or two plain sentences on what each building in the build menu is for,
 * shown in its info panel (#157). Shortened from the original's
 * `<name>_desc` strings (`YARD_PROPS.as` `description`, words in
 * `server/public/gamestage/assets/english.json`).
 */
export const BUILD_BLURBS: Readonly<Record<number, string>> = {
  1: "Makes Twigs, which pay for new buildings and upgrades.",
  2: "Makes Pebbles, which pay for new buildings and upgrades.",
  3: "Makes Putty, which pays for new buildings and upgrades.",
  4: "Makes Goo, which the Hatchery turns into monsters.",
  5: "Flings your monsters into battle. You need one to attack; the Map Room finds the yards.",
  6: "Holds more Twigs, Pebbles, Putty and Goo.",
  8: "Research and unlock new kinds of monster to hatch.",
  9: "Turns monsters you no longer want back into Goo, freeing room in Housing.",
  10: "Gives you a bird's-eye view of the yard, so moving buildings or remodelling it is a snap.",
  11: "Look around the world, help friends and pick yards to attack.",
  12: "Spend Shiny on upgrades that save you time.",
  13: "Turns Goo into the monsters your Monster Locker has unlocked.",
  15: "Houses the monsters you hatch. Upgrade it or build more for room.",
  16: "Runs all your Hatcheries from one queue: each monster goes to the next Hatchery that is free.",
  17: "A block for building walls that shield buildings and steer attackers into traps and towers.",
  19: "Draws Wild Monsters to your yard to test your defences. Its siren scares them off again.",
  20: "Short range, high damage. Its shells burst on impact, good against tight groups.",
  21: "Long range and high damage, but slow to reload. Picks monsters off before they get close.",
  22: "Your monsters wait inside and come out to defend the yard.",
  23: "Fast and deadly: zaps any monster in range at the speed of light.",
  24: "Hidden until a monster steps on it, then hits hard over a small area.",
  25: "Fries any monster that comes within range. Upgrades add shocks, damage and range.",
  26: "Trains your monsters to higher levels.",
  51: "A siege weapon that hurls Twigs at enemy yards to damage buildings.",
  114: "Hatch and evolve a Champion to attack with and to defend your yard.",
  115: "A fast-firing gun against flying monsters.",
  116: "Research secret abilities for your monsters.",
  117: "Hidden until one of the strongest monsters steps on it, then hits everything nearby.",
  118: "High damage in a straight line through everything, but a short reach.",
  119: "Keeps spare Champions safely frozen while one is active.",
};
