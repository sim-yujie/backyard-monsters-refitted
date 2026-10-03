import type { CompletedJob } from "@/api/types";
import { labAbility, monsterEntry } from "@/game/monsters/monsterCatalogue";
import { championEntry } from "@/game/yard/championCatalogue";
import { typeName } from "@/game/yard/planner/summary";
import { formatAmount } from "@/ui/format";
import type { Notices } from "@/ui/maproom/Notices";
import { RESOURCE_KEYS, RESOURCE_NAMES } from "@/ui/resourceIcon";

/**
 * "3 upgrades finished: Cannon Tower 5, Sniper Tower 3, Silo 7"
 * (`docs/design/yard-buildings.md` §3.1 "Notices").
 *
 * The server's catch-up says what finished in each answer (`completed`), and
 * this turns one answer's list into toasts in the yard's notice dock: one per
 * kind of job, so five upgrades landing in the same second are one line
 * rather than five. Every building in a toast is a button that selects it,
 * which is where a finished upgrade is looked at and the next one started.
 *
 * What the owner's own `/base/load` finished while they were away comes as
 * one toast instead, every kind in it: "While you were away: 2 upgrades
 * finished: Cannon Tower 5, Silo 7" (issue #135). The starter base an empty
 * yard was given is told first, as a sentence of its own: "Your yard is
 * ready: …" (issue #154).
 */

/** How long a job toast stays up on its own. */
export const JOB_NOTICE_TIMEOUT_MS = 10_000;

/**
 * How long the "While you were away" toast stays up: longer, since it lands
 * while the player is still taking in the yard they just opened.
 */
export const AWAY_NOTICE_TIMEOUT_MS = 20_000;

/** The lead-in of the one toast for what finished while the player was away. */
export const AWAY_PREFIX = "While you were away: ";

/** One building (or item) a toast names. */
export interface JobNoticeItem {
  /** "Cannon Tower 5". */
  readonly label: string;
  /** The building to select on a click, or null for a store item. */
  readonly buildingId: number | null;
}

/** One toast: every completed job of one kind in an answer. */
export interface JobNoticeGroup {
  readonly kind: string;
  /** "3 upgrades finished" or "Upgrade finished". */
  readonly heading: string;
  readonly items: readonly JobNoticeItem[];
  /**
   * Set for a kind told as one sentence around its items, "A " + "Map Room"
   * + " was added to your yard", rather than "heading: items".
   */
  readonly tail?: string;
  /**
   * Set for a kind told as a sentence of its own, ahead of the away toast's
   * "While you were away" rather than under it: the starter base.
   */
  readonly standalone?: boolean;
}

/** The store buffs a Phase 1 yard can hold, by code (`server/src/game-data/store/storeItems.ts`). */
const STORE_ITEM_NAMES: Readonly<Record<string, string>> = {
  BST: "Sharper Tools",
  CLOD: "Monster Locker overdrive",
  HOD: "Hatchery Overdrive 1",
  HOD2: "Hatchery Overdrive 2",
  HOD3: "Hatchery Overdrive 3",
  POD: "Production Overdrive",
  EXH: "Housing Expansion",
  PRO1: "Protection",
  PRO2: "Holiday Protection",
  PRO3: "Ultimate Protection",
};

/** Singular and plural nouns per kind; a kind a later phase adds reads as "<kind> finished". */
const NOUNS: Readonly<Record<string, readonly [string, string]>> = {
  upgrade: ["upgrade", "upgrades"],
  build: ["build", "builds"],
  fortify: ["fortification", "fortifications"],
  unlock: ["unlock", "unlocks"],
  train: ["training", "trainings"],
  research: ["research", "researches"],
  repair: ["repair", "repairs"],
};

const capitalise = (text: string): string => text.charAt(0).toUpperCase() + text.slice(1);

const headingOf = (kind: string, count: number): string => {
  if (kind === "storeItem") return count === 1 ? "Ran out" : `${count} boosts ran out`;
  if (kind === RADIO_REMOVED) {
    return count === 1 ? "The Radio Tower is gone" : `${count} Radio Towers are gone`;
  }
  if (kind === STARVED) return count === 1 ? "Your champion starved" : `Your champion starved ${count} times`;
  const [one, many] = NOUNS[kind] ?? [kind, kind];
  return count === 1 ? `${capitalise(one)} finished` : `${count} ${many} finished`;
};

/**
 * The catch-up takes every Radio Tower down once and refunds its build cost
 * (`server/src/services/yard/mapRoom.ts`, design §5.7, D15); the next load
 * says so in its away toast.
 */
