import type { CompletedJob } from "@/api/types";
import { monsterEntry } from "@/game/monsters/monsterCatalogue";
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
 * finished: Cannon Tower 5, Silo 7" (issue #135).
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
  repair: ["repair", "repairs"],
};

const capitalise = (text: string): string => text.charAt(0).toUpperCase() + text.slice(1);

const headingOf = (kind: string, count: number): string => {
  if (kind === "storeItem") return count === 1 ? "Ran out" : `${count} boosts ran out`;
  if (kind === RADIO_REMOVED) {
    return count === 1 ? "The Radio Tower is gone" : `${count} Radio Towers are gone`;
  }
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
  if (job.kind === "storeItem") {
    const code = String(job.id);
    return { label: STORE_ITEM_NAMES[code] ?? code, buildingId: null };
  }
  if (job.kind === "unlock") {
    const id = String(job.id);
    return { label: monsterEntry(id)?.name ?? id, buildingId: null };
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
  const byKind = new Map<string, JobNoticeItem[]>();
  for (const job of completed) {
    const items = byKind.get(job.kind) ?? [];
    items.push(labelOf(job));
    byKind.set(job.kind, items);
  }
  return [...byKind].map(([kind, items]) =>
    kind === MAP_ROOM_ADDED
      ? { kind, heading: "A ", items, tail: " was added to your yard" }
      : { kind, heading: headingOf(kind, items.length), items },
  );
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
 * Cannon Tower 5, Silo 7; ran out: Sharper Tools". Empty for no groups.
 */
export const awayNoticeText = (groups: readonly JobNoticeGroup[]): string =>
  groups.length === 0 ? "" : AWAY_PREFIX + groups.map((group) => noticeText(awayHeading(group))).join("; ");

export class JobNotices {
  private readonly notices: Notices;
  private readonly select: (buildingId: number) => void;
  private count = 0;

  /** `select` selects a building: the scene's `selectBuilding`. */
  constructor(notices: Notices, select: (buildingId: number) => void) {
    this.notices = notices;
    this.select = select;
  }

  /** Shows one answer's completed jobs. Nothing for an empty list. */
  show(completed: readonly CompletedJob[]): void {
    for (const group of groupCompletedJobs(completed)) {
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
    line.append(AWAY_PREFIX);
    groups.forEach((group, index) => {
      if (index > 0) line.append("; ");
      this.appendGroup(line, awayHeading(group));
    });
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
