import type { AdminHealthReport, DashboardSection } from "./api";

/**
 * What goes in the box at the top of the dashboard: everything wrong right
 * now, worst first, each in everyday words with what it means for players,
 * what to do about it, and the section that shows more. No DOM.
 *
 * The server words its problems for the Telegram alerts, which are terse and
 * name files and settings. Here the known ones are said again plainly from
 * the same numbers; one this page does not know yet keeps the server's words.
 */

export interface Step {
  text: string;
  /** Something to type on the server (from /opt/bymr/server), if any. */
  command?: string;
}

export interface TopItem {
  /** "bad": something is broken; "warn": worth a look, or could not be checked. */
  level: "bad" | "warn";
  /** The server's problem key, or "unchecked:<what>" / "telegram". */
  key: string;
  title: string;
  /** What it means, for players and for the owner. */
  detail: string;
  steps: Step[];
  section: DashboardSection;
}

/** "11:00" in the viewer's own time for a UTC hour. */
export const localHour = (utcHour: number): string => {
  const at = new Date(Date.UTC(2026, 0, 15, utcHour));
  return `${String(at.getHours()).padStart(2, "0")}:${String(at.getMinutes()).padStart(2, "0")}`;
};

const percentOf = (report: AdminHealthReport): number | null => {
  const used = (report.health.disks ?? [])
    .map((disk) => disk.usedPercent)
    .filter((n): n is number => n !== null);
  return used.length ? Math.max(...used) : null;
};

type Explained = Pick<TopItem, "title" | "detail" | "steps">;

/** Plain words for the problems the server knows; null for one it added later. */
const explain = (key: string, report: AdminHealthReport): Explained | null => {
  const health = report.health;
  switch (key.split(":")[0]) {
    case "database":
      return {
        title: "The database is not answering",
        detail: "Players cannot load or save their yards until it is back.",
        steps: [
          { text: "See whether it is running:", command: "deploy/prod.sh ps" },
          { text: "If it is stopped or unhealthy, restart it:", command: "deploy/prod.sh restart db" },
        ],
      };
    case "redis":
      return {
        title: "The sign-in and chat store is not answering",
        detail: "Players cannot sign in, and chat stops, until it is back. (Its technical name is Redis.)",
        steps: [{ text: "Restart it:", command: "deploy/prod.sh restart redis" }],
      };
    case "host-status":
      return {
        title: "The machine has stopped reporting its health",
        detail:
          "The game may be fine, but this page cannot see disk space, backups or the server's parts until it reports again.",
        steps: [
          {
            text: "Switch the machine's health report back on:",
            command: "systemctl enable --now bymr-host-status.timer",
          },
        ],
      };
    case "disk": {
      const used = percentOf(report);
      return {
        title:
          used === null ? "The server's disk is nearly full" : `The server's disk is ${Math.round(used)}% full`,
        detail: "When it is full, saves and backups fail.",
        steps: [
          { text: "See how much the backups take:", command: "du -sh /opt/bymr/server/backups" },
          { text: "Then make the disk bigger at the VPS provider, or remove old files." },
        ],
      };
    }
    case "backup": {
      const newest = health.backups?.newest ?? null;
      const hours = newest?.ageHours ?? null;
      return {
        title: "Last night's backup did not happen",
        detail: newest
          ? `The newest backup is ${hours === null ? "of unknown age" : `${Math.round(hours)} hours old`}. One should be made every night at ${localHour(3)} your time.`
          : "There is no backup at all. One should be made every night.",
        steps: [
          { text: "Take one now:", command: "deploy/prod.sh exec backup bash /backup.sh" },
          { text: "If it fails, see why:", command: "deploy/prod.sh logs backup" },
        ],
      };
    }
    case "errors":
      return {
        title: "Far more server errors than usual",
        detail: "Something may be broken for players right now. The Errors list shows the newest ones.",
        steps: [
          { text: "If players cannot play, restart the game server:", command: "deploy/prod.sh restart web" },
        ],
      };
    default:
      return null;
  }
};

const UNCHECKED: Record<string, { title: string; section: DashboardSection }> = {
  disk: { title: "Disk space could not be checked", section: "health" },
  backup: { title: "Backups could not be checked", section: "backups" },
  errors: { title: "The error count could not be checked", section: "errors" },
};

export const topItems = (report: AdminHealthReport): TopItem[] => {
  const items: TopItem[] = report.problems.map((problem) => ({
    level: "bad",
    key: problem.key,
    section: problem.section,
    ...(explain(problem.key, report) ?? { title: problem.title, detail: problem.detail, steps: [] }),
  }));
  for (const key of report.unchecked) {
    const known = UNCHECKED[key];
    items.push({
      level: "warn",
      key: `unchecked:${key}`,
      title: known?.title ?? `"${key}" could not be checked`,
      detail: "Probably nothing wrong: the check could not run just now. It tries again every minute.",
      steps: [],
      section: known?.section ?? "health",
    });
  }
  if (!report.telegram) {
    items.push({
      level: "warn",
      key: "telegram",
      title: "Telegram alerts are off",
      detail: "Problems are not sent to your phone; you only see them here.",
      steps: [
        {
          text: "Put TELEGRAM_BOT_TOKEN and TELEGRAM_CHAT_ID in production.env, then:",
          command: "deploy/prod.sh up -d web",
        },
      ],
      section: "health",
    });
  }
  return items;
};

/** The headline over the box: one short sentence for the whole page. */
export const verdict = (items: readonly TopItem[]): string => {
  const bad = items.filter((item) => item.level === "bad").length;
  const warn = items.length - bad;
  if (bad) return bad === 1 ? "1 problem needs you" : `${bad} problems need you`;
  if (warn) return warn === 1 ? "Running fine, 1 thing to check" : `Running fine, ${warn} things to check`;
  return "Everything is running fine";
};