const RADIO_REMOVED = "radioRemoved";

/**
 * A Map Room 2 yard that had no Map Room is given one by the catch-up
 * (`server/src/services/yard/mapRoom.ts`, owner decision 2026-09-28); the
 * next load says "A Map Room was added to your yard" in its away toast.
 */
const MAP_ROOM_ADDED = "mapRoomAdded";

/**
 * An empty main yard is given the original's starter set once by the
 * catch-up (`server/src/services/yard/starterBase.ts`, issue #154); the next
 * load says "Your yard is ready: a Town Hall and three starter buildings were
 * placed. You also got 1,600 Twigs and 1,600 Pebbles".
 */
const STARTER_BASE = "starterBase";

/**
 * A champion left hungry 24 hours past its feeding time loses a feed, or a
 * food bonus at the top level (`server/src/services/yard/catchUpChampions.ts`,
 * design §7.2, D11).
 */
const STARVED = "starve";

/**
 * Monsters the catch-up moved from a hatchery into housing, one entry per
 * type with its `count` (`server/src/services/yard/catchUpMonsters.ts`). A
 * busy yard hatches one every few seconds, so a live answer's hatches raise
 * no toast (the housing, the Monsters screen and the dock show them, #142);
 * the away toast says them once: "12 monsters hatched: 10 Pokey, 2 Octo-ooze".
 */
const HATCH = "hatch";

/** How many monsters a hatch entry moved into housing; 1 when it does not say. */
const hatchCount = (job: CompletedJob): number => {
  const count = Number((job.detail as { count?: unknown }).count);
  return Number.isFinite(count) && count > 0 ? count : 1;
};

/**
 * One of the player's outposts was attacked or taken while they were away
 * (outposts WP8, #187), or their Map Room 1 yard was attacked (bot neighbours
 * �4.8, #242). The server writes the whole sentence
 * (`server/src/services/maproom/v2/outpostNotices.ts`): "Bramble attacked your
 * outpost at (243, 206). It was left 63% damaged, and 1,234 Twigs were
 * looted." Told as a sentence of its own, ahead of what finished; the value
 * is what it says if the server sent no text.
 */
const SERVER_NOTICES: Readonly<Record<string, string>> = {
  outpostAttacked: "One of your outposts was attacked",
  outpostTaken: "One of your outposts was attacked",
  yardAttacked: "Your yard was attacked",
};

const isServerNotice = (job: CompletedJob): boolean => Object.hasOwn(SERVER_NOTICES, job.kind);

/** A server-written notice as its own sentence, with no buttons. */
const serverNoticeGroup = (job: CompletedJob): JobNoticeGroup => {
  const text = (job.detail as { text?: unknown }).text;
  return {
    kind: job.kind,
    heading: typeof text === "string" && text !== "" ? text.replace(/\.$/, "") : (SERVER_NOTICES[job.kind] ?? ""),
    items: [],
    tail: "",
    standalone: true,
  };
};

