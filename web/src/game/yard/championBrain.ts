import {
  BRAIN_KEYS,
  DRULL_ID,
  FOMOR_ID,
  GORGO_ID,
  KORATH_ID,
  KRALLEN_ID,
  STANCE_SHORT,
  championByType,
  habitPips,
  habitsOf,
  parseBrain,
  parseBrainStats,
  parseHabitBook,
  parseHabitStats,
  type BrainKey,
  type ChampionStance,
  type HabitKey,
} from "@/game/combat/rules";

/**
 * A champion's learned brain in plain words (issue #219), for the Champion
 * Cage: what it has come to prefer, strongest first, from the weights its own
 * attacks taught it (`combat/rules/brain.ts`).
 */

/** A weight this far from 0, either way, is a tendency worth naming. */
export const TENDENCY_THRESHOLD = 50;

/** How many tendencies the cage names at most. */
export const TENDENCY_LIMIT = 3;

/** Each feature's words: for a weight above the threshold, and below its negative. */
const WORDS: Readonly<Record<BrainKey, readonly [string, string]>> = {
  tower: ["Goes for towers", "Steers clear of towers"],
  loot: ["Loves loot", "Ignores loot"],
  finish: ["Finishes off the wounded", "Picks fresh targets"],
  focus: ["Sticks with the pack", "Goes its own way"],
  // Threat is a penalty: a higher weight keeps it further from tower fire.
  threat: ["Cautious near towers", "Shrugs off tower fire"],
};

export interface BrainSummary {
  /** The tendencies, strongest first; empty while it is still learning. */
  readonly tendencies: readonly string[];
  /** Attacks it has learned from. */
  readonly attacks: number;
}

/**
 * The tendencies a champion's brain shows, strongest first, ties in the
 * features' own order.
 *
 * @param entry - The champion's save entry; its `b` and `bs` are read, safely.
 */
export const brainSummary = (entry: { readonly b?: unknown; readonly bs?: unknown }): BrainSummary => {
  const brain = parseBrain(entry.b);
  const ranked = BRAIN_KEYS.map((key, order) => ({ key, order, weight: brain[key] }))
    .filter(({ weight }) => Math.abs(weight) >= TENDENCY_THRESHOLD)
    .sort((one, other) => Math.abs(other.weight) - Math.abs(one.weight) || one.order - other.order)
    .slice(0, TENDENCY_LIMIT);
  return {
    tendencies: ranked.map(({ key, weight }) => WORDS[key][weight > 0 ? 0 : 1]),
    attacks: parseBrainStats(entry.bs).n,
  };
};

/** The cage's one line: its tendencies, or that it is still learning. */
export const tendenciesText = (summary: BrainSummary): string =>
  summary.tendencies.length > 0 ? summary.tendencies.join(" · ") : "Still learning";

/** How much it has learned from, in words. */
export const learnedFromText = (summary: BrainSummary): string =>
  summary.attacks === 0
    ? "It learns from every attack it fights in."
    : `Learned from ${summary.attacks} attack${summary.attacks === 1 ? "" : "s"}.`;

/* ── Instincts and habits (champion modes round 2) ───────────────────────── */

/**
 * The shapes a trait row is drawn with. PLACEHOLDER icons: plain line shapes
 * until the painted ones (Codex) come; the panel marks them as placeholders.
 */
export type TraitIcon =
  | "tower"
  | "finish"
  | "dodge"
  | "pack"
  | "skip"
  | "guard"
  | "air"
  | "gun"
  | "hall"
  | "close"
  | "hurt"
  | "loot"
  | "quake"
  | "crowd"
  | "big"
  | "none";

export interface TraitRow {
  readonly icon: TraitIcon;
  /** Its short name; a two-ended habit's names the side it leans to. */
  readonly name: string;
  /** One line of what it does, for the tooltip. */
  readonly what: string;
  /** For a habit, 0 to 3; an instinct has none, being always on. */
  readonly pips?: number;
}

/** One Mode as the cage shows it. */
export interface ModeView {
  readonly stance: ChampionStance;
  /** Attacks it has fought in this Mode since habits began. */
  readonly attacks: number;
  readonly instincts: readonly TraitRow[];
  readonly habits: readonly TraitRow[];
  /** Whether it has any habit in this Mode, so Forget has something to wipe. */
  readonly learned: boolean;
}

