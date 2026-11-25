import {
  DRULL_ID,
  FOMOR_ID,
  GORGO_ID,
  KORATH_ID,
  KRALLEN_ID,
  STANCE_SHORT,
  championByType,
  habitLearningOf,
  habitsOf,
  hasLearned,
  parseHabitStats,
  type ChampionStance,
  type HabitKey,
} from "@/game/combat/rules";

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
  /**
   * For a habit (owner's pick B, 19 Nov 2026): Active (it changes picks) or
   * Unproven (it does not, yet); an instinct has none, being always on.
   */
  readonly state?: HabitState;
  /** For a habit the last attack turned on or off, in the Mode it fought in. */
  readonly event?: "learned" | "faded";
}

/** A habit is Active or Unproven: nothing in between (no pips). */
export type HabitState = "active" | "unproven";

/** One Mode as the cage shows it. */
export interface ModeView {
  readonly stance: ChampionStance;
  /** Attacks it has fought in this Mode since habits began. */
  readonly attacks: number;
  readonly instincts: readonly TraitRow[];
  readonly habits: readonly TraitRow[];
  /** Whether it has an Active habit or any evidence in this Mode, so Forget has something to wipe. */
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
  big: {
    icon: "big",
    on: ["Backs the big ones", "Follows your biggest hurt monster."],
    off: ["Backs the small ones", "Follows your smallest hurt monster."],
  },
  crowd: {
    icon: "crowd",
    on: ["Fires up the crowd", "Follows the hurt monster with most monsters round it."],
    off: ["Sticks with one", "Follows a hurt monster on its own."],
  },
};

/**
 * A two-ended habit's name while Unproven: it leans neither way yet, so the
 * cage names what it is about, not a side (pips prototype, astra round 2).
 */
const NEUTRAL_NAMES: Partial<Record<HabitKey, readonly [string, string]>> = {
  tower: ["Tower preference", "May learn to go for towers, or steer clear."],
  loot: ["Loot preference", "May learn to love loot, or ignore it."],
  gun: ["Gun size", "May learn to take the biggest gun first, or the smallest."],
  big: ["Ally size", "May learn to back your biggest hurt monster, or the smallest."],
  crowd: ["Group size", "May learn to back the hurt monster in a crowd, or one alone."],
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
  name: monsterId === FOMOR_ID ? "Nearest hurt ally" : "Nearest target",
  what:
    monsterId === FOMOR_ID
      ? "Follows the nearest hurt monster, as in Flash."
      : "Takes the closest building, as in Flash.",
});

/**
 * One Mode of a champion's mind as the cage shows it: its instincts, and
 * each habit in its row, Active or Unproven (owner's pick B), with the last
 * attack's change when that attack was in this Mode.
 *
 * @param entry - The champion's save entry; its `t`, `h`, `hs` and `hl` are read, safely.
 * @param stance - The Mode.
 */
export const modeView = (
  entry: { readonly t: number; readonly h?: unknown; readonly hs?: unknown; readonly hl?: unknown },
  stance: ChampionStance,
): ModeView => {
  const id = championByType(entry.t);
  const learning = habitLearningOf(entry, id);
  const tracks = learning[STANCE_SHORT[stance]] ?? {};
  const stats = parseHabitStats(entry.hs);
  // Only the champion's latest learning attack has a "Last attack" line.
  const receipt =
    learning.r && learning.r.m === STANCE_SHORT[stance] && learning.r.n === stats.n ? learning.r.e : {};
  const habits = habitsOf(id, stance).map((key): TraitRow => {
    const way = tracks[key]?.d;
    const words = HABIT_WORDS[key];
    const neutral = NEUTRAL_NAMES[key];
    const [name, what] =
      way === undefined && neutral ? neutral : way === -1 && words.off ? words.off : words.on;
    const event = receipt[key];
    return {
      icon: words.icon,
      name,
      what,
      state: way === undefined ? "unproven" : "active",
      ...(event ? { event } : {}),
    };
  });
  return {
    stance,
    attacks: stats[STANCE_SHORT[stance]]?.n ?? 0,
    instincts: INSTINCTS[stance],
    habits,
    learned: hasLearned(learning, stance),
  };
};

/**
 * The attacks a champion has fought in its Modes, the three Mode counts
 * summed: `hs.n` also counts every attack since before Modes, and the old
 * brain's `bs` count, which taught its habits nothing (Reze: 1,174 shown,
 * 137 in its Modes).
 */
export const habitAttacks = (entry: { readonly hs?: unknown }): number => {
  const stats = parseHabitStats(entry.hs);
  return (stats.off?.n ?? 0) + (stats.hyb?.n ?? 0) + (stats.def?.n ?? 0);
};

/** The Mode names, short, as the tabs show them. */
export const STANCE_NAMES: Readonly<Record<ChampionStance, string>> = {
  offensive: "Offensive",
  defensive: "Defensive",
  hybrid: "Hybrid",
};