const COUNT_WORDS = ["no", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine"];

/** "1,600 Twigs and 1,600 Pebbles", or "" when nothing landed. */
const amountsLabel = (amounts: Record<string, unknown>): string => {
  const parts = RESOURCE_KEYS.flatMap((key) => {
    const amount = Number(amounts[key]);
    return amount > 0 ? [`${formatAmount(amount)} ${RESOURCE_NAMES[key]}`] : [];
  });
  if (parts.length <= 1) return parts.join("");
  return `${parts.slice(0, -1).join(", ")} and ${parts[parts.length - 1]}`;
};

/** The starter base's sentence around its Town Hall button. */
const starterGroup = (job: CompletedJob): JobNoticeGroup => {
  const detail = job.detail as { buildings?: unknown; resources?: unknown };
  const placedCount = Array.isArray(detail.buildings) ? detail.buildings.length : 1;
  const others = Math.max(0, placedCount - 1);
  const count = COUNT_WORDS[others] ?? String(others);
  const placed =
    others === 0
      ? " was placed"
      : ` and ${count} starter building${others === 1 ? "" : "s"} were placed`;
  const amounts = amountsLabel((detail.resources ?? {}) as Record<string, unknown>);
  return {
    kind: STARTER_BASE,
    heading: "Your yard is ready: a ",
    items: [{ label: "Town Hall", buildingId: typeof job.id === "number" ? job.id : null }],
    tail: amounts === "" ? placed : `${placed}. You also got ${amounts}`,
    standalone: true,
  };
};

/** "2,000 Twigs, 2,000 Pebbles, 2,000 Putty refunded", or "nothing refunded" (the storage was full). */
const refundLabel = (detail: Record<string, unknown>): string => {
  const refund = (detail["refund"] ?? {}) as Record<string, unknown>;
  const parts = RESOURCE_KEYS.flatMap((key) => {
    const amount = Number(refund[key]);
    return amount > 0 ? [`${formatAmount(amount)} ${RESOURCE_NAMES[key]}`] : [];
  });
  return parts.length > 0 ? `${parts.join(", ")} refunded` : "nothing refunded (your storage is full)";
};

const labelOf = (job: CompletedJob): JobNoticeItem => {
  if (job.kind === RADIO_REMOVED) return { label: refundLabel(job.detail), buildingId: null };
  if (job.kind === MAP_ROOM_ADDED) {
    return { label: "Map Room", buildingId: typeof job.id === "number" ? job.id : null };
  }
  if (job.kind === STARVED) {
    const entry = championEntry(String(job.id));
    const detail = job.detail as { level?: unknown };
    const top = entry !== undefined && typeof detail.level === "number" && detail.level >= entry.levels;
    return { label: `${entry?.name ?? String(job.id)} lost ${top ? "a food bonus" : "a feed"}`, buildingId: null };
  }
  if (job.kind === "storeItem") {
    const code = String(job.id);
    return { label: STORE_ITEM_NAMES[code] ?? code, buildingId: null };
  }
  if (job.kind === "unlock") {
    const id = String(job.id);
    return { label: monsterEntry(id)?.name ?? id, buildingId: null };
  }
  if (job.kind === HATCH) {
    const id = String(job.id);
    const count = hatchCount(job);
    const name = monsterEntry(id)?.name ?? id;
    return { label: count === 1 ? name : `${formatAmount(count)} ${name}`, buildingId: null };
  }
  if (job.kind === "train") {
    // "Fang 4", pointing at the academy that trained it (`catchUpTraining.ts`).
    const id = String(job.id);
    const detail = job.detail as { level?: unknown; academy?: unknown };
    const name = monsterEntry(id)?.name ?? id;
    return {
      label: typeof detail.level === "number" ? `${name} ${detail.level}` : name,
      buildingId: typeof detail.academy === "number" ? detail.academy : null,
    };
  }
  if (job.kind === "research") {
    // "Bolt: Teleportation 1", pointing at the Lab (`catchUpResearch`, `catchUpTraining.ts`).
    const id = String(job.id);
    const detail = job.detail as { rank?: unknown; lab?: unknown };
    const what = `${monsterEntry(id)?.name ?? id}: ${labAbility(id)?.name ?? "ability"}`;
    return {
      label: typeof detail.rank === "number" ? `${what} ${detail.rank}` : what,
      buildingId: typeof detail.lab === "number" ? detail.lab : null,
    };
  }
  const buildingId = typeof job.id === "number" ? job.id : null;
  const name = job.t === null ? String(job.id) : typeName(job.t);
  const detail = job.detail as { level?: unknown; fort?: unknown };
  const level = typeof detail.level === "number" ? detail.level : null;
  const fort = typeof detail.fort === "number" ? detail.fort : null;
  if (job.kind === "fortify" && fort !== null) {
    return { label: `${name} (fortification ${fort})`, buildingId };
  }
  // A new building is level 1, which goes without saying; a prefab says its level.
  if (job.kind === "build" && (level === null || level <= 1)) return { label: name, buildingId };
  return { label: level === null ? name : `${name} ${level}`, buildingId };
};

/**
 * One answer's `completed` list as toasts: grouped by kind in the order each
 * kind first appears, the jobs in each in the order they finished.
 */
export const groupCompletedJobs = (completed: readonly CompletedJob[]): JobNoticeGroup[] => {
  const starters = completed.filter((job) => job.kind === STARTER_BASE).map(starterGroup);
  const notices = completed.filter(isServerNotice).map(serverNoticeGroup);
  const byKind = new Map<string, JobNoticeItem[]>();
  for (const job of completed) {
    if (job.kind === STARTER_BASE || isServerNotice(job)) continue;
    const items = byKind.get(job.kind) ?? [];
    items.push(labelOf(job));
    byKind.set(job.kind, items);
  }
  const hatched = completed.reduce((sum, job) => (job.kind === HATCH ? sum + hatchCount(job) : sum), 0);
  return [
    ...starters,
    ...notices,
    ...[...byKind].map(([kind, items]) =>
      kind === MAP_ROOM_ADDED
        ? { kind, heading: "A ", items, tail: " was added to your yard" }
        : kind === HATCH
          ? { kind, heading: hatched === 1 ? "A monster hatched" : `${formatAmount(hatched)} monsters hatched`, items }
          : { kind, heading: headingOf(kind, items.length), items },
    ),
  ];
};

/** The toast's plain text, as a screen reader and the tests read it. */
export const noticeText = (group: JobNoticeGroup): string => {
  const items = group.items.map((item) => item.label).join(", ");
  return group.tail === undefined ? `${group.heading}: ${items}` : `${group.heading}${items}${group.tail}`;
};

/** A heading after the away lead-in, where it no longer starts the sentence. */
const awayHeading = (group: JobNoticeGroup): JobNoticeGroup => ({
  ...group,
  heading: group.heading.charAt(0).toLowerCase() + group.heading.slice(1),
});

/**
 * The away toast's plain text: "While you were away: 2 upgrades finished:
 * Cannon Tower 5, Silo 7; ran out: Sharper Tools", after any standalone
 * sentence ("Your yard is ready: …. While you were away: …"). Empty for no
 * groups.
 */
export const awayNoticeText = (groups: readonly JobNoticeGroup[]): string => {
  const standalone = groups.filter((group) => group.standalone).map(noticeText);
  const away = groups.filter((group) => !group.standalone);
  const rest = away.map((group) => noticeText(awayHeading(group))).join("; ");
  return [...standalone, ...(away.length === 0 ? [] : [AWAY_PREFIX + rest])].join(". ");
};

export class JobNotices {
  private readonly notices: Notices;
  private readonly select: (buildingId: number) => void;
  private count = 0;

  /** `select` selects a building: the scene's `selectBuilding`. */
  constructor(notices: Notices, select: (buildingId: number) => void) {
    this.notices = notices;
    this.select = select;
  }

  /** Shows one answer's completed jobs, less its hatches (see `HATCH`). Nothing for an empty list. */
  show(completed: readonly CompletedJob[]): void {
    for (const group of groupCompletedJobs(completed.filter((job) => job.kind !== HATCH))) {
      // A key per toast: a second batch landing while the first is still up is
      // news of its own, not a correction of the first.
      this.count += 1;
      this.notices.show(`job:${group.kind}:${this.count}`, this.message(group), {
        level: "info",
        timeoutMs: JOB_NOTICE_TIMEOUT_MS,
      });
    }
  }

  /**
   * Shows what the owner's load finished while they were away as one toast,
   * every kind in it. Nothing for an empty list.
   */
  showAway(completed: readonly CompletedJob[]): void {
    const groups = groupCompletedJobs(completed);
    if (groups.length === 0) return;
    const line = document.createElement("span");
    line.className = "job-notice job-notice--away";
    const standalone = groups.filter((group) => group.standalone);
    const away = groups.filter((group) => !group.standalone);
    standalone.forEach((group, index) => {
      if (index > 0) line.append(". ");
      this.appendGroup(line, group);
    });
    if (away.length > 0) {
      line.append(standalone.length > 0 ? `. ${AWAY_PREFIX}` : AWAY_PREFIX);
      away.forEach((group, index) => {
        if (index > 0) line.append("; ");
        this.appendGroup(line, awayHeading(group));
      });
    }
    this.count += 1;
    this.notices.show(`job:away:${this.count}`, line, {
      level: "info",
      timeoutMs: AWAY_NOTICE_TIMEOUT_MS,
    });
  }

  private message(group: JobNoticeGroup): HTMLElement {
    const line = document.createElement("span");
    line.className = "job-notice";
    this.appendGroup(line, group);
    return line;
  }

  /** "Heading: " then each item, a building as a button that selects it (or the group's sentence). */
  private appendGroup(line: HTMLElement, group: JobNoticeGroup): void {
    line.append(group.tail === undefined ? `${group.heading}: ` : group.heading);
    group.items.forEach((item, index) => {
      if (index > 0) line.append(", ");
      if (item.buildingId === null) {
        line.append(item.label);
        return;
      }
      const buildingId = item.buildingId;
      const button = document.createElement("button");
      button.type = "button";
      button.className = "job-notice__building";
      button.textContent = item.label;
      button.title = `Show ${item.label}`;
      button.addEventListener("click", () => this.select(buildingId));
      line.append(button);
    });
    if (group.tail !== undefined) line.append(group.tail);
  }
}