const INSTINCTS: Readonly<Record<ChampionStance, readonly TraitRow[]>> = {
  offensive: [
    { icon: "tower", name: "Goes for towers", what: "Walks further to hit a tower." },
    { icon: "finish", name: "Finishes hurt buildings", what: "Prefers a building already damaged." },
  ],
  defensive: [
    { icon: "dodge", name: "Avoids tower fire", what: "Prefers buildings fewer towers cover." },
    { icon: "pack", name: "Fights beside its monsters", what: "Goes where your monsters already are." },
    { icon: "skip", name: "Skips towers it can't beat", what: "Leaves a tower that would kill it first." },
  ],
  hybrid: [],
};

/** Each habit's icon and words: for leaning to it, and (two-ended) away from it. */
const HABIT_WORDS: Readonly<
  Record<HabitKey, { icon: TraitIcon; on: [string, string]; off?: [string, string] }>
> = {
  tower: {
    icon: "tower",
    on: ["Goes for towers", "Towers first."],
    off: ["Steers clear of towers", "Towers last."],
  },
  loot: {
    icon: "loot",
    on: ["Loves loot", "Loot buildings first."],
    off: ["Ignores loot", "Loot buildings last."],
  },
  guard: { icon: "guard", on: ["Guards its monsters", "Hits the tower shooting your monsters."] },
  aerial: {
    icon: "air",
    on: ["Aerial Defense first", "Smashes Aerial Defense Towers so your fliers live."],
  },
  gun: {
    icon: "gun",
    on: ["Biggest gun first", "The hardest-hitting tower first (3+ towers)."],
    off: ["Smallest gun first", "The weakest tower first (3+ towers)."],
  },
  hall: { icon: "hall", on: ["Town Hall first", "Heads for the Town Hall or outpost core."] },
  near: { icon: "close", on: ["Stays close", "Takes near buildings, does not cross the yard."] },
  careful: {
    icon: "hurt",
    on: ["Careful when hurt", "Under half health: buildings no tower covers."],
  },
  quake: { icon: "quake", on: ["Quakes the crowd", "Picks packed buildings for its quake."] },
};

/** What a champion is, in one short fixed line. */
export const championNature = (monsterId: string, level: number): string => {
  switch (monsterId) {
    case GORGO_ID:
      return "Walks · melee · tank · can't hit fliers";
    case DRULL_ID:
      return "Walks · melee · fast · can't hit fliers";
    case KORATH_ID:
      return "Walks · melee · quake · fireball";
    case FOMOR_ID:
      return `${level >= 3 ? "Flies" : "Walks"} · ranged · backs hurt monsters`;
    case KRALLEN_ID:
      return "Loot first, towers after";
    default:
      return "";
  }
};

/** The Hybrid line with no instincts: it picks as the Flash champion. */
export const naturalRow = (monsterId: string): TraitRow => ({
  icon: "none",
  name: "None: a natural",
  what:
    monsterId === FOMOR_ID
      ? "Follows the nearest hurt monster, as in Flash."
      : "Takes the closest building, as in Flash.",
});

/**
 * One Mode of a champion's mind as the cage shows it: its instincts, and
 * each habit in its row with the pips it has earned.
 *
 * @param entry - The champion's save entry; its `t`, `h`, `hs` and `bs` are read, safely.
 * @param stance - The Mode.
 */
export const modeView = (
  entry: { readonly t: number; readonly h?: unknown; readonly hs?: unknown },
  stance: ChampionStance,
): ModeView => {
  const id = championByType(entry.t);
  const book = parseHabitBook(entry.h, id);
  const weights = book[STANCE_SHORT[stance]] ?? {};
  const stats = parseHabitStats(entry.hs);
  const habits = habitsOf(id, stance).map((key): TraitRow => {
    const weight = weights[key] ?? 0;
    const words = HABIT_WORDS[key];
    const [name, what] = weight < 0 && words.off ? words.off : words.on;
    return { icon: words.icon, name, what, pips: habitPips(weight, stance) };
  });
  return {
    stance,
    attacks: stats[STANCE_SHORT[stance]]?.n ?? 0,
    instincts: INSTINCTS[stance],
    habits,
    learned: Object.keys(weights).length > 0,
  };
};

/** Every attack a champion with habits has learned from, its old brain's count included. */
export const habitAttacks = (entry: { readonly hs?: unknown; readonly bs?: unknown }): number =>
  parseHabitStats(entry.hs, entry.bs).n;

/** The Mode names, short, as the tabs show them. */
export const STANCE_NAMES: Readonly<Record<ChampionStance, string>> = {
  offensive: "Offensive",
  defensive: "Defensive",
  hybrid: "Hybrid",
};
